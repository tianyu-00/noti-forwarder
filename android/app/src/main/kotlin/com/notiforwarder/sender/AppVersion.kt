package com.notiforwarder.sender

/** Compares version names such as 0.1.66. Anything that is not numbers separated by dots is never "newer". */
object AppVersion {
    /** A release tag is "v0.1.66"; the app's own version name has no "v". */
    fun clean(version: String) = version.trim().removePrefix("v").removePrefix("V")

    private class Parsed(val numbers: List<Int>, val preRelease: Boolean)

    private fun parse(version: String): Parsed? {
        val text = clean(version)
        val core = text.substringBefore('-')
        val numbers = core.split('.').map { it.toIntOrNull() ?: return null }
        if (numbers.isEmpty()) return null
        return Parsed(numbers, preRelease = '-' in text)
    }

    fun isNewer(latest: String, installed: String): Boolean {
        val a = parse(latest) ?: return false
        val b = parse(installed) ?: return false
        val length = maxOf(a.numbers.size, b.numbers.size)
        for (i in 0 until length) {
            val x = a.numbers.getOrElse(i) { 0 }
            val y = b.numbers.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        // Same numbers: a final release replaces a dev or pre-release build of it.
        return b.preRelease && !a.preRelease
    }
}
