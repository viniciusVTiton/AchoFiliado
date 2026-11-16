import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectStore } from '../src/links/detect.js';
import { extractLinks } from '../src/links/extract.js';
import { convertAmazon } from '../src/links/converters.js';
import { convertLink, convertMessage } from '../src/links/index.js';

test('detecta a loja pelo domínio', () => {
  assert.equal(detectStore('https://www.amazon.com.br/dp/B0ABC12345'), 'amazon');
  assert.equal(detectStore('https://amzn.to/3xyz'), 'amazon');
  assert.equal(detectStore('https://shopee.com.br/produto-i.1.2'), 'shopee');
  assert.equal(detectStore('https://shp.ee/abc'), 'shopee');
  assert.equal(detectStore('https://produto.mercadolivre.com.br/MLB-123'), 'mercadolivre');
  assert.equal(detectStore('https://meli.la/abc'), 'mercadolivre');
  assert.equal(detectStore('https://www.google.com/search?q=x'), null);
  assert.equal(detectStore('não é url'), null);
});

test('extrai links de um texto sem pontuação final', () => {
  const links = extractLinks('Olha isso: https://amzn.to/abc, muito bom!');
  assert.deepEqual(links.map((l) => l.url), ['https://amzn.to/abc']);
});

test('amazon: gera link limpo com a tag do afiliado', () => {
  const result = convertAmazon(
    'https://www.amazon.com.br/Produto-Qualquer/dp/B0ABC12345/ref=sr_1_1?utm=x&tag=outra-20',
    { tag: 'minhatag-20' },
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.url, 'https://www.amazon.com.br/dp/B0ABC12345?tag=minhatag-20');
});

test('amazon: aceita o formato /gp/product', () => {
  const result = convertAmazon('https://www.amazon.com.br/gp/product/b0abc12345', { tag: 'x-20' });
  assert.equal(result.url, 'https://www.amazon.com.br/dp/B0ABC12345?tag=x-20');
});

test('amazon: link curto pede resolução antes', () => {
  assert.deepEqual(convertAmazon('https://amzn.to/abc', { tag: 'x-20' }), {
    status: 'needs_resolve',
    url: 'https://amzn.to/abc',
  });
});

test('amazon: sem tag não converte', () => {
  assert.equal(convertAmazon('https://www.amazon.com.br/dp/B0ABC12345', {}).status, 'needs_provider');
});

test('amazon: URL sem ASIN não converte', () => {
  assert.equal(convertAmazon('https://www.amazon.com.br/s?k=fone', { tag: 'x-20' }).status, 'unsupported');
});

test('shopee e mercado livre sem conta conectada pedem o provedor', async () => {
  assert.equal((await convertLink('https://shopee.com.br/x-i.1.2', {})).status, 'needs_provider');
  assert.equal((await convertLink('https://meli.la/abc', {})).status, 'needs_provider');
});

test('shopee usa o provedor injetado', async () => {
  const provider = async (url) => ({ status: 'ok', url: `https://s.shopee.com.br/affiliate?u=${encodeURIComponent(url)}` });
  const result = await convertLink('https://shopee.com.br/x-i.1.2', { shopeeProvider: provider });
  assert.equal(result.store, 'shopee');
  assert.equal(result.status, 'ok');
});

test('mensagem: troca só os links de loja e lista os que falharam', async () => {
  const text = 'Oferta: https://www.amazon.com.br/dp/B0ABC12345 e também https://shopee.com.br/x-i.1.2 e https://g.com/a';
  const { text: out, changes, failed } = await convertMessage(text, { amazonTag: 'x-20' });
  assert.equal(
    out,
    'Oferta: https://www.amazon.com.br/dp/B0ABC12345?tag=x-20 e também https://shopee.com.br/x-i.1.2 e https://g.com/a',
  );
  assert.equal(changes.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].store, 'shopee');
});
