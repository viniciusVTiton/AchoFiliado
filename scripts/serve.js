/**
 * Servidor estático de desenvolvimento, sem dependências.
 * Serve a pasta do projeto para que a página web/ consiga importar src/ como módulos.
 *
 *   npm run dev   ->   http://localhost:3000/web/
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(pathname);

    // Nunca serve arquivos ocultos (.git, .env, etc.)
    if (path.split('/').some((segment) => segment.startsWith('.'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Proibido');
      return;
    }

    if (path === '/') path = '/web/index.html';
    else if (path.endsWith('/')) path += 'index.html';

    const file = resolve(join(root, path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Proibido');
      return;
    }

    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
});

server.listen(port, () => {
  console.log(`AchoFiliado rodando em http://localhost:${port}/web/`);
});
