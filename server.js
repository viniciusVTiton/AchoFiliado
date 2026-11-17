/**
 * Servidor do AchoFiliado (sem dependências; Node 18+).
 *
 * - Serve a página (index.html, app.js, styles.css, src/).
 * - GET  /api/status          -> quais lojas estão conectadas
 * - POST /api/convert         -> { text, amazonTag? } => { text, changes, failed }
 * - POST /api/mirror/preview  -> { text, rule }       => resultado do motor de espelhamento
 *
 * As credenciais ficam só aqui no servidor (arquivo .env), nunca no navegador.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertMessage } from './src/links/index.js';
import { processMessage } from './src/mirror/engine.js';
import { createShopeeProvider } from './src/providers/shopee.js';
import { resolveShortLink } from './src/providers/resolve.js';
import { RulesStore } from './src/mirror/rules-store.js';
import { SeenStore } from './src/mirror/dedupe.js';
import { handleIncoming } from './src/mirror/inbox.js';
import { MlBridge, createMlProvider } from './src/providers/ml-bridge.js';
import { ProductStore, defaultText, downloadImage } from './src/products/store.js';
import { RateLimiter } from './src/whatsapp/limits.js';
import { GroupTagStore } from './src/mirror/group-tags.js';
import { TemplateStore } from './src/mirror/templates-store.js';
import { createDownWatch } from './src/whatsapp/watchdog.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ---------- Configuração (.env simples) ---------- */

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv(join(ROOT, '.env'));

const config = {
  port: Number(process.env.PORT) || 3000,
  // Só este computador acessa, a menos que você mude de propósito.
  host: process.env.HOST || '127.0.0.1',
  rulesFile: process.env.RULES_FILE || join(ROOT, 'data', 'rules.json'),
  productsFile: join(ROOT, 'data', 'products.json'),
  whatsapp: process.env.WHATSAPP !== '0',
  whatsappAuthDir: join(ROOT, 'data', 'whatsapp-auth'),
  amazonTag: process.env.AMAZON_TAG || '',
  // Etiqueta do Mercado Livre (Gerador de links > Etiqueta em uso)
  mlTag: process.env.ML_TAG || '',
  shopeeAppId: process.env.SHOPEE_APP_ID || '',
  shopeeSecret: process.env.SHOPEE_SECRET || '',
  shopeeSubId: process.env.SHOPEE_SUB_ID || '',
};

const shopeeProvider =
  config.shopeeAppId && config.shopeeSecret
    ? createShopeeProvider({ appId: config.shopeeAppId, secret: config.shopeeSecret, subId: config.shopeeSubId })
    : undefined;

// Mercado Livre: os links são gerados pela extensão do Chrome (a sessão fica lá).
const mlBridge = new MlBridge();
const mercadoLivreProvider = createMlProvider(mlBridge);

const shopeeBySub = new Map();
function shopeeFor(subId) {
  if (!subId) return shopeeProvider;
  if (!shopeeBySub.has(subId)) {
    shopeeBySub.set(subId, createShopeeProvider({ appId: config.shopeeAppId, secret: config.shopeeSecret, subId }));
  }
  return shopeeBySub.get(subId);
}

function accounts(amazonTag, shopeeSubId) {
  return {
    amazonTag: (amazonTag || config.amazonTag || '').trim(),
    shopeeProvider: shopeeSubId && shopeeAvailable() ? shopeeFor(shopeeSubId) : shopeeProvider,
    mercadoLivreProvider,
    resolve: resolveShortLink,
  };
}

const shopeeAvailable = () => Boolean(config.shopeeAppId && config.shopeeSecret);

const rulesStore = new RulesStore(config.rulesFile);
const productStore = new ProductStore(config.productsFile);
const seen = new SeenStore({ file: join(ROOT, 'data', 'seen.json') });
const limiter = new RateLimiter({ file: join(ROOT, 'data', 'limits.json') });
const groupTags = new GroupTagStore(join(ROOT, 'data', 'group-tags.json'));
const templates = new TemplateStore(join(ROOT, 'data', 'templates.json'));

function mirrorIncoming({ sourceId, text, mediaHash = '' }) {
  return handleIncoming(
    { sourceId, text, mediaHash },
    {
      rules: rulesStore.list(),
      seen,
      limiter,
      accounts: accounts(),
      accountsFor: (target, rule) => {
        const tag = groupTags.get(target);
        return accounts(rule.amazonTag || tag.amazonTag, rule.shopeeSubId || tag.shopeeSubId);
      },
    },
  );
}

// O conector só é carregado quando ligado, para os testes e o modo sem WhatsApp não dependerem dele.
let whatsapp = null;
async function startWhatsApp() {
  const { createWhatsApp } = await import('./src/whatsapp/connector.js');
  whatsapp = createWhatsApp({ authDir: config.whatsappAuthDir, onMessage: mirrorIncoming, activityFile: join(ROOT, 'data', 'activity.json') });
  await whatsapp.loadHistory();
  whatsapp.start();
}

