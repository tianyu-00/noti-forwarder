package com.notiforwarder.sender

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

// The same green design as the web dashboard, in light and dark. Cards sit on a soft page colour;
// green marks what is on, what is good, and the one main action.
private val LightColors = lightColorScheme(
    primary = Color(0xFF12805C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD8F3E4),
    onPrimaryContainer = Color(0xFF0D5C41),
    secondary = Color(0xFF12805C),
    onSecondary = Color.White,
    tertiary = Color(0xFF16A34A), // "good" states: connected, granted
    onTertiary = Color.White,
    error = Color(0xFFDC2626),
    onError = Color.White,
    background = Color(0xFFE9EEEB),
    onBackground = Color(0xFF14211B),
    surface = Color(0xFFE9EEEB),
    onSurface = Color(0xFF14211B),
    surfaceVariant = Color(0xFFEEF2EF),
    onSurfaceVariant = Color(0xFF5D6F65),
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFEEF2EF),
    outline = Color(0xFF8A9A91),
    outlineVariant = Color(0xFFE3EAE6),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF3DDC97),
    onPrimary = Color(0xFF0A0F0D),
    primaryContainer = Color(0xFF163527),
    onPrimaryContainer = Color(0xFF7BE3B3),
    secondary = Color(0xFF3DDC97),
    onSecondary = Color(0xFF0A0F0D),
    tertiary = Color(0xFF3DDC97),
    onTertiary = Color(0xFF0A0F0D),
    error = Color(0xFFFF6B6B),
    onError = Color(0xFF0A0F0D),
    background = Color(0xFF0A0F0D),
    onBackground = Color(0xFFE6EFEA),
    surface = Color(0xFF0A0F0D),
    onSurface = Color(0xFFE6EFEA),
    surfaceVariant = Color(0xFF1B2822),
    onSurfaceVariant = Color(0xFF8FA398),
    surfaceContainer = Color(0xFF111A15),
    surfaceContainerHigh = Color(0xFF1B2822),
    outline = Color(0xFF7F9388),
    outlineVariant = Color(0xFF1D2B24),
)

private val NotiShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(22.dp),
)

@Composable
fun NotiTheme(dark: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, shapes = NotiShapes, content = content)
}

/** Amber, for "check this" rows. Not part of the Material colour set, so picked by the theme. */
val MaterialTheme.warn: Color
    @Composable get() = if (colorScheme.background.luminance() < 0.5f) Color(0xFFFFC857) else Color(0xFFB45309)

private val ButtonPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)
private val ButtonHeight = 48.dp

/** The one main action on a screen: filled green. */
@Composable
fun PrimaryButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = ButtonHeight),
        shape = MaterialTheme.shapes.medium,
        contentPadding = ButtonPadding,
        content = content,
    )
}

/** Every other action: outlined. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = ButtonHeight),
        shape = MaterialTheme.shapes.medium,
        contentPadding = ButtonPadding,
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onBackground,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}
