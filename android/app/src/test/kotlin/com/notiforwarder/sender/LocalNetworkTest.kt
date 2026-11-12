package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalNetworkTest {
    @Test
    fun `private IPv4 ranges are local`() {
        for (host in listOf("10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20", "169.254.10.1", "127.0.0.1")) {
            assertTrue("$host should be local", LocalNetwork.isLocalHost(host))
        }
    }

    @Test
    fun `local names are local`() {
        for (host in listOf("localhost", "rpi-server", "nas", "printer.local", "Pi.LOCAL")) {
            assertTrue("$host should be local", LocalNetwork.isLocalHost(host))
        }
    }

    @Test
    fun `public addresses and look-alikes are not local`() {
        val hosts = listOf(
            "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1", "169.253.1.1",
            "nf.example.com", "10.evil.com", "192.168.1.1.evil.com", "localhost.evil.com",
            "300.1.1.1", "192.168.1", "", "evil.local.com", "134744072",
        )
        for (host in hosts) {
            assertFalse("$host must not be local", LocalNetwork.isLocalHost(host))
        }
    }
}
