/**
 * Vitrine: lista os produtos adicionados pela extensão, deixa editar o texto
 * e manda os escolhidos para os grupos pelo robô do WhatsApp.
 */
const $ = (id) => document.getElementById(id);

let products = [];
const selected = new Set();
const texts = new Map(); // id -> texto editado
let groupsKey = '';

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function renderProducts() {
  $('vitrine-empty').hidden = products.length > 0;
  $('products').replaceChildren(
    ...products.map((p) => {
      const box = el('input', {
        type: 'checkbox',
        checked: selected.has(p.id),
        onchange: () => {
          box.checked ? selected.add(p.id) : selected.delete(p.id);
          item.classList.toggle('selected', box.checked);
          updateSendForm();
        },
      });
      box.setAttribute('aria-label', `Selecionar ${p.title}`);
      const area = el('textarea', { value: texts.get(p.id) ?? p.text, oninput: () => texts.set(p.id, area.value) });
      area.setAttribute('aria-label', `Texto da oferta ${p.title}`);
      const sent = p.sentTo?.length ? ` · já enviado para ${p.sentTo.length} grupo(s)` : '';
      const item = el(
        'li',
        { className: `product${selected.has(p.id) ? ' selected' : ''}` },
        box,
        p.image ? el('img', { src: p.image, alt: '' }) : el('span'),
        el(
          'div',
          {},
          el('strong', { textContent: p.title }),
          el('div', { className: 'meta', textContent: `${p.price ? 'R$ ' + p.price + ' · ' : ''}${p.affiliateUrl}${sent}` }),
          area,
          el(
            'div',
            { className: 'row' },
            el('button', {
              type: 'button',
              className: 'btn btn-small btn-ghost',
              textContent: 'Remover',
              onclick: async () => {
                await call('DELETE', `/api/products?id=${encodeURIComponent(p.id)}`);
                selected.delete(p.id);
                await loadProducts();
              },
            }),
          ),
        ),
      );
      return item;
    }),
  );
  updateSendForm();
}

function updateSendForm() {
  const n = selected.size;
  $('send-form').hidden = n === 0;
  $('send-count').textContent = `${n} produto${n === 1 ? '' : 's'}`;
}

function renderTargets(groups) {
  const mine = groups.filter((g) => !g.announce || g.admin); // só onde o robô pode postar
  const key = mine.map((g) => g.id).join('|');
  if (key === groupsKey) return;
  groupsKey = key;
  const checked = new Set([...document.querySelectorAll('input[name="send-target"]:checked')].map((i) => i.value));
  $('send-targets').replaceChildren(
    ...mine.map((g) => el('label', {}, el('input', { type: 'checkbox', name: 'send-target', value: g.id, checked: checked.has(g.id) }), ` ${g.name}`)),
  );
  if (!mine.length) $('send-targets').append(el('p', { className: 'muted', textContent: 'Conecte o WhatsApp para escolher os grupos.' }));
}

async function loadProducts() {
  const fresh = (await call('GET', '/api/products')).items;
  const changed = fresh.map((p) => p.id + (p.sentTo?.length ?? 0)).join() !== products.map((p) => p.id + (p.sentTo?.length ?? 0)).join();
  products = fresh;
  for (const id of [...selected]) if (!products.some((p) => p.id === id)) selected.delete(id);
  // Não redesenha enquanto você digita no texto de um produto.
  if (changed && !document.activeElement?.closest?.('#products')) renderProducts();
}

$('send-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const targets = [...document.querySelectorAll('input[name="send-target"]:checked')].map((i) => i.value);
  const err = $('send-error');
  const ok = $('send-ok');
  ok.hidden = true;
  if (!targets.length) {
    err.textContent = 'Escolha pelo menos um grupo.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const items = [...selected].map((id) => ({ id, text: texts.get(id) }));
  try {
    const { queued, blocked = [] } = await call('POST', '/api/products/send', { items, targets });
    ok.textContent = `${queued} envio${queued === 1 ? '' : 's'} na fila do robô. Acompanhe em Últimas atividades.`;
    ok.hidden = false;
    if (blocked.length) {
      err.textContent = `${blocked.length} não enviado${blocked.length === 1 ? '' : 's'} por limite: ` +
        blocked.map((b) => `${b.group} (${b.reason.toLowerCase()})`).filter((v, i, a) => a.indexOf(v) === i).join('; ');
      err.hidden = false;
    }
    selected.clear();
    await loadProducts();
    renderProducts();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

async function poll() {
  try {
    const [ml, wa] = await Promise.all([call('GET', '/api/ml/status'), call('GET', '/api/whatsapp/status')]);
    $('ext-status').textContent = ml.online
      ? 'Extensão do Chrome: conectada. Links do Mercado Livre estão sendo gerados na sua conta.'
      : 'Extensão do Chrome: desconectada. Abra o Chrome com a extensão AchoFiliado instalada.';
    if (ml.lastError) $('ext-status').textContent += ` Último erro: ${ml.lastError}`;
    renderTargets(wa.groups ?? []);
    await loadProducts();
  } catch {
    $('ext-status').textContent = 'A Vitrine só funciona com o servidor rodando no seu computador.';
    return;
  }
  setTimeout(poll, 4000);
}

poll();
