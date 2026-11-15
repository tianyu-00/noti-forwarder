package com.notiforwarder.sender

/**
 * Finds a one-time code (2FA / OTP) in a message. A copy of server/src/codes.js and web/src/codes.js, with the same
 * test cases, so a code looks the same wherever you see it. It needs a code-like keyword AND a 4 to 8 digit number,
 * and prefers the number nearest the keyword.
 */
object CodeExtractor {
    private val ASCII_KEYWORDS = Regex(
        """\b(?:code|otp|passcode|password|pin|verification|verify|security|authentication|authorization|auth|login|log-in|sign-in|token|one[- ]time)\b""",
        RegexOption.IGNORE_CASE,
    )

    // No word boundaries: Chinese text has no spaces, e.g. "验证码654321".
    private val CHINESE_KEYWORDS = Regex("验证码|驗證碼|校验码|校驗碼|动态码|動態碼|确认码|安全码")

    // 4-8 digits, or two groups of 3 or 4 ("123 456", "1234-5678"). Not part of a longer number, not next to
    // ASCII letters, not an amount (£1500, 1234.56) and not a #reference.
    private val NUMBER = Regex("""(?<![A-Za-z\d.,£${'$'}€¥#])(\d{3}[ -]\d{3}|\d{4}[ -]\d{4}|\d{4,8})(?![A-Za-z\d]|[.,]\d|%)""")

    private fun gap(a: IntRange, b: IntRange): Int = when {
        a.last < b.first -> b.first - a.last - 1
        b.last < a.first -> a.first - b.last - 1
        else -> 0
    }

    fun extract(text: String?): String? {
        if (text.isNullOrEmpty()) return null
        val keywords = (ASCII_KEYWORDS.findAll(text) + CHINESE_KEYWORDS.findAll(text)).map { it.range }.toList()
        if (keywords.isEmpty()) return null

        var best: Pair<Int, String>? = null
        for (match in NUMBER.findAll(text)) {
            val distance = keywords.minOf { gap(match.range, it) }
            if (best == null || distance < best.first) best = distance to match.groupValues[1].filter { it.isDigit() }
        }
        return best?.second
    }
}
