import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/server/app.js';

let server;
let base;

const accounts = {
  amazonTag: 'viniachados0a-20',
  shopeeProvider: async () => ({ status: 'ok', url: 'https://s.shopee.com.br/meu' }),
  mercadoLivreProvider: null,
};

before(async () => {
  server = createApp({ accounts });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('status informa lojas conectadas sem expor o Secret', async () => {
  const res = await fetch(`${base}/api/status`);
  const body = await res.json();
  assert.deepEqual(body.stores, { amazon: true, shopee: true, mercadolivre: false });
  assert.doesNotMatch(JSON.stringify(body), /secret/i);
});

test('converte mensagem pela API', async () => {
  const res = await post('/api/convert', {
    text: 'A https://www.amazon.com.br/dp/B0ABC12345 S https://shopee.com.br/x-i.1.2',
  });
  const body = await res.json();
  assert.equal(body.text, 'A https://www.amazon.com.br/dp/B0ABC12345?tag=viniachados0a-20 S https://s.shopee.com.br/meu');
});

test('prévia do espelhamento pela API', async () => {
  const res = await post('/api/mirror/preview', {
    text: 'Oferta https://www.amazon.com.br/dp/B0ABC12345 siga @outro',
    rule: { handleMode: 'replace', handle: '@viniachados' },
  });
  const body = await res.json();
  assert.equal(body.action, 'send');
  assert.equal(body.sends[0].text, 'Oferta https://www.amazon.com.br/dp/B0ABC12345?tag=viniachados0a-20 siga @viniachados');
});

test('valida entrada', async () => {
  assert.equal((await post('/api/convert', { text: '' })).status, 400);
  const bad = await fetch(`${base}/api/convert`, { method: 'POST', body: '{nao json' });
  assert.equal(bad.status, 400);
});

test('serve a interface e bloqueia o resto do projeto', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/src/links/index.js`)).status, 200);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/src/server/app.js`)).status, 404);
  assert.equal((await fetch(`${base}/src/providers/shopee.js`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/web/..%2F.env`)).status, 404);
});
