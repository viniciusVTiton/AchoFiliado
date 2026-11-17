import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processMessage } from '../src/mirror/engine.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { SeenStore } from '../src/mirror/dedupe.js';
import { imageFromHtml } from '../src/providers/title.js';

const OFFER = '🔥 Filamento PLA 1kg\nR$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345';
const MINE = 'https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20';
const accounts = { amazonTag: 'minha-20' };

test('Link preview: manda só o seu link, sem texto', async () => {
  const rule = validateRule({ id: 'l1', sources: ['a'], targets: ['v'], imageMode: 'link' });
  const r = await processMessage({ sourceId: 'a', text: OFFER }, rule, { accounts, seen: new SeenStore() });
  assert.equal(r.sends[0].text, MINE);
});

test('Sempre com foto: sem foto na origem, usa a foto da loja', async () => {
  const rule = validateRule({ id: 'a1', sources: ['a'], targets: ['v'], imageMode: 'always' });
  const r = await processMessage(
    { sourceId: 'a', text: OFFER, mediaHash: '' },
    rule,
    { accounts, seen: new SeenStore(), productFor: async () => ({ image: 'https://m.media-amazon.com/foto.jpg' }) },
  );
  assert.equal(r.sends[0].imageUrl, 'https://m.media-amazon.com/foto.jpg');
});

test('Sempre com foto: se a origem já tem foto, não busca a da loja', async () => {
  const rule = validateRule({ id: 'a2', sources: ['a'], targets: ['v'], imageMode: 'always' });
  const r = await processMessage(
    { sourceId: 'a', text: OFFER, mediaHash: 'abc' },
    rule,
    { accounts, seen: new SeenStore(), productFor: async () => ({ image: 'https://m.media-amazon.com/foto.jpg' }) },
  );
  assert.equal(r.sends[0].imageUrl, null);
});

test('Não repetir a mesma foto: segunda vez no mesmo grupo é pulada, em outro grupo não', async () => {
  const rule = validateRule({ id: 'n1', sources: ['a'], targets: ['111@g.us'], noRepeatPhoto: true });
  const seen = new SeenStore();
  const first = await processMessage({ sourceId: 'a', text: OFFER, mediaHash: 'foto1' }, rule, { accounts, seen });
  assert.equal(first.action, 'send');
  const again = await processMessage({ sourceId: 'a', text: 'Outro texto\nhttps://www.amazon.com.br/dp/ZZZZZZZZZZ', mediaHash: 'foto1' }, rule, { accounts, seen });
  assert.match(again.skippedTargets[0].reason, /Esta foto já foi enviada/);
  const other = validateRule({ id: 'n2', sources: ['a'], targets: ['222@g.us'], noRepeatPhoto: true });
  const elsewhere = await processMessage({ sourceId: 'a', text: OFFER, mediaHash: 'foto1' }, other, { accounts, seen });
  assert.equal(elsewhere.action, 'send');
});

test('Foto da loja: tira o endereço da imagem do produto', () => {
  assert.equal(imageFromHtml('<meta property="og:image" content="https://http2.mlstatic.com/D_NQ_123-O.webp">'), 'https://http2.mlstatic.com/D_NQ_123-O.webp');
  assert.equal(imageFromHtml('<html></html>'), null);
});
