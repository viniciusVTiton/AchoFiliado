/**
 * Funções que rodam DENTRO de uma página do Mercado Livre (chrome.scripting, mundo MAIN).
 * Precisam ser autocontidas: o Chrome copia só o corpo da função para a página.
 * A sessão e a chave de segurança são usadas ali mesmo e nunca saem do Chrome.
 */

/** Gera o link de afiliado pelo mesmo endereço que o "Gerador de links" do painel usa. */
export async function mlCreateLink(productUrl, tag) {
  // Captura a chave de segurança que a própria página usa nos pedidos dela.
  if (!window.__achoHook) {
    window.__achoHook = true;
    const setHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (/csrf/i.test(k)) window.__achoCsrf = v;
      return setHeader.apply(this, arguments);
    };
    const pageFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        for (const [k, v] of new Headers(init?.headers)) if (/csrf/i.test(k)) window.__achoCsrf = v;
      } catch {}
      return pageFetch.apply(this, arguments);
    };
  }
  const findToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"], meta[name="x-csrf-token"]');
    if (meta?.content) return meta.content;
    const cookie = document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/);
    if (cookie) return decodeURIComponent(cookie[1]);
    const inPage = document.documentElement.innerHTML.match(/["']?csrf[-_]?token["']?\s*[:=]\s*["']([^"']{16,})["']/i);
    if (inPage) return inPage[1];
    return window.__achoCsrf || null;
  };

  let token = findToken();
  for (let i = 0; i < 20 && !token; i++) {
    await new Promise((r) => setTimeout(r, 500));
    token = findToken();
  }
  if (!token) return { error: 'Não achei a chave de segurança da página. Recarregue o Mercado Livre ou faça login.' };

  let res;
  try {
    res = await fetch('/affiliate-program/api/v2/affiliates/linkbuilder/createLink', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ urls: [productUrl], tag }),
    });
  } catch {
    return { error: 'Sem conexão com o Mercado Livre' };
  }
  if (res.status === 401 || res.status === 403) return { error: 'O Mercado Livre pediu login de novo' };
  const data = await res.json().catch(() => null);
  const item = data?.urls?.[0];
  if (!item?.short_url) return { error: item?.error?.message ?? item?.message ?? data?.message ?? `Erro ${res.status} do Mercado Livre` };
  return { shortUrl: item.short_url, title: item.title ?? '' };
}

/** Lê nome, preço e foto do produto aberto na tela. */
export function readMlProduct() {
  const og = (p) => document.querySelector(`meta[property="og:${p}"]`)?.content ?? '';
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
  const fraction = (root) => {
    const el = document.querySelector(root);
    if (!el) return '';
    const f = el.querySelector('.andes-money-amount__fraction')?.textContent?.trim() ?? '';
    const c = el.querySelector('.andes-money-amount__cents')?.textContent?.trim() ?? '';
    return f ? (c ? `${f},${c}` : f) : '';
  };
  const isProduct = /\/p\/MLB\d+|MLB-?\d{6,}/i.test(location.href);
  return {
    isProduct,
    title: txt('h1.ui-pdp-title') || og('title'),
    price: fraction('.ui-pdp-price__second-line') || fraction('.ui-pdp-price'),
    oldPrice: fraction('.ui-pdp-price__original-value'),
    image: og('image'),
    url: location.origin + location.pathname,
  };
}

/**
 * Roda na página https://www.mercadolivre.com.br/cupons (mundo MAIN).
 * 1) Coloca na sua conta os códigos pedidos (o mesmo que "Inserir código").
 * 2) Lê os seus cupons ativos: desconto, compra mínima, limite, validade e os produtos válidos.
 * Precisa ser autocontida: o Chrome copia só o corpo da função para a página.
 */
