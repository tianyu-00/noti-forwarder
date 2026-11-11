import { z } from 'zod';

const messageSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['sms', 'notification']),
  app: z.string().min(1).max(255),
  sender: z.string().max(500).default(''),
  body: z.string().max(20000),
  receivedAt: z.string().datetime({ offset: true }),
});

export const postMessagesSchema = z.object({
  messages: z.array(messageSchema).max(500),
});
