import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RateLimiter, validateLimits } from '../src/whatsapp/limits.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const HOUR = 60 * 60 * 1000;

test('Limites: bloqueia por hora no grupo e libera depois que a hora passa', () => {
  let now = 0;
  const lim = new RateLimiter({ limits: { perGroupHour: 2, perGroupDay: 10, totalHour: 50 }, now: () => now });
  lim.record('g');
  lim.record('g');
  assert.match(lim.check('g'), /2 posts por hora neste grupo/);
  assert.equal(lim.check('outro'), null);
  now += HOUR + 1;
  assert.equal(lim.check('g'), null);
});

test('Limites: bloqueia por dia no grupo e pelo total da hora', () => {
  let now = 0;
  const lim = new RateLimiter({ limits: { perGroupHour: 5, perGroupDay: 6, totalHour: 7 }, now: () => now });
  for (let i = 0; i < 6; i++) {
    lim.record('g');
    now += HOUR / 2; // espalhado para não bater o limite por hora
  }
  assert.match(lim.check('g'), /6 posts por dia/);
  now = 100 * HOUR;
  for (let i = 0; i < 7; i++) lim.record(`grupo${i}`);
  assert.match(lim.check('novo'), /7 posts por hora no total/);
});

test('Limites: valores inválidos são recusados', () => {
  assert.throws(() => validateLimits({ perGroupHour: 0 }), /entre 1 e 1000/);
  assert.throws(() => validateLimits({ perGroupHour: 20, perGroupDay: 10 }), /maior que o limite por dia/);
  assert.deepEqual(validateLimits({ perGroupHour: '5' }), { perGroupHour: 5, perGroupDay: 80, totalHour: 30 });
});

test('Limites: contagem e ajustes sobrevivem a reiniciar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acho-lim-'));
  try {
    const file = join(dir, 'limits.json');
    const a = new RateLimiter({ file });
    await a.setLimits({ perGroupHour: 3, perGroupDay: 20, totalHour: 10 });
    a.record('g');
    await a.flush();
    const b = new RateLimiter({ file });
    await b.load();
    assert.equal(b.limits.perGroupHour, 3);
    assert.equal(b.usage().groups.g.hour, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Clonador: acima do limite a oferta é pulada com o motivo, e não conta como enviada', async () => {
  const lim = new RateLimiter({ limits: { perGroupHour: 1, perGroupDay: 10, totalHour: 50 } });
  const rules = [validateRule({ id: 'r1', sources: ['a'], targets: ['vini'] })];
  const seen = new SeenStore();
  const accounts = { amazonTag: 'minha-20' };
  const first = await handleIncoming({ sourceId: 'a', text: 'https://www.amazon.com.br/dp/B0ABC12345' }, { rules, seen, accounts, limiter: lim });
  const second = await handleIncoming({ sourceId: 'a', text: 'https://www.amazon.com.br/dp/B0ZZZ99999' }, { rules, seen, accounts, limiter: lim });
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 0);
  assert.match(second.skipped[0].reason, /1 posts por hora/);
  // A oferta pulada não foi marcada como enviada: pode sair depois, quando o limite liberar.
  assert.equal(seen.has('vini', 'amazon:B0ZZZ99999'), false);
});
