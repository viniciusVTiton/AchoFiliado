import { test } from 'node:test';
import assert from 'node:assert/strict';

import { offerData, renderTemplate } from '../src/mirror/template.js';
import { productTitle, titleFromHtml, titleFromMlPath } from '../src/providers/title.js';
import { processMessage } from '../src/mirror/engine.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const PRODUCT = 'https://www.mercadolivre.com.br/impressora-3d-ender-3/p/MLB123456';
const SOCIAL_HTML = `<a href="${PRODUCT}?ref=x">produto</a>`;

function fakeWeb(pages) {
  return async (url) => {
    const page = pages[url];
    if (!page) return new Response('', { status: 404 });
    return new Response(page.body ?? '', { status: page.status ?? 200, headers: page.location ? { location: page.location } : {} });
  };
}

test('Título: lê o og:title e tira o nome da loja e as entidades', () => {
  assert.equal(
    titleFromHtml('<meta property="og:title" content="Impressora 3D Ender 3 &amp; Kit | Mercado Livre">'),
    'Impressora 3D Ender 3 & Kit',
  );
  assert.equal(titleFromHtml('<meta content="Filamento PLA" property="og:title">'), 'Filamento PLA');
  assert.equal(titleFromHtml('<html></html>'), null);
});

test('Título: sem og:title, usa o nome que está no endereço do produto', () => {
  assert.equal(titleFromMlPath(PRODUCT), 'Impressora 3d ender 3');
});

test('Título: link curto de afiliado leva ao produto e pega o nome da página dele', async () => {
  const pages = {
    'https://meli.la/abc': { status: 302, location: 'https://www.mercadolivre.com.br/social/bbaed' },
    'https://www.mercadolivre.com.br/social/bbaed': { body: SOCIAL_HTML },
    [PRODUCT]: { body: '<meta property="og:title" content="Impressora 3D Ender 3 | Mercado Livre">' },
  };
  const title = await productTitle('https://meli.la/abc', { fetch: fakeWeb(pages) });
  assert.equal(title, 'Impressora 3D Ender 3');
});

test('Título: se a página não responde, não inventa nome', async () => {
  assert.equal(await productTitle('https://meli.la/zzz', { fetch: fakeWeb({}) }), null);
  assert.equal(await productTitle('https://example.com/produto', { fetch: fakeWeb({}) }), null);
});

test('Cupom: copia o código da mensagem e não pega palavra comum', () => {
  const data = offerData('CUPOM MEUDESCONTOOBRA\n\n❌ R$ 108,78\n✅ R$ 79,00\n\n👉 https://www.amazon.com.br/dp/B0ABC12345', 'x');
  assert.equal(data.cupom, 'MEUDESCONTOOBRA');
  assert.equal(offerData('Cupom válido até amanhã', 'x').cupom, '');
});

test('Cupom: a linha do cupom não vira o título do produto', () => {
  const data = offerData('CUPOM MEUDESCONTOOBRA\nImpressora 3D Ender 3\nR$ 79,00', 'x');
  assert.equal(data.titulo, 'Impressora 3D Ender 3');
});

test('Modelo: cupom e título entram mesmo quando a origem não tem título', async () => {
  const rule = validateRule({
    id: 'c1', sources: ['a'], targets: ['v'], textMode: 'template', randomOpener: false,
    template: '🎟️ Cupom: {cupom}\n{titulo}\n{preco} {link}',
  });
  const text = 'CUPOM MEUDESCONTOOBRA\n\n❌ R$ 108,78\n✅ R$ 79,00\n\n👉 https://www.amazon.com.br/dp/B0ABC12345';
  const r = await processMessage(
    { sourceId: 'a', text },
    rule,
    { accounts: { amazonTag: 'minha-20' }, seen: new SeenStore(), productFor: async () => ({ title: 'Impressora 3D Ender 3' }) },
  );
  assert.equal(
    r.sends[0].text,
    '🎟️ Cupom: MEUDESCONTOOBRA\nImpressora 3D Ender 3\nR$ 79,00 https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20',
  );
});

test('Modelo: o nome do produto da loja vence o cabeçalho da mensagem', async () => {
  const rule = validateRule({ id: 'c2', sources: ['a'], targets: ['v'], textMode: 'template', randomOpener: false, template: '{titulo}\n{link}' });
  const text = '🔥 OFERTA IMPERDÍVEL!\nR$ 79,00\nhttps://www.amazon.com.br/dp/B0ABC12345';
  const r = await processMessage(
    { sourceId: 'a', text },
    rule,
    { accounts: { amazonTag: 'minha-20' }, seen: new SeenStore(), productFor: async () => ({ title: 'Impressora 3D Ender 3' }) },
  );
  assert.equal(r.sends[0].text, 'Impressora 3D Ender 3\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=minha-20');
});

test('Modelo: sem cupom na mensagem, a linha do cupom some', () => {
  const out = renderTemplate('🎟️ Cupom: {cupom}\n{titulo}', { cupom: '', titulo: 'Caneca' });
  assert.equal(out, 'Caneca');
});
