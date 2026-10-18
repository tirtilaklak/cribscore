import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const requested = decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    // Same exclusions as scripts/build-worker.mjs: nothing hidden, nothing under dist/server, nothing outside dist.
    const segments = relative(root, file).split(sep);
    if (segments.some(segment => segment.startsWith('.')) || segments[0] === 'server' || !(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.on('error', error => { console.error('Local preview unavailable: ' + error.code); process.exitCode = 1; });
server.listen(Number(process.env.CRIBSCORE_PORT || 4179), '127.0.0.1', () => console.log('Cribscore local preview: http://127.0.0.1:' + server.address().port));
