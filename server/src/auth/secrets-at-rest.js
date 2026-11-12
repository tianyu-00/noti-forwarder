/** Encrypts any two-step secret that was saved before a key was set. Returns how many it sealed. */
export async function sealExistingSecrets(db, box) {
  const { rows } = await db.query('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL');
  let sealed = 0;
  for (const row of rows) {
    if (box.isSealed(row.totp_secret)) continue;
    const value = box.seal(row.totp_secret);
    if (value === row.totp_secret) continue; // no key: nothing to do
    await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [row.id, value]);
    sealed += 1;
  }
  return sealed;
}

/**
 * Stops the server from starting when it could not read the stored secrets (the key was removed
 * or changed). Otherwise two-step login would silently fail for the only user.
 */
export async function assertSecretsReadable(db, box) {
  const { rows } = await db.query('SELECT totp_secret FROM users WHERE totp_secret IS NOT NULL');
  for (const row of rows) {
    if (!box.isSealed(row.totp_secret)) continue;
    try {
      box.open(row.totp_secret);
    } catch {
      throw new Error('Stored two-step secrets are encrypted but SECRET_KEY is missing or wrong. Set the key you used before.');
    }
  }
}
