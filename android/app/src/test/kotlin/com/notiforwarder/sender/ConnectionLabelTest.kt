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

class ConnectionHeadlineTest {
    @Test
    fun `gives the big word on the status card`() {
        assertEquals("Connected", connectionHeadline(ConnectionState.Connected))
        assertEquals("Connecting…", connectionHeadline(ConnectionState.Connecting))
        assertEquals("Reconnecting…", connectionHeadline(ConnectionState.Reconnecting))
        assertEquals("Not connected", connectionHeadline(ConnectionState.Stopped))
    }
}

class ServerNameTest {
    @Test
    fun `drops the scheme and any trailing slash`() {
        assertEquals("notify.example.com", serverName("https://notify.example.com/"))
        assertEquals("192.168.1.10:3100", serverName("http://192.168.1.10:3100"))
    }

    @Test
    fun `keeps what it cannot read as it was`() {
        assertEquals("not a url", serverName("not a url"))
    }
}