export async function mlSyncCoupons(codes) {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!token) return { error: 'Não achei a chave de segurança da página de cupons. Faça login no Mercado Livre.' };

  // A lista de cupons ativos vem como JSON dentro do HTML da página ("_n.ctx.r={...}").
  async function readActive() {
    const html = await fetch('/cupons/filter?status=active', { credentials: 'include' }).then((r) => r.text());
    const at = html.indexOf('_n.ctx.r=');
    if (at < 0) return null;
    const start = html.indexOf('{', at);
    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (ch === '"') {
        i++;
        while (i < html.length && html[i] !== '"') {
          if (html[i] === '\\') i++;
          i++;
        }
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    let state;
    try {
      state = JSON.parse(html.slice(start, end + 1));
    } catch {
      return null;
    }
    const list = state?.appProps?.pageProps?.filteredCouponsData?.coupons ?? [];
    return list.map((c) => ({
      code: String(c.code || c.inputCode || '').toUpperCase(),
      campaignId: String(c.campaignId ?? ''),
      title: c.title?.text ?? '',
      min: c.amount?.minAmount ?? '',
      cap: c.amount?.capAmount ?? '',
      expiresAt: c.futureCouponInfo?.expiration_date ?? '',
      expiresText: c.expirationDate?.text ?? '',
      productsUrl: c.action?.type === 'link' ? c.action?.value ?? '' : '',
      items: (c.items ?? []).slice(0, 6).map((it) => ({ title: it.altText ?? '', image: it.imageUrl ?? '' })),
      status: c.status?.id ?? '',
    }));
  }

  let coupons = await readActive();
  if (!coupons) return { error: 'Não consegui ler a lista de cupons (a página mudou?)' };

  // Só coloca na conta os códigos que ainda não estão ativos (o mesmo que "Inserir código").
  const have = new Set(coupons.map((c) => c.code));
  const inserted = [];
  for (const code of (codes ?? []).filter((c) => !have.has(String(c).toUpperCase()))) {
    try {
      const res = await fetch('/cupons/api/input-code', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ coupon_input_code: code }),
      });
      const data = await res.json().catch(() => null);
      const msg = data?.responseMessage ?? {};
      inserted.push({ code, ok: res.ok && msg.type !== 'error', message: String(msg.text ?? '').slice(0, 160) });
    } catch {
      inserted.push({ code, ok: false, message: 'Sem conexão com o Mercado Livre' });
    }
  }
  if (inserted.some((r) => r.ok)) coupons = (await readActive()) ?? coupons;
  return { inserted, coupons };
}

/**
 * Roda em https://myaccount.mercadolivre.com.br (mundo MAIN), com a sua sessão.
 * Cria uma "Lista de afiliados", coloca os anúncios nela e publica no seu perfil, devolvendo o link da lista
 * (o link já leva a sua identificação de afiliado). Mesmo caminho que a página "Favoritos > Listas" usa.
 */
