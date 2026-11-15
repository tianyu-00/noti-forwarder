package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

// The receiver phone does not have the sender's apps installed, so the list of apps you can turn off is made from
// the notifications it has actually received.
class AppsSeenTest {
    private fun m(type: String, app: String, label: String? = null) =
        ReceivedMessage("id-$app-$type-${label ?: ""}", "d1", null, type, app, label, "", "x", "2026-11-11T10:00:05.000Z", null)

    @Test
    fun `lists each app that sent a notification once, by its real name, in alphabetical order`() {
        val seen = appsSeen(
            listOf(
                m("notification", "com.google.android.gm", "Gmail"),
                m("notification", "com.example.bank", "Northwind Bank"),
                m("notification", "com.google.android.gm", "Gmail"),
            ),
        )

        assertEquals(listOf(SeenApp("com.google.android.gm", "Gmail"), SeenApp("com.example.bank", "Northwind Bank")).sortedBy { it.name }, seen)
    }

    @Test
    fun `texts are not an app, so they are left out`() {
        assertEquals(emptyList<SeenApp>(), appsSeen(listOf(m("sms", "sms"))))
    }

    @Test
    fun `an app with no known name is listed by its package name`() {
        assertEquals(listOf(SeenApp("com.example.game", "com.example.game")), appsSeen(listOf(m("notification", "com.example.game"))))
    }

    @Test
    fun `a name learnt later replaces the package name`() {
        val seen = appsSeen(listOf(m("notification", "com.example.bank"), m("notification", "com.example.bank", "Northwind Bank")))

        assertEquals(listOf(SeenApp("com.example.bank", "Northwind Bank")), seen)
    }
}
