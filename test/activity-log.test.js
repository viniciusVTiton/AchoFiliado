import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ActivityLog } from '../src/whatsapp/parts.js';

test('Histórico: guarda em disco e volta depois de reiniciar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'achofiliado-'));
  try {
    const file = join(dir, 'activity.json');
    const first = new ActivityLog(50, { file });
    first.add({ type: 'sent', group: 'Ofertas', text: 'oi' });
    await new Promise((r) => setTimeout(r, 50));

    const again = new ActivityLog(50, { file });
    await again.load();
    assert.equal(again.list()[0].text, 'oi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Resumo do dia: conta só o que aconteceu hoje', () => {
  const log = new ActivityLog();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  log.items = [
    { at: now.toISOString(), type: 'sent' },
    { at: now.toISOString(), type: 'sent' },
    { at: now.toISOString(), type: 'skipped' },
    { at: now.toISOString(), type: 'error' },
    { at: yesterday, type: 'sent' },
  ];
  const s = log.summary(now);
  assert.equal(s.sent, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.error, 1);
  assert.equal(s.received, 0);
});
