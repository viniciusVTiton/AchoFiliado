/**
 * Nome do produto para o modelo, quando a mensagem de origem não traz o título.
 * Só acessa páginas de loja conhecidas, como os links curtos: nunca outro site.
 */
import { detectStore } from '../links/detect.js';
import { resolveShortLink } from './resolve.js';
import { productFromSocialHtml } from './ml-bridge.js';

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const ENTITIES = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#x27': "'" };
const decode = (s) => s.replace(/&(amp|quot|lt|gt|nbsp|#39|#x27);/g, (_, e) => ENTITIES[e]);
const SUFFIX = /\s*[|–—-]\s*(Mercado\s*Livre|Amazon(\.com\.br)?|Shopee).*$/i;

export function titleFromHtml(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (!m) return null;
  return decode(m[1]).replace(SUFFIX, '').trim() || null;
}

export function imageFromHtml(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? decode(m[1]).trim() : null;
}

/** Mercado Livre: o endereço do produto traz o nome, ex.: /impressora-3d-ender-3/p/MLB123. */
export function titleFromMlPath(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('p');
  if (i < 1) return null;
  const words = decodeURIComponent(parts[i - 1]).replace(/-/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

async function fetchHtml(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'pt-BR' },
    signal: AbortSignal.timeout(10_000),
  });
  return res.text();
}

/**
 * @param {string} url  link de loja (curto ou direto) de quem postou a oferta
 * @returns {Promise<string|null>}
 */
export async function productInfo(url, { fetch: fetchImpl = fetch } = {}) {
  if (!detectStore(url)) return { title: null, image: null };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;

  let info = { title: null, image: null };
  try {
    const final = (await resolveShortLink(url, { fetch: fetchImpl })) ?? url;
    let product = final;
    if (new URL(final).pathname.startsWith('/social/')) {
      product = productFromSocialHtml(await fetchHtml(final, fetchImpl));
    }
    if (product && detectStore(product)) {
      const html = await fetchHtml(product, fetchImpl);
      info = { title: titleFromHtml(html) ?? titleFromMlPath(product), image: imageFromHtml(html) };
    }
  } catch {
    info = { title: null, image: null };
  }
  if (info.title) cache.set(url, { info, at: Date.now() });
  return info;
}

export async function productTitle(url, opts) {
  return (await productInfo(url, opts)).title;
}
