package com.notiforwarder.sender

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// Black and white, the same two themes as the web dashboard (zinc greys). No accent colour:
// the main action is the filled button, everything else is outlined or plain text.
private val LightColors = lightColorScheme(
    primary = Color(0xFF09090B),
    onPrimary = Color(0xFFFAFAFA),
    secondary = Color(0xFF09090B),
    onSecondary = Color(0xFFFAFAFA),
    tertiary = Color(0xFF16A34A), // "good" states: paired, granted
    onTertiary = Color.White,
    error = Color(0xFFDC2626),
    onError = Color.White,
    background = Color.White,
    onBackground = Color(0xFF09090B),
    surface = Color.White,
    onSurface = Color(0xFF09090B),
    surfaceVariant = Color(0xFFF4F4F5),
    onSurfaceVariant = Color(0xFF52525B),
    surfaceContainer = Color(0xFFFAFAFA),
    surfaceContainerHigh = Color(0xFFF4F4F5),
    outline = Color(0xFFA1A1AA),
    outlineVariant = Color(0xFFE4E4E7),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFAFAFA),
    onPrimary = Color(0xFF09090B),
    secondary = Color(0xFFFAFAFA),
    onSecondary = Color(0xFF09090B),
    tertiary = Color(0xFF4ADE80),
    onTertiary = Color(0xFF09090B),
    error = Color(0xFFEF4444),
    onError = Color.White,
    background = Color(0xFF09090B),
    onBackground = Color(0xFFFAFAFA),
    surface = Color(0xFF09090B),
    onSurface = Color(0xFFFAFAFA),
    surfaceVariant = Color(0xFF18181B),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainer = Color(0xFF0F0F12),
    surfaceContainerHigh = Color(0xFF18181B),
    outline = Color(0xFF52525B),
    outlineVariant = Color(0xFF27272A),
)

private val NotiShapes = Shapes(
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(12.dp),
)

@Composable
fun NotiTheme(dark: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, shapes = NotiShapes, content = content)
}

private val ButtonPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)
private val ButtonHeight = 48.dp

/** The one main action on a screen: filled. */
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
fun SecondaryButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = ButtonHeight),
        shape = MaterialTheme.shapes.medium,
        contentPadding = ButtonPadding,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onBackground),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}

/** A small heading with the things that belong to it underneath. */
@Composable
fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

/** Pick one of a few options: the chosen one is filled, the rest outlined. */
@Composable
fun <T> Choice(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((value, label) in options) {
            val modifier = Modifier.weight(1f)
            if (value == selected) {
                PrimaryButton(onClick = { onSelect(value) }, modifier = modifier) { Text(label) }
            } else {
                SecondaryButton(onClick = { onSelect(value) }, modifier = modifier) { Text(label) }
            }
        }
    }
}
