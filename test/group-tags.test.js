import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GroupTagStore, validateGroupTag } from '../src/mirror/group-tags.js';
import { ActivityLog } from '../src/whatsapp/parts.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = '🔥 Filamento PLA 1kg\nR$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345';

test('Etiqueta: aceita código comum e recusa caractere estranho', () => {
  assert.deepEqual(validateGroupTag({ amazonTag: ' viniachados0a-20 ', shopeeSubId: 'grupo_3d' }), {
    amazonTag: 'viniachados0a-20',
    shopeeSubId: 'grupo_3d',
  });
  assert.throws(() => validateGroupTag({ amazonTag: 'x y' }), /Tag da Amazon/);
  assert.throws(() => validateGroupTag({ shopeeSubId: 'a/b' }), /Sub-ID da Shopee/);
});

test('Etiqueta: salva por grupo, sobrevive a reiniciar e apaga grupo vazio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'achofiliado-'));
  try {
    const file = join(dir, 'group-tags.json');
    const store = new GroupTagStore(file);
    await store.replace({
      '111@g.us': { amazonTag: 'tag-3d-20', shopeeSubId: 'impressao3d' },
      '222@g.us': { amazonTag: '', shopeeSubId: '' },
    });
    const again = new GroupTagStore(file);
    await again.load();
    assert.equal(again.get('111@g.us').amazonTag, 'tag-3d-20');
    assert.deepEqual(again.get('222@g.us'), {});
    await assert.rejects(store.replace({ 'nao-e-grupo': { amazonTag: 'x' } }), /Grupo inválido/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Relatório: conta os envios de hoje por grupo', () => {
  const log = new ActivityLog();
  const now = new Date();
  log.items = [
    { at: now.toISOString(), type: 'sent', group: '#12 Impressão 3D' },
    { at: now.toISOString(), type: 'sent', group: '#12 Impressão 3D' },
    { at: now.toISOString(), type: 'sent', group: 'Calango Tech' },
    { at: now.toISOString(), type: 'skipped', group: 'Calango Tech' },
  ];
  assert.deepEqual(log.summary(now).byGroup, { '#12 Impressão 3D': 2, 'Calango Tech': 1 });
});

test('Etiqueta por grupo: cada destino recebe o seu link com a sua tag', async () => {
  const rule = validateRule({ id: 'g1', sources: ['a'], targets: ['111@g.us', '222@g.us'] });
  const tags = { '111@g.us': { amazonTag: 'tag-3d-20' }, '222@g.us': { amazonTag: 'tag-fit-20' } };
  const r = await handleIncoming(
    { sourceId: 'a', text: OFFER },
    { rules: [rule], seen: new SeenStore(), accountsFor: (t) => ({ amazonTag: tags[t].amazonTag }) },
  );
  const byTarget = Object.fromEntries(r.sends.map((s) => [s.target, s.text]));
  assert.match(byTarget['111@g.us'], /tag=tag-3d-20/);
  assert.match(byTarget['222@g.us'], /tag=tag-fit-20/);
});
