/**
 * Painel do robô do WhatsApp: conexão (QR), grupos, regras e últimas atividades.
 * Só funciona com o servidor rodando; sem ele mostra um aviso.
 */
const $ = (id) => document.getElementById(id);

const STATUS = {
  starting: ['Iniciando...', 'verdict-wait'],
  qr: ['Aguardando leitura do QR', 'verdict-skip'],
  connected: ['Conectado', 'verdict-send'],
  reconnecting: ['Reconectando...', 'verdict-wait'],
  error: ['Erro', 'verdict-skip'],
  disabled: ['Desligado', 'verdict-skip'],
  offline: ['Sem servidor', 'verdict-skip'],
};

const ACTIVITY = {
  received: 'Recebida de',
  sent: 'Enviada para',
  skipped: 'Não enviada',
  error: 'Erro',
  info: 'Aviso',
};

let groups = [];
let groupsKey = '';
let rules = [];
const DISCONNECT_STATUSES = ['offline', 'error', 'reconnecting'];

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

const groupName = (id) => groups.find((g) => g.id === id)?.name ?? id;

/* ---------- Grupos ---------- */

function renderGroupChecks(container, name) {
  const checked = new Set([...container.querySelectorAll('input:checked')].map((i) => i.value));
  container.replaceChildren(
    ...groups.map((g) =>
      el(
        'label',
        {},
        el('input', { type: 'checkbox', name, value: g.id, checked: checked.has(g.id) }),
        ` ${g.name} `,
        el('span', { className: 'size', textContent: `(${g.size})` }),
        // Só no destino importa: num grupo onde só admins postam, o robô precisa ser admin.
        name === 'target' && g.announce && g.admin === false
          ? el('span', { className: 'not-admin', textContent: ' · robô não é admin, não vai conseguir postar' })
          : null,
      ),
    ),
  );
  if (!groups.length) container.append(el('p', { className: 'muted', textContent: 'Nenhum grupo encontrado neste número.' }));
}

function renderGroups(list) {
  const key = list.map((g) => g.id + g.name + g.admin + g.announce).join('|');
  if (key === groupsKey) return;
  groups = list;
  groupsKey = key;
  renderGroupChecks($('rule-sources'), 'source');
  renderGroupChecks($('rule-targets'), 'target');
  renderRules();
  renderTagRows();
}

/* ---------- Etiquetas por grupo ---------- */

let groupTagsState = {};

function renderTagRows() {
  $('tags-rows').replaceChildren(
    ...groups.map((g) => {
      const t = groupTagsState[g.id] ?? {};
      const amazon = el('input', { type: 'text', placeholder: 'tag Amazon', value: t.amazonTag ?? '' });
      const sub = el('input', { type: 'text', placeholder: 'sub-ID Shopee', value: t.shopeeSubId ?? '' });
      amazon.dataset.group = g.id;
      amazon.name = 'amazon';
      sub.dataset.group = g.id;
      sub.name = 'sub';
      return el('div', { className: 'field-row' }, el('span', { className: 'meta', textContent: g.name }), amazon, sub);
    }),
  );
}

async function loadTags() {
  groupTagsState = (await call('GET', '/api/group-tags')).tags;
  renderTagRows();
}

