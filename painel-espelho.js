/*
 * Espelhamento, grupos, modelos, relatório e limites do painel.
 * Tudo fala com o robô pelo roboCall do painel (token de pareamento).
 * Regras, modelos e etiquetas ficam salvos no robô, como na versão local.
 */

const FIELDS = [
  ['titulo', 'Título'],
  ['preco', 'Preço'],
  ['preco_antigo', 'Preço antigo'],
  ['cupom', 'Cupom'],
  ['loja', 'Loja'],
  ['link', 'Meu link'],
  ['links', 'Todos os meus links'],
];

const OPENINGS = [
  '🔥 OFERTA IMPERDÍVEL!',
  '🚨 Achado do dia 🚨',
  '💥 Preço caiu, corre!',
  '⚡ Oferta relâmpago',
  '✅ Vale a pena conferir',
  '👀 Olha que achado',
  '🛒 Garantir antes que acabe',
  '📉 Menor preço do momento',
];

const ACTIVITY = { received: 'Recebida de', sent: 'Enviada para', skipped: 'Não enviada', error: 'Erro', info: 'Aviso' };

const EMOJIS = [
  '🔥', '🚨', '💥', '⚡', '✅', '❌', '👉', '👀', '🛒', '📉', '📦', '🎟️', '💰', '💳', '🎁', '⭐',
  '🏷️', '🚚', '📲', '💬', '✨', '🟢', '🔴', '🟡', '🔵', '⏰', '📍', '🎯', '🧾', '🛍️', '💸', '🤑',
  '😍', '🙌', '👏', '😱', '🥇', '🏆', '📢', '✔️', '➡️', '🔗', '📌', '💎', '🖨️', '🧵', '🔧', '🎉',
  '🆕', '🔝', '❗', '⚠️', '🤩', '😎', '🚀', '💡', '🧡', '🖤', '💚', '💙', '📣', '🔔', '⏳', '🎀',
];

