import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RulesStore, validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = 'PLA 1kg R$ 79\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=outro-20\nSiga @mundo3d';
const accounts = { amazonTag: 'minha-20' };

/* ---------- Regras ---------- */

test('Regras: salva no arquivo e carrega de novo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'achofiliado-'));
  try {
    const file = join(dir, 'data', 'rules.json');
    const store = new RulesStore(file);
    await store.load();
    const saved = await store.save({ name: 'Impressão 3D', sources: ['grupo-a'], targets: ['vini-3d'] });
    assert.ok(saved.id);

    const again = new RulesStore(file);
    await again.load();
    assert.equal(again.list().length, 1);
    assert.equal(again.list()[0].name, 'Impressão 3D');

    assert.equal(await again.remove(saved.id), true);
    assert.equal(again.list().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Regras: recusa origem igual ao destino (evita loop)', () => {
  assert.throws(() => validateRule({ sources: ['a'], targets: ['a'] }), /origem e destino/);
});

test('Regras: recusa horário inválido e loja desconhecida', () => {
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], schedule: { start: '25:00', end: '08:00' } }), /HH:MM/);
  assert.throws(() => validateRule({ sources: ['a'], targets: ['b'], stores: ['aliexpress'] }), /Loja desconhecida/);
});

/* ---------- Entrada de mensagens ---------- */

test('Entrada: mensagem de grupo de origem vira envio para cada destino', async () => {
  const rules = [validateRule({ id: 'r1', sources: ['a'], targets: ['vini-3d', 'vini-tec'] })];
  const r = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules, seen: new SeenStore(), accounts });
  assert.deepEqual(r.sends.map((s) => s.target), ['vini-3d', 'vini-tec']);
  assert.match(r.sends[0].text, /tag=minha-20/);
  assert.doesNotMatch(r.sends[0].text, /@mundo3d|outro-20/);
});

test('Entrada: a mesma oferta vinda de outro grupo não é repetida no mesmo destino', async () => {
  const rules = [
    validateRule({ id: 'r1', sources: ['a'], targets: ['vini-3d'] }),
    validateRule({ id: 'r2', sources: ['b'], targets: ['vini-3d'] }),
  ];
  const seen = new SeenStore();
  const first = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules, seen, accounts });
  const second = await handleIncoming({ sourceId: 'b', text: OFFER.replace('R$ 79', 'R$ 79,90') }, { rules, seen, accounts });
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 0);
  assert.match(second.skipped[0].reason, /já enviada/);
});

test('Repetição: memória salva em disco sobrevive a reiniciar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acho-seen-'));
  try {
    const file = join(dir, 'seen.json');
    const a = new SeenStore({ file });
    a.add('grupo', 'amazon:B0ABC12345');
    await a.flush();
    const b = new SeenStore({ file });
    await b.load();
    assert.equal(b.has('grupo', 'amazon:B0ABC12345'), true);
    assert.equal(b.has('outro', 'amazon:B0ABC12345'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Repetição: mesmo produto com links curtos de afiliados diferentes não repete', async () => {
  // Cada origem usa o link curto de um afiliado diferente; convertidos, viram o MESMO link meu.
  const rules = [
    validateRule({ id: 'r1', sources: ['a'], targets: ['vini'] }),
    validateRule({ id: 'r2', sources: ['b'], targets: ['vini'] }),
  ];
  const accounts = {
    mercadoLivreProvider: async () => ({ status: 'ok', url: 'https://meli.la/MEU' }),
    resolve: async () => 'https://www.mercadolivre.com.br/produto/p/MLB123',
  };
  const seen = new SeenStore();
  const first = await handleIncoming({ sourceId: 'a', text: 'Air fryer https://meli.la/AFILIADO1' }, { rules, seen, accounts });
  const second = await handleIncoming({ sourceId: 'b', text: 'AIR FRYER!! https://meli.la/AFILIADO2' }, { rules, seen, accounts });
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 0);
});

test('Modo teste: repassa oferta do Mercado Livre sem nenhum link e sem o @ de quem postou', async () => {
  const rules = [validateRule({ id: 'r1', sources: ['a'], targets: ['b'], handle: '@viniachados', handleMode: 'replace', testMode: true })];
  const text = '🔥 Air fryer R$ 299\nhttps://mercadolivre.com/sec/ABC123\nSiga @outro e veja https://outro.com.br';
  const seen = new SeenStore();
  const r = await handleIncoming({ sourceId: 'a', text }, { rules, seen, accounts: {} });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].text, '🔥 Air fryer R$ 299\nSiga @viniachados e veja');

  const again = await handleIncoming({ sourceId: 'a', text }, { rules, seen, accounts: {} });
  assert.equal(again.sends.length, 0);
});

test('Entrada: grupo sem regra e regra desativada não enviam nada', async () => {
  const rules = [validateRule({ id: 'r1', sources: ['a'], targets: ['x'], enabled: false })];
  const r = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules, seen: new SeenStore(), accounts });
  assert.equal(r.sends.length, 0);
  assert.match(r.skipped[0].reason, /Nenhuma regra/);
});