export async function mlCreateAffiliateList(name, itemIds) {
  const api = '/gz/navigation/api';
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) };
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, credentials: 'include', headers, signal: AbortSignal.timeout(20_000), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401 || res.status === 403) throw new Error('O Mercado Livre pediu login de novo');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.component?.message || data?.message || `Erro ${res.status} do Mercado Livre`);
    return data;
  };
  const allLists = async () => (await call('GET', '/wishlist/lists/all'))?.lists ?? [];

  try {
    const existing = await allLists();
    const before = new Set(existing.map((l) => l.id));
    const names = new Set(existing.map((l) => String(l.name).toLowerCase()));
    // O Mercado Livre aceita no máximo 25 letras e não deixa repetir nome: se já existir, vira "... 2", "... 3".
    const base = String(name).slice(0, 25).trim();
    let finalName = base;
    for (let n = 2; names.has(finalName.toLowerCase()) && n < 100; n++) {
      const suffix = ` ${n}`;
      finalName = base.slice(0, 25 - suffix.length).trim() + suffix;
    }
    const created = await call('POST', '/wishlist/list/create', { name: finalName, description: '', type: 'AFFILIATE', icon: '' });
    if (created?.error) {
      const why = created.error.internal_code === '1001' ? 'já existe uma lista com esse nome'
        : /25 characters/i.test(created.error.message ?? '') ? 'o nome passa de 25 letras'
        : created?.component?.message || created.error.message || '';
      throw new Error(`O Mercado Livre não criou a lista "${finalName}": ${why}`);
    }
    const list = (await allLists()).find((l) => !before.has(l.id) && l.type === 'AFFILIATE');
    if (!list) throw new Error('A lista foi pedida, mas não apareceu em Favoritos > Listas');

    let added = 0;
    const failed = [];
    for (const id of itemIds) {
      try {
        await call('POST', `/wishlist/lists/${list.id}/elements/add`, { entity_id: id, entity_type: 'item', platform: 'marketplace', platform_id: 1, list_id: list.id });
        added++;
      } catch (e) {
        failed.push({ id, error: e.message });
      }
    }
    if (!added) return { error: 'Nenhum produto entrou na lista', listId: list.id, failed };
    // "Compartilhar": publica a lista no seu perfil e devolve o link com a sua identificação de afiliado.
    const share = await call('GET', `/wishlist/affiliate/share/${list.id}`);
    const url = share?.metadata?.affiliate?.url_attribution_list_detail ?? '';
    if (!url) return { error: 'A lista foi criada, mas o Mercado Livre não devolveu o link', listId: list.id, added, failed };
    return { listId: list.id, url, added, failed };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Roda em https://myaccount.mercadolivre.com.br (mundo MAIN): mexe nas suas listas de afiliado.
 *   lists                      → as suas listas de afiliado
 *   items   {listId}           → os produtos de uma lista
 *   add     {listId, itemIds}  → coloca anúncios (MLB…) na lista
 *   remove  {bookmarkIds}      → tira produtos da lista
 *   rename  {listId, name}     → muda o nome (até 25 letras)
 *   delete  {listId}           → exclui a lista
 *   share   {listId}           → publica no seu perfil e devolve o link (com a sua identificação de afiliado)
 */
export async function mlListOps(op, a = {}) {
  const api = '/gz/navigation/api';
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) };
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, credentials: 'include', headers, signal: AbortSignal.timeout(20_000), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401 || res.status === 403) throw new Error('O Mercado Livre pediu login de novo');
    const data = await res.json().catch(() => null);
    const err = data?.error;
    if (!res.ok || err) {
      const why = err?.internal_code === '1001' ? 'já existe uma lista com esse nome'
        : /25 characters/i.test(err?.message ?? '') ? 'o nome passa de 25 letras'
        : data?.component?.message || err?.message || `erro ${res.status}`;
      throw new Error(`O Mercado Livre recusou: ${why}`);
    }
    return data;
  };
  const brl = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  try {
    if (op === 'lists') {
      // O Mercado Livre devolve no máximo 32 por vez.
      const all = [];
      for (let offset = 0; offset < 320; offset += 32) {
        const d = await call('GET', `/wishlist/lists/all?offset=${offset}&limit=32`);
        all.push(...(d?.lists ?? []));
        if (!d?.lists?.length || offset + 32 >= (d?.paging?.total ?? 0)) break;
      }
      return {
        lists: all.filter((l) => l.type === 'AFFILIATE').map((l) => ({
          id: l.id,
          name: l.name,
          privacy: l.privacy,
          total: l.elements?.total ?? 0,
          images: (l.elements?.images ?? []).slice(0, 4),
          main: l.subtype === 'RECOMMENDATIONS' || /minhas recomenda/i.test(l.name ?? ''),
        })),
      };
    }
    if (op === 'items') {
      const items = [];
      for (let offset = 0; offset < 600; offset += 32) {
        const d = await call('GET', `/wishlist/list/details/${encodeURIComponent(a.listId)}?offset=${offset}&limit=32`);
        const cards = d?.list?.elements?.polycards ?? [];
        for (const c of cards) {
          const m = c.metadata ?? {};
          const comp = (t) => (c.components ?? []).find((x) => x.type === t);
          const price = comp('price')?.price ?? {};
          const pic = c.pictures?.pictures?.[0]?.id;
          items.push({
            bookmarkId: m.bookmarks_id,
            itemId: m.id,
            title: comp('title')?.title?.text ?? '',
            price: brl(price.current_price?.value),
            oldPrice: brl(price.previous_price?.value),
            image: pic ? `https://http2.mlstatic.com/D_Q_NP_2X_${pic}-V.webp` : '',
            url: m.url ? `https://${String(m.url).replace(/^https?:\/\//, '')}` : '',
          });
        }
        const total = d?.paging?.total ?? 0;
        if (!cards.length || offset + 32 >= total) {
          return { name: d?.list?.name ?? '', total, items };
        }
      }
      return { items };
    }
    if (op === 'add') {
      let added = 0;
      const failed = [];
      for (const id of a.itemIds ?? []) {
        try {
          await call('POST', `/wishlist/lists/${a.listId}/elements/add`, { entity_id: id, entity_type: 'item', platform: 'marketplace', platform_id: 1, list_id: a.listId });
          added++;
        } catch (e) {
          failed.push({ id, error: e.message });
        }
      }
      return { added, failed };
    }
    if (op === 'remove') {
      let removed = 0;
      const failed = [];
      for (const id of a.bookmarkIds ?? []) {
        try {
          await call('DELETE', `/wishlist/elements/delete/${encodeURIComponent(id)}`, {});
          removed++;
        } catch (e) {
          failed.push({ id, error: e.message });
        }
      }
      return { removed, failed };
    }
    if (op === 'rename') {
      await call('PUT', '/wishlist/list/edit', { id: a.listId, name: String(a.name).slice(0, 25).trim(), type: 'AFFILIATE', description: '' });
      return { ok: true };
    }
    if (op === 'delete') {
      await call('DELETE', `/wishlist/list/delete/${encodeURIComponent(a.listId)}?from=list_hub`, {});
      return { ok: true };
    }
    if (op === 'share') {
      const share = await call('GET', `/wishlist/affiliate/share/${encodeURIComponent(a.listId)}`);
      const url = share?.metadata?.affiliate?.url_attribution_list_detail ?? '';
      return url ? { url } : { error: 'O Mercado Livre não devolveu o link da lista' };
    }
    return { error: `Operação desconhecida: ${op}` };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Lê os produtos de uma página de lista do Mercado Livre (ex.: produtos válidos de um cupom).
 * Ignora anúncios patrocinados (links de clique) e repetidos.
 */
export async function readMlListing(limit) {
  // Em aba de segundo plano a página pode ainda estar montando: espera os produtos aparecerem (até 12 s).
  for (let i = 0; i < 24; i++) {
    if (/captcha|verification/i.test(location.pathname)) break;
    if (document.querySelector('.poly-card') || /não encontramos|nenhum resultado/i.test(document.body?.innerText ?? '')) break;
    // Só vale o dado do produto ("polycard":{…), não o nome de arquivo "search.card.polycard.js".
    if ([...document.scripts].some((s) => !s.src && /\\?"polycard\\?":\{/.test(s.textContent))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // O Mercado Livre às vezes pede uma verificação de segurança: quem resolve é você, no Chrome.
  if (/captcha|verification/i.test(location.pathname)) return { blocked: true };
  const seen = new Set();
  const out = [];
  const amount = (root, sel) => {
    const el = root.querySelector(sel);
    if (!el) return '';
    const f = el.querySelector('.andes-money-amount__fraction')?.textContent?.trim() ?? '';
    const c = el.querySelector('.andes-money-amount__cents')?.textContent?.trim() ?? '';
    return f ? (c ? `${f},${c}` : f) : '';
  };
  for (const card of document.querySelectorAll('.poly-card')) {
    const a = card.querySelector('a.poly-component__title') ?? card.querySelector('a[href]');
    if (!a) continue;
    const url = a.href.split('#')[0].split('?')[0];
    if (!/^https:\/\/(www|produto)\.mercadolivre\.com\.br\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    const img = card.querySelector('img');
    // Código do anúncio (MLB…): é o que entra numa lista de afiliado. Vem no "wid" do link ou no próprio endereço.
    const itemId = (a.href.match(/[#?&]wid=(MLB\d+)/i)?.[1] ?? url.match(/MLB-?(\d{6,})/i)?.[0] ?? '').replace('-', '').toUpperCase();
    out.push({
      title: a.textContent.trim(),
      url,
      itemId: /\/p\/MLB/i.test(url) && !a.href.includes('wid=') ? '' : itemId,
      price: amount(card, '.poly-price__current'),
      oldPrice: amount(card, '.andes-money-amount--previous'),
      image: img?.getAttribute('data-src') || img?.src || '',
    });
    if (out.length >= limit) break;
  }
  // Aba em segundo plano: o Mercado Livre não desenha os cartões, mas os produtos vêm nos dados da página.
  if (!out.length) {
    const data = [...document.scripts].filter((s) => !s.src && s.textContent.includes('polycard')).map((s) => s.textContent).join('\n')
      .replace(/\\"/g, '"').replace(/\\u002F/gi, '/');
    for (const chunk of data.split('"polycard":{').slice(1)) {
      const itemId = chunk.match(/"metadata":\{"id":"(MLB\d+)"/)?.[1] ?? '';
      const path = chunk.match(/"url":"((?:www|produto)\.mercadolivre\.com\.br\/[^"]+)"/)?.[1] ?? '';
      if (!itemId || !path) continue;
      const url = `https://${path}`.split('#')[0].split('?')[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const money = (v) => (v ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }) : '');
      out.push({
        title: chunk.match(/"title":\{"text":"([^"]+)"/)?.[1] ?? '',
        url,
        itemId,
        price: money(chunk.match(/"current_price":\{"value":([\d.]+)/)?.[1]),
        oldPrice: money(chunk.match(/"previous_price":\{"value":([\d.]+)/)?.[1]),
        image: '',
      });
      if (out.length >= limit) break;
    }
  }
  // Nada achado: devolve o que a página mostrava, para entender o motivo.
  if (!out.length) {
    return { empty: true, noResults: /não encontramos|nenhum resultado/i.test(document.body?.innerText ?? ''), page: location.host + location.pathname, title: document.title.slice(0, 80), cards: document.querySelectorAll('.poly-card').length, links: document.querySelectorAll('a[href]').length, text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200) };
  }
  return out;
}