$('tags-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {};
  for (const input of document.querySelectorAll('#tags-rows input[name="amazon"]')) {
    body[input.dataset.group] = { amazonTag: input.value.trim(), shopeeSubId: '' };
  }
  for (const input of document.querySelectorAll('#tags-rows input[name="sub"]')) {
    body[input.dataset.group] ??= { amazonTag: '', shopeeSubId: '' };
    body[input.dataset.group].shopeeSubId = input.value.trim();
  }
  const errorBox = $('tags-error');
  try {
    groupTagsState = (await call('POST', '/api/group-tags', body)).tags;
    errorBox.hidden = true;
    renderTagRows();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

/* ---------- Regras ---------- */

function renderRules() {
  $('rules-block').hidden = rules.length === 0;
  $('rules').replaceChildren(
    ...rules.map((r) => {
      const toggle = el('button', {
        type: 'button',
        className: 'btn btn-small btn-ghost',
        textContent: r.enabled ? 'Pausar' : 'Ativar',
        onclick: () => saveRule({ ...r, enabled: !r.enabled }),
      });
      const test = el('button', {
        type: 'button',
        className: 'btn btn-small btn-ghost',
        textContent: r.testMode ? 'Sair do modo teste' : 'Modo teste (sem links)',
        onclick: () => saveRule({ ...r, testMode: !r.testMode }),
      });
      const edit = el('button', {
        type: 'button',
        className: 'btn btn-small btn-ghost',
        textContent: 'Editar',
        onclick: () => startEdit(r),
      });
      const remove = el('button', {
        type: 'button',
        className: 'btn btn-small btn-ghost',
        textContent: 'Apagar',
        onclick: async () => {
          if (!confirm(`Apagar a regra "${r.name || 'sem nome'}"?`)) return;
          await call('DELETE', `/api/mirror/rules?id=${encodeURIComponent(r.id)}`);
          await loadRules();
        },
      });
      const schedule = r.schedule ? ` · ${r.schedule.start} às ${r.schedule.end}` : '';
      return el(
        'li',
        {},
        el('span', {
          className: 'meta',
          textContent: `${r.enabled ? 'Ativa' : 'Pausada'}${schedule}${r.testMode ? ' · MODO TESTE: repassa sem links' : ''}`,
        }),
        el('strong', { textContent: r.name || 'Sem nome' }),
        el('span', { className: 'msg', textContent: `\nDe: ${r.sources.map(groupName).join(', ')}\nPara: ${r.targets.map(groupName).join(', ')}${filterSummary(r)}` }),
        el('div', { className: 'rule-actions' }, edit, toggle, test, remove),
      );
    }),
  );
}

const money = (n) => `R$ ${Number(n).toLocaleString('pt-BR')}`;

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
  return parts.length ? `\nFiltros: ${parts.join(' · ')}` : '';
}

/* ---------- Editar regra ---------- */

let editing = null;
const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);

function setChecks(name, ids) {
  for (const input of document.querySelectorAll(`input[name="${name}"]`)) input.checked = ids.includes(input.value);
}

function startEdit(r) {
  editing = r;
  editingTemplateId = null;
  $('template-name').value = '';
  $('rule-name').value = r.name ?? '';
  setChecks('source', r.sources);
  setChecks('target', r.targets);
  const stores = r.stores ?? [];
  $('rule-store-ml').checked = stores.includes('mercadolivre');
  $('rule-store-shopee').checked = stores.includes('shopee');
  $('rule-store-amazon').checked = stores.includes('amazon');
  $('rule-only-stores').checked = r.onlyStoreOffers !== false;
  $('rule-amazon-tag').value = r.amazonTag ?? '';
  $('rule-shopee-sub').value = r.shopeeSubId ?? '';
  setRadio('rule-image', r.imageMode ?? 'original');
  $('rule-no-repeat-photo').checked = r.noRepeatPhoto === true;
  $('rule-handle').value = r.handle ?? '';
  setSeg('rule-handle-mode', r.handleMode ?? 'replace');
  $('rule-site').value = r.site ?? '';
  setSeg('rule-site-mode', r.siteMode ?? 'remove');
  setRadio('rule-hours', r.schedule ? 'range' : 'all');
  $('rule-start').value = r.schedule?.start ?? '08:00';
  $('rule-end').value = r.schedule?.end ?? '22:00';
  $('rule-footer').value = r.footer ?? '';
  $('rule-block').value = (r.blockWords ?? []).join('\n');
  $('rule-require').value = (r.requireWords ?? []).join('\n');
  // Mostra com vírgula (79,9): o servidor lê ponto como separador de milhar.
  $('rule-min').value = r.minPrice != null ? String(r.minPrice).replace('.', ',') : '';
  $('rule-max').value = r.maxPrice != null ? String(r.maxPrice).replace('.', ',') : '';
  $('rule-min-discount').value = r.minDiscount != null ? String(r.minDiscount) : '';
  $('rule-drop').value = (r.dropLines ?? []).join('\n');
  renderReplacements(r.replacements ?? []);
  setRadio('rule-text-mode', r.textMode ?? 'edit');
  $('rule-template').value = r.template ?? '';
  $('rule-random-opener').checked = r.randomOpener !== false;
  syncTemplate();
  syncHours();
  updateSummary();
  $('rule-filters').open = Boolean(filterSummary(r));
  $('rule-form-title').textContent = `Editando: ${r.name || 'regra sem nome'}`;
  $('rule-submit').textContent = 'Salvar alterações';
  $('rule-cancel').hidden = false;
  $('group-filter').value = '';
  $('group-filter').dispatchEvent(new Event('input'));
  $('rule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

function setSeg(id, value) {
  $(id).value = value;
  document.querySelectorAll(`[data-seg="${id}"] button`).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}
document.querySelectorAll('[data-seg]').forEach((group) => {
  group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setSeg(group.dataset.seg, b.dataset.value)));
});
setSeg('rule-handle-mode', 'replace');
setSeg('rule-site-mode', 'remove');
const setRadio = (name, value) => {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
};

