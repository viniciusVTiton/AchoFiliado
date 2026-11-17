import { mlCreateLink, readMlProduct } from './ml.js';

const SERVER = 'http://localhost:3000';
const $ = (id) => document.getElementById(id);

function say(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = `${el.className.split(' ')[0]} ${cls ?? ''}`.trim();
}

async function run(tabId, func, args = [], world = 'ISOLATED') {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  return r?.result;
}

let status = null;
try {
  status = await fetch(`${SERVER}/api/status`).then((r) => r.json());
  say('robot', 'Robô: conectado', 'ok');
  say('ml', status.mlTag ? `Mercado Livre: etiqueta ${status.mlTag}` : 'Mercado Livre: etiqueta não configurada no robô', status.mlTag ? 'ok' : 'bad');
} catch {
  say('robot', 'Robô: desligado. Abra o AchoFiliado no computador.', 'bad');
  say('ml', '');
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const onMl = /^https:\/\/([a-z]+\.)?mercadolivre\.com\.br\//.test(tab?.url ?? '');
let product = null;
if (onMl) {
  try {
    product = await run(tab.id, readMlProduct);
  } catch {
    product = null;
  }
}

if (!product?.isProduct) {
  $('hint').hidden = false;
} else {
  $('product').hidden = false;
  $('img').src = product.image;
  $('title').textContent = product.title;
  $('price').innerHTML = '';
  if (product.price) {
    $('price').append(`R$ ${product.price}`);
    if (product.oldPrice) {
      const old = document.createElement('span');
      old.className = 'old';
      old.textContent = `R$ ${product.oldPrice}`;
      $('price').append(old);
    }
  }
  $('add').hidden = false;
  $('add').disabled = !status?.mlTag;
}

$('add').addEventListener('click', async () => {
  const btn = $('add');
  btn.disabled = true;
  btn.textContent = 'Gerando seu link...';
  say('msg', '');
  try {
    const link = await run(tab.id, mlCreateLink, [product.url, status.mlTag], 'MAIN');
    if (!link?.shortUrl) throw new Error(link?.error ?? 'Não consegui gerar o link');
    const res = await fetch(`${SERVER}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...product, store: 'mercadolivre', affiliateUrl: link.shortUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
    say('msg', `Adicionado à Vitrine com o seu link ${link.shortUrl}`, 'ok');
    btn.textContent = 'Adicionado ✓';
  } catch (e) {
    say('msg', e.message, 'bad');
    btn.textContent = 'Tentar de novo';
    btn.disabled = false;
  }
});
