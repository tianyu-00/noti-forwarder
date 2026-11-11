import { Router } from 'express';

const HEARTBEAT_MS = 25000;

export function streamRouter({ requireViewer, events }) {
  const router = Router();

  router.get('/stream', requireViewer, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop reverse proxies from buffering the stream.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const unsubscribe = events.subscribe(({ type, data }) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    // Comment frames keep idle connections alive through proxies.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    // res (not req): req 'close' fires once the GET body is read, not on disconnect.
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
