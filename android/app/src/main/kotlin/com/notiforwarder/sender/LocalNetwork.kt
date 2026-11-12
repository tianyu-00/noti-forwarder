package com.notiforwarder.sender

/**
 * Which servers the app may talk to without HTTPS. Android's own cleartext setting cannot
 * express IP ranges, so the manifest allows cleartext and this decides: plain http:// is
 * accepted only for a server on the phone's own network, never for one on the internet.
 */
object LocalNetwork {
    fun isLocalHost(host: String): Boolean {
        val name = host.lowercase()
        if (name == "localhost" || name.endsWith(".local")) return true
        // A single word such as "rpi-server" cannot be a public domain. It needs a letter, because
        // a bare number like 134744072 is another way to write a public IPv4 address.
        if ('.' !in name) return name.any(Char::isLetter)
        val octets = ipv4Octets(name) ?: return false
        val (a, b) = octets
        return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
    }

    /** Four numbers 0-255, or null when the text is not a dotted IPv4 address. */
    private fun ipv4Octets(host: String): List<Int>? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val numbers = parts.map { part -> part.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }?.toIntOrNull() }
        return if (numbers.any { it == null || it > 255 }) null else numbers.filterNotNull()
    }
}
