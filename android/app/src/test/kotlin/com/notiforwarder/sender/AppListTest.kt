package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class AppListTest {
    private val apps = listOf(
        AppEntry("com.whatsapp", "WhatsApp"),
        AppEntry("com.android.chrome", "Chrome"),
        AppEntry("com.bank.mobile", "my Bank"),
        AppEntry("com.game.fun", "Fun Game"),
    )

    @Test
    fun `lists apps by name, ignoring case`() {
        assertEquals(
            listOf("Chrome", "Fun Game", "my Bank", "WhatsApp"),
            filterApps(apps, query = "").map { it.label },
        )
    }

    @Test
    fun `searches by name or by package, ignoring case and spaces around the query`() {
        assertEquals(listOf("my Bank"), filterApps(apps, "BANK").map { it.label })
        assertEquals(listOf("Chrome"), filterApps(apps, "android.chrome").map { it.label })
        assertEquals(listOf("Fun Game"), filterApps(apps, "  fun ").map { it.label })
    }

    @Test
    fun `finds nothing for a query that matches no app`() {
        assertEquals(emptyList<AppEntry>(), filterApps(apps, "zzz"))
    }
}
