package `in`.sanocare.pulse.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Phone
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.theme.SanocareCoral
import `in`.sanocare.pulse.theme.SanocareCoralSoft
import `in`.sanocare.pulse.theme.SanocareMonoFamily

// ── Buttons ───────────────────────────────────────────────────────────────────

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Surface(
        onClick = { if (enabled && !loading) onClick() },
        enabled = enabled && !loading,
        shape = RoundedCornerShape(14.dp),
        color = if (enabled) SanocareBlue else BorderHair,
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (loading) {
                CircularProgressIndicator(color = Paper, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            } else {
                Text(
                    text = text,
                    color = Paper,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }
        }
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = Paper,
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderHair),
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text = text, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

// ── Phone field (Concept A): +91 mono prefix + 10-digit input, blue focus ring ─

@Composable
fun PhoneField(
    value: String,
    onValueChange: (String) -> Unit,
    hint: String,
    focused: Boolean,
    onFocusChanged: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(Paper, RoundedCornerShape(14.dp))
            .border(
                width = if (focused) 2.dp else 1.dp,
                color = if (focused) SanocareBlue else BorderHair,
                shape = RoundedCornerShape(14.dp),
            )
            .padding(horizontal = 16.dp),
    ) {
        Text(
            text = "+91",
            fontFamily = SanocareMonoFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 16.sp,
            color = InkPrimary,
        )
        Spacer(Modifier.width(8.dp))
        Box(
            modifier = Modifier
                .width(1.dp)
                .height(22.dp)
                .background(BorderHair),
        )
        Spacer(Modifier.width(12.dp))
        BasicTextField(
            value = value,
            onValueChange = { onValueChange(it.filter { c -> c.isDigit() }.take(10)) },
            singleLine = true,
            cursorBrush = SolidColor(SanocareBlue),
            textStyle = LocalTextStyle.current.copy(
                color = InkPrimary,
                fontSize = 16.sp,
                fontFamily = SanocareMonoFamily,
            ),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { onFocusChanged(it.isFocused) },
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text(hint, color = InkMute, fontSize = 16.sp)
                }
                inner()
            },
        )
    }
}

// ── OTP boxes: 6 monospaced cells driven by one hidden field ────────────────────

@Composable
fun OtpBoxes(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        BasicTextField(
            value = value,
            onValueChange = { onValueChange(it.filter { c -> c.isDigit() }.take(6)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            textStyle = TextStyle(color = androidx.compose.ui.graphics.Color.Transparent),
            cursorBrush = SolidColor(androidx.compose.ui.graphics.Color.Transparent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = {
                Row(
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    repeat(6) { i ->
                        val ch = value.getOrNull(i)?.toString() ?: ""
                        val active = i == value.length
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(width = 48.dp, height = 56.dp)
                                .background(Paper, RoundedCornerShape(12.dp))
                                .border(
                                    width = if (active) 2.dp else 1.dp,
                                    color = if (active) SanocareBlue else BorderHair,
                                    shape = RoundedCornerShape(12.dp),
                                ),
                        ) {
                            Text(
                                text = ch,
                                fontFamily = SanocareMonoFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 22.sp,
                                color = InkPrimary,
                            )
                        }
                    }
                }
            },
        )
    }
}

// ── Emergency ribbon (the single coral accent) ─────────────────────────────────

@Composable
fun EmergencyRibbon(text: String, modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .background(SanocareCoralSoft, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Phone,
            contentDescription = null,
            tint = SanocareCoral,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text = text, color = SanocareCoral, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

// ── Outcome tile (Home) ─────────────────────────────────────────────────────────

@Composable
fun OutcomeTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = Paper,
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderHair),
        modifier = modifier.height(150.dp),
    ) {
        Column(
            verticalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.padding(14.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(40.dp)
                    .background(SanocareBlueSoft, RoundedCornerShape(12.dp)),
            ) {
                Icon(imageVector = icon, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(22.dp))
            }
            Column {
                Text(text = title, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(Modifier.height(2.dp))
                Text(text = subtitle, color = InkMute, fontSize = 12.sp, lineHeight = 15.sp)
            }
        }
    }
}

// ── Snapshot card (empty-state stub in PB1) ─────────────────────────────────────

@Composable
fun SnapshotCard(title: String, emptyText: String, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Paper,
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderHair),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = title.uppercase(),
                color = InkMute,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
            )
            Spacer(Modifier.height(8.dp))
            Text(text = emptyText, color = InkMute, fontSize = 14.sp)
        }
    }
}
