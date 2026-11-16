import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  signShopee,
  buildShortLinkPayload,
  sanitizeSubIds,
  createShopeeProvider,
  SHOPEE_ENDPOINT,
} from '../src/providers/shopee.js';
import { convertMessage } from '../src/links/index.js';

const APP_ID = '123';
const SECRET = 'segredo-de-teste';

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (body, status = 200) => ({ status, json: async () => body });

test('assinatura segue sha256(AppId + Timestamp + Payload + Secret)', () => {
  const payload = '{"query":"x"}';
  const header = signShopee({ appId: APP_ID, secret: SECRET, timestamp: 1700000000, payload });
  const expected = createHash('sha256').update(`${APP_ID}1700000000${payload}${SECRET}`).digest('hex');
  assert.equal(header, `SHA256 Credential=${APP_ID}, Timestamp=1700000000, Signature=${expected}`);
});

test('payload escapa a URL e limita sub IDs a 5 alfanuméricos', () => {
  assert.deepEqual(sanitizeSubIds(['grupo-3d', 'tec', 'a', 'b', 'c', 'd']), ['grupo3d', 'tec', 'a', 'b', 'c']);
  const payload = JSON.parse(buildShortLinkPayload('https://shopee.com.br/x?a="b"', ['g1']));
  assert.match(payload.query, /generateShortLink\(input: \{ originUrl: "https:\/\/shopee\.com\.br\/x\?a=\\"b\\"", subIds: \["g1"\] \}\)/);
});

test('sem credenciais o provedor não é criado', () => {
  assert.equal(createShopeeProvider({ appId: '', secret: '' }), null);
});

test('envia a requisição assinada e devolve o shortLink', async () => {
  const fetch = fakeFetch(() => json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/abc' } } }));
  const provider = createShopeeProvider({ appId: APP_ID, secret: SECRET, fetch, now: () => 1700000000_000 });
  const result = await provider('https://shopee.com.br/x-i.1.2');

  assert.deepEqual(result, { status: 'ok', url: 'https://s.shopee.com.br/abc' });
  assert.equal(fetch.calls[0].url, SHOPEE_ENDPOINT);
  const { headers, body } = fetch.calls[0].init;
  assert.equal(headers.Authorization, signShopee({ appId: APP_ID, secret: SECRET, timestamp: 1700000000, payload: body }));
});

test('erros conhecidos da Shopee viram mensagens claras', async () => {
  const fetch = fakeFetch(() => json({ errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }));
  const provider = createShopeeProvider({ appId: APP_ID, secret: SECRET, fetch });
  const result = await provider('https://shopee.com.br/x');
  assert.equal(result.status, 'error');
  assert.match(result.reason, /App ID e Secret/);
});

test('falha de rede não derruba a conversão', async () => {
  const fetch = fakeFetch(() => { throw new TypeError('fetch failed'); });
  const provider = createShopeeProvider({ appId: APP_ID, secret: SECRET, fetch });
  assert.equal((await provider('https://shopee.com.br/x')).status, 'error');
});

test('mensagem com Shopee e Amazon converte as duas com a conta conectada', async () => {
  const fetch = fakeFetch(() => json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/zz' } } }));
  const shopeeProvider = createShopeeProvider({ appId: APP_ID, secret: SECRET, fetch });
  const { text, failed } = await convertMessage(
    'A: https://www.amazon.com.br/dp/B0ABC12345 S: https://shopee.com.br/x-i.1.2',
    { amazonTag: 't-20', shopeeProvider },
  );
  assert.equal(text, 'A: https://www.amazon.com.br/dp/B0ABC12345?tag=t-20 S: https://s.shopee.com.br/zz');
  assert.equal(failed.length, 0);
});

test('link curto da Amazon é resolvido antes de converter', async () => {
  const resolve = async () => 'https://www.amazon.com.br/Produto/dp/B0ABC12345?ref=x';
  const { text } = await convertMessage('Veja https://amzn.to/abc', { amazonTag: 't-20', resolve });
  assert.equal(text, 'Veja https://www.amazon.com.br/dp/B0ABC12345?tag=t-20');
});