// Valores de exemplo para a prévia (o robô troca pelos valores reais de cada oferta).
const FIELD_SAMPLE = {
  titulo: 'Filamento PLA 1kg',
  preco: 'R$ 79',
  preco_antigo: 'R$ 129',
  cupom: 'MEUDESCONTO',
  loja: 'Mercado Livre',
  link: 'https://meli.la/exemplo',
  links: 'https://meli.la/exemplo',
  condicao: 'Compre no mínimo 2 unidades',
  titulo_maiusculo: 'FILAMENTO PLA 1KG',
  cupom_desconto: '10%',
  frase_ia: 'Olha essa impressora, como tá barata!',
  faixas_cupom: 'R$20 OFF acima de R$189\nR$30 OFF acima de R$279',
};

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function initEspelho({ roboCall }) {
  const $ = (id) => document.getElementById(id);

  let groups = [];
  let rules = [];
  let templates = [];
  let tags = {};
  let sourceEvery = {}; // frequência de cada grupo de origem da regra em edição (0 = todas as ofertas)
  const FREQ_OPTIONS = [
    [0, 'Todas as ofertas'],
    [5, '1 oferta a cada 5 min'],
    [10, '1 oferta a cada 10 min'],
    [15, '1 oferta a cada 15 min'],
    [30, '1 oferta a cada 30 min'],
    [60, '1 oferta por hora'],
  ];
  let editing = null; // regra em edição
  let editingTpl = null; // modelo em edição (página Modelos)
  let connected = false;

  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter((k) => k !== null && k !== undefined));
    return node;
  };
  const btn = (text, onclick, extra = 'btn-ghost') =>
    el('button', { type: 'button', className: `btn btn-sm ${extra}`, textContent: text, onclick });
  const groupName = (id) => groups.find((g) => g.id === id)?.name ?? id;
  const money = (n) => `R$ ${Number(n).toLocaleString('pt-BR')}`;
  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const setRadio = (name, value) => {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };
  const setChecks = (name, ids) => {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) input.checked = ids.includes(input.value);
  };
  const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
  const checkedIn = (container) => [...container.querySelectorAll('input:checked')].map((i) => i.value);

  function showMsg(id, text, isError = false) {
    const box = $(id);
    box.textContent = text;
    box.className = `form-msg${isError ? ' err' : ''}`;
    box.hidden = !text;
  }

  async function run(msgId, fn) {
    try {
      const ok = await fn();
      showMsg(msgId, ok || '');
    } catch (err) {
      showMsg(msgId, err.message, true);
    }
  }

  function insertAt(id, text) {
    const box = $(id);
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    box.value = box.value.slice(0, start) + text + box.value.slice(end);
    box.focus();
    box.setSelectionRange(start + text.length, start + text.length);
    box.dispatchEvent(new Event('input'));
  }

  // Envolve o trecho selecionado com a marca do WhatsApp (*negrito*, _itálico_...).
  // Sem seleção, deixa a marca vazia e o cursor entre as duas.
  function wrapText(id, open, close = open) {
    const box = $(id);
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    const selected = box.value.slice(start, end);
    box.value = box.value.slice(0, start) + open + selected + close + box.value.slice(end);
    box.focus();
    const from = start + open.length;
    box.setSelectionRange(from, from + selected.length);
    box.dispatchEvent(new Event('input'));
  }

  function buildTools(containerId, targetId) {
    const emojiPanel = el('div', { className: 'emoji-panel', hidden: true },
      ...EMOJIS.map((e) => el('button', { type: 'button', className: 'emoji-btn', textContent: e, onclick: () => insertAt(targetId, e) })),
    );
    const mark = (label, title, open, close, extra) =>
      el('button', { type: 'button', className: `tb-btn ${extra}`, title, textContent: label, onclick: () => wrapText(targetId, open, close) });
    $(containerId).replaceChildren(
      mark('N', 'Negrito: *texto*', '*', '*', 'tb-b'),
      mark('I', 'Itálico: _texto_', '_', '_', 'tb-i'),
      mark('S', 'Tachado: ~texto~', '~', '~', 'tb-s'),
      mark('</>', 'Monoespaçado: ```texto```', '```', '```', 'tb-m'),
      el('button', { type: 'button', className: 'tb-btn', title: 'Inserir emoji', textContent: '😀 Emojis', onclick: () => { emojiPanel.hidden = !emojiPanel.hidden; } }),
      emojiPanel,
    );
  }

  // Prévia parecida com a do WhatsApp: converte as marcas e mostra os campos com valores de exemplo.
  function renderPreview(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = esc(text)
      .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
      .replace(/_([^_\n]+)_/g, '<i>$1</i>')
      .replace(/~([^~\n]+)~/g, '<s>$1</s>')
      .replace(/\{(\w+)\}/g, (m, f) => (FIELD_SAMPLE[f] ? `<span class="fld">${esc(FIELD_SAMPLE[f])}</span>` : m));
    $('tpl-preview').innerHTML = html || '<span class="muted">Escreva o modelo para ver a prévia.</span>';
  }
  $('tpl-text').addEventListener('input', () => renderPreview($('tpl-text').value));

  function setSeg(id, value) {
    $(id).value = value;
    document.querySelectorAll(`[data-seg="${id}"] button`).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
  }
  document.querySelectorAll('[data-seg]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setSeg(group.dataset.seg, b.dataset.value)));
  });

  /* ---------- Grupos ---------- */

  function renderGroupChecks(container, name) {
    const checked = new Set(checkedIn(container));
    container.replaceChildren(
      ...groups.map((g) => {
        const input = el('input', { type: 'checkbox', name, value: g.id, checked: checked.has(g.id) });
        const label = el('label', { className: 'check-item' },
          input,
          el('span', { textContent: g.name }),
          el('small', { className: 'muted', textContent: ` (${g.size})` }),
          name === 'target' && g.announce && g.admin === false
            ? el('small', { className: 'warn-text', textContent: ' · robô não é admin, não vai conseguir postar' })
            : null,
        );
        label.dataset.search = g.name; // o filtro procura só pelo nome do grupo
        if (name === 'source') label.append(frequencySelect(g, input));
        return label;
      }),
    );
    if (!groups.length) {
      container.append(el('p', { className: 'muted', textContent: connected ? 'Nenhum grupo encontrado neste número.' : 'Conecte o WhatsApp para listar os grupos.' }));
    }
    applyFilter();
  }

  // Frequência de um grupo de origem: aparece só quando o grupo está marcado.
  function frequencySelect(group, input) {
    const select = el('select', {
      className: 'freq',
      hidden: !input.checked,
      onchange: () => {
        sourceEvery[group.id] = Number(select.value) || 0;
      },
    }, ...FREQ_OPTIONS.map(([value, label]) => el('option', { value: String(value), textContent: label })));
    select.setAttribute('aria-label', `Quantas ofertas pegar de ${group.name}`);
    select.value = String(sourceEvery[group.id] ?? 0);
    input.addEventListener('change', () => {
      select.hidden = !input.checked;
    });
    return select;
  }

  // Põe na tela a frequência guardada de cada origem marcada (ao abrir uma regra ou limpar o formulário).
  function syncFrequencies() {
    document.querySelectorAll('#r-sources select.freq').forEach((select) => {
      const input = select.closest('label').querySelector('input');
      select.value = String(sourceEvery[input.value] ?? 0);
      select.hidden = !input.checked;
    });
  }

  function everyLabel(rule, group) {
    const minutes = Number(rule.sourceEvery?.[group]);
    return FREQ_OPTIONS.find(([value]) => value === minutes && value > 0)?.[1] ?? '';
  }

  function applyFilter() {
    const q = fold($('r-filter').value.trim());
    document.querySelectorAll('#r-sources label, #r-targets label').forEach((label) => {
      const on = label.querySelector('input').checked;
      label.hidden = Boolean(q) && !on && !fold(label.dataset.search ?? label.textContent).includes(q);
    });
  }
  $('r-filter').addEventListener('input', applyFilter);

  function renderGroupsPage() {
    $('grp-empty').hidden = groups.length > 0;
    $('tags-form').hidden = groups.length === 0;
    $('tags-rows').replaceChildren(
      ...groups.map((g) => {
        const t = tags[g.id] ?? {};
        const amazon = el('input', { type: 'text', placeholder: 'ex.: seuchave-20', value: t.amazonTag ?? '', className: 'tag-amz' });
        const sub = el('input', { type: 'text', placeholder: 'ex.: impressao3d', value: t.shopeeSubId ?? '', className: 'tag-sub' });
        amazon.dataset.group = g.id;
        sub.dataset.group = g.id;
        const warn = g.announce && g.admin === false ? ' · robô não é admin' : '';
        return el('div', { className: 'tag-row' },
          el('div', {}, el('strong', { textContent: g.name }), el('small', { className: 'muted', textContent: `${g.size} membros${warn}` })),
          el('label', { className: 'field' }, el('span', { textContent: 'Etiqueta Amazon' }), amazon),
          el('label', { className: 'field' }, el('span', { textContent: 'Sub-ID Shopee' }), sub),
        );
      }),
    );
  }

  function setGroups(list) {
    groups = list;
    renderGroupChecks($('r-sources'), 'source');
    renderGroupChecks($('r-targets'), 'target');
    renderRules();
    renderGroupsPage();
  }

  $('grp-refresh').addEventListener('click', () =>
    run('grp-msg', async () => {
      const r = await roboCall('/api/whatsapp/groups/refresh', { method: 'POST', body: {} });
      setGroups(r.groups);
      return `${r.groups.length} grupos atualizados.`;
    }),
  );

  $('tags-form').addEventListener('submit', (event) => {
    event.preventDefault();
    run('tags-msg', async () => {
      const body = {};
      for (const i of document.querySelectorAll('.tag-amz')) body[i.dataset.group] = { amazonTag: i.value.trim(), shopeeSubId: '' };
      for (const i of document.querySelectorAll('.tag-sub')) {
        body[i.dataset.group] ??= { amazonTag: '', shopeeSubId: '' };
        body[i.dataset.group].shopeeSubId = i.value.trim();
      }
      tags = (await roboCall('/api/group-tags', { method: 'POST', body })).tags;
      renderGroupsPage();
      return 'Etiquetas salvas.';
    });
  });

  async function loadTags() {
    tags = (await roboCall('/api/group-tags')).tags;
    renderGroupsPage();
  }

  /* ---------- Regras ---------- */

  function filterSummary(r) {
    const parts = [];
    if (r.textMode === 'template') parts.push('texto: meu modelo');
    const imageLabels = { off: 'sem foto', always: 'sempre com foto', link: 'só link preview' };
    if (imageLabels[r.imageMode]) parts.push(imageLabels[r.imageMode]);
    if (r.noRepeatPhoto) parts.push('não repete a mesma foto');
    if (r.blockWords?.length) parts.push(`não envia se tiver: ${r.blockWords.join(', ')}`);
    if (r.requireWords?.length) parts.push(`só com: ${r.requireWords.join(', ')}`);
    if (r.minPrice != null || r.maxPrice != null) {
      parts.push(`preço ${r.minPrice != null ? 'de ' + money(r.minPrice) : ''}${r.maxPrice != null ? ' até ' + money(r.maxPrice) : ''}`.trim());
    }
    if (r.dropLines?.length) parts.push(`apaga linhas com: ${r.dropLines.join(', ')}`);
    return parts.length ? `Filtros: ${parts.join(' · ')}` : '';
  }

  function renderRules() {
    $('rules-empty').hidden = rules.length > 0;
    $('rules-list').replaceChildren(
      ...rules.map((r) => {
        const hours = r.schedule ? ` · ${r.schedule.start} às ${r.schedule.end}` : '';
        const filters = filterSummary(r);
        return el('article', { className: 'rule-card' },
          el('div', { className: 'rule-head' },
            el('strong', { textContent: r.name || 'Sem nome' }),
            el('span', { className: `badge ${r.enabled ? 'on' : 'off'}`, textContent: `${r.enabled ? 'Ativa' : 'Pausada'}${hours}${r.testMode ? ' · MODO TESTE' : ''}` }),
          ),
          el('p', { className: 'muted', textContent: `De: ${r.sources.map((g) => groupName(g) + (everyLabel(r, g) ? ` (${everyLabel(r, g)})` : '')).join(', ')}` }),
          el('p', { className: 'muted', textContent: `Para: ${r.targets.map(groupName).join(', ')}` }),
          el('p', { className: 'muted small', textContent: `Não repete o mesmo produto no mesmo grupo por ${r.repeatHours ?? 24} hora(s)` }),
          filters ? el('p', { className: 'muted small', textContent: filters }) : null,
          el('div', { className: 'btn-row' },
            btn('Editar', () => startEdit(r)),
            btn(r.enabled ? 'Pausar' : 'Ativar', () => run('rules-msg', () => saveRule({ ...r, enabled: !r.enabled }))),
            btn(r.testMode ? 'Sair do modo teste' : 'Modo teste (sem links)', () => run('rules-msg', () => saveRule({ ...r, testMode: !r.testMode }))),
            btn('Apagar', () => {
              if (confirm(`Apagar a regra "${r.name || 'sem nome'}"?`)) run('rules-msg', () => deleteRule(r));
            }, 'btn-danger'),
          ),
        );
      }),
    );
  }

  async function loadRules() {
    rules = (await roboCall('/api/mirror/rules')).rules;
    renderRules();
  }

  async function saveRule(rule) {
    await roboCall('/api/mirror/rules', { method: 'POST', body: rule });
    await loadRules();
  }

  async function deleteRule(r) {
    await roboCall(`/api/mirror/rules?id=${encodeURIComponent(r.id)}`, { method: 'DELETE', body: {} });
    await loadRules();
  }

  /* ---------- Formulário da regra ---------- */

  function replacementRow(from = '', to = '') {
    const row = el('div', { className: 'repl-row' },
      el('input', { type: 'text', name: 'from', placeholder: 'Texto original', value: from }),
      el('input', { type: 'text', name: 'to', placeholder: 'Trocar por… (vazio = apagar)', value: to }),
      btn('Remover', () => row.remove()),
    );
    return row;
  }
  const renderReplacements = (list) => $('r-repl').replaceChildren(...list.map((r) => replacementRow(r.from, r.to)));
  const readReplacements = () =>
    [...document.querySelectorAll('#r-repl .repl-row')]
      .map((row) => ({ from: row.querySelector('[name="from"]').value.trim(), to: row.querySelector('[name="to"]').value.trim() }))
      .filter((r) => r.from);
  $('r-add-repl').addEventListener('click', () => $('r-repl').append(replacementRow()));

  function syncVisibility() {
    $('r-tpl-block').hidden = radio('r-textmode') !== 'template';
    $('r-ai-block').hidden = radio('r-textmode') !== 'ai';
    $('r-range').hidden = radio('r-hours') !== 'range';
  }
  document.querySelectorAll('input[name="r-textmode"], input[name="r-hours"]').forEach((i) => i.addEventListener('change', syncVisibility));

  function updateSummary() {
    const sources = checkedIn($('r-sources')).length;
    const targets = checkedIn($('r-targets')).length;
    const stores = [['r-st-ml', 'Mercado Livre'], ['r-st-shopee', 'Shopee'], ['r-st-amazon', 'Amazon']]
      .filter(([id]) => $(id).checked)
      .map(([, name]) => name);
    const hours = radio('r-hours') === 'range' ? `${$('r-start').value} às ${$('r-end').value}` : 'o dia todo';
    $('r-summary').textContent =
      `${sources} origem${sources === 1 ? '' : 'ns'} → ${targets} grupo${targets === 1 ? '' : 's'} · ${stores.join(' e ') || 'nenhuma loja'} · ${hours}`;
  }
  $('rule-form').addEventListener('input', updateSummary);
  $('rule-form').addEventListener('change', updateSummary);

  function renderTplPicker() {
    $('r-tpl-pick').replaceChildren(
      el('option', { value: '', textContent: 'Escolha um modelo salvo…' }),
      ...templates.map((t, i) => el('option', { value: String(i), textContent: t.name + (t.builtin ? ' (pronto)' : '') })),
    );
  }
  $('r-tpl-pick').addEventListener('change', (event) => {
    const t = templates[Number(event.target.value)];
    if (t) $('r-tpl').value = t.text;
    event.target.value = '';
  });

  $('r-opening').replaceChildren(
    el('option', { value: '', textContent: 'Adicionar frase de abertura...' }),
    ...OPENINGS.map((o) => el('option', { value: o, textContent: o })),
  );
  $('r-opening').addEventListener('change', (event) => {
    if (event.target.value) insertAt('r-tpl', event.target.value + '\n');
    event.target.value = '';
  });

  document.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => insertAt(b.dataset.insert, `{${b.dataset.f}}`)));

  $('r-tpl-save').addEventListener('click', () =>
    run('r-tpl-msg', async () => {
      const name = $('r-tpl-name').value.trim();
      const text = $('r-tpl').value.trim();
      if (!name) throw new Error('Dê um nome para o modelo.');
      if (!text) throw new Error('O modelo está vazio.');
      templates = (await roboCall('/api/templates', { method: 'POST', body: { name, text } })).templates;
      $('r-tpl-name').value = '';
      renderTemplates();
      return 'Modelo salvo.';
    }),
  );

  function resetForm() {
    editing = null;
    $('rule-form').reset();
    setSeg('r-handle-mode', 'replace');
    setSeg('r-site-mode', 'remove');
    renderReplacements([]);
    setChecks('source', []);
    setChecks('target', []);
    sourceEvery = {};
    syncFrequencies();
    $('r-filter').value = '';
    applyFilter();
    $('r-extras').open = false;
    $('rule-title').textContent = 'Nova regra de espelhamento';
    $('r-submit').textContent = 'Salvar regra';
    $('r-cancel').hidden = true;
    showMsg('rule-error', '');
    syncVisibility();
    updateSummary();
  }

  function openNew() {
    resetForm();
    $('rule-form').hidden = false;
    $('rule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    resetForm();
    $('rule-form').hidden = true;
  }

  function startEdit(r) {
    resetForm();
    editing = r;
    $('rule-title').textContent = `Editando: ${r.name || 'regra sem nome'}`;
    $('r-submit').textContent = 'Salvar alterações';
    $('r-cancel').hidden = false;
    $('r-name').value = r.name ?? '';
    setChecks('source', r.sources);
    setChecks('target', r.targets);
    sourceEvery = { ...(r.sourceEvery ?? {}) };
    syncFrequencies();
    const stores = r.stores ?? [];
    $('r-st-ml').checked = stores.includes('mercadolivre');
    $('r-st-shopee').checked = stores.includes('shopee');
    $('r-st-amazon').checked = stores.includes('amazon');
    $('r-only').checked = r.onlyStoreOffers !== false;
    $('r-amazon-tag').value = r.amazonTag ?? '';
    $('r-shopee-sub').value = r.shopeeSubId ?? '';
    setRadio('r-image', r.imageMode ?? 'original');
    $('r-nophoto').checked = r.noRepeatPhoto === true;
    $('r-handle').value = r.handle ?? '';
    setSeg('r-handle-mode', r.handleMode ?? 'replace');
    $('r-site').value = r.site ?? '';
    setSeg('r-site-mode', r.siteMode ?? 'remove');
    setRadio('r-hours', r.schedule ? 'range' : 'all');
    $('r-start').value = r.schedule?.start ?? '08:00';
    $('r-end').value = r.schedule?.end ?? '22:00';
    $('r-footer').value = r.footer ?? '';
    $('r-block').value = (r.blockWords ?? []).join('\n');
    $('r-require').value = (r.requireWords ?? []).join('\n');
    // Mostra com vírgula (79,9): o servidor lê ponto como separador de milhar.
    $('r-min').value = r.minPrice != null ? String(r.minPrice).replace('.', ',') : '';
    $('r-max').value = r.maxPrice != null ? String(r.maxPrice).replace('.', ',') : '';
    $('r-mindisc').value = r.minDiscount != null ? String(r.minDiscount) : '';
    $('r-drop').value = (r.dropLines ?? []).join('\n');
    renderReplacements(r.replacements ?? []);
    setRadio('r-textmode', r.textMode ?? 'edit');
    $('r-tpl').value = r.template ?? '';
    $('r-random').checked = r.randomOpener !== false;
    $('r-repeat').value = String(r.repeatHours ?? 24);
    $('r-nicho').value = r.nicho ?? '';
    $('r-extras').open = Boolean(filterSummary(r));
    syncVisibility();
    updateSummary();
    $('rule-form').hidden = false;
    $('rule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('rule-new').addEventListener('click', () => {
    if (connected) openNew();
  });
  $('r-cancel').addEventListener('click', closeForm);

  $('rule-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const start = $('r-start').value;
    const end = $('r-end').value;
    const rule = {
      ...(editing ?? {}),
      name: $('r-name').value.trim(),
      sources: checkedIn($('r-sources')),
      targets: checkedIn($('r-targets')),
      stores: [['mercadolivre', 'r-st-ml'], ['shopee', 'r-st-shopee'], ['amazon', 'r-st-amazon']]
        .filter(([, id]) => $(id).checked)
        .map(([store]) => store),
      onlyStoreOffers: $('r-only').checked,
      amazonTag: $('r-amazon-tag').value.trim(),
      shopeeSubId: $('r-shopee-sub').value.trim(),
      imageMode: radio('r-image'),
      noRepeatPhoto: $('r-nophoto').checked,
      handle: $('r-handle').value.trim(),
      handleMode: $('r-handle-mode').value,
      site: $('r-site').value.trim(),
      siteMode: $('r-site-mode').value,
      footer: $('r-footer').value.trim(),
      schedule: radio('r-hours') === 'range' && start && end ? { start, end } : null,
      blockWords: lines('r-block'),
      requireWords: lines('r-require'),
      dropLines: lines('r-drop'),
      minPrice: $('r-min').value.trim() || null,
      maxPrice: $('r-max').value.trim() || null,
      minDiscount: $('r-mindisc').value.trim() || null,
      replacements: readReplacements(),
      textMode: radio('r-textmode'),
      template: $('r-tpl').value.trim(),
      randomOpener: $('r-random').checked,
      repeatHours: Number($('r-repeat').value) || 24,
      nicho: $('r-nicho').value.trim(),
    };
    // Só origens marcadas, com frequência diferente de "todas as ofertas".
    rule.sourceEvery = Object.fromEntries(rule.sources.filter((g) => sourceEvery[g] > 0).map((g) => [g, sourceEvery[g]]));
    const problem = !rule.sources.length
      ? 'Escolha pelo menos um grupo de origem.'
      : !rule.targets.length
        ? 'Escolha pelo menos um grupo seu para postar.'
        : !rule.stores.length
          ? 'Marque pelo menos uma loja.'
          : '';
    if (problem) {
      showMsg('rule-error', problem, true);
      return;
    }
    try {
      await saveRule(rule);
      closeForm();
      showMsg('rules-msg', 'Regra salva.');
    } catch (err) {
      showMsg('rule-error', err.message, true);
    }
  });

  /* ---------- Modelos ---------- */

  function renderTemplates() {
    $('templates').replaceChildren(
      ...templates.map((t) =>
        el('div', { className: `card tpl-card${t.builtin ? ' builtin' : ''}` },
          el('div', { className: 'tpl-head' }, el('h3', { textContent: t.name }), el('small', { className: 'muted', textContent: t.builtin ? 'Pronto' : 'Seu' })),
          el('pre', { className: 'msg', textContent: t.text }),
          el('div', { className: 'btn-row' },
            t.builtin
              ? btn('Copiar e editar', () => copyTemplate(t))
              : btn('Editar', () => editTemplate(t)),
            t.builtin
              ? null
              : btn('Excluir', () => {
                  if (confirm(`Apagar o modelo "${t.name}"?`)) run('tpl-msg', () => deleteTemplate(t));
                }, 'btn-danger'),
          ),
        ),
      ),
    );
    renderTplPicker();
  }

  async function loadTemplates() {
    templates = (await roboCall('/api/templates')).templates;
    renderTemplates();
  }

  function cancelTpl() {
    editingTpl = null;
    $('tpl-title').textContent = 'Monte o seu modelo';
    $('tpl-name').value = '';
    $('tpl-text').value = '';
    $('tpl-cancel').hidden = true;
    renderPreview('');
  }

  function editTemplate(t) {
    editingTpl = t;
    $('tpl-title').textContent = `Editando: ${t.name}`;
    $('tpl-name').value = t.name;
    $('tpl-text').value = t.text;
    $('tpl-cancel').hidden = false;
    renderPreview(t.text);
    $('tpl-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Modelos prontos não são alterados: a edição vira um modelo novo, seu.
  function copyTemplate(t) {
    editingTpl = null;
    $('tpl-title').textContent = `Cópia de "${t.name}"`;
    $('tpl-name').value = `${t.name} (meu)`;
    $('tpl-text').value = t.text;
    $('tpl-cancel').hidden = false;
    renderPreview(t.text);
    $('tpl-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteTemplate(t) {
    templates = (await roboCall(`/api/templates?id=${encodeURIComponent(t.id)}`, { method: 'DELETE', body: {} })).templates;
    if (editingTpl?.id === t.id) cancelTpl();
    renderTemplates();
  }

  $('tpl-new').addEventListener('click', () => {
    cancelTpl();
    $('tpl-text').focus();
  });
  $('tpl-cancel').addEventListener('click', cancelTpl);

  $('tpl-form').addEventListener('submit', (event) => {
    event.preventDefault();
    run('tpl-msg', async () => {
      const name = $('tpl-name').value.trim();
      const text = $('tpl-text').value.trim();
      if (!name) throw new Error('Dê um nome para o modelo.');
      if (!text) throw new Error('O modelo está vazio.');
      templates = (await roboCall('/api/templates', { method: 'POST', body: { id: editingTpl?.id ?? null, name, text } })).templates;
      cancelTpl();
      renderTemplates();
      return 'Modelo salvo.';
    });
  });

  /* ---------- Relatório e status ---------- */

  function renderReport(s) {
    const t = s.today;
    $('rel-today').textContent = t
      ? `Hoje (${t.day}): ${t.sent} enviadas · ${t.skipped} não enviadas · ${t.received} recebidas · ${t.error} erros`
      : '';
    const items = s.activity ?? [];
    $('rel-empty').hidden = items.length > 0;
    $('rel-activity').replaceChildren(
      ...items.slice(0, 30).map((a) => {
        const when = new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return el('li', {},
          el('span', { className: 'meta', textContent: `${when} · ${ACTIVITY[a.type] ?? a.type}${a.group ? ' ' + a.group : ''}` }),
          el('div', { className: 'msg', textContent: a.text ?? '' }),
        );
      }),
    );
  }

  function renderStatus(s) {
    connected = s.status === 'connected';
    $('esp-aviso').hidden = connected;
    $('esp-aviso').textContent =
      s.status === 'disabled'
        ? 'O WhatsApp está desligado no robô.'
        : 'Conecte o WhatsApp na página Conexões para listar os seus grupos.';
    $('rule-new').disabled = !connected;
    if (connected) setGroups(s.groups);
    else $('rule-form').hidden = true;
    renderReport(s);
  }

  /* ---------- Limites contra bloqueio ---------- */

  function renderLimits(u) {
    if ($('lim-form').contains(document.activeElement)) return;
    $('lim-group-hour').value = u.limits.perGroupHour;
    $('lim-group-day').value = u.limits.perGroupDay;
    $('lim-total-hour').value = u.limits.totalHour;
    $('lim-usage').replaceChildren(
      el('li', {}, el('span', { className: 'msg', textContent: `Total na última hora: ${u.totalHour}/${u.limits.totalHour}` })),
      ...Object.entries(u.groups)
        .filter(([, c]) => c.day > 0)
        .map(([id, c]) =>
          el('li', {},
            el('span', { className: 'meta', textContent: groupName(id) }),
            el('div', { className: 'msg', textContent: `${c.hour}/${u.limits.perGroupHour} na última hora · ${c.day}/${u.limits.perGroupDay} nas últimas 24h` }),
          ),
        ),
    );
  }

  async function loadLimits() {
    renderLimits(await roboCall('/api/settings/limits'));
  }

  $('lim-form').addEventListener('submit', (event) => {
    event.preventDefault();
    run('lim-msg', async () => {
      const u = await roboCall('/api/settings/limits', {
        method: 'POST',
        body: {
          perGroupHour: Number($('lim-group-hour').value),
          perGroupDay: Number($('lim-group-day').value),
          totalHour: Number($('lim-total-hour').value),
        },
      });
      document.activeElement?.blur();
      renderLimits(u);
      return 'Limites salvos.';
    });
  });

  /* ---------- Carregar tudo ---------- */

  async function refresh() {
    const results = await Promise.allSettled([
      roboCall('/api/whatsapp/status').then(renderStatus),
      loadRules(),
      loadTemplates(),
      loadTags(),
      loadLimits(),
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    showMsg('esp-msg', failed ? failed.reason.message : '', true);
  }

  // Chamado quando a tela muda: recarrega só o que a tela usa.
  function onView(view) {
    if (['espelhamento', 'grupos', 'modelos', 'relatorio', 'config'].includes(view)) refresh();
  }

  buildTools('tpl-tools', 'tpl-text');
  buildTools('r-tools', 'r-tpl');
  renderPreview('');
  resetForm();
  return { refresh, onView };
}
