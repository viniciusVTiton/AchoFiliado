import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterReason, dropLines, offerPrice } from '../src/mirror/filters.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = '🔥 Filamento PLA 1kg\nDe R$ 129,90 por R$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345\n👉 Entre no grupo VIP: chat.whatsapp.com/xyz';

test('Preço: pega o menor valor da mensagem (preço da oferta)', () => {
  assert.equal(offerPrice(OFFER), 79.9);
  assert.equal(offerPrice('Notebook R$ 3.499,00 no Pix'), 3499);
  assert.equal(offerPrice('sem preço'), null);
});

test('Filtro: palavra proibida bloqueia, sem diferença de acento ou maiúscula', () => {
  assert.match(filterReason('Promoção ESGOTADA', { blockWords: ['esgotada'] }), /proibida "esgotada"/);
  assert.match(filterReason('Cupom válido', { blockWords: ['cupom valido'] }), /proibida/);
  assert.equal(filterReason('Oferta boa', { blockWords: ['esgotado'] }), null);
});

test('Filtro: palavras obrigatórias (basta uma)', () => {
  const rule = { requireWords: ['3d', 'filamento'] };
  assert.equal(filterReason(OFFER, rule), null);
  assert.match(filterReason('Air fryer R$ 299', rule), /obrigatórias/);
});

test('Filtro: faixa de preço; mensagem sem preço passa', () => {
  assert.match(filterReason(OFFER, { minPrice: 100 }), /abaixo do mínimo/);
  assert.match(filterReason(OFFER, { maxPrice: 50 }), /acima do máximo/);
  assert.equal(filterReason(OFFER, { minPrice: 50, maxPrice: 100 }), null);
  assert.equal(filterReason('sem preço aqui', { minPrice: 50 }), null);
});

test('Apagar linhas: some a linha inteira que contém o texto', () => {
  assert.equal(dropLines('A\n👉 Entre no GRUPO vip\nB', ['entre no grupo']), 'A\nB');
});

test('Regra: lê filtros da tela (preço com vírgula e ponto de milhar) e valida', () => {
  const r = validateRule({ sources: ['a'], targets: ['b'], blockWords: 'vip, esgotado', minPrice: '79,90', maxPrice: '2.000' });
  assert.deepEqual(r.blockWords, ['vip', 'esgotado']);
  assert.equal(r.minPrice, 79.9);
  assert.equal(r.maxPrice, 2000);
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], minPrice: '500', maxPrice: '100' }), /mínimo não pode ser maior/);
});

test('Clonador: filtros pulam a oferta com motivo, e apagam a linha do grupo VIP', async () => {
  const accounts = { amazonTag: 'minha-20' };
  const block = [validateRule({ id: 'r1', sources: ['a'], targets: ['v'], maxPrice: '50' })];
  const r1 = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: block, seen: new SeenStore(), accounts });
  assert.equal(r1.sends.length, 0);
  assert.match(r1.skipped[0].reason, /acima do máximo/);

  const clean = [validateRule({ id: 'r2', sources: ['a'], targets: ['v'], dropLines: ['entre no grupo'] })];
  const r2 = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: clean, seen: new SeenStore(), accounts });
  assert.equal(r2.sends[0].text, '🔥 Filamento PLA 1kg\nDe R$ 129,90 por R$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=minha-20');
});
