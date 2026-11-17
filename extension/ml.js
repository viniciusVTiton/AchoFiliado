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
