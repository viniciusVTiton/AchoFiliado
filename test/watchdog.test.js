import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDownWatch } from '../src/whatsapp/watchdog.js';

test('Aviso: só dispara depois de ficar fora do ar pelo tempo combinado, e uma vez só', () => {
  let t = 0;
  const check = createDownWatch({ alertAfterMs: 1000, now: () => t });
  assert.equal(check('reconnecting'), false);
  t = 500;
  assert.equal(check('reconnecting'), false);
  t = 1000;
  assert.equal(check('error'), true);
  t = 5000;
  assert.equal(check('reconnecting'), false);
});

test('Aviso: reconexão rápida não dispara, e a conta recomeça depois de voltar', () => {
  let t = 0;
  const check = createDownWatch({ alertAfterMs: 1000, now: () => t });
  check('reconnecting');
  t = 400;
  assert.equal(check('connected'), false);
  t = 900;
  assert.equal(check('reconnecting'), false);
  t = 1900;
  assert.equal(check('reconnecting'), true);
});
