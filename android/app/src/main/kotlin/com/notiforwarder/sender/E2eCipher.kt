package com.notiforwarder.sender

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * End-to-end encryption of message text. The key comes from the dashboard (in the pairing QR) and
 * stays on the phone and in the browsers; the server stores only the scrambled text.
 *
 * Format of an encrypted field: "e2e:v1:" + base64url(nonce[12] | ciphertext | tag[16]).
 * Cipher: AES-256-GCM, additional data "nf-e2e-v1:" + field ("body" or "sender").
 *
 * The nonce is derived from the message (HMAC-SHA256 of field, app, time and text under the same
 * key, first 12 bytes). Sending the same message again therefore gives identical output, which
 * keeps the server's duplicate check working. The same nonce is only ever used for the same
 * field, app, time and text, so nothing is encrypted twice under one nonce. The web dashboard
 * implements the decrypting half (web/src/e2e.js); a shared test vector keeps them in step.
 */
class E2eCipher(keyText: String) {
    private val key: ByteArray = decodeKey(keyText) ?: throw IllegalArgumentException("not a valid encryption key")

    fun encrypt(field: String, plaintext: String, app: String, receivedAtMs: Long): String {
        val nonce = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal("nf-e2e-v1-nonce|$field|$app|$receivedAtMs|$plaintext".toByteArray(Charsets.UTF_8))
        }.copyOf(NONCE_BYTES)
        val sealed = aes(Cipher.ENCRYPT_MODE, nonce, field).doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(nonce + sealed)
    }

    /** Throws if the key, the field or the text does not match. Used by tests and diagnostics. */
    fun decrypt(field: String, blob: String): String {
        require(blob.startsWith(PREFIX)) { "not encrypted" }
        val raw = Base64.getUrlDecoder().decode(blob.removePrefix(PREFIX))
        require(raw.size >= NONCE_BYTES + TAG_BYTES) { "too short" }
        val plain = aes(Cipher.DECRYPT_MODE, raw.copyOfRange(0, NONCE_BYTES), field)
            .doFinal(raw, NONCE_BYTES, raw.size - NONCE_BYTES)
        return String(plain, Charsets.UTF_8)
    }

    private fun aes(mode: Int, nonce: ByteArray, field: String): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
            updateAAD("nf-e2e-v1:$field".toByteArray(Charsets.UTF_8))
        }

    companion object {
        const val PREFIX = "e2e:v1:"
        private const val KEY_BYTES = 32
        private const val NONCE_BYTES = 12
        private const val TAG_BYTES = 16

        fun isValidKey(text: String): Boolean = decodeKey(text) != null

        private fun decodeKey(text: String): ByteArray? {
            if (!Regex("[A-Za-z0-9_-]{43}").matches(text)) return null
            val bytes = try {
                Base64.getUrlDecoder().decode(text)
            } catch (e: IllegalArgumentException) {
                return null
            }
            return bytes.takeIf { it.size == KEY_BYTES }
        }
    }
}