function needWhatsApp() {
  if (!whatsapp) throw Object.assign(new Error('WhatsApp desligado no servidor'), { status: 409 });
  return whatsapp;
}

function sendWindowsToast(title, message) {
  if (process.platform !== 'win32') return;
  const script = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$t = [System.Security.SecurityElement]::Escape($env:ACHO_TITLE)
$m = [System.Security.SecurityElement]::Escape($env:ACHO_MSG)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastText02'><text id='1'>$t</text><text id='2'>$m</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
`;
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, env: { ...process.env, ACHO_TITLE: title, ACHO_MSG: message } },
    (err) => {
      if (err) console.warn('Aviso do Windows não apareceu:', err.message);
    },
  );
}

/* ---------- HTTP ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Só estes caminhos são públicos: nada de .env, server.js ou testes.
const PUBLIC = [/^\/(index\.html|app\.js|whatsapp\.js|vitrine\.js|styles\.css)$/, /^\/src\/(links|mirror)\/[\w-]+\.js$/];

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req, limit = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Mensagem grande demais'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

async function serveStatic(req, res, pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  if (!PUBLIC.some((re) => re.test(path))) return send(res, 404, { error: 'Não encontrado' });
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return send(res, 404, { error: 'Não encontrado' });
  try {
    send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'Não encontrado' });
  }
}

const routes = {
  'GET /api/status': async () => ({
    backend: true,
    amazonTag: config.amazonTag,
    mlTag: config.mlTag,
    stores: {
      amazon: Boolean(config.amazonTag),
      shopee: Boolean(shopeeProvider),
      mercadolivre: mlBridge.online(),
    },
  }),

  /* ---------- Extensão do Mercado Livre ---------- */

  'GET /api/ml/status': async () => mlBridge.status(),

  // Long-poll: a extensão espera aqui por pedidos de link.
  'GET /api/ml/next': async (req, url) => {
    const job = await mlBridge.next({ info: { version: url.searchParams.get('v') ?? '' } });
    return { job };
  },

  'POST /api/ml/result': async (req) => {
    const { id, shortUrl, error } = await readJson(req);
    return { ok: mlBridge.result({ id: String(id ?? ''), shortUrl: typeof shortUrl === 'string' ? shortUrl : '', error: typeof error === 'string' ? error.slice(0, 200) : '' }) };
  },

  /* ---------- Vitrine ---------- */

  'GET /api/products': async () => ({ items: productStore.list().map((p) => ({ ...p, text: defaultText(p) })) }),

  'POST /api/products': async (req) => ({ product: await productStore.add(await readJson(req)) }),

  'DELETE /api/products': async (req, url) => {
    if (!(await productStore.remove(url.searchParams.get('id') ?? ''))) {
      throw Object.assign(new Error('Produto não encontrado'), { status: 404 });
    }
    return { removed: true };
  },

  // { items: [{ id, text }], targets: [grupo...] }
  'POST /api/products/send': async (req) => {
    const wa = needWhatsApp();
    const { items, targets } = await readJson(req);
    const groups = new Set(wa.status().groups.map((g) => g.id));
    if (!Array.isArray(targets) || !targets.length || targets.some((t) => !groups.has(t))) {
      throw Object.assign(new Error('Escolha grupos válidos do WhatsApp'), { status: 400 });
    }
    if (!Array.isArray(items) || !items.length || items.length > 30) {
      throw Object.assign(new Error('Escolha de 1 a 30 produtos'), { status: 400 });
    }
    let queued = 0;
    const blocked = [];
    const groupName = (id) => wa.status().groups.find((g) => g.id === id)?.name ?? id;
    for (const item of items) {
      const product = productStore.get(item?.id);
      if (!product) continue;
      const text = typeof item.text === 'string' && item.text.trim() ? item.text.trim().slice(0, 3000) : defaultText(product);
      const image = product.image ? await downloadImage(product.image) : null;
      const sentTo = [];
      for (const target of targets) {
        const limited = limiter.check(target);
        if (limited) {
          blocked.push({ product: product.title, group: groupName(target), reason: limited });
          continue;
        }
        wa.enqueue({ target, text, image });
        limiter.record(target);
        sentTo.push(target);
        queued++;
      }
      if (sentTo.length) await productStore.markSent(product.id, sentTo);
    }
    return { queued, blocked };
  },

  /* ---------- Limites contra bloqueio ---------- */

  'GET /api/settings/limits': async () => limiter.usage(),

  'POST /api/settings/limits': async (req) => {
    await limiter.setLimits(await readJson(req));
    return limiter.usage();
  },

  'POST /api/convert': async (req) => {
    const { text, amazonTag } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) {
      throw Object.assign(new Error('Envie o texto da mensagem'), { status: 400 });
    }
    return convertMessage(text, accounts(amazonTag));
  },

  'POST /api/mirror/preview': async (req) => {
    const { text, rule = {}, amazonTag } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) {
      throw Object.assign(new Error('Envie o texto da mensagem'), { status: 400 });
    }
    return processMessage(
      { sourceId: 'preview', text },
      { ...rule, sources: ['preview'], targets: ['preview'] },
      { accounts: accounts(amazonTag) },
    );
  },

  'GET /api/mirror/rules': async () => ({ rules: rulesStore.list() }),

  'POST /api/mirror/rules': async (req) => ({ rule: await rulesStore.save(await readJson(req)) }),

  'DELETE /api/mirror/rules': async (req, url) => {
    const removed = await rulesStore.remove(url.searchParams.get('id') ?? '');
    if (!removed) throw Object.assign(new Error('Regra não encontrada'), { status: 404 });
    return { removed: true };
  },

  // Chamado pelo conector do WhatsApp quando chega mensagem em um grupo de origem.
  'POST /api/mirror/incoming': async (req) => {
    const { sourceId, text, mediaHash } = await readJson(req);
    if (typeof sourceId !== 'string' || !sourceId || typeof text !== 'string') {
      throw Object.assign(new Error('Envie sourceId e text'), { status: 400 });
    }
    return mirrorIncoming({ sourceId, text, mediaHash: typeof mediaHash === 'string' ? mediaHash : '' });
  },

  'GET /api/templates': async () => ({ templates: templates.list() }),

  'POST /api/templates': async (req) => ({ templates: await templates.save(await readJson(req)) }),

  'DELETE /api/templates': async (req, url) => ({ templates: await templates.remove(url.searchParams.get('id') ?? '') }),

  'GET /api/group-tags': async () => ({ tags: groupTags.list() }),

  'POST /api/group-tags': async (req) => ({ tags: await groupTags.replace(await readJson(req)) }),

  'GET /api/whatsapp/status': async () =>
    whatsapp ? { enabled: true, ...whatsapp.status() } : { enabled: false, status: 'disabled' },

  'POST /api/whatsapp/groups/refresh': async () => ({ groups: await needWhatsApp().refreshGroups() }),

  'POST /api/whatsapp/logout': async () => {
    await needWhatsApp().logout();
    return { ok: true };
  },

};

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const handler = routes[`${req.method} ${pathname}`];
    try {
      // Só a própria página e a extensão podem chamar a API (outros sites abertos no
      // navegador não conseguem mandar ofertas para os seus grupos).
      if (pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        const okOrigin = !origin || origin === `http://localhost:${config.port}` || origin === `http://127.0.0.1:${config.port}` || origin.startsWith('chrome-extension://');
        if (!okOrigin) return send(res, 403, { error: 'Origem não permitida' });
        if (req.method !== 'GET' && !/^application\/json/i.test(req.headers['content-type'] ?? '')) {
          return send(res, 415, { error: 'Envie JSON' });
        }
      }
      if (handler) return send(res, 200, await handler(req, url));
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido' });
      return serveStatic(req, res, pathname);
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) console.error(error);
      send(res, status, { error: status === 500 ? 'Erro interno' : error.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  await rulesStore.load();
  await productStore.load();
  await seen.load();
  await limiter.load();
  await groupTags.load();
  await templates.load();
  // Ao desligar (Ctrl+C ou o Windows encerrando), grava a memória de ofertas antes de sair.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      await seen.flush().catch(() => {});
      await limiter.flush().catch(() => {});
      process.exit(0);
    });
  }
  createServer().listen(config.port, config.host, () => {
    console.log(`AchoFiliado em http://localhost:${config.port}`);
    console.log(`  Regras de espelhamento: ${rulesStore.list().length}`);
    console.log(`  Amazon: ${config.amazonTag ? 'tag ' + config.amazonTag : 'sem tag (usa a da página)'}`);
    console.log(`  Shopee: ${shopeeProvider ? 'conectada' : 'não conectada (SHOPEE_APP_ID / SHOPEE_SECRET)'}`);
    console.log(`  Mercado Livre: ${config.mlTag ? `etiqueta ${config.mlTag} (links gerados pela extensão do Chrome)` : 'sem etiqueta (ML_TAG)'}`);
    console.log(`  WhatsApp: ${config.whatsapp ? 'ligado (abra a página para escanear o QR)' : 'desligado (WHATSAPP=0)'}`);
  });
  if (config.whatsapp) await startWhatsApp();
  const downWatch = createDownWatch();
  setInterval(() => {
    const status = whatsapp?.status().status;
    if (status && downWatch(status)) {
      sendWindowsToast('AchoFiliado: WhatsApp desconectado', 'Faz mais de 2 minutos que o robô não posta. Abra o AchoFiliado para ver o motivo.');
    }
  }, 30_000).unref();
}
