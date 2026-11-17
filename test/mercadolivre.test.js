import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MlBridge, createMlProvider, productFromSocialHtml } from '../src/providers/ml-bridge.js';
import { resolveShortLink } from '../src/providers/resolve.js';
import { convertMessage } from '../src/links/index.js';
import { processMessage } from '../src/mirror/engine.js';
import { ProductStore, validateProduct, defaultText, isAllowedImage } from '../src/products/store.js';

const PRODUCT = 'https://www.mercadolivre.com.br/impressora-3d-bambu-lab-a1-mini-alta-velocidade-a1m/p/MLB45702954';

/** Simula a extensão: atende os pedidos devolvendo um meli.la "meu". */
function fakeExtension(bridge, answer = (url) => ({ shortUrl: 'https://meli.la/MEU123' })) {
  let stop = false;
  (async () => {
    while (!stop) {
      const job = await bridge.next({ waitMs: 20 });
      if (job) bridge.result({ id: job.id, ...answer(job.url) });
    }
  })();
  return () => (stop = true);
}

test('Ponte: sem extensão conectada, o link fica bloqueado com motivo', async () => {
  const bridge = new MlBridge();
  const r = await bridge.request(PRODUCT);
  assert.equal(r.status, 'needs_provider');
  assert.match(r.reason, /Extensão/);
});

test('Ponte: extensão atende o pedido e devolve o meu link', async () => {
  const bridge = new MlBridge();
  const seen = [];
  const stop = fakeExtension(bridge, (url) => (seen.push(url), { shortUrl: 'https://meli.la/MEU123' }));
  await new Promise((r) => setTimeout(r, 5));
  const r = await bridge.request(PRODUCT);
  stop();
  assert.deepEqual(r, { status: 'ok', url: 'https://meli.la/MEU123' });
  assert.deepEqual(seen, [PRODUCT]);
});

test('Ponte: erro da extensão vira link não convertido, e link estranho é recusado', async () => {
  const bridge = new MlBridge();
  let n = 0;
  const stop = fakeExtension(bridge, () => (n++ === 0 ? { error: 'O Mercado Livre pediu login de novo' } : { shortUrl: 'https://site-estranho.com/x' }));
  await new Promise((r) => setTimeout(r, 5));
  const a = await bridge.request(PRODUCT);
  const b = await bridge.request(PRODUCT);
  stop();
  assert.equal(a.status, 'unsupported');
  assert.match(a.reason, /login/);
  assert.equal(b.status, 'unsupported');
});

test('Ponte: se a extensão não responder, desiste no tempo limite', async () => {
  const bridge = new MlBridge({ timeoutMs: 30 });
  bridge.lastSeen = Date.now(); // parece conectada, mas não atende
  const r = await bridge.request(PRODUCT);
  assert.match(r.reason, /não respondeu/);
});

test('Produto: acha o produto em destaque na página de perfil do afiliado', () => {
  const html = `<a href="https://www.mercadolivre.com.br/impressora-3d-bambu-lab-a1-mini-alta-velocidade-a1m/p/MLB45702954?x=1&amp;y=2">x</a>
    <a href="https://www.mercadolivre.com.br/outra/p/MLB65260733">y</a>`;
  assert.equal(productFromSocialHtml(html), PRODUCT);
  assert.equal(productFromSocialHtml('<p>nada</p>'), null);
});

test('Clonador: meli.la de outra pessoa vira o meu link (abre, acha o produto, gera)', async () => {
  const bridge = new MlBridge();
  const stop = fakeExtension(bridge);
  await new Promise((r) => setTimeout(r, 5));

  const SOCIAL = 'https://www.mercadolivre.com.br/social/outroafiliado?matt_word=outro&ref=XYZ';
  const net = async (url) => {
    if (url === 'https://meli.la/DELES') return new Response(null, { status: 301, headers: { Location: SOCIAL } });
    if (url === SOCIAL) return new Response(`<a href="${PRODUCT}">produto</a>`);
    return new Response('ok');
  };
  const accounts = {
    mercadoLivreProvider: createMlProvider(bridge, { fetch: net }),
    resolve: (u) => resolveShortLink(u, { fetch: net }),
  };
  const rule = { sources: ['a'], targets: ['b'], handle: '@viniachados', handleMode: 'replace' };
  const r = await processMessage({ sourceId: 'a', text: '🔥 Bambu A1 Mini\nhttps://meli.la/DELES\nSiga @outro' }, rule, { accounts });
  stop();
  assert.equal(r.action, 'send');
  assert.equal(r.sends[0].text, '🔥 Bambu A1 Mini\nhttps://meli.la/MEU123\nSiga @viniachados');
});

test('Clonador: link mercadolivre.com/sec também é reconhecido e convertido', async () => {
  const bridge = new MlBridge();
  const stop = fakeExtension(bridge);
  await new Promise((r) => setTimeout(r, 5));
  const SOCIAL = 'https://www.mercadolivre.com.br/social/outro?ref=1';
  const net = async (url) =>
    url === 'https://mercadolivre.com/sec/ABC'
      ? new Response(null, { status: 302, headers: { Location: SOCIAL } })
      : new Response(`<a href="${PRODUCT}">p</a>`);
  const r = await convertMessage('https://mercadolivre.com/sec/ABC', {
    mercadoLivreProvider: createMlProvider(bridge, { fetch: net }),
    resolve: (u) => resolveShortLink(u, { fetch: net }),
  });
  stop();
  assert.equal(r.text, 'https://meli.la/MEU123');
});

/* ---------- Vitrine ---------- */

test('Vitrine: valida produto e só aceita foto das lojas', () => {
  assert.throws(() => validateProduct({ title: 'x' }), /link de afiliado/);
  const p = validateProduct({ title: 'Bambu A1', price: '1.999', affiliateUrl: 'https://meli.la/X', image: 'https://evil.com/a.jpg' });
  assert.equal(p.image, '');
  assert.equal(isAllowedImage('https://http2.mlstatic.com/D_NQ_NP_123.webp'), true);
});

test('Vitrine: texto padrão com preço antigo, novo e link', () => {
  const t = defaultText({ title: 'Bambu A1', price: '1.999', oldPrice: '2.499', affiliateUrl: 'https://meli.la/X' });
  assert.equal(t, '🔥 Bambu A1\n💰 De ~R$ 2.499~ por *R$ 1.999*\n\n🛒 https://meli.la/X');
});

test('Vitrine: guarda no arquivo e não duplica o mesmo produto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acho-vitrine-'));
  try {
    const store = new ProductStore(join(dir, 'products.json'));
    await store.load();
    await store.add({ title: 'A', affiliateUrl: 'https://meli.la/X', url: PRODUCT });
    await store.add({ title: 'A (preço novo)', price: '10', affiliateUrl: 'https://meli.la/X', url: PRODUCT });
    const again = new ProductStore(join(dir, 'products.json'));
    await again.load();
    assert.equal(again.list().length, 1);
    assert.equal(again.list()[0].title, 'A (preço novo)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
