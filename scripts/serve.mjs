import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = parseInt(process.env.PORT || '4750', 10);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

http.createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (file === '/' || file === '') file = '/index.html';
  try {
    const buf = await readFile(PUBLIC + file.replace(/^\//, ''));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`\n  Preview local:  http://localhost:${PORT}\n`));