function syncTemplate() {
  $('rule-template-block').hidden = radio('rule-text-mode') !== 'template';
}
function syncHours() {
  $('rule-range').hidden = radio('rule-hours') !== 'range';
}
document.querySelectorAll('input[name="rule-text-mode"]').forEach((input) => input.addEventListener('change', syncTemplate));
document.querySelectorAll('input[name="rule-hours"]').forEach((input) => input.addEventListener('change', syncHours));

/* ---------- Biblioteca de modelos ---------- */

let templateList = [];
let editingTemplateId = null;

function renderTemplateLibrary() {
  $('template-library').replaceChildren(
    ...templateList.map((t) =>
      el('div', { className: `template-card${t.builtin ? ' builtin' : ''}` },
        el('div', { className: 'template-head' },
          el('strong', { textContent: t.name }),
          el('span', { className: 'meta', textContent: t.builtin ? 'Pronto' : 'Seu' }),
        ),
        el('pre', { className: 'template-preview', textContent: t.text }),
        el('div', { className: 'rule-actions' },
          el('button', { type: 'button', className: 'btn btn-small', textContent: 'Usar', onclick: () => useTemplate(t) }),
          t.builtin ? null : el('button', { type: 'button', className: 'btn btn-small btn-ghost', textContent: 'Editar', onclick: () => editTemplate(t) }),
          t.builtin ? null : el('button', { type: 'button', className: 'btn btn-small btn-ghost', textContent: 'Excluir', onclick: () => deleteTemplate(t) }),
        ),
      ),
    ),
  );
}

function useTemplate(t) {
  editingTemplateId = null;
  $('rule-template').value = t.text;
  $('template-name').value = '';
  $('template-error').hidden = true;
}

function editTemplate(t) {
  editingTemplateId = t.id;
  $('rule-template').value = t.text;
  $('template-name').value = t.name;
  $('template-name').focus();
}

async function deleteTemplate(t) {
  if (!confirm(`Apagar o modelo "${t.name}"?`)) return;
  templateList = (await call('DELETE', `/api/templates?id=${encodeURIComponent(t.id)}`, {})).templates;
  if (editingTemplateId === t.id) editingTemplateId = null;
  renderTemplateLibrary();
}

$('template-new').addEventListener('click', () => {
  editingTemplateId = null;
  $('rule-template').value = '';
  $('template-name').value = '';
  $('rule-template').focus();
});

