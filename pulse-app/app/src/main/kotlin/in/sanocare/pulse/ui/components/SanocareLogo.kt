package `in`.sanocare.pulse.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareInterFamily

// Faithful reproduction of Sanocare_Marketing_Context/Logos/Sanocare_Lockup_HD.svg:
// the two-lobe butterfly mark (identical path data to the SVG) + the "Sanocare"
// wordmark in Inter 800, brand blue. The SVG itself is exactly mark + <text>, so
// this is the lockup, not a stand-in.

// viewBox of the mark in path space: x∈[58,203], y∈[72,214] → 145 × 142.
private const val MARK_D1 =
    "M64.25,131.47 C69.26,122.87 76.58,119.23 86.02,119.36 C89.85,119.41 93.7,119.44 97.49,119.04 " +
        "C104.14,118.34 106.98,115.39 107.38,108.77 C107.69,103.79 107.35,98.78 107.69,93.81 " +
        "C108.46,82.62 117.47,74.32 128.85,74.03 C140.55,73.74 150.61,82.09 152.05,93.12 " +
        "C154.07,108.58 148.75,121.64 138.81,133.01 C127.51,145.95 114.34,156.54 98,162.48 " +
        "C88.57,165.91 79.07,166.61 70.45,160.03 C61.71,153.37 59.56,143.53 64.25,131.47 Z"
private const val MARK_D2 =
    "M147.6,202.53 C139.98,210.25 131.37,211.96 121.75,208.02 C112.36,204.18 108.35,196.78 107.9,186.86 " +
        "C107.4,175.99 111.11,167.01 118.87,159.53 C129.04,149.71 139.15,139.81 149.32,129.98 " +
        "C158.27,121.32 168.72,117.28 181.21,119.99 C192.18,122.37 199.57,132.16 198.97,143.34 " +
        "C198.38,154.29 190.32,163.07 179.25,164.3 C174.3,164.85 169.27,164.55 164.29,164.78 " +
        "C156.82,165.14 153.76,167.93 153.02,175.37 C152.52,180.34 152.94,185.43 152.06,190.31 " +
        "C151.32,194.42 149.3,198.29 147.6,202.53 Z"

@Composable
fun SanocareMark(size: Dp, color: Color = SanocareBlue) {
    val p1 = remember { PathParser().parsePathString(MARK_D1).toPath() }
    val p2 = remember { PathParser().parsePathString(MARK_D2).toPath() }
    Canvas(modifier = Modifier.size(size)) {
        val scale = this.size.minDimension / 145f
        withTransform({
            scale(scale, scale, pivot = Offset.Zero)
            translate(-58f, -72f)
        }) {
            drawPath(p1, color)
            drawPath(p2, color)
        }
    }
}

@Composable
fun SanocareLockup(
    modifier: Modifier = Modifier,
    markSize: Dp = 28.dp,
    wordmarkSp: Int = 22,
    color: Color = SanocareBlue,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        SanocareMark(size = markSize, color = color)
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = "Sanocare",
            color = color,
            fontFamily = SanocareInterFamily,
            fontWeight = FontWeight.ExtraBold,
            fontSize = wordmarkSp.sp,
        )
    }
}
