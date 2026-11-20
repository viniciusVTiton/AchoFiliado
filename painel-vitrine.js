/**
 * Vitrine no painel: produtos guardados no robô, com cupom vinculado a cada um.
 * Na lista você marca um ou mais produtos. Depois aparecem o modelo e a mensagem de cada um,
 * e os grupos para enviar. Tudo passa pelo robô local (roboCall), como no restante do painel.
 */
const STORE_LABEL = { amazon: 'Amazon', shopee: 'Shopee', mercadolivre: 'Mercado Livre' };

export function initVitrine({ roboCall }) {
  const $ = (id) => document.getElementById(id);
  let products = [];
  let groups = [];
  let templateList = []; // modelos prontos e salvos (Modelos)
  const selected = new Set();
  const texts = new Map(); // id -> texto da oferta (editado à mão ou montado no modelo)
  const tplChoice = new Map(); // id -> modelo escolhido ('' ou ausente = texto atual)
  let timer = null;
  let visible = false;
  let query = '';
  let storeFilter = '';
  let couponList = []; // cupons da seção Cupons, para vincular aos produtos

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(Boolean));
    return node;
  };
  const setMsg = (id, text, isError = false) => {
    const node = $(id);
    node.textContent = text;
    node.hidden = !text;
    node.style.color = isError ? '#f87171' : '';
  };

  function matches(p) {
    if (storeFilter && p.store !== storeFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [p.title, p.store, p.coupon].some((v) => String(v ?? '').toLowerCase().includes(q));
  }

  function visibleProducts() {
    return products.filter(matches);
  }

  async function removeProduct(p) {
    try {
      await roboCall(`/api/products?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      selected.delete(p.id);
      await loadProducts();
    } catch (err) {
      setMsg('vt-msg', err.message, true);
    }
  }

  // Monta o texto do produto no modelo escolhido; sem modelo, volta ao texto padrão.
  async function applyTemplate(id, templateId) {
    if (!templateId) {
      texts.delete(id);
      tplChoice.delete(id);
      return;
    }
    const { text } = await roboCall(`/api/products/preview?id=${encodeURIComponent(id)}&template=${encodeURIComponent(templateId)}`);
    texts.set(id, text);
    tplChoice.set(id, templateId);
  }

  function setSelected(id, on) {
    if (on) {
      selected.add(id);
      // Se já há um modelo escolhido para todos, o produto novo entra com ele.
      const bulk = $('vt-bulk-tpl').value;
      if (bulk) applyTemplate(id, bulk).then(renderSelected).catch((err) => setMsg('vt-send-msg', err.message, true));
    } else {
      selected.delete(id);
    }
    render();
  }

  function productRow(p) {
    const on = selected.has(p.id);
    const box = el('input', { type: 'checkbox', checked: on, onchange: () => setSelected(p.id, box.checked) });
    box.setAttribute('aria-label', `Selecionar ${p.title}`);
    const sent = p.sentTo?.length ? `${p.sentTo.length} grupo(s)` : 'ainda não';
    const row = el(
      'li',
      { className: `vt-row${on ? ' selected' : ''}` },
      box,
      p.image ? el('img', { src: p.image, alt: '', className: 'vt-img' }) : el('span', { className: 'vt-img vt-noimg' }),
      el('div', { className: 'vt-main' },
        el('div', { className: 'vt-title', textContent: p.title }),
        el('small', { textContent: STORE_LABEL[p.store] ?? p.store ?? '' }),
      ),
      el('div', { className: 'vt-cell-hide' },
        el('small', { textContent: 'Preço' }),
        el('div', { textContent: p.price ? `R$ ${p.price}` : '—' }),
      ),
      el('div', { className: 'vt-cell-hide' },
        el('small', { textContent: 'Cupom' }),
        el('div', { textContent: p.coupon ? `${p.coupon}${p.couponInfo ? ' · ' + p.couponInfo : ''}` : 'sem cupom' }),
      ),
      el('div', { className: 'vt-cell-hide' },
        el('small', { textContent: 'Enviado' }),
        el('div', { textContent: sent }),
      ),
      el('div', { className: 'btn-row vt-actions' },
        el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Remover', onclick: () => removeProduct(p) }),
      ),
    );
    // Clicar na linha marca ou desmarca o produto (botões e campos continuam funcionando).
    row.addEventListener('click', (event) => {
      if (event.target.closest('button, input, select, textarea, a')) return;
      box.checked = !box.checked;
      setSelected(p.id, box.checked);
    });
    return row;
  }

  // Cartão de um produto selecionado: modelo, mensagem, cupom e envio.
  function productCard(p) {
    const couponCode = el('input', { type: 'text', value: p.coupon || '', placeholder: 'Código do cupom (ex.: SHO1125)', autocomplete: 'off' });
    const couponInfo = el('input', { type: 'text', value: p.couponInfo || '', placeholder: 'Condição (ex.: R$25 OFF acima de R$199)', autocomplete: 'off' });
    // Cupom guardado na seção Cupons: ao escolher, o código e a condição vêm dele.
    const couponPick = el('select', {
      onchange: () => {
        const c = couponList.find((x) => x.id === couponPick.value);
        if (!c) return;
        couponCode.value = c.code;
        couponInfo.value = c.condition ?? '';
      },
    });
    couponPick.setAttribute('aria-label', `Cupom da seção Cupons para ${p.title}`);
    couponPick.append(
      el('option', { value: '', textContent: 'Sem vínculo (digitar abaixo)' }),
      ...couponList.map((c) => el('option', { value: c.id, textContent: `${c.code}${c.condition ? ' · ' + c.condition : ''}` })),
    );
    couponPick.value = p.couponId ?? '';
    // Se você mudar o código à mão, o vínculo com a seção Cupons sai.
    couponCode.addEventListener('input', () => {
      couponPick.value = '';
    });
    const saveCoupon = el('button', {
      type: 'button',
      className: 'btn btn-sm btn-ghost',
      textContent: 'Salvar cupom',
      onclick: async () => {
        try {
          await roboCall('/api/products', {
            method: 'POST',
            body: { ...p, coupon: couponCode.value, couponInfo: couponInfo.value, couponId: couponPick.value },
          });
          // Se há modelo escolhido, a mensagem é montada de novo com o cupom salvo.
          await applyTemplate(p.id, tplChoice.get(p.id) ?? '');
          setMsg('vt-send-msg', 'Cupom salvo.');
          await loadProducts();
        } catch (err) {
          setMsg('vt-send-msg', err.message, true);
        }
      },
    });

    const area = el('textarea', { rows: 4, value: texts.get(p.id) ?? p.text, oninput: () => texts.set(p.id, area.value) });
    area.setAttribute('aria-label', `Texto da oferta ${p.title}`);

    const tplSelect = el('select', {
      onchange: async () => {
        try {
          await applyTemplate(p.id, tplSelect.value);
          renderSelected();
        } catch (err) {
          setMsg('vt-send-msg', err.message, true);
        }
      },
    });
    tplSelect.setAttribute('aria-label', `Modelo para ${p.title}`);
    tplSelect.append(
      el('option', { value: '', textContent: 'Texto atual' }),
      ...templateList.map((t) => el('option', { value: t.id, textContent: t.name })),
    );
    tplSelect.value = tplChoice.get(p.id) ?? '';

    const sent = p.sentTo?.length ? ` · já enviado para ${p.sentTo.length} grupo(s)` : '';
    const item = el(
      'li',
      { className: 'vt-item selected' },
      el('div', { className: 'vt-head' },
        p.image ? el('img', { src: p.image, alt: '', className: 'vt-img' }) : el('span', { className: 'vt-img vt-noimg' }),
        el('div', { className: 'vt-info' },
          el('strong', { textContent: p.title }),
          el('div', { className: 'muted vt-meta', textContent: `${p.price ? 'R$ ' + p.price + ' · ' : ''}${STORE_LABEL[p.store] ?? p.store ?? ''}${sent}` }),
        ),
        el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Tirar da seleção', onclick: () => setSelected(p.id, false) }),
      ),
      el('label', { className: 'field' }, el('span', { textContent: 'Modelo do texto' }), tplSelect),
      el('label', { className: 'field' }, el('span', { textContent: 'Mensagem' }), area),
      el('div', { className: 'vt-coupon' },
        el('label', { className: 'field' }, el('span', { textContent: 'Cupom da seção Cupons' }), couponPick),
        el('label', { className: 'field' }, el('span', { textContent: 'Cupom deste produto' }), couponCode),
        el('label', { className: 'field' }, el('span', { textContent: 'Condição do cupom' }), couponInfo),
        el('div', { className: 'btn-row' }, saveCoupon),
      ),
    );
    item.dataset.vtId = p.id;
    return item;
  }

  function renderSummary() {
    $('vt-total').textContent = String(products.length);
    $('vt-coupons').textContent = String(products.filter((p) => p.coupon).length);
    $('vt-sent').textContent = String(products.filter((p) => p.sentTo?.length).length);
  }

  function renderSelectAll(list) {
    const box = $('vt-select-all');
    const n = list.filter((p) => selected.has(p.id)).length;
    box.checked = list.length > 0 && n === list.length;
    box.indeterminate = n > 0 && n < list.length;
  }

  function renderSelected() {
    const chosen = products.filter((p) => selected.has(p.id));
    $('vt-selected').replaceChildren(...chosen.map(productCard));
  }

  function updateSendForm() {
    const n = selected.size;
    $('vt-send').hidden = n === 0;
    $('vt-send-count').textContent = `${n} produto${n === 1 ? '' : 's'}`;
  }

  function render() {
    $('vt-empty').hidden = products.length > 0;
    renderSummary();
    const list = visibleProducts();
    const nodes = list.map(productRow);
    if (products.length && !list.length) nodes.push(el('li', { className: 'muted', textContent: 'Nenhum produto com esse filtro.' }));
    $('vt-list').replaceChildren(...nodes);
    renderSelectAll(list);
    renderSelected();
    updateSendForm();
  }

  // Lista de modelos no seletor "para todos"; mantém a escolha quando a lista não muda.
  function renderBulkTemplates() {
    const select = $('vt-bulk-tpl');
    const signature = templateList.map((t) => `${t.id}:${t.name}`).join('|');
    if (select.dataset.signature === signature) return;
    const keep = select.value;
    select.replaceChildren(
      el('option', { value: '', textContent: 'Texto atual' }),
      ...templateList.map((t) => el('option', { value: t.id, textContent: t.name })),
    );
    select.value = templateList.some((t) => t.id === keep) ? keep : '';
    select.dataset.signature = signature;
  }

  function renderTargets() {
    const mine = groups.filter((g) => !g.announce || g.admin); // só onde o robô pode postar
    const checked = new Set([...document.querySelectorAll('input[name="vt-target"]:checked')].map((i) => i.value));
    $('vt-targets').replaceChildren(
      ...mine.map((g) => el('label', {}, el('input', { type: 'checkbox', name: 'vt-target', value: g.id, checked: checked.has(g.id) }), ` ${g.name}`)),
    );
    if (!mine.length) $('vt-targets').append(el('p', { className: 'muted', textContent: 'Conecte o WhatsApp para escolher os grupos.' }));
  }

  async function loadProducts() {
    const fresh = (await roboCall('/api/products')).items ?? [];
    products = fresh;
    for (const id of [...selected]) if (!products.some((p) => p.id === id)) selected.delete(id);
    // Não redesenha enquanto você digita em algum campo da lista ou dos selecionados.
    const typing = [$('vt-list'), $('vt-selected')].some((node) => node.contains(document.activeElement));
    if (!typing) render();
  }

  async function refresh() {
    try {
      const [ml, wa, tpl] = await Promise.all([
        roboCall('/api/ml/status'),
        roboCall('/api/whatsapp/status'),
        roboCall('/api/templates'),
      ]);
      templateList = tpl.templates ?? [];
      // Se a seção Cupons não responder, a vitrine segue com a lista anterior.
      couponList = await roboCall('/api/coupons').then((r) => r.coupons ?? []).catch(() => couponList);
      renderBulkTemplates();
      $('vt-ext').textContent = ml.online
        ? 'Extensão do Chrome: conectada. Links do Mercado Livre saem na sua conta.'
        : 'Extensão do Chrome: desconectada. Abra o Chrome com a extensão AchoFiliado instalada.';
      groups = wa.groups ?? [];
      renderTargets();
      await loadProducts();
    } catch (err) {
      setMsg('vt-msg', err.message, true);
    }
  }

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(() => { if (visible) refresh(); }, 6000);
  }

  $('vt-search').addEventListener('input', (event) => {
    query = event.target.value.trim();
    render();
  });
  $('vt-store-filter').addEventListener('change', (event) => {
    storeFilter = event.target.value;
    render();
  });
  $('vt-select-all').addEventListener('change', (event) => {
    for (const p of visibleProducts()) {
      if (event.target.checked) selected.add(p.id);
      else selected.delete(p.id);
    }
    render();
  });
  $('vt-clear').addEventListener('click', () => {
    selected.clear();
    tplChoice.clear();
    texts.clear();
    $('vt-bulk-tpl').value = '';
    render();
  });
  // Um modelo para todos os selecionados de uma vez.
  $('vt-bulk-tpl').addEventListener('change', async (event) => {
    const templateId = event.target.value;
    try {
      await Promise.all([...selected].map((id) => applyTemplate(id, templateId)));
      renderSelected();
    } catch (err) {
      setMsg('vt-send-msg', err.message, true);
    }
  });

  $('vt-add').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      url: $('vt-url').value.trim(),
      title: $('vt-title').value.trim(),
      price: $('vt-price').value.trim(),
      oldPrice: $('vt-old').value.trim(),
      coupon: $('vt-coupon').value.trim(),
      couponInfo: $('vt-coupon-info').value.trim(),
    };
    $('vt-add-btn').disabled = true;
    setMsg('vt-msg', 'Buscando o produto e gerando o link de afiliado…');
    try {
      const { product } = await roboCall('/api/products/from-link', { method: 'POST', body });
      setMsg('vt-msg', `"${product.title}" adicionado à vitrine.`);
      event.target.reset();
      await loadProducts();
    } catch (err) {
      setMsg('vt-msg', err.message, true);
    } finally {
      $('vt-add-btn').disabled = false;
    }
  });

  $('vt-send').addEventListener('submit', async (event) => {
    event.preventDefault();
    const targets = [...document.querySelectorAll('input[name="vt-target"]:checked')].map((i) => i.value);
    if (!targets.length) return setMsg('vt-send-msg', 'Escolha pelo menos um grupo.', true);
    const items = [...selected].map((id) => ({ id, text: texts.get(id) }));
    try {
      const { queued, blocked = [] } = await roboCall('/api/products/send', { method: 'POST', body: { items, targets } });
      let text = `${queued} envio${queued === 1 ? '' : 's'} na fila do robô. Acompanhe em Últimas atividades.`;
      if (blocked.length) text += ` ${blocked.length} não enviado(s) pelo limite de envios.`;
      setMsg('vt-send-msg', text, blocked.length > 0);
      selected.clear();
      tplChoice.clear();
      texts.clear();
      $('vt-bulk-tpl').value = '';
      await loadProducts();
    } catch (err) {
      setMsg('vt-send-msg', err.message, true);
    }
  });

  return {
    onView(viewName) {
      visible = viewName === 'vitrine';
      if (visible) {
        refresh();
        startPolling();
      } else {
        clearInterval(timer);
      }
    },
    refresh,
  };
}
