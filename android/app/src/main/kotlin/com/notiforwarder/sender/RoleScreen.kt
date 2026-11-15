package com.notiforwarder.sender

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Shown on a new install: is this phone the one that forwards notifications, or the one that shows them? */
@Composable
internal fun RoleScreen(onChoose: (AppRole) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Notiforwarder")
        Text(
            "How will you use this phone?",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            Text("Sender", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "This phone forwards its notifications and texts to your server. Use it on the phones you want to watch.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            PrimaryButton(onClick = { onChoose(AppRole.Sender) }, modifier = Modifier.fillMaxWidth()) { Text("Use as a sender") }
        }
        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            Text("Receiver", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "This phone shows your alerts: each message from your sender phones, with its text and 2FA code. Use it on your main phone.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            PrimaryButton(onClick = { onChoose(AppRole.Receiver) }, modifier = Modifier.fillMaxWidth()) { Text("Use as a receiver") }
        }
        Text(
            "You can change this later in Settings.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
