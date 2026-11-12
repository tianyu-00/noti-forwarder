import { hashToken } from './tokens.js';

export function authenticateDevice({ db }) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') || '';
      if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const tokenHash = hashToken(header.slice('Bearer '.length));
      const { rows } = await db.query(
        `UPDATE devices
            SET last_seen = now(), app_version = COALESCE($2, app_version)
          WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING device_id, name`,
        [tokenHash, req.get('x-app-version') || null],
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      req.deviceId = rows[0].device_id;
      req.deviceName = rows[0].name;
      next();
    } catch (err) {
      next(err);
    }
  };
}
