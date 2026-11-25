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
 * Lê os produtos de uma página de lista do Mercado Livre (ex.: produtos válidos de um cupom).
 * Ignora anúncios patrocinados (links de clique) e repetidos.
 */
export function readMlListing(limit) {
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
    out.push({
      title: a.textContent.trim(),
      url,
      price: amount(card, '.poly-price__current'),
      oldPrice: amount(card, '.andes-money-amount--previous'),
      image: img?.getAttribute('data-src') || img?.src || '',
    });
    if (out.length >= limit) break;
  }
  return out;
}
