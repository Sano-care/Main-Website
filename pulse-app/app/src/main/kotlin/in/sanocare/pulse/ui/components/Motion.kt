package `in`.sanocare.pulse.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import `in`.sanocare.pulse.theme.Paper

// v2 motion — a press-scale clickable (cards dip to 0.96 over 120ms). Kept in one
// place so every card/tile shares the same feel.

@Composable
fun Modifier.pressScaleClickable(onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = tween(durationMillis = 120),
        label = "press-scale",
    )
    return this
        .scale(scale)
        .clickable(interactionSource = interaction, indication = null) { onClick() }
}

// v2 motion — fade + rise on first appearance (200ms). Applied to glance cards and
// list sections so content settles in rather than snapping.
@Composable
fun Modifier.fadeRiseOnAppear(delayMillis: Int = 0): Modifier {
    var shown by remember { mutableStateOf(false) }
    val progress by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = 200, delayMillis = delayMillis),
        label = "fade-rise",
    )
    val density = LocalDensity.current
    LaunchedEffect(Unit) { shown = true }
    return this.graphicsLayer {
        alpha = progress
        translationY = with(density) { (1f - progress) * 16.dp.toPx() }
    }
}

// v2 motion — pull-to-refresh that spins the Sanocare butterfly mark instead of the
// default Material spinner. Wraps any scrollable content.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PulseRefreshBox(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        state = state,
        modifier = modifier,
        indicator = {
            val pull = state.distanceFraction
            val visible = refreshing || pull > 0f
            if (visible) {
                val spin = rememberInfiniteTransition(label = "mark-spin")
                val angle by spin.animateFloat(
                    initialValue = 0f,
                    targetValue = 360f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(durationMillis = 900, easing = LinearEasing),
                        repeatMode = RepeatMode.Restart,
                    ),
                    label = "mark-angle",
                )
                // While pulling, follow the finger; while refreshing, spin freely.
                val rotation = if (refreshing) angle else pull * 180f
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 18.dp)
                        .size(40.dp)
                        .background(Paper, CircleShape)
                        .graphicsLayer {
                            alpha = if (refreshing) 1f else pull.coerceIn(0f, 1f)
                            rotationZ = rotation
                        },
                ) {
                    SanocareMark(size = 24.dp)
                }
            }
        },
        content = content,
    )
}