$('template-save').addEventListener('click', async () => {
  const errorBox = $('template-error');
  try {
    templateList = (await call('POST', '/api/templates', {
      id: editingTemplateId,
      name: $('template-name').value,
      text: $('rule-template').value,
    })).templates;
    editingTemplateId = null;
    errorBox.hidden = true;
    renderTemplateLibrary();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

async function loadTemplates() {
  templateList = (await call('GET', '/api/templates')).templates;
  renderTemplateLibrary();
}

function replacementRow(from = '', to = '') {
  const row = el('div', { className: 'replacement-row' },
    el('input', { type: 'text', name: 'from', placeholder: 'Texto original', value: from }),
    el('input', { type: 'text', name: 'to', placeholder: 'Trocar por… (vazio = apagar)', value: to }),
    el('button', { type: 'button', className: 'btn btn-small btn-ghost', textContent: 'Remover', onclick: () => row.remove() }),
  );
  return row;
}
function renderReplacements(list) {
  $('rule-replacements').replaceChildren(...list.map((r) => replacementRow(r.from, r.to)));
}
function readReplacements() {
  return [...document.querySelectorAll('#rule-replacements .replacement-row')]
    .map((row) => ({ from: row.querySelector('[name="from"]').value.trim(), to: row.querySelector('[name="to"]').value.trim() }))
    .filter((r) => r.from);
}
$('rule-add-replacement').addEventListener('click', () => $('rule-replacements').append(replacementRow()));

function updateSummary() {
  const sources = document.querySelectorAll('input[name="source"]:checked').length;
  const targets = document.querySelectorAll('input[name="target"]:checked').length;
  const storeNames = [['rule-store-ml', 'Mercado Livre'], ['rule-store-shopee', 'Shopee'], ['rule-store-amazon', 'Amazon']]
    .filter(([id]) => $(id).checked)
    .map(([, name]) => name);
  const hours = radio('rule-hours') === 'range' ? `${$('rule-start').value} às ${$('rule-end').value}` : 'o dia todo';
  $('rule-summary').textContent =
    `${sources} origem${sources === 1 ? '' : 'ns'} → ${targets} grupo${targets === 1 ? '' : 's'} · ${storeNames.join(' e ') || 'nenhuma loja'} · ${hours}`;
}
$('rule-form').addEventListener('input', updateSummary);
$('rule-form').addEventListener('change', updateSummary);

function insertAtCursor(tag) {
  const box = $('rule-template');
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? start;
  box.value = box.value.slice(0, start) + tag + box.value.slice(end);
  box.focus();
  box.setSelectionRange(start + tag.length, start + tag.length);
}

document.querySelectorAll('[data-field]').forEach((button) => {
  button.addEventListener('click', () => insertAtCursor(`{${button.dataset.field}}`));
});

$('rule-opening').addEventListener('change', (event) => {
  if (event.target.value) insertAtCursor(event.target.value + '\n');
  event.target.value = '';
});

function resetForm() {
  const keep = { handle: $('rule-handle').value, start: $('rule-start').value, end: $('rule-end').value };
  editing = null;
  $('rule-form').reset();
  editingTemplateId = null;
  $('template-name').value = '';
  setSeg('rule-handle-mode', 'replace');
  setSeg('rule-site-mode', 'remove');
  syncTemplate();
  syncHours();
  $('rule-handle').value = keep.handle;
  $('rule-start').value = keep.start;
  $('rule-end').value = keep.end;
  renderReplacements([]);
  setChecks('source', []);
  setChecks('target', []);
  updateSummary();
  $('rule-filters').open = false;
  $('rule-form-title').textContent = 'Nova regra de espelhamento';
  $('rule-submit').textContent = 'Salvar regra';
  $('rule-cancel').hidden = true;
  $('rule-error').hidden = true;
}

$('rule-cancel').addEventListener('click', resetForm);

async function loadRules() {
  rules = (await call('GET', '/api/mirror/rules')).rules;
  renderRules();
}

async function saveRule(rule) {
  await call('POST', '/api/mirror/rules', rule);
  await loadRules();
}

$('rule-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('rule-error');
  const picked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const start = $('rule-start').value;
  const end = $('rule-end').value;
  const stores = [['mercadolivre', 'rule-store-ml'], ['shopee', 'rule-store-shopee'], ['amazon', 'rule-store-amazon']]
    .filter(([, id]) => $(id).checked)
    .map(([store]) => store);
  const rule = {
    // Editando: mantém o que a tela não mostra (ativa/pausada, modo teste...).
    ...(editing ?? {}),
    name: $('rule-name').value.trim(),
    sources: picked('source'),
    targets: picked('target'),
    stores,
    onlyStoreOffers: $('rule-only-stores').checked,
    amazonTag: $('rule-amazon-tag').value.trim(),
    shopeeSubId: $('rule-shopee-sub').value.trim(),
    imageMode: radio('rule-image'),
    noRepeatPhoto: $('rule-no-repeat-photo').checked,
    handle: $('rule-handle').value.trim(),
    handleMode: $('rule-handle-mode').value,
    site: $('rule-site').value.trim(),
    siteMode: $('rule-site-mode').value,
    footer: $('rule-footer').value.trim(),
    schedule: radio('rule-hours') === 'range' && start && end ? { start, end } : null,
    blockWords: lines('rule-block'),
    requireWords: lines('rule-require'),
    dropLines: lines('rule-drop'),
    minPrice: $('rule-min').value.trim() || null,
    maxPrice: $('rule-max').value.trim() || null,
    minDiscount: $('rule-min-discount').value.trim() || null,
    replacements: readReplacements(),
    textMode: radio('rule-text-mode'),
    template: $('rule-template').value.trim(),
    randomOpener: $('rule-random-opener').checked,
  };
  const problem = !rule.sources.length
    ? 'Escolha pelo menos um grupo de origem.'
    : !rule.targets.length
      ? 'Escolha pelo menos um grupo seu para postar.'
      : !rule.stores.length
        ? 'Marque pelo menos uma loja.'
        : '';
  errorBox.textContent = problem;
  errorBox.hidden = !problem;
  if (problem) return;

  try {
    await saveRule(rule);
    resetForm();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

/* ---------- Limites contra bloqueio ---------- */

let limitsLoaded = false;

function renderLimits(u) {
  if (!limitsLoaded || !document.getElementById('limits-form').contains(document.activeElement)) {
    $('lim-group-hour').value = u.limits.perGroupHour;
    $('lim-group-day').value = u.limits.perGroupDay;
    $('lim-total-hour').value = u.limits.totalHour;
    limitsLoaded = true;
  }
  const rows = Object.entries(u.groups)
    .filter(([, c]) => c.day > 0)
    .map(([id, c]) =>
      el('li', {}, el('span', { className: 'meta', textContent: groupName(id) }),
        el('span', { className: 'msg', textContent: `${c.hour}/${u.limits.perGroupHour} na última hora · ${c.day}/${u.limits.perGroupDay} nas últimas 24h` })),
    );
  rows.unshift(el('li', {}, el('span', { className: 'msg', textContent: `Total na última hora: ${u.totalHour}/${u.limits.totalHour}` })));
  $('limits-usage').replaceChildren(...rows);
}

$('limits-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('limits-error');
  try {
    const u = await call('POST', '/api/settings/limits', {
      perGroupHour: Number($('lim-group-hour').value),
      perGroupDay: Number($('lim-group-day').value),
      totalHour: Number($('lim-total-hour').value),
    });
    errorBox.hidden = true;
    limitsLoaded = false;
    document.activeElement?.blur();
    renderLimits(u);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

/* ---------- Status e atividades ---------- */

function renderActivity(items) {
  $('activity-block').hidden = items.length === 0;
  $('activity').replaceChildren(
    ...items.slice(0, 20).map((a) => {
      const when = new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const label = `${when} · ${ACTIVITY[a.type] ?? a.type}${a.group ? ' ' + a.group : ''}`;
      return el('li', {}, el('span', { className: 'meta', textContent: label }), el('span', { className: 'msg', textContent: a.text ?? '' }));
    }),
  );
}

function renderStatus(s) {
  const [label, cls] = STATUS[s.status] ?? [s.status, 'verdict-wait'];
  const badge = $('wa-badge');
  badge.textContent = label;
  badge.className = `verdict ${cls}`;

  $('wa-qr-block').hidden = !s.qr;
  if (s.qr && $('wa-qr').src !== s.qr) $('wa-qr').src = s.qr;

  const connected = s.status === 'connected';
  $('wa-actions').hidden = !connected;
  $('rule-form').hidden = !connected;

  // Gerenciar banner de desconexão
  const isDisconnected = DISCONNECT_STATUSES.includes(s.status);
  $('disconnect-banner').hidden = !isDisconnected;
  if (isDisconnected) {
    const reasons = {
      offline: 'O servidor não está rodando. Reinicie o robô.',
      error: 'Erro ao conectar. Verifique o log.',
      reconnecting: 'Reconectando... Aguarde alguns segundos.',
    };
    $('disconnect-reason').textContent = reasons[s.status] || 'O robô não está postando.';
  }

  $('wa-info').textContent =
    s.status === 'offline'
      ? 'O robô só funciona com o servidor rodando no seu computador (npm start).'
      : s.status === 'disabled'
        ? 'O WhatsApp está desligado no servidor (WHATSAPP=0 no .env).'
        : s.status === 'error'
          ? `Erro: ${s.error}`
          : connected
            ? `Número conectado: +${s.me ?? '?'} · ${s.groups.length} grupos${s.queue ? ` · ${s.queue} na fila de envio` : ''}`
            : '';

  if (connected) renderGroups(s.groups);
  renderActivity(s.activity ?? []);
  const t = s.today;
  const perGroup = t ? Object.entries(t.byGroup ?? {}).map(([name, n]) => `${name}: ${n}`).join(' · ') : '';
  $('today-summary').textContent = t
    ? `Hoje (${t.day}): ${t.sent} enviadas · ${t.skipped} não enviadas · ${t.received} recebidas · ${t.error} erros${perGroup ? ` · Por grupo: ${perGroup}` : ''}`
    : '';
  $('tags-form').hidden = !connected;
}

async function poll() {
  try {
    renderStatus(await call('GET', '/api/whatsapp/status'));
    renderLimits(await call('GET', '/api/settings/limits'));
    $('limits-form').hidden = false;
  } catch {
    renderStatus({ status: 'offline' });
    return; // sem servidor: não fica tentando
  }
  setTimeout(poll, 3000);
}

// Filtra as duas listas de grupos; os marcados sempre continuam visíveis.
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function applyFilter() {
  const q = fold($('group-filter').value.trim());
  for (const label of document.querySelectorAll('.group-list label')) {
    const input = label.querySelector('input');
    label.hidden = Boolean(q) && !input.checked && !fold(label.textContent).includes(q);
  }
}
$('group-filter').addEventListener('input', applyFilter);
new MutationObserver(() => {
  applyFilter();
  updateSummary();
}).observe($('rule-sources'), { childList: true });
new MutationObserver(() => {
  applyFilter();
  updateSummary();
}).observe($('rule-targets'), { childList: true });

$('wa-refresh').addEventListener('click', async () => {
  renderGroups((await call('POST', '/api/whatsapp/groups/refresh')).groups);
});

$('wa-logout').addEventListener('click', async () => {
  if (!confirm('Desconectar este número do robô? Vai ser preciso escanear o QR de novo.')) return;
  await call('POST', '/api/whatsapp/logout');
});

poll();
loadRules().catch(() => {});
loadTags().catch(() => {});
loadTemplates().catch(() => {});
