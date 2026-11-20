/**
 * Vitrine no painel: produtos guardados no robô, com cupom vinculado a cada um.
 * Você cadastra colando o link do produto, escolhe os produtos e envia para os grupos.
 * Dá para ver em lista (compacta) ou em cards (com cupom e texto editáveis).
 * Tudo passa pelo robô local (roboCall), como no restante do painel.
 */
const VIEW_KEY = 'vt-view';
const STORE_LABEL = { amazon: 'Amazon', shopee: 'Shopee', mercadolivre: 'Mercado Livre' };

export function initVitrine({ roboCall }) {
  const $ = (id) => document.getElementById(id);
  let products = [];
  let groups = [];
  let templateList = []; // modelos prontos e salvos (Modelos)
  const selected = new Set();
  const texts = new Map(); // id -> texto editado à mão
  let timer = null;
  let visible = false;
  let view = readView();
  let query = '';
  let storeFilter = '';

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'lista';
    } catch {
      return 'lista';
    }
  }
  function saveView(next) {
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // sem armazenamento local, a escolha vale só nesta tela
    }
  }

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

  async function removeProduct(p) {
    try {
      await roboCall(`/api/products?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      selected.delete(p.id);
      await loadProducts();
    } catch (err) {
      setMsg('vt-msg', err.message, true);
    }
  }

  function productRow(p) {
    const box = el('input', {
      type: 'checkbox',
      checked: selected.has(p.id),
      onchange: () => {
        if (box.checked) selected.add(p.id);
        else selected.delete(p.id);
        row.classList.toggle('selected', box.checked);
        updateSendForm();
      },
    });
    box.setAttribute('aria-label', `Selecionar ${p.title}`);
    const sent = p.sentTo?.length ? `${p.sentTo.length} grupo(s)` : 'ainda não';
    const row = el(
      'li',
      { className: `vt-row${selected.has(p.id) ? ' selected' : ''}` },
      box,
      p.image ? el('img', { src: p.image, alt: '', className: 'vt-img' }) : el('span', { className: 'vt-img vt-noimg' }),
      el('div', { style: 'min-width:0' },
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
      el('div', { className: 'btn-row', style: 'margin:0' },
        el('button', {
          type: 'button',
          className: 'btn btn-sm btn-ghost',
          textContent: 'Editar',
          onclick: () => {
            setView('cards');
            document.querySelector(`[data-vt-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        }),
        el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Remover', onclick: () => removeProduct(p) }),
      ),
    );
    return row;
  }

  function productCard(p) {
    const box = el('input', {
      type: 'checkbox',
      checked: selected.has(p.id),
      onchange: () => {
        if (box.checked) selected.add(p.id);
        else selected.delete(p.id);
        item.classList.toggle('selected', box.checked);
        updateSendForm();
      },
    });
    box.setAttribute('aria-label', `Selecionar ${p.title}`);

    const couponCode = el('input', { type: 'text', value: p.coupon || '', placeholder: 'Código do cupom (ex.: SHO1125)', autocomplete: 'off' });
    const couponInfo = el('input', { type: 'text', value: p.couponInfo || '', placeholder: 'Condição (ex.: R$25 OFF acima de R$199)', autocomplete: 'off' });
    const saveCoupon = el('button', {
      type: 'button',
      className: 'btn btn-sm btn-ghost',
      textContent: 'Salvar cupom',
      onclick: async () => {
        try {
          await roboCall('/api/products', {
            method: 'POST',
            body: { ...p, coupon: couponCode.value, couponInfo: couponInfo.value },
          });
          texts.delete(p.id); // texto volta a sair com o cupom novo
          setMsg('vt-msg', 'Cupom salvo.');
          await loadProducts();
        } catch (err) {
          setMsg('vt-msg', err.message, true);
        }
      },
    });

    const area = el('textarea', { rows: 4, value: texts.get(p.id) ?? p.text, oninput: () => texts.set(p.id, area.value) });
    area.setAttribute('aria-label', `Texto da oferta ${p.title}`);

    // Escolher um modelo monta o texto do produto nele; "Texto atual" volta ao texto padrão.
    const tplSelect = el('select', {
      onchange: async () => {
        if (!tplSelect.value) {
          texts.delete(p.id);
          area.value = p.text;
          return;
        }
        try {
          const { text } = await roboCall(`/api/products/preview?id=${encodeURIComponent(p.id)}&template=${encodeURIComponent(tplSelect.value)}`);
          area.value = text;
          texts.set(p.id, text);
        } catch (err) {
          setMsg('vt-msg', err.message, true);
        }
      },
    });
    tplSelect.setAttribute('aria-label', `Modelo para ${p.title}`);
    tplSelect.append(
      el('option', { value: '', textContent: 'Texto atual' }),
      ...templateList.map((t) => el('option', { value: t.id, textContent: t.name })),
    );
    const sent = p.sentTo?.length ? ` · já enviado para ${p.sentTo.length} grupo(s)` : '';

    const item = el(
      'li',
      { className: `vt-item${selected.has(p.id) ? ' selected' : ''}` },
      el('div', { className: 'vt-head' },
        box,
        p.image ? el('img', { src: p.image, alt: '', className: 'vt-img' }) : el('span', { className: 'vt-img vt-noimg' }),
        el('div', { className: 'vt-info' },
          el('strong', { textContent: p.title }),
          el('div', { className: 'muted vt-meta', textContent: `${p.price ? 'R$ ' + p.price + ' · ' : ''}${p.store ?? ''}${sent}` }),
        ),
      ),
      el('div', { className: 'vt-coupon' },
        el('label', { className: 'field' }, el('span', { textContent: 'Cupom deste produto' }), couponCode),
        el('label', { className: 'field' }, el('span', { textContent: 'Condição do cupom' }), couponInfo),
        el('div', { className: 'btn-row' }, saveCoupon),
      ),
      el('label', { className: 'field' }, el('span', { textContent: 'Modelo do texto' }), tplSelect),
      el('label', { className: 'field' }, el('span', { textContent: 'Texto da oferta' }), area),
      el('div', { className: 'btn-row' },
        el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Remover', onclick: () => removeProduct(p) }),
      ),
    );
    item.dataset.vtId = p.id;
    return item;
  }

  function matches(p) {
    if (storeFilter && p.store !== storeFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [p.title, p.store, p.coupon].some((v) => String(v ?? '').toLowerCase().includes(q));
  }

  function renderSummary() {
    $('vt-total').textContent = String(products.length);
    $('vt-coupons').textContent = String(products.filter((p) => p.coupon).length);
    $('vt-sent').textContent = String(products.filter((p) => p.sentTo?.length).length);
  }

  function renderToggle() {
    $('vt-view-lista').classList.toggle('on', view === 'lista');
    $('vt-view-cards').classList.toggle('on', view === 'cards');
  }

  function render() {
    $('vt-empty').hidden = products.length > 0;
    renderSummary();
    renderToggle();
    const list = products.filter(matches);
    const nodes = list.map((p) => (view === 'cards' ? productCard(p) : productRow(p)));
    if (products.length && !list.length) nodes.push(el('li', { className: 'muted', textContent: 'Nenhum produto com esse filtro.' }));
    $('vt-list').replaceChildren(...nodes);
    updateSendForm();
  }

  function setView(next) {
    view = next;
    saveView(next);
    render();
  }

  function updateSendForm() {
    const n = selected.size;
    $('vt-send').hidden = n === 0;
    $('vt-send-count').textContent = `${n} produto${n === 1 ? '' : 's'}`;
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
    // Não redesenha enquanto você digita em algum campo da lista.
    if (!$('vt-list').contains(document.activeElement)) render();
  }

  async function refresh() {
    try {
      const [ml, wa, tpl] = await Promise.all([
        roboCall('/api/ml/status'),
        roboCall('/api/whatsapp/status'),
        roboCall('/api/templates'),
      ]);
      templateList = tpl.templates ?? [];
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
  $('vt-view-lista').addEventListener('click', () => setView('lista'));
  $('vt-view-cards').addEventListener('click', () => setView('cards'));

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
      texts.clear();
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
