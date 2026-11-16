import { convertMessage } from '../src/links/index.js';
import { extractLinks } from '../src/links/extract.js';
import { processMessage } from '../src/mirror/engine.js';

const STORE_LABEL = {
  amazon: 'Amazon',
  shopee: 'Shopee',
  mercadolivre: 'Mercado Livre',
};

const STORE_PENDING = {
  amazon: 'Tag não configurada',
  shopee: 'Conta não conectada',
  mercadolivre: 'Sessão não conectada',
};

const EXAMPLE = [
  'Oferta do dia!',
  'Fone bluetooth por R$ 99: https://www.amazon.com.br/Fone-Exemplo/dp/B0ABC12345/ref=sr_1_1',
  'Outra oferta da Shopee: https://shopee.com.br/Produto-i.123.456',
  'Mercado Livre: https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
].join('\n');

const MIRROR_EXAMPLE = [
  '🔥 PRECINHO! Filamento PLA 1kg',
  'De R$ 129 por R$ 79',
  'https://www.amazon.com.br/Filamento-PLA/dp/B0ABC12345?tag=outroafiliado-20',
  '',
  'Siga @mundo3doficial e veja mais em https://mundo3d.com.br',
].join('\n');

const $ = (id) => document.getElementById(id);

/* ---------- Backend: usa a API quando o servidor está rodando ---------- */

const backend = { available: false, stores: { amazon: true, shopee: false, mercadolivre: false } };

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data;
}

function renderStoreStatus() {
  for (const el of document.querySelectorAll('[data-store-status]')) {
    const store = el.dataset.storeStatus;
    const ok = backend.stores[store];
    el.textContent = ok ? 'Conectada' : STORE_PENDING[store];
    el.className = `status ${ok ? 'status-ok' : 'status-pending'}`;
  }
  $('mode-note').textContent = backend.available
    ? 'Servidor conectado: as conversões usam as contas configuradas no servidor.'
    : 'Modo demonstração: só a Amazon converte. Rode o servidor com as credenciais para converter a Shopee.';
  $('footer-mode').textContent = backend.available ? 'Servidor conectado' : 'Modo demonstração';
}

async function detectBackend() {
  try {
    const res = await fetch('/api/status', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.backend) throw new Error();
    backend.available = true;
    backend.stores = data.stores;
    if (data.amazonTag && !$('amazon-tag').value) $('amazon-tag').value = data.amazonTag;
  } catch {
    backend.available = false;
  }
  renderStoreStatus();
}

/* ---------- Helpers de tela ---------- */

function li(parts) {
  const item = document.createElement('li');
  for (const part of parts) {
    if (part.tag) {
      const el = document.createElement(part.tag);
      el.className = part.className;
      el.textContent = part.text;
      item.append(el);
    } else {
      item.append(part.text);
    }
  }
  return item;
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

/* ---------- Conversor ---------- */

const form = $('convert-form');
const messageEl = $('message');
const tagEl = $('amazon-tag');
const errorEl = $('form-error');
const resultEl = $('result');
const convertedEl = $('converted');
const countEl = $('result-count');
const changesBlock = $('changes-block');
const changesEl = $('changes');
const failedBlock = $('failed-block');
const failedEl = $('failed');
const copyBtn = $('copy');

function renderChanges(changes) {
  changesEl.replaceChildren(
    ...changes.map((c) =>
      li([
        { tag: 'span', className: 'from', text: c.from },
        { text: ' → ' },
        { tag: 'span', className: 'to', text: c.to },
      ]),
    ),
  );
  changesBlock.hidden = changes.length === 0;
}

function renderFailed(failed) {
  failedEl.replaceChildren(
    ...failed.map((f) =>
      li([
        { tag: 'span', className: 'store', text: STORE_LABEL[f.store] ?? f.store },
        { text: ' ' + f.url },
        { tag: 'span', className: 'reason', text: f.reason ?? 'Não foi possível converter' },
      ]),
    ),
  );
  failedBlock.hidden = failed.length === 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageEl.value.trim();
  if (!text) {
    showError(errorEl, 'Cole uma mensagem com links para converter.');
    resultEl.hidden = true;
    return;
  }
  showError(errorEl, '');

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Convertendo...';
  try {
    const amazonTag = tagEl.value.trim();
    const result = backend.available
      ? await api('/api/convert', { text, amazonTag })
      : await convertMessage(text, { amazonTag });

    const found = extractLinks(text).length;
    convertedEl.textContent = result.text;
    countEl.textContent = found === 0
      ? 'Nenhum link encontrado'
      : `${found} ${found === 1 ? 'link encontrado' : 'links encontrados'} · ${result.changes.length} convertido${result.changes.length === 1 ? '' : 's'}`;
    renderChanges(result.changes);
    renderFailed(result.failed);
    resultEl.hidden = false;
  } catch (error) {
    showError(errorEl, `Não consegui converter: ${error.message}`);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Converter links';
  }
});

$('load-example').addEventListener('click', () => {
  messageEl.value = EXAMPLE;
  showError(errorEl, '');
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(convertedEl.textContent);
    copyBtn.textContent = 'Copiado!';
  } catch {
    copyBtn.textContent = 'Não consegui copiar';
  }
  setTimeout(() => (copyBtn.textContent = 'Copiar mensagem'), 1500);
});

/* ---------- Espelhamento ---------- */

const mirrorForm = $('mirror-form');

function readRule() {
  return {
    stores: [...mirrorForm.querySelectorAll('input[name="store"]:checked')].map((i) => i.value),
    onlyStoreOffers: $('mirror-only-store').checked,
    handle: $('mirror-handle').value.trim(),
    handleMode: $('mirror-handle-mode').value,
    site: $('mirror-site').value.trim(),
    siteMode: $('mirror-site-mode').value,
    footer: $('mirror-footer').value.trim(),
  };
}

mirrorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('mirror-message').value.trim();
  const errorBox = $('mirror-error');
  if (!text) {
    showError(errorBox, 'Cole a mensagem que chegou no grupo de origem.');
    $('mirror-result').hidden = true;
    return;
  }
  showError(errorBox, '');

  const rule = readRule();
  try {
    const result = backend.available
      ? await api('/api/mirror/preview', { text, rule })
      : await processMessage(
          { sourceId: 'preview', text },
          { ...rule, sources: ['preview'], targets: ['preview'] },
          { accounts: { amazonTag: tagEl.value.trim() } },
        );

    const sent = result.action === 'send';
    const verdict = $('mirror-verdict');
    verdict.textContent = sent ? 'Seria enviada' : 'Não seria enviada';
    verdict.className = `verdict ${sent ? 'verdict-send' : 'verdict-skip'}`;
    $('mirror-out-block').hidden = !sent;
    $('mirror-out').textContent = sent ? result.sends[0].text : '';
    $('mirror-reason-block').hidden = sent;
    $('mirror-reason').textContent = sent ? '' : result.reason;
    $('mirror-result').hidden = false;
  } catch (error) {
    showError(errorBox, `Não consegui simular: ${error.message}`);
  }
});

$('mirror-example').addEventListener('click', () => {
  $('mirror-message').value = MIRROR_EXAMPLE;
  showError($('mirror-error'), '');
});

detectBackend();
