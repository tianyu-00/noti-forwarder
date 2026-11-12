import { plainSecretBox } from './secret-box.js';
import { checkTotp, hashBackupCode } from './totp.js';

/**
 * Checks the second login factor: the current 6-digit code, or a one-use backup code.
 * Each is spent atomically in the database, so two requests cannot both use the same code.
 */
export async function verifySecondFactor(db, user, code, now, secretBox = plainSecretBox) {
  const text = String(code ?? '').trim();
  if (/^\d{6}$/.test(text)) {
    const result = checkTotp(secretBox.open(user.totp_secret), text, { now, lastStep: user.totp_last_step === null ? null : Number(user.totp_last_step) });
    if (!result.ok) return false;
    const spent = await db.query(
      `UPDATE users SET totp_last_step = $2
        WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
      [user.id, result.step],
    );
    return spent.rowCount === 1;
  }
  if (text.length === 0 || text.length > 30) return false;
  const used = await db.query(
    'UPDATE totp_backup_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
    [user.id, hashBackupCode(text)],
  );
  return used.rowCount === 1;
}
