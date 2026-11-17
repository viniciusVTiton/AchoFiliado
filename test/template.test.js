import { test } from 'node:test';
import assert from 'node:assert/strict';

import { offerData, renderTemplate } from '../src/mirror/template.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = '🔥 Filamento PLA 1kg\nDe R$ 129,90 por R$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345\n👉 Entre no grupo VIP: chat.whatsapp.com/xyz';
const MINE = 'https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20';
const accounts = { amazonTag: 'minha-20' };

test('Modelo: tira título, preço e preço antigo da oferta, e usa só o seu link', () => {
  const data = offerData(OFFER, OFFER.replace('https://www.amazon.com.br/dp/B0ABC12345', MINE));
  assert.equal(data.titulo, 'Filamento PLA 1kg');
  assert.equal(data.preco, 'R$ 79,90');
  assert.equal(data.preco_antigo, 'R$ 129,90');
  assert.equal(data.loja, 'Amazon');
  assert.equal(data.link, MINE);
  assert.equal(data.links, MINE);
});

test('Modelo: linha cujo campo ficou vazio some, sem sobrar "De  por"', () => {
  const out = renderTemplate('{titulo}\nDe {preco_antigo} por {preco}\nCompre: {link}', {
    titulo: 'Caneca', preco: 'R$ 20,00', preco_antigo: '', link: MINE, links: MINE, loja: 'Amazon',
  });
  assert.equal(out, `Caneca\nCompre: ${MINE}`);
});

test('Modelo: envia o texto do modelo com o seu link, sem o link do grupo VIP', async () => {
  const rule = validateRule({
    id: 't1', sources: ['a'], targets: ['v'], textMode: 'template',
    template: '🔥 {titulo}\n{preco} {link}', randomOpener: false,
  });
  const r = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: [rule], seen: new SeenStore(), accounts });
  assert.equal(r.sends[0].text, `🔥 Filamento PLA 1kg\nR$ 79,90 ${MINE}`);
  assert.doesNotMatch(r.sends[0].text, /whatsapp/);
});

test('Regra: modelo vazio é recusado; imagem repete por padrão e pode ser desligada', () => {
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], textMode: 'template', template: '  ' }), /modelo de texto/);
  assert.equal(validateRule({ sources: ['a'], targets: ['b'] }).imageMode, 'original');
  assert.equal(validateRule({ sources: ['a'], targets: ['b'], imageMode: 'off' }).imageMode, 'off');
  assert.equal(validateRule({ sources: ['a'], targets: ['b'], keepImage: false }).imageMode, 'off');
});

test('Imagem: a entrega leva o aviso de repetir ou não a imagem', async () => {
  const rule = validateRule({ id: 'i1', sources: ['a'], targets: ['v'], imageMode: 'off' });
  const r = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: [rule], seen: new SeenStore(), accounts });
  assert.equal(r.sends[0].imageMode, 'off');
});
