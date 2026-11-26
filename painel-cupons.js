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
            c.official?.productsUrl
              ? el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Montar lista', onclick: () => openList(c) })
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

  async function openSend(c, presetText = '') {
    selectedId = c.id;
    renderList();
    $('cp-send-form').hidden = false;
    $('cp-send-title').textContent = `Enviar o cupom ${c.code}`;
    setMsg('cp-send-msg', '');
    try {
      const [{ text }] = await Promise.all([
        presetText ? Promise.resolve({ text: presetText }) : roboCall(`/api/coupons/message?id=${encodeURIComponent(c.id)}`),
        loadTargets(),
      ]);
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

  // Montar lista: procura produtos válidos do cupom pelas palavras e leva a mensagem para o envio.
  let listingId = null;
  function openList(c) {
    listingId = c.id;
    $('cp-list-form').hidden = false;
    $('cp-list-title').textContent = `Montar lista do cupom ${c.code}`;
    setMsg('cp-list-msg', '');
    $('cp-list-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('cp-list-words').focus();
  }

  $('cp-list-cancel').addEventListener('click', () => {
    listingId = null;
    $('cp-list-form').hidden = true;
  });

  $('cp-list-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const keywords = $('cp-list-words').value.trim();
    if (!keywords) return setMsg('cp-list-msg', 'Escreva o que procurar, ex.: notebook, playstation 5.', true);
    const mode = $('cp-list-mode').value;
    if (mode === 'mlList' && !confirm('A lista será criada e publicada no seu perfil de afiliado do Mercado Livre (fica pública). Continuar?')) return;
    $('cp-list-btn').disabled = true;
    setMsg('cp-list-msg', mode === 'mlList'
      ? 'Procurando nos produtos do cupom e criando a lista no Mercado Livre… (pode levar 1 a 2 minutos)'
      : 'Procurando nos produtos do cupom e gerando os seus links… (pode levar 1 a 2 minutos)');
    try {
      const r = await roboCall('/api/coupons/build-list', { method: 'POST', body: { id: listingId, keywords, perKeyword: $('cp-list-per').value, mode } });
      const resumo = r.found.map((f) => `${f.keyword}: ${f.count}`).join(' · ');
      if (!r.count) return setMsg('cp-list-msg', `Nenhum produto válido achado (${resumo}). Tente outras palavras.`, true);
      setMsg('cp-list-msg', mode === 'mlList'
        ? `Lista criada no Mercado Livre com ${r.count} produto(s) (${resumo}). Confira a mensagem abaixo e escolha os grupos.`
        : `${r.count} produto(s) na lista (${resumo}). Confira a mensagem abaixo e escolha os grupos.`);
      const coupon = coupons.find((x) => x.id === listingId);
      await openSend(coupon, r.text);
      if (mode === 'mlList' && mlLists.length) loadMlLists();
    } catch (err) {
      setMsg('cp-list-msg', err.message, true);
    } finally {
      $('cp-list-btn').disabled = false;
    }
  });

  // ---------- Minhas listas no Mercado Livre ----------
  // Cada ação abre uma aba rápida do Mercado Livre pela extensão, então leva alguns segundos.
  let mlLists = [];
  let current = null; // lista aberta
  let currentItems = [];

  const busy = (ids, on) => ids.forEach((id) => { $(id).disabled = on; });

  async function loadMlLists() {
    busy(['ml-lists-load'], true);
    setMsg('ml-lists-msg', 'Lendo as suas listas no Mercado Livre…');
    try {
      const r = await roboCall('/api/ml-lists');
      mlLists = r.lists ?? [];
      setMsg('ml-lists-msg', mlLists.length ? '' : 'Nenhuma lista de afiliado ainda. Use "Montar lista" num cupom para criar.');
      renderMlLists();
    } catch (err) {
      setMsg('ml-lists-msg', err.message, true);
    } finally {
      busy(['ml-lists-load'], false);
    }
  }

  function renderMlLists() {
    $('ml-lists').replaceChildren(
      ...mlLists.map((l) => el('li', { className: `cp-item clickable${current?.id === l.id ? ' selected' : ''}`, onclick: () => openMlList(l) },
        el('div', { className: 'vt-send-head' },
          el('strong', { textContent: l.name }),
          el('div', { className: 'ml-thumbs' }, ...(l.images ?? []).map((src) => el('img', { src, alt: '', loading: 'lazy' }))),
        ),
        el('small', { className: 'muted', textContent: `${l.total} produto${l.total === 1 ? '' : 's'} · ${l.privacy === 'PUBLIC' ? 'pública' : 'privada'}` }),
      )),
    );
  }

  function guessCoupon(name) {
    const lower = String(name ?? '').toLowerCase();
    return coupons.find((c) => c.official?.productsUrl && lower.includes(String(c.code).toLowerCase()));
  }

  function fillCouponSelect(listName) {
    const usable = coupons.filter((c) => c.official?.productsUrl);
    const guess = guessCoupon(listName);
    $('ml-ld-coupon').replaceChildren(
      ...(usable.length ? usable : []).map((c) => el('option', { value: c.id, textContent: c.code, selected: c.id === guess?.id })),
    );
    if (!usable.length) $('ml-ld-coupon').append(el('option', { value: '', textContent: 'Nenhum cupom conferido no Mercado Livre' }));
  }

  async function openMlList(l) {
    current = l;
    renderMlLists();
    $('ml-list-detail').hidden = false;
    $('ml-ld-title').textContent = l.name;
    $('ml-ld-name').value = l.name;
    $('ml-ld-open').href = `https://myaccount.mercadolivre.com.br/bookmarks/wishlist/hub/detail/${encodeURIComponent(l.id)}`;
    $('ml-ld-delete').hidden = !!l.main;
    $('ml-ld-rename-form').hidden = !!l.main;
    fillCouponSelect(l.name);
    setMsg('ml-ld-msg', '');
    $('ml-list-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await loadItems();
  }

  async function loadItems() {
    $('ml-ld-info').textContent = 'Carregando os produtos…';
    $('ml-ld-items').replaceChildren();
    $('ml-ld-all').checked = false;
    try {
      const r = await roboCall(`/api/ml-lists/items?id=${encodeURIComponent(current.id)}`);
      currentItems = r.items ?? [];
      current.total = r.total ?? currentItems.length;
      $('ml-ld-info').textContent = `${current.total} produto${current.total === 1 ? '' : 's'} · ${current.privacy === 'PUBLIC' ? 'pública no seu perfil' : 'privada'}`;
      $('ml-ld-items').replaceChildren(
        ...currentItems.map((it) => el('li', { className: 'cp-item ml-row' },
          el('input', { type: 'checkbox', name: 'ml-ld-item', value: it.bookmarkId }),
          it.image ? el('img', { src: it.image, alt: '', loading: 'lazy' }) : el('span'),
          el('div', {},
            el('a', { href: it.url, target: '_blank', rel: 'noopener', textContent: it.title || it.itemId }),
            el('small', { className: 'muted', textContent: [it.oldPrice ? `de R$ ${it.oldPrice}` : '', it.price ? `por R$ ${it.price}` : ''].filter(Boolean).join(' ') }),
          ),
          el('small', { className: 'muted', textContent: it.itemId }),
        )),
      );
      if (!currentItems.length) $('ml-ld-items').append(el('p', { className: 'muted', textContent: 'A lista está vazia.' }));
      renderMlLists();
    } catch (err) {
      $('ml-ld-info').textContent = '';
      setMsg('ml-ld-msg', err.message, true);
    }
  }

  $('ml-lists-load').addEventListener('click', loadMlLists);
  $('ml-ld-close').addEventListener('click', () => {
    current = null;
    $('ml-list-detail').hidden = true;
    renderMlLists();
  });
  $('ml-ld-all').addEventListener('change', (e) => {
    document.querySelectorAll('input[name="ml-ld-item"]').forEach((i) => { i.checked = e.target.checked; });
  });

  $('ml-ld-rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    busy(['ml-ld-rename-btn'], true);
    try {
      const r = await roboCall('/api/ml-lists/rename', { method: 'POST', body: { id: current.id, name: $('ml-ld-name').value } });
      current.name = r.name;
      $('ml-ld-title').textContent = r.name;
      $('ml-ld-name').value = r.name;
      setMsg('ml-ld-msg', 'Nome salvo.');
      renderMlLists();
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-rename-btn'], false);
    }
  });

  $('ml-ld-remove').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('input[name="ml-ld-item"]:checked')].map((i) => i.value);
    if (!ids.length) return setMsg('ml-ld-msg', 'Marque os produtos que quer tirar.', true);
    if (!confirm(`Tirar ${ids.length} produto(s) da lista "${current.name}"?`)) return;
    busy(['ml-ld-remove'], true);
    setMsg('ml-ld-msg', 'Tirando os produtos…');
    try {
      const r = await roboCall('/api/ml-lists/remove', { method: 'POST', body: { bookmarkIds: ids } });
      setMsg('ml-ld-msg', `${r.removed} produto(s) tirado(s).${r.failed?.length ? ` ${r.failed.length} não saíram: ${r.failed[0].error}` : ''}`, !!r.failed?.length);
      await loadItems();
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-remove'], false);
    }
  });

  $('ml-ld-add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const links = $('ml-ld-links').value.trim();
    if (!links) return setMsg('ml-ld-msg', 'Cole pelo menos um link.', true);
    busy(['ml-ld-add-btn'], true);
    setMsg('ml-ld-msg', 'Colocando os produtos na lista…');
    try {
      const r = await roboCall('/api/ml-lists/add', { method: 'POST', body: { id: current.id, links } });
      const fails = (r.failed ?? []).map((f) => `${f.link ?? f.id}: ${f.error}`).join('\n');
      setMsg('ml-ld-msg', `${r.added} produto(s) colocado(s).${fails ? `\nFicaram de fora:\n${fails}` : ''}`, !!fails);
      if (r.added) $('ml-ld-links').value = '';
      await loadItems();
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-add-btn'], false);
    }
  });

  $('ml-ld-more-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const couponId = $('ml-ld-coupon').value;
    const keywords = $('ml-ld-words').value.trim();
    if (!couponId) return setMsg('ml-ld-msg', 'Escolha um cupom conferido no Mercado Livre.', true);
    if (!keywords) return setMsg('ml-ld-msg', 'Escreva o que procurar, ex.: notebook, fone.', true);
    busy(['ml-ld-more-btn'], true);
    setMsg('ml-ld-msg', 'Procurando nos produtos do cupom e colocando na lista… (pode levar 1 a 2 minutos)');
    try {
      const r = await roboCall('/api/ml-lists/more', { method: 'POST', body: { id: current.id, couponId, keywords, perKeyword: $('ml-ld-per').value } });
      const resumo = r.found.map((f) => `${f.keyword}: ${f.count}`).join(' · ');
      setMsg('ml-ld-msg', r.added
        ? `${r.added} produto(s) novo(s) na lista (${resumo}).`
        : `Nenhum produto novo (${resumo}). Os achados já estavam na lista ou não há resultados; tente outras palavras.`, !r.added);
      await loadItems();
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-more-btn'], false);
    }
  });

  $('ml-ld-share').addEventListener('click', async () => {
    if (current.privacy !== 'PUBLIC' && !confirm('Para mandar no grupo, a lista será publicada no seu perfil de afiliado (fica pública). Continuar?')) return;
    busy(['ml-ld-share'], true);
    setMsg('ml-ld-msg', 'Pegando o link da lista…');
    try {
      const coupon = guessCoupon(current.name);
      const r = await roboCall('/api/ml-lists/share', { method: 'POST', body: { id: current.id, name: current.name, total: current.total, couponId: coupon?.id ?? '' } });
      current.privacy = 'PUBLIC';
      setMsg('ml-ld-msg', `Link da lista: ${r.url}`);
      if (coupon) await openSend(coupon, r.text);
      else {
        selectedId = null;
        renderList();
        $('cp-send-form').hidden = false;
        $('cp-send-title').textContent = `Enviar a lista ${current.name}`;
        setMsg('cp-send-msg', '');
        $('cp-send-text').value = r.text;
        await loadTargets();
        $('cp-send-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-share'], false);
    }
  });

  $('ml-ld-delete').addEventListener('click', async () => {
    if (!confirm(`Excluir a lista "${current.name}" do Mercado Livre? Não dá para desfazer, e o link dela para de funcionar.`)) return;
    busy(['ml-ld-delete'], true);
    try {
      await roboCall('/api/ml-lists/delete', { method: 'POST', body: { id: current.id } });
      setMsg('ml-lists-msg', `Lista "${current.name}" excluída.`);
      current = null;
      $('ml-list-detail').hidden = true;
      await loadMlLists();
    } catch (err) {
      setMsg('ml-ld-msg', err.message, true);
    } finally {
      busy(['ml-ld-delete'], false);
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
