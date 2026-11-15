package com.notiforwarder.sender

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Small line icons drawn in code (no icon library), like the tab icons, on a 24 x 24 grid. */
enum class AppIcon { Check, Alert, ChevronRight, ChevronLeft }

@Composable
fun IconMark(icon: AppIcon, color: Color, modifier: Modifier = Modifier, size: Dp = 16.dp) {
    Canvas(modifier.size(size)) {
        val unit = this.size.width / 24f
        val stroke = Stroke(width = 2.4f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun p(x: Float, y: Float) = Offset(x * unit, y * unit)
        when (icon) {
            AppIcon.Check -> drawPath(
                Path().apply {
                    moveTo(5 * unit, 12.5f * unit)
                    lineTo(10 * unit, 17.5f * unit)
                    lineTo(19 * unit, 7 * unit)
                },
                color,
                style = stroke,
            )
            AppIcon.Alert -> {
                drawLine(color, p(12f, 5f), p(12f, 13.5f), stroke.width, StrokeCap.Round)
                drawCircle(color, radius = 1.4f * unit, center = p(12f, 18.5f))
            }
            AppIcon.ChevronRight -> drawPath(
                Path().apply {
                    moveTo(9 * unit, 5 * unit)
                    lineTo(16 * unit, 12 * unit)
                    lineTo(9 * unit, 19 * unit)
                },
                color,
                style = stroke,
            )
            AppIcon.ChevronLeft -> drawPath(
                Path().apply {
                    moveTo(15 * unit, 5 * unit)
                    lineTo(8 * unit, 12 * unit)
                    lineTo(15 * unit, 19 * unit)
                },
                color,
                style = stroke,
            )
        }
    }
}
