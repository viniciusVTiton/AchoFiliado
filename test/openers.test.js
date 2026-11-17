import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OPENERS, OpenerPicker } from '../src/mirror/openers.js';
import { validateRule } from '../src/mirror/rules-store.js';
import { handleIncoming } from '../src/mirror/inbox.js';
import { SeenStore } from '../src/mirror/dedupe.js';

const OFFER = '🔥 Filamento PLA 1kg\nDe R$ 129,90 por R$ 79,90\nhttps://www.amazon.com.br/dp/B0ABC12345';
const accounts = { amazonTag: 'minha-20' };

test('Frases: tem mais de 50 opções e nenhuma cita preço nem link', () => {
  assert.ok(OPENERS.length > 50);
  for (const o of OPENERS) assert.doesNotMatch(o, /R\$|http|\.com/);
});

test('Frases: nenhuma se repete dentro de uma janela de 20 posts', () => {
  const picker = new OpenerPicker({ window: 20 });
  const picks = Array.from({ length: 300 }, () => picker.pick());
  for (let i = 20; i < picks.length; i++) {
    assert.ok(!picks.slice(i - 20, i).includes(picks[i]), `repetiu no post ${i + 1}`);
  }
});

test('Frases: com a janela cheia volta a sortear sem travar', () => {
  const picker = new OpenerPicker({ openers: ['a', 'b'], window: 1 });
  const picks = Array.from({ length: 6 }, () => picker.pick());
  assert.equal(picks.length, 6);
});

test('Modelo: o post vem com uma frase sorteada na frente, e sem frase se a opção estiver desligada', async () => {
  const withOpener = validateRule({ id: 'o1', sources: ['a'], targets: ['v'], textMode: 'template', template: '{titulo} {link}' });
  const r1 = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: [withOpener], seen: new SeenStore(), accounts });
  assert.ok(OPENERS.some((o) => r1.sends[0].text.startsWith(o + '\n')));

  const without = validateRule({ id: 'o2', sources: ['a'], targets: ['v'], textMode: 'template', template: '{titulo} {link}', randomOpener: false });
  const r2 = await handleIncoming({ sourceId: 'a', text: OFFER }, { rules: [without], seen: new SeenStore(), accounts });
  assert.equal(r2.sends[0].text, 'Filamento PLA 1kg https://www.amazon.com.br/dp/B0ABC12345?tag=minha-20');
});
