import http from 'node:http';

function parse(raw) {
  if (raw.startsWith(':')) return { comment: raw.slice(1).trim() };
  const event = { event: 'message', data: undefined };
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event.event = line.slice(6).trim();
    if (line.startsWith('data:')) event.data = JSON.parse(line.slice(5).trim());
  }
  return event;
}

// Opens /api/v1/stream on a real listening server and collects parsed SSE frames.
export async function openStream(app, { cookie, path = '/api/v1/stream', headers = {} } = {}) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.get(
      { port, path, headers: cookie ? { cookie, ...headers } : headers },
      (res) => {
        const events = [];
        let buffer = '';
        let seen = 0;
        let wake = () => {};
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            events.push(parse(buffer.slice(0, end)));
            buffer = buffer.slice(end + 2);
            wake();
          }
        });
        const close = () => {
          req.destroy();
          server.close();
        };
        resolve({
          status: res.statusCode,
          headers: res.headers,
          events,
          close,
          // Resolves with the next frame not yet consumed, or rejects after timeoutMs.
          next(timeoutMs = 2000) {
            return new Promise((ok, fail) => {
              const timer = setTimeout(() => fail(new Error('timed out waiting for SSE event')), timeoutMs);
              const check = () => {
                if (seen < events.length) {
                  clearTimeout(timer);
                  wake = () => {}; // a stale callback would swallow the next frame
                  ok(events[seen++]);
                } else {
                  wake = check;
                }
              };
              check();
            });
          },
          // True if no new frame arrives within ms.
          async quiet(ms = 300) {
            const before = events.length;
            await new Promise((r) => setTimeout(r, ms));
            return events.length === before;
          },
        });
        if (res.statusCode !== 200) close();
      },
    );
    req.on('error', reject);
  });
}
