import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMirrorRunner } from '../src/whatsapp/runner.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const rule = {
  id: 'r1',
  sources: ['origem'],
  targets: ['destino-a', 'destino-b'],
  handleMode: 'replace',
  handle: '@viniachados',
};

const accounts = { amazonTag: 'viniachados0a-20' };
const offer = 'Fone R$ 99 https://www.amazon.com.br/Fone/dp/B0ABC12345';

function fakeAdapter({ failTo } = {}) {
  let handler;
  const sent = [];
  return {
    sent,
    onMessage(h) { handler = h; },
    async send(groupId, text) {
      if (groupId === failTo) throw new Error('grupo indisponível');
      sent.push({ groupId, text });
    },
    emit(msg) { return handler(msg); },
  };
}

test('envia a oferta para todos os destinos da regra', async () => {
  const adapter = fakeAdapter();
  const runner = createMirrorRunner({ adapter, getRules: () => [rule], accounts });
  runner.start();
  await adapter.emit({ sourceId: 'origem', text: offer });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(adapter.sent.map((s) => s.groupId), ['destino-a', 'destino-b']);
  assert.match(adapter.sent[0].text, /tag=viniachados0a-20/);
});

test('ignora mensagem de grupo que não é origem', async () => {
  const adapter = fakeAdapter();
  const runner = createMirrorRunner({ adapter, getRules: () => [rule], accounts });
  runner.start();
  await adapter.emit({ sourceId: 'outro', text: offer });
  await new Promise((r) => setImmediate(r));
  assert.equal(adapter.sent.length, 0);
});

test('não repete a mesma oferta no mesmo destino dentro do prazo', async () => {
  const adapter = fakeAdapter();
  const runner = createMirrorRunner({ adapter, getRules: () => [rule], accounts, seen: new SeenStore() });
  runner.start();
  await adapter.emit({ sourceId: 'origem', text: offer });
  await adapter.emit({ sourceId: 'origem', text: offer });
  assert.equal(adapter.sent.length, 2);
});

test('falha de envio libera a oferta para nova tentativa', async () => {
  const adapter = fakeAdapter({ failTo: 'destino-a' });
  const seen = new SeenStore();
  const runner = createMirrorRunner({ adapter, getRules: () => [rule], accounts, seen });
  runner.start();
  await adapter.emit({ sourceId: 'origem', text: offer });
  const errors = runner.history().filter((h) => h.action === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].target, 'destino-a');
  assert.equal(adapter.sent.length, 1);
  // a oferta não ficou marcada como enviada no destino que falhou
  await adapter.emit({ sourceId: 'origem', text: offer });
  assert.equal(adapter.sent.filter((s) => s.groupId === 'destino-a').length, 0);
});

test('regra desativada não envia nada', async () => {
  const adapter = fakeAdapter();
  const runner = createMirrorRunner({ adapter, getRules: () => [{ ...rule, enabled: false }], accounts });
  runner.start();
  await adapter.emit({ sourceId: 'origem', text: offer });
  await new Promise((r) => setImmediate(r));
  assert.equal(adapter.sent.length, 0);
});

test('rejeita adapter incompleto', () => {
  assert.throws(() => createMirrorRunner({ adapter: {}, getRules: () => [] }), /incompleto/);
});
