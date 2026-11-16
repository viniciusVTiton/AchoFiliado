import { convertMessage } from '../src/links/index.js';
import { extractLinks } from '../src/links/extract.js';

const STORE_LABEL = {
  amazon: 'Amazon',
  shopee: 'Shopee',
  mercadolivre: 'Mercado Livre',
};

const EXAMPLE = [
  'Oferta do dia!',
  'Fone bluetooth por R$ 99: https://www.amazon.com.br/Fone-Exemplo/dp/B0ABC12345/ref=sr_1_1',
  'Outra oferta da Shopee: https://shopee.com.br/Produto-i.123.456',
  'Mercado Livre: https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
].join('\n');

const $ = (id) => document.getElementById(id);

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

function setError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

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
    setError('Cole uma mensagem com links para converter.');
    resultEl.hidden = true;
    return;
  }
  setError('');

  const found = extractLinks(text).length;
  const { text: converted, changes, failed } = await convertMessage(text, {
    amazonTag: tagEl.value.trim(),
  });

  convertedEl.textContent = converted;
  countEl.textContent = found === 0
    ? 'Nenhum link encontrado'
    : `${found} ${found === 1 ? 'link encontrado' : 'links encontrados'} · ${changes.length} convertido${changes.length === 1 ? '' : 's'}`;
  renderChanges(changes);
  renderFailed(failed);
  resultEl.hidden = false;
});

$('load-example').addEventListener('click', () => {
  messageEl.value = EXAMPLE;
  setError('');
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(convertedEl.textContent);
    copyBtn.textContent = 'Copiado!';
    setTimeout(() => (copyBtn.textContent = 'Copiar mensagem'), 1500);
  } catch {
    copyBtn.textContent = 'Não consegui copiar';
  }
});
