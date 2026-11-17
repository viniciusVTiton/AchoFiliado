import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemplateStore, BUILTIN_TEMPLATES } from '../src/mirror/templates-store.js';

test('Modelos: os três prontos sempre aparecem primeiro', async () => {
  const store = new TemplateStore(join(tmpdir(), 'nao-existe-templates.json'));
  await store.load();
  assert.deepEqual(store.list().map((t) => t.name), ['Post padrão', 'Direto e agressivo', 'Limpo']);
});

test('Modelos: salva, edita, guarda em disco e apaga; prontos não são apagados', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'achofiliado-'));
  try {
    const file = join(dir, 'templates.json');
    const store = new TemplateStore(file);
    await store.save({ name: 'Meu post', text: '{titulo}\n👉 {link}' });
    const saved = store.list().find((t) => t.name === 'Meu post');
    assert.ok(saved.id);

    await store.save({ id: saved.id, name: 'Meu post 2', text: '{preco}' });
    const again = new TemplateStore(file);
    await again.load();
    assert.equal(again.list().at(-1).name, 'Meu post 2');

    await again.remove(saved.id);
    assert.equal(again.list().some((t) => t.id === saved.id), false);
    await assert.rejects(again.remove(BUILTIN_TEMPLATES[0].id), /não pode ser apagado/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Modelos: recusa nome vazio, texto vazio e campo que não existe', async () => {
  const store = new TemplateStore(join(tmpdir(), 'nao-usado.json'));
  await assert.rejects(store.save({ name: '', text: 'x' }), /nome/);
  await assert.rejects(store.save({ name: 'a', text: '  ' }), /texto/);
  await assert.rejects(store.save({ name: 'a', text: '{nao_existe}' }), /Campo desconhecido/);
});
