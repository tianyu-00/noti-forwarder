package com.notiforwarder.sender

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// The same palette the web dashboard uses (Tailwind slate / sky), so both feel like one product.
private val Slate100 = Color(0xFFF1F5F9)
private val Slate400 = Color(0xFF94A3B8)
private val Slate600 = Color(0xFF475569)
private val Slate700 = Color(0xFF334155)
private val Slate800 = Color(0xFF1E293B)
private val Slate900 = Color(0xFF0F172A)
private val Sky400 = Color(0xFF38BDF8)
private val Sky600 = Color(0xFF0284C7)
private val Red400 = Color(0xFFF87171)
private val Emerald400 = Color(0xFF34D399)

private val NotiColors = darkColorScheme(
    primary = Sky600,
    onPrimary = Color.White,
    secondary = Sky400,
    onSecondary = Slate900,
    tertiary = Emerald400, // "good" states: paired, granted
    onTertiary = Slate900,
    error = Red400,
    onError = Slate900,
    background = Slate900,
    onBackground = Slate100,
    surface = Slate900,
    onSurface = Slate100,
    surfaceVariant = Slate800,
    onSurfaceVariant = Slate400,
    surfaceContainer = Slate800,
    surfaceContainerHigh = Slate700,
    outline = Slate600,
    outlineVariant = Slate700,
)

/** Always dark, like the web dashboard. */
@Composable
fun NotiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = NotiColors, content = content)
}

/** The quieter button: light-blue text on the page, like the web's secondary actions. */
@Composable
fun SecondaryButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.secondary),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        content = content,
    )
}
