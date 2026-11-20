/**
 * Aba Converter: você cola uma oferta e o robô devolve o texto com os SEUS links,
 * no modelo que você escolher. Depois você escolhe os grupos e o robô envia,
 * com a foto do produto quando achar. Tudo passa pelo robô local (roboCall).
 */
export function initConverter({ roboCall }) {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter(Boolean));
    return node;
  };

  const setMsg = (text, isError = false) => {
    const box = $('cv-msg');
    box.textContent = text;
    box.hidden = !text;
    box.style.color = isError ? '#f87171' : '';
    box.style.whiteSpace = 'pre-line';
  };
  const setSendMsg = (text, isError = false) => {
    const box = $('cv-send-msg');
    box.textContent = text;
    box.hidden = !text;
    box.style.color = isError ? '#f87171' : '';
    box.style.whiteSpace = 'pre-line';
  };

  // Lista os modelos; mantém o que estava escolhido quando a lista não muda.
  async function loadTemplates() {
    const keep = $('cv-tpl').value;
    const { templates = [] } = await roboCall('/api/templates');
    $('cv-tpl').replaceChildren(
      el('option', { value: '', textContent: 'Só trocar os links (texto original)' }),
      ...templates.map((t) => el('option', { value: t.id, textContent: t.name })),
    );
    $('cv-tpl').value = templates.some((t) => t.id === keep) ? keep : '';
  }

  // Grupos onde o robô pode postar (os de só admin entram se o robô for admin).
  async function loadGroups() {
    const wa = await roboCall('/api/whatsapp/status');
    const mine = (wa.groups ?? []).filter((g) => !g.announce || g.admin);
    const checked = new Set([...document.querySelectorAll('input[name="cv-target"]:checked')].map((i) => i.value));
    $('cv-targets').replaceChildren(
      ...mine.map((g) => el('label', {}, el('input', { type: 'checkbox', name: 'cv-target', value: g.id, checked: checked.has(g.id) }), ` ${g.name}`)),
    );
    if (!mine.length) $('cv-targets').append(el('p', { className: 'muted', textContent: 'Conecte o WhatsApp para escolher os grupos.' }));
  }

  $('cv-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('cv-text').value.trim();
    if (!text) return setMsg('Cole a mensagem da oferta.', true);
    $('cv-btn').disabled = true;
    setMsg('Convertendo…');
    try {
      const result = await roboCall('/api/convert-message', {
        method: 'POST',
        body: { text, templateId: $('cv-tpl').value },
      });
      if (!result.ok) {
        // Link que não converteu: a mensagem não sai montada, para não ficar com link de outra pessoa.
        $('cv-result').hidden = true;
        const links = (result.failed ?? []).map((f) => `${f.url}: ${f.reason ?? f.status}`);
        setMsg([result.reason, ...links].filter(Boolean).join('\n'), true);
        return;
      }
      $('cv-out').value = result.text;
      $('cv-result').hidden = false;
      setSendMsg('');
      setMsg('');
      await loadGroups().catch((err) => setSendMsg(err.message, true));
    } catch (err) {
      $('cv-result').hidden = true;
      setMsg(err.message, true);
    } finally {
      $('cv-btn').disabled = false;
    }
  });

  $('cv-copy').addEventListener('click', async () => {
    const out = $('cv-out');
    try {
      await navigator.clipboard.writeText(out.value);
    } catch {
      out.select();
      document.execCommand('copy');
    }
    setMsg('Copiado.');
  });

  // Envia o texto (como está na caixa, inclusive se você editou) para os grupos escolhidos.
  $('cv-send-btn').addEventListener('click', async () => {
    const targets = [...document.querySelectorAll('input[name="cv-target"]:checked')].map((i) => i.value);
    if (!targets.length) return setSendMsg('Escolha pelo menos um grupo.', true);
    const text = $('cv-out').value.trim();
    if (!text) return setSendMsg('A mensagem está vazia.', true);
    $('cv-send-btn').disabled = true;
    setSendMsg('Enviando…');
    try {
      const r = await roboCall('/api/convert-message/send', {
        method: 'POST',
        body: { text, original: $('cv-text').value, targets },
      });
      const parts = [`${r.queued} envio${r.queued === 1 ? '' : 's'} na fila do robô (${r.photo}).`];
      if (r.blocked?.length) parts.push(`Não enviado pelo limite: ${r.blocked.map((b) => b.group).join(', ')}.`);
      parts.push('Acompanhe em Últimas atividades.');
      setSendMsg(parts.join('\n'), (r.blocked ?? []).length > 0);
    } catch (err) {
      setSendMsg(err.message, true);
    } finally {
      $('cv-send-btn').disabled = false;
    }
  });

  return {
    onView(view) {
      if (view !== 'converter') return;
      loadTemplates().catch((err) => setMsg(err.message, true));
      loadGroups().catch((err) => setSendMsg(err.message, true));
    },
  };
}
