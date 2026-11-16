/**
 * Servidor do AchoFiliado: serve a interface (web/) e a API.
 *
 *   GET  /api/status          quais lojas estão conectadas (sem expor credenciais)
 *   POST /api/convert         { text, amazonTag? } -> mensagem convertida
 *   POST /api/mirror/preview  { text, rule }       -> prévia do espelhamento
 *
 * Credenciais vêm de variáveis de ambiente (arquivo .env, fora do git).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertMessage } from '../links/index.js';
import { createResolver } from '../links/resolve.js';
import { createShopeeProvider } from '../providers/shopee.js';
import { processMessage } from '../mirror/engine.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MAX_BODY = 100 * 1024;

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

// Só estas pastas são servidas como arquivo estático.
const PUBLIC_DIRS = ['/web/', '/src/links/', '/src/mirror/'];

export function createAccounts(env = process.env, { fetch: fetchImpl = globalThis.fetch } = {}) {
  return {
    amazonTag: env.AMAZON_TAG?.trim() || '',
    shopeeProvider: createShopeeProvider({
      appId: env.SHOPEE_APP_ID?.trim(),
      secret: env.SHOPEE_APP_SECRET?.trim(),
      subIds: (env.SHOPEE_SUB_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      fetch: fetchImpl,
    }),
    mercadoLivreProvider: null,
    resolve: createResolver({ fetch: fetchImpl }),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Mensagem grande demais'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

function textFrom(body) {
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw Object.assign(new Error('Envie o campo "text" com a mensagem'), { status: 400 });
  return text;
}

async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(pathname);
  if (path === '/') path = '/web/index.html';
  else if (path.endsWith('/')) path += 'index.html';

  const allowed = PUBLIC_DIRS.some((dir) => path.startsWith(dir));
  const hidden = path.split('/').some((segment) => segment.startsWith('.'));
  const file = resolve(join(ROOT, path));
  if (!allowed || hidden || !file.startsWith(ROOT + sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
}

export function createApp({ accounts = createAccounts() } = {}) {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        return sendJson(res, 200, {
          backend: true,
          stores: {
            amazon: Boolean(accounts.amazonTag),
            shopee: Boolean(accounts.shopeeProvider),
            mercadolivre: Boolean(accounts.mercadoLivreProvider),
          },
          amazonTag: accounts.amazonTag,
        });
      }

      if (pathname === '/api/convert' && req.method === 'POST') {
        const body = await readJson(req);
        const text = textFrom(body);
        const amazonTag = typeof body.amazonTag === 'string' && body.amazonTag.trim()
          ? body.amazonTag.trim()
          : accounts.amazonTag;
        return sendJson(res, 200, await convertMessage(text, { ...accounts, amazonTag }));
      }

      if (pathname === '/api/mirror/preview' && req.method === 'POST') {
        const body = await readJson(req);
        const text = textFrom(body);
        const rule = { ...(body.rule ?? {}), sources: ['preview'], targets: ['preview'] };
        const result = await processMessage({ sourceId: 'preview', text }, rule, { accounts });
        return sendJson(res, 200, result);
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Rota não encontrada' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      return serveStatic(req, res);
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) console.error(error);
      return sendJson(res, status, { error: status === 500 ? 'Erro interno' : error.message });
    }
  });
}
