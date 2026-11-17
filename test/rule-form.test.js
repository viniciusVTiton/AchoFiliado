import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterReason } from '../src/mirror/filters.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = 'CUPOM MEUDESCONTOOBRA\n\n❌ R$ 108,78\n✅ R$ 79,00\n\n👉 https://www.amazon.com.br/dp/B0ABC12345';

test('Desconto mínimo: bloqueia oferta com desconto menor que o pedido', () => {
  assert.match(filterReason(OFFER, { minDiscount: 30 }), /desconto de 27% abaixo do mínimo de 30%/);
  assert.equal(filterReason(OFFER, { minDiscount: 20 }), null);
});

test('Desconto mínimo: sem preço antigo na mensagem, deixa passar', () => {
  assert.equal(filterReason('Filamento R$ 79,00', { minDiscount: 30 }), null);
});

test('Regra: lê desconto mínimo e recusa valor fora de 0 a 99', () => {
  assert.equal(validateRule({ sources: ['a'], targets: ['b'], minDiscount: '30' }).minDiscount, 30);
  assert.equal(validateRule({ sources: ['a'], targets: ['b'], minDiscount: '' }).minDiscount, null);
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], minDiscount: '150' }), /Desconto mínimo/);
});

test('Regra: etiqueta própria tem prioridade sobre a do grupo', async () => {
  const rule = validateRule({ id: 'e1', sources: ['a'], targets: ['111@g.us'], amazonTag: 'regra-20' });
  const r = await handleIncoming(
    { sourceId: 'a', text: OFFER },
    { rules: [rule], seen: new SeenStore(), accountsFor: (target, rule) => ({ amazonTag: rule.amazonTag || 'grupo-20' }) },
  );
  assert.match(r.sends[0].text, /tag=regra-20/);
});

test('Regra: lojas escolhidas são validadas', () => {
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], stores: ['aliexpress'] }), /Loja desconhecida/);
  assert.deepEqual(validateRule({ sources: ['a'], targets: ['b'], stores: ['shopee'] }).stores, ['shopee']);
});
