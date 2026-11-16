import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanMessage } from '../src/mirror/clean.js';
import { SeenStore, productKey } from '../src/mirror/dedupe.js';
import { processMessage, inSchedule } from '../src/mirror/engine.js';

const accounts = {
  amazonTag: 'viniachados0a-20',
  shopeeProvider: async () => ({ status: 'ok', url: 'https://s.shopee.com.br/meu' }),
};

const baseRule = {
  sources: ['origem'],
  targets: ['grupo-3d'],
  handleMode: 'replace',
  handle: '@viniachados',
};

const offer = [
  '🔥 Fone bluetooth R$ 99',
  'https://www.amazon.com.br/Fone/dp/B0ABC12345?tag=outro-20',
  'Siga @calangotech e veja mais em https://calangotech.com.br',
].join('\n');

test('limpeza troca o @ de terceiros e remove o site, sem tocar links de loja', () => {
  const out = cleanMessage(offer, { handleMode: 'replace', handle: '@viniachados', siteMode: 'remove' });
  assert.match(out, /Siga @viniachados e veja mais em$/m);
  assert.match(out, /amazon\.com\.br\/Fone\/dp\/B0ABC12345/);
  assert.doesNotMatch(out, /calangotech/);
});

test('limpeza não confunde e-mail com @', () => {
  assert.equal(cleanMessage('contato: loja@exemplo.com', { handleMode: 'remove' }), 'contato: loja@exemplo.com');
});

test('espelha a oferta com o link convertido', async () => {
  const result = await processMessage({ sourceId: 'origem', text: offer }, baseRule, { accounts });
  assert.equal(result.action, 'send');
  assert.equal(result.sends[0].target, 'grupo-3d');
  assert.match(result.sends[0].text, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=viniachados0a-20/);
  assert.doesNotMatch(result.sends[0].text, /outro-20/);
});

test('ignora grupo que não é origem', async () => {
  const result = await processMessage({ sourceId: 'outro', text: offer }, baseRule, { accounts });
  assert.equal(result.action, 'skip');
});

test('ignora mensagem sem link de loja quando o filtro está ligado', async () => {
  const result = await processMessage({ sourceId: 'origem', text: 'Bom dia, grupo!' }, baseRule, { accounts });
  assert.equal(result.action, 'skip');
  assert.match(result.reason, /sem link/);
});

test('nunca envia se um link de loja não puder ser convertido', async () => {
  const text = 'Oferta ML https://produto.mercadolivre.com.br/MLB-123-x';
  const result = await processMessage({ sourceId: 'origem', text }, baseRule, { accounts });
  assert.equal(result.action, 'skip');
  assert.match(result.reason, /link de afiliado de outra pessoa/);
});

test('não repete a mesma oferta no mesmo grupo dentro de 24h', async () => {
  let now = 0;
  const seen = new SeenStore({ now: () => now });
  const first = await processMessage({ sourceId: 'origem', text: offer }, baseRule, { accounts, seen });
  const again = await processMessage(
    { sourceId: 'origem', text: 'Outro texto, mesmo produto https://amzn.com.br/x https://www.amazon.com.br/dp/B0ABC12345' },
    baseRule,
    { accounts, seen },
  );
  assert.equal(first.action, 'send');
  assert.equal(again.action, 'skip');
  now += 25 * 60 * 60 * 1000;
  const later = await processMessage({ sourceId: 'origem', text: offer }, baseRule, { accounts, seen });
  assert.equal(later.action, 'send');
});

test('respeita o horário, inclusive janela que passa da meia-noite', () => {
  const at = (h) => new Date(`2026-11-16T${String(h).padStart(2, '0')}:30:00-03:00`);
  assert.equal(inSchedule({ start: '08:00', end: '22:00' }, at(10)), true);
  assert.equal(inSchedule({ start: '08:00', end: '22:00' }, at(23)), false);
  assert.equal(inSchedule({ start: '22:00', end: '02:00' }, at(23)), true);
  assert.equal(inSchedule({ start: '22:00', end: '02:00' }, at(1)), true);
  assert.equal(inSchedule({ start: '22:00', end: '02:00' }, at(12)), false);
  assert.equal(inSchedule(null, at(3)), true);
});

test('etiqueta por grupo: cada destino usa as próprias contas', async () => {
  const rule = { ...baseRule, targets: ['tec', '3d'] };
  const accountsFor = (target) => ({ amazonTag: `${target}-20` });
  const result = await processMessage({ sourceId: 'origem', text: offer }, rule, { accountsFor });
  assert.deepEqual(result.sends.map((s) => s.text.match(/tag=([\w-]+)/)[1]), ['tec-20', '3d-20']);
});

test('rodapé e troca de textos', async () => {
  const rule = { ...baseRule, footer: 'Entre no grupo: Vini Achados', replacements: [{ from: '🔥', to: '⚡' }] };
  const result = await processMessage({ sourceId: 'origem', text: offer }, rule, { accounts });
  assert.match(result.sends[0].text, /^⚡ Fone/);
  assert.match(result.sends[0].text, /Entre no grupo: Vini Achados$/);
});

test('código do produto é estável entre formatos de URL', () => {
  assert.equal(productKey('https://www.amazon.com.br/x/dp/b0abc12345?ref=1', 'amazon'), 'amazon:B0ABC12345');
  assert.equal(productKey('https://shopee.com.br/Produto-i.111.222?sp=1', 'shopee'), 'shopee:111.222');
  assert.equal(productKey('https://produto.mercadolivre.com.br/MLB-123456-x-_JM', 'mercadolivre'), 'ml:MLB123456');
});
