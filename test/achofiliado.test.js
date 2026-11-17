import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { convertMessage } from '../src/links/index.js';
import { processMessage } from '../src/mirror/engine.js';
import { createShopeeProvider, signShopee, SHOPEE_ENDPOINT } from '../src/providers/shopee.js';
import { resolveShortLink } from '../src/providers/resolve.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const redirect = (location) => new Response(null, { status: 301, headers: { Location: location } });

/* ---------- Amazon ---------- */

test('Amazon: troca a tag de outro afiliado pela minha e limpa a URL', async () => {
  const text = 'Oferta: https://www.amazon.com.br/Fone/dp/B0ABC12345/ref=sr_1?tag=outro-20.';
  const r = await convertMessage(text, { amazonTag: 'minha-20' });
  assert.equal(r.text, 'Oferta: https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20.');
  assert.equal(r.failed.length, 0);
});

test('Amazon: amzn.to é seguido e convertido', async () => {
  const fakeFetch = async (url) =>
    url === 'https://amzn.to/abc' ? redirect('https://www.amazon.com.br/dp/B0ABC12345?ref=x') : new Response('ok');
  const r = await convertMessage('https://amzn.to/abc', {
    amazonTag: 'minha-20',
    resolve: (u) => resolveShortLink(u, { fetch: fakeFetch }),
  });
  assert.equal(r.text, 'https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20');
});

/* ---------- Resolver ---------- */

test('Resolver: não segue redirecionamento para fora das lojas', async () => {
  const fakeFetch = async () => redirect('http://169.254.169.254/latest');
  assert.equal(await resolveShortLink('https://amzn.to/abc', { fetch: fakeFetch }), null);
});

test('Resolver: não abre link que não é de loja', async () => {
  let called = false;
  const fakeFetch = async () => ((called = true), new Response('ok'));
  assert.equal(await resolveShortLink('https://exemplo.com/x', { fetch: fakeFetch }), null);
  assert.equal(called, false);
});

/* ---------- Shopee ---------- */

test('Shopee: assinatura segue a fórmula sha256(AppId + ts + payload + Secret)', () => {
  const header = signShopee({ appId: '123', secret: 'abc', payload: '{"q":1}', timestamp: 1700000000 });
  const expected = createHash('sha256').update('1231700000000{"q":1}abc').digest('hex');
  assert.equal(header, `SHA256 Credential=123, Timestamp=1700000000, Signature=${expected}`);
});

test('Shopee: gera o link curto pela API', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init };
    return json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/meulink' } } });
  };
  const provider = createShopeeProvider({ appId: '123', secret: 'abc', subId: 'grupo3d', fetch: fakeFetch, now: () => 1 });
  const r = await convertMessage('Veja https://shopee.com.br/Produto-i.123.456 agora', { shopeeProvider: provider });

  assert.equal(r.text, 'Veja https://s.shopee.com.br/meulink agora');
  assert.equal(sent.url, SHOPEE_ENDPOINT);
  const body = JSON.parse(sent.init.body);
  assert.deepEqual(body.variables.input, { originUrl: 'https://shopee.com.br/Produto-i.123.456', subIds: ['grupo3d'] });
  assert.match(sent.init.headers.Authorization, /^SHA256 Credential=123, Timestamp=1, Signature=[0-9a-f]{64}$/);
});

test('Shopee: erro da API vira link não convertido, com motivo', async () => {
  const fakeFetch = async () => json({ errors: [{ message: 'Invalid Signature' }] });
  const provider = createShopeeProvider({ appId: '1', secret: 'x', fetch: fakeFetch });
  const r = await convertMessage('https://shopee.com.br/Produto-i.1.2', { shopeeProvider: provider });
  assert.equal(r.changes.length, 0);
  assert.match(r.failed[0].reason, /Invalid Signature/);
});

test('Shopee: link curto de outra pessoa é aberto e limpo antes de gerar o meu', async () => {
  const sentOrigins = [];
  const shopeeFetch = async (url, init) => {
    sentOrigins.push(JSON.parse(init.body).variables.input.originUrl);
    return json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/MEU' } } });
  };
  const redirectFetch = async (url) =>
    url === 'https://s.shopee.com.br/DELES'
      ? redirect('https://shopee.com.br/Produto-i.1.2?mmp_pid=an_OUTRO&utm_source=an_OUTRO')
      : new Response('ok');
  const r = await convertMessage('Oferta https://s.shopee.com.br/DELES', {
    shopeeProvider: createShopeeProvider({ appId: '1', secret: 'x', fetch: shopeeFetch }),
    resolve: (u) => resolveShortLink(u, { fetch: redirectFetch }),
  });
  assert.equal(r.text, 'Oferta https://s.shopee.com.br/MEU');
  assert.deepEqual(sentOrigins, ['https://shopee.com.br/Produto-i.1.2']);
});

test('Shopee: se a API devolver o mesmo link, conta como falha (nunca repassa o de outra pessoa)', async () => {
  const fakeFetch = async () => json({ data: { generateShortLink: { shortLink: 'https://shopee.com.br/P-i.1.2' } } });
  const provider = createShopeeProvider({ appId: '1', secret: 'x', fetch: fakeFetch });
  const r = await convertMessage('https://shopee.com.br/P-i.1.2', { shopeeProvider: provider });
  assert.equal(r.failed.length, 1);
});

/* ---------- Espelhamento ---------- */

const rule = { sources: ['a'], targets: ['b'], handle: '@viniachados', handleMode: 'replace' };

test('Espelhamento: troca @ e link, remove o site de quem postou', async () => {
  const text = 'PLA 1kg por R$ 79\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=outro-20\nSiga @mundo3d e veja https://mundo3d.com.br';
  const r = await processMessage({ sourceId: 'a', text }, rule, { accounts: { amazonTag: 'minha-20' } });
  assert.equal(r.action, 'send');
  assert.equal(
    r.sends[0].text,
    'PLA 1kg por R$ 79\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=minha-20\nSiga @viniachados e veja',
  );
});

test('Espelhamento: não envia se a Shopee não estiver conectada', async () => {
  const r = await processMessage(
    { sourceId: 'a', text: 'https://shopee.com.br/Produto-i.1.2' },
    rule,
    { accounts: { amazonTag: 'minha-20' } },
  );
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /link de afiliado de outra pessoa/);
});
