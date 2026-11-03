// Podgląd lokalny: node narzedzia/serwer.mjs  ->  http://localhost:8123
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const KORZEN = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TYPY = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PORT = Number(process.env.PORT || 8123);

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const plik = normalize(join(KORZEN, p));
  if (!plik.startsWith(normalize(KORZEN))) { res.writeHead(403).end(); return; }
  try {
    const dane = await readFile(plik);
    res.writeHead(200, { 'content-type': TYPY[extname(plik)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(dane);
  } catch {
    res.writeHead(404).end('brak');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));
