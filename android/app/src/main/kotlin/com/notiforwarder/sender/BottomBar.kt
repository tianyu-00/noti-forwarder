package com.notiforwarder.sender

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/** The tab bar at the bottom: an icon and a name for each tab, the current one in a green pill. */
@Composable
fun BottomBar(tabs: List<Tab>, current: Tab, onSelect: (Tab) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.outlineVariant))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.surfaceContainer)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            for (tab in tabs) {
                val on = tab == current
                val tone = if (on) colors.onPrimaryContainer else colors.onSurfaceVariant
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            role = Role.Tab,
                            onClick = { onSelect(tab) },
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .width(58.dp)
                            .height(30.dp)
                            .clip(CircleShape)
                            .background(if (on) colors.primaryContainer else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        TabIcon(tab, tone)
                    }
                    Text(
                        tab.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                        color = tone,
                    )
                }
            }
        }
    }
}

/** Line icons drawn in code (no icon library), on a 24 x 24 grid scaled to the box. */
@Composable
private fun TabIcon(tab: Tab, color: Color) {
    Canvas(Modifier.size(20.dp)) {
        val unit = size.width / 24f
        val stroke = Stroke(width = 2.1f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun p(x: Float, y: Float) = Offset(x * unit, y * unit)
        when (tab) {
            Tab.Status -> drawPath(
                Path().apply {
                    moveTo(4 * unit, 13 * unit)
                    lineTo(8 * unit, 13 * unit)
                    lineTo(11 * unit, 5 * unit)
                    lineTo(15 * unit, 19 * unit)
                    lineTo(18 * unit, 13 * unit)
                    lineTo(20 * unit, 13 * unit)
                },
                color,
                style = stroke,
            )
            Tab.Forward -> {
                drawLine(color, p(4f, 7f), p(20f, 7f), stroke.width, StrokeCap.Round)
                drawLine(color, p(7f, 12f), p(17f, 12f), stroke.width, StrokeCap.Round)
                drawLine(color, p(10f, 17f), p(14f, 17f), stroke.width, StrokeCap.Round)
            }
            Tab.Activity -> {
                drawCircle(color, radius = 8f * unit, center = p(12f, 12f), style = stroke)
                drawPath(
                    Path().apply {
                        moveTo(12 * unit, 8 * unit)
                        lineTo(12 * unit, 12 * unit)
                        lineTo(15 * unit, 14 * unit)
                    },
                    color,
                    style = stroke,
                )
            }
            Tab.Settings -> {
                drawCircle(color, radius = 3f * unit, center = p(12f, 12f), style = stroke)
                drawCircle(color, radius = 7f * unit, center = p(12f, 12f), style = stroke)
                rays(color, stroke.width, unit)
            }
        }
    }
}

// Eight short teeth around the gear.
private fun DrawScope.rays(color: Color, width: Float, unit: Float) {
    val centre = Offset(12 * unit, 12 * unit)
    for (i in 0 until 8) {
        val angle = Math.toRadians(i * 45.0).toFloat()
        val from = Offset(centre.x + cos(angle) * 8.5f * unit, centre.y + sin(angle) * 8.5f * unit)
        val to = Offset(centre.x + cos(angle) * 10.5f * unit, centre.y + sin(angle) * 10.5f * unit)
        drawLine(color, from, to, width, StrokeCap.Round)
    }
}
