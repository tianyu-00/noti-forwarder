package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionLabelTest {
    @Test
    fun `says plainly what the connection is doing`() {
        assertEquals(ConnectionLabel("Connected to the server", good = true), describeConnection(ConnectionState.Connected))
        assertEquals(ConnectionLabel("Reconnecting…", good = false), describeConnection(ConnectionState.Reconnecting))
        assertEquals(ConnectionLabel("Connecting…", good = false), describeConnection(ConnectionState.Connecting))
        assertEquals(ConnectionLabel("Not connected", good = false), describeConnection(ConnectionState.Stopped))
    }
}
