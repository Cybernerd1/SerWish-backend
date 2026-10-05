/**
 * Integration helpers. supabase-js calls `${SUPABASE_URL}/rest/v1/...`; a bare
 * PostgREST serves at `/`. This tiny proxy strips the prefix so the real client
 * talks to a real PostgREST + Postgres (see scripts/integration-env.sh and CI).
 */
import http from 'node:http';

export const integrationConfig = () => {
  const url = process.env.TEST_POSTGREST_URL;
  const key = process.env.TEST_SERVICE_ROLE_JWT;
  return url && key ? { url, key } : null;
};

export const startRestProxy = (target) =>
  new Promise((resolve) => {
    const t = new URL(target);
    const server = http.createServer((req, res) => {
      const path = req.url.replace(/^\/rest\/v1/, '') || '/';
      const upstream = http.request(
        { hostname: t.hostname, port: t.port, path, method: req.method, headers: { ...req.headers, host: t.host } },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        },
      );
      upstream.on('error', (err) => {
        res.writeHead(502);
        res.end(err.message);
      });
      req.pipe(upstream);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
