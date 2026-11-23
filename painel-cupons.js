/**
 * Seção Cupons: você cola mensagens com cupom e o robô acha e guarda o código e a condição.
 * Depois escolhe um cupom, os grupos e envia, com a foto da loja quando houver.
 * Tudo passa pelo robô local (roboCall), como no restante do painel.
 */
const STORES = [
  ['mercadolivre', 'Mercado Livre'],
  ['amazon', 'Amazon'],
  ['shopee', 'Shopee'],
];
const LABEL = Object.fromEntries(STORES);

/** "vale até 23:59 de 23/11" (cada cupom vale até o fim do dia). */
function validity(c) {
  if (!c.expiresAt) return '';
  const d = new Date(c.expiresAt);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `vale até ${hora} de ${dia}`;
}

export function initCupons({ roboCall }) {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter((k) => k !== null && k !== undefined));
    return node;
  };
  const setMsg = (id, text, isError = false) => {
    const box = $(id);
    box.textContent = text;
    box.hidden = !text;
    box.style.color = isError ? '#f87171' : '';
    box.style.whiteSpace = 'pre-line';
  };

  let coupons = [];
  let selectedId = null;

  function renderList() {
    $('cp-empty').hidden = coupons.length > 0;
    $('cp-list').replaceChildren(
      ...coupons.map((c) => {
        const sent = (c.sentTo ?? []).length;
        return el('li', { className: `cp-item${c.id === selectedId ? ' selected' : ''}` },
          el('div', { className: 'cp-code', textContent: c.code }),
          el('small', {
            className: 'muted',
            textContent: [LABEL[c.store] ?? 'Qualquer loja', c.info ?? c.condition, validity(c), sent ? `enviado ${sent}×` : ''].filter(Boolean).join(' · '),
          }),
          c.official
            ? el('small', { className: 'muted', textContent: `✓ conferido no Mercado Livre${c.official.items?.length ? ' · ex.: ' + c.official.items.slice(0, 2).map((i) => i.title.slice(0, 40)).join('; ') : ''}` })
            : null,
          el('div', { className: 'btn-row' },
            c.official?.productsUrl
              ? el('a', { className: 'btn btn-sm btn-ghost', href: c.official.productsUrl, target: '_blank', rel: 'noopener', textContent: 'Produtos válidos' })
              : null,
            el('button', { type: 'button', className: 'btn btn-sm btn-primary', textContent: 'Enviar', onclick: () => openSend(c) }),
            el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Editar', onclick: () => openEdit(c) }),
            el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Remover', onclick: () => remove(c) }),
          ),
        );
      }),
    );
  }

  async function load() {
    const r = await roboCall('/api/coupons');
    coupons = r.coupons ?? [];
    renderList();
  }

  async function loadImages() {
    const boxes = await Promise.all(
      STORES.map(async ([store, label]) => {
        const { dataUrl } = await roboCall(`/api/coupons/image?store=${store}`);
        const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
        input.setAttribute('aria-label', `Foto para ${label}`);
        input.addEventListener('change', () => uploadImage(store, input.files?.[0]));
        return el('div', { className: 'cp-img-box' },
          el('strong', { textContent: label }),
          dataUrl
            ? el('img', { src: dataUrl, alt: `Foto do cupom ${label}` })
            : el('small', { className: 'muted', textContent: 'Sem foto: o cupom sai só com texto' }),
          input,
        );
      }),
    );
    $('cp-images').replaceChildren(...boxes);
  }

  function uploadImage(store, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await roboCall('/api/coupons/image', { method: 'POST', body: { store, dataUrl: reader.result } });
        setMsg('cp-msg', `Foto da ${LABEL[store]} salva.`);
        await loadImages();
      } catch (err) {
        setMsg('cp-msg', err.message, true);
      }
    };
    reader.readAsDataURL(file);
  }

  async function loadTargets() {
    const wa = await roboCall('/api/whatsapp/status');
    const mine = (wa.groups ?? []).filter((g) => !g.announce || g.admin); // onde o robô pode postar
    const checked = new Set([...document.querySelectorAll('input[name="cp-target"]:checked')].map((i) => i.value));
    $('cp-targets').replaceChildren(
      ...mine.map((g) => el('label', {}, el('input', { type: 'checkbox', name: 'cp-target', value: g.id, checked: checked.has(g.id) }), ` ${g.name}`)),
    );
    if (!mine.length) $('cp-targets').append(el('p', { className: 'muted', textContent: 'Conecte o WhatsApp para escolher os grupos.' }));
  }

  async function openSend(c) {
    selectedId = c.id;
    renderList();
    $('cp-send-form').hidden = false;
    $('cp-send-title').textContent = `Enviar o cupom ${c.code}`;
    setMsg('cp-send-msg', '');
    try {
      const [{ text }] = await Promise.all([roboCall(`/api/coupons/message?id=${encodeURIComponent(c.id)}`), loadTargets()]);
      $('cp-send-text').value = text;
    } catch (err) {
      setMsg('cp-send-msg', err.message, true);
    }
    $('cp-send-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Editar: código, loja, condição e os produtos da Vitrine que usam o cupom.
  let editingId = null;
  async function openEdit(c) {
    editingId = c.id;
    $('cp-edit-form').hidden = false;
    $('cp-edit-title').textContent = `Editar o cupom ${c.code}`;
    $('cp-edit-code').value = c.code;
    $('cp-edit-store').value = c.store || '';
    $('cp-edit-cond').value = c.condition || '';
    $('cp-edit-disc').value = c.discount ?? '';
    setMsg('cp-edit-msg', '');
    try {
      const { items = [] } = await roboCall('/api/products');
      $('cp-edit-products').replaceChildren(
        ...items.map((p) =>
          el('label', {},
            el('input', { type: 'checkbox', name: 'cp-prod', value: p.id, checked: p.couponId === c.id }),
            ` ${p.title}${p.couponId && p.couponId !== c.id ? ' (já usa outro cupom)' : ''}`,
          ),
        ),
      );
      if (!items.length) $('cp-edit-products').append(el('p', { className: 'muted', textContent: 'Nenhum produto na Vitrine.' }));
    } catch (err) {
      setMsg('cp-edit-msg', err.message, true);
    }
    $('cp-edit-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('cp-edit-cancel').addEventListener('click', () => {
    editingId = null;
    $('cp-edit-form').hidden = true;
  });

  $('cp-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('cp-edit-btn').disabled = true;
    try {
      await roboCall('/api/coupons/update', {
        method: 'POST',
        body: { id: editingId, code: $('cp-edit-code').value, store: $('cp-edit-store').value, condition: $('cp-edit-cond').value, discount: $('cp-edit-disc').value },
      });
      const productIds = [...document.querySelectorAll('input[name="cp-prod"]:checked')].map((i) => i.value);
      const { linked } = await roboCall('/api/coupons/products', { method: 'POST', body: { id: editingId, productIds } });
      setMsg('cp-edit-msg', `Cupom salvo. ${linked} produto${linked === 1 ? '' : 's'} com este cupom.`);
      await load();
    } catch (err) {
      setMsg('cp-edit-msg', err.message, true);
    } finally {
      $('cp-edit-btn').disabled = false;
    }
  });

  async function remove(c) {
    if (!confirm(`Remover o cupom ${c.code}?`)) return;
    try {
      await roboCall(`/api/coupons?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      if (selectedId === c.id) {
        selectedId = null;
        $('cp-send-form').hidden = true;
      }
      setMsg('cp-msg', `Cupom ${c.code} removido.`);
      await load();
    } catch (err) {
      setMsg('cp-msg', err.message, true);
    }
  }

  // Atualiza com o Mercado Livre: a extensão ativa os códigos novos na sua conta e lê os dados oficiais.
  $('cp-ml-sync').addEventListener('click', async () => {
    $('cp-ml-sync').disabled = true;
    setMsg('cp-ml-msg', 'Consultando o Mercado Livre pela extensão…');
    try {
      const r = await roboCall('/api/coupons/ml-sync', { method: 'POST', body: {} });
      const parts = [`${r.updated} cupom(s) atualizado(s) e ${r.created} novo(s) com os dados do Mercado Livre.`];
      if (r.activated?.length) parts.push(`Ativados na sua conta: ${r.activated.join(', ')}.`);
      if (r.notFound?.length) parts.push(`Não estão na sua conta do Mercado Livre: ${r.notFound.join(', ')}.`);
      setMsg('cp-ml-msg', parts.join('\n'));
      await load();
    } catch (err) {
      setMsg('cp-ml-msg', err.message, true);
    } finally {
      $('cp-ml-sync').disabled = false;
    }
  });

  $('cp-identify-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('cp-text').value.trim();
    if (!text) return setMsg('cp-msg', 'Cole a mensagem com o cupom.', true);
    try {
      const r = await roboCall('/api/coupons/identify', { method: 'POST', body: { text } });
      if (!r.found) return setMsg('cp-msg', r.reason || 'Não achei cupom nessa mensagem.', true);
      setMsg('cp-msg', `${r.found} cupom(s) achado(s): ${r.created} novo(s), ${r.updated} atualizado(s).`);
      $('cp-text').value = '';
      await load();
    } catch (err) {
      setMsg('cp-msg', err.message, true);
    }
  });

  $('cp-new-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await roboCall('/api/coupons', {
        method: 'POST',
        body: { code: $('cp-new-code').value, store: $('cp-new-store').value, condition: $('cp-new-cond').value, discount: $('cp-new-disc').value },
      });
      event.target.reset();
      setMsg('cp-msg', 'Cupom guardado.');
      await load();
    } catch (err) {
      setMsg('cp-msg', err.message, true);
    }
  });

  $('cp-send-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const targets = [...document.querySelectorAll('input[name="cp-target"]:checked')].map((i) => i.value);
    if (!targets.length) return setMsg('cp-send-msg', 'Escolha pelo menos um grupo.', true);
    const text = $('cp-send-text').value.trim();
    if (!text) return setMsg('cp-send-msg', 'A mensagem está vazia.', true);
    $('cp-send-btn').disabled = true;
    try {
      const r = await roboCall('/api/coupons/send', { method: 'POST', body: { id: selectedId, targets, text } });
      const parts = [`${r.queued} envio${r.queued === 1 ? '' : 's'} na fila do robô (${r.photo}).`];
      if (r.blocked?.length) parts.push(`Não enviado pelo limite: ${r.blocked.map((b) => b.group).join(', ')}.`);
      setMsg('cp-send-msg', parts.join('\n'), (r.blocked ?? []).length > 0);
      await load();
    } catch (err) {
      setMsg('cp-send-msg', err.message, true);
    } finally {
      $('cp-send-btn').disabled = false;
    }
  });

  return {
    onView(view) {
      if (view !== 'cupons') return;
      load().catch((err) => setMsg('cp-msg', err.message, true));
      loadImages().catch((err) => setMsg('cp-msg', err.message, true));
    },
    /** Lista de cupons para o seletor dos produtos (vitrine). */
    async list() {
      const r = await roboCall('/api/coupons');
      return r.coupons ?? [];
    },
  };
}
