package `in`.sanocare.medic.attendance

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import dagger.hilt.android.AndroidEntryPoint
import `in`.sanocare.medic.MainActivity
import `in`.sanocare.medic.R
import `in`.sanocare.medic.data.network.IncomingPing
import `in`.sanocare.medic.data.network.LocationApi
import `in`.sanocare.medic.data.network.LocationBatch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import javax.inject.Inject

// T65 Phase 1.5 — adherence tracking foreground service.
//
// Lifecycle: started on clock-in API success, stopped on clock-out API
// success (or on system kill via START_STICKY). Persistent notification
// (non-dismissible) is the legal basis for background location access
// — we DO NOT runtime-request ACCESS_BACKGROUND_LOCATION in v0 (low
// grant rate; foreground-service-with-notification is sufficient).
//
// Location pings: FusedLocationProviderClient with
// BALANCED_POWER_ACCURACY, interval 60s, min-interval 45s for burst
// tolerance. Each ping snapshots battery_pct + speed_mps too.
//
// Batching: in-memory ArrayList, flush every 5 min OR when buffer hits
// MAX_BUFFER_SIZE (10). Network failure → batch dropped (no Room queue
// in v0 — that's v0.1+ scope per the brief).
//
// On destroy: final flush with 2s timeout, then teardown. Pings buffered
// since the last flush are lost on force-kill (acknowledged tradeoff).

@AndroidEntryPoint
class MedicAttendanceService : Service() {

    @Inject lateinit var locationApi: LocationApi
    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val pingBuffer = mutableListOf<IncomingPing>()
    private val bufferLock = Any()
    private var locationCallback: LocationCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Starting foreground attendance service")
        startForegroundWithNotification()
        startLocationUpdates()
        startBatchLoop()
        return START_STICKY
    }

    private fun startForegroundWithNotification() {
        ensureChannel()
        val notification = buildNotification()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            } else 0,
        )
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            LOCATION_INTERVAL_MS,
        ).setMinUpdateIntervalMillis(LOCATION_MIN_INTERVAL_MS).build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    val ping = IncomingPing(
                        pingedAt = Instant.now().toString(),
                        lat = loc.latitude,
                        lng = loc.longitude,
                        accuracyM = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
                        batteryPct = readBatteryPct(),
                        speedMps = if (loc.hasSpeed()) loc.speed.toDouble() else null,
                    )
                    val shouldFlush: Boolean
                    synchronized(bufferLock) {
                        pingBuffer.add(ping)
                        shouldFlush = pingBuffer.size >= MAX_BUFFER_SIZE
                    }
                    if (shouldFlush) scope.launch { flushBatch() }
                }
            }
        }
        locationCallback = callback

        try {
            fusedLocationClient.requestLocationUpdates(
                request, callback, Looper.getMainLooper(),
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permission revoked — stopping service", e)
            stopSelf()
        }
    }

    private fun startBatchLoop() {
        scope.launch {
            while (isActive) {
                delay(BATCH_INTERVAL_MS)
                flushBatch()
            }
        }
    }

    private suspend fun flushBatch() {
        val toSend: List<IncomingPing> = synchronized(bufferLock) {
            if (pingBuffer.isEmpty()) return
            val copy = pingBuffer.toList()
            pingBuffer.clear()
            copy
        }
        try {
            val response = locationApi.postBatch(LocationBatch(pings = toSend))
            if (!response.isSuccessful) {
                Log.w(TAG, "Batch HTTP ${response.code()} — ${toSend.size} pings dropped")
            } else {
                Log.i(TAG, "Batch ok — ${toSend.size} pings accepted")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Batch send failed — ${toSend.size} pings dropped (v0 has no offline queue)", e)
        }
    }

    private fun readBatteryPct(): Int? {
        return try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
            val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (pct in 0..100) pct else null
        } catch (e: Exception) {
            null
        }
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_attendance_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.notification_channel_attendance_description)
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_attendance_title))
            .setContentText(getString(R.string.notification_attendance_body))
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    override fun onDestroy() {
        Log.i(TAG, "Service onDestroy — final flush + teardown")
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
        // Best-effort final flush before the scope cancels. 2s ceiling so a
        // network stall doesn't block service stop.
        runBlocking { withTimeoutOrNull(2_000L) { flushBatch() } }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val TAG = "MedicAttendanceSvc"
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "sanocare_medic_attendance"
        const val LOCATION_INTERVAL_MS = 60_000L
        const val LOCATION_MIN_INTERVAL_MS = 45_000L
        const val BATCH_INTERVAL_MS = 5L * 60L * 1000L
        const val MAX_BUFFER_SIZE = 10

        @Suppress("UNUSED_PARAMETER")
        fun requiredRuntimePermissions(): Array<String> {
            val base = mutableListOf(
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                base.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            return base.toTypedArray()
        }
    }
}
