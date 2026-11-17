import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readContent, SendQueue, ActivityLog } from '../src/whatsapp/parts.js';
import { fingerprint } from '../src/mirror/dedupe.js';

test('Leitura: texto simples, texto com link e legenda de foto', () => {
  assert.deepEqual(readContent({ conversation: 'oi' }), { text: 'oi', kind: 'text' });
  assert.deepEqual(readContent({ extendedTextMessage: { text: 'https://amzn.to/x' } }), { text: 'https://amzn.to/x', kind: 'text' });
  assert.deepEqual(readContent({ imageMessage: { caption: 'PLA R$ 79' } }), { text: 'PLA R$ 79', kind: 'image' });
  assert.equal(readContent({ stickerMessage: {} }), null);
  assert.equal(readContent(null), null);
});

test('Fila: envia em ordem, uma por vez, com pausa entre os envios', async () => {
  const log = [];
  const queue = new SendQueue({
    minDelayMs: 4000,
    maxDelayMs: 9000,
    random: () => 0.5,
    sleep: async (ms) => log.push(`pausa ${ms}`),
    send: async (item) => log.push(`envio ${item.target}`),
  });
  queue.push({ target: 'a' });
  queue.push({ target: 'b' });
  await queue.push({ target: 'c' });
  assert.deepEqual(log, ['envio a', 'pausa 6500', 'envio b', 'pausa 6500', 'envio c']);
});

test('Fila: um envio com erro não trava os próximos', async () => {
  const sent = [];
  const errors = [];
  const queue = new SendQueue({
    sleep: async () => {},
    send: async (item) => {
      if (item.target === 'ruim') throw new Error('sem permissão');
      sent.push(item.target);
    },
    onError: (e, item) => errors.push(`${item.target}: ${e.message}`),
  });
  queue.push({ target: 'ruim' });
  await queue.push({ target: 'bom' });
  assert.deepEqual(sent, ['bom']);
  assert.deepEqual(errors, ['ruim: sem permissão']);
});

test('Histórico: mais recente primeiro e com limite', () => {
  const log = new ActivityLog(2);
  log.add({ type: 'a' });
  log.add({ type: 'b' });
  log.add({ type: 'c' });
  assert.deepEqual(log.list().map((x) => x.type), ['c', 'b']);
});

test('Repetição: mesmo produto com foto diferente é a mesma oferta', () => {
  const a = fingerprint({ productKeys: ['amazon:B0ABC12345'], mediaHash: 'foto1' });
  const b = fingerprint({ productKeys: ['amazon:B0ABC12345'], mediaHash: 'foto2' });
  assert.equal(a, b);
  assert.notEqual(fingerprint({ mediaHash: 'foto1' }), fingerprint({ mediaHash: 'foto2' }));
});
