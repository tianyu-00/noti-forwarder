import { Router } from 'express';
import { authenticateDevice } from '../auth/device-auth.js';

export function messagesRouter({ db }) {
  const router = Router();
  router.post('/messages', authenticateDevice({ db }), (req, res) => {
    res.status(201).json({});
  });
  return router;
}
