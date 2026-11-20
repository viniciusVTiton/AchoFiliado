/**
 * Aba Converter: você cola uma oferta e o robô devolve o texto com os SEUS links,
 * no modelo que você escolher. Não envia para grupo: só monta o texto para você copiar.
 * Tudo passa pelo robô local (roboCall), como no restante do painel.
 */
export function initConverter({ roboCall }) {
  const $ = (id) => document.getElementById(id);

  const setMsg = (text, isError = false) => {
    const box = $('cv-msg');
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
      Object.assign(document.createElement('option'), { value: '', textContent: 'Só trocar os links (texto original)' }),
      ...templates.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })),
    );
    $('cv-tpl').value = templates.some((t) => t.id === keep) ? keep : '';
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
      setMsg('');
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

  return {
    onView(view) {
      if (view !== 'converter') return;
      loadTemplates().catch((err) => setMsg(err.message, true));
    },
  };
}
