/**
 * Memória de ofertas já enviadas, por grupo de destino, com validade.
 * Evita mandar a mesma oferta duas vezes no mesmo grupo quando ela aparece em várias origens.
 * Em memória por enquanto; a interface permite trocar por Redis/Postgres depois.
 */
export class SeenStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  #key(target, fingerprint) {
    return `${target}\u0000${fingerprint}`;
  }

  has(target, fingerprint) {
    const key = this.#key(target, fingerprint);
    const expires = this.entries.get(key);
    if (expires === undefined) return false;
    if (expires <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(target, fingerprint) {
    this.entries.set(this.#key(target, fingerprint), this.now() + this.ttlMs);
  }
}

/**
 * Identidade de uma oferta: os produtos (lojas + código do produto) e, se houver, a mídia.
 * Ignora o texto, que costuma mudar entre grupos.
 */
export function fingerprint({ productKeys = [], mediaHash = '' }) {
  const parts = [...new Set(productKeys)].sort();
  if (mediaHash) parts.push(`media:${mediaHash}`);
  return parts.join('|');
}

/** Código estável do produto a partir da URL original (antes da conversão). */
export function productKey(url, store) {
  try {
    const u = new URL(url);
    if (store === 'amazon') {
      const asin = u.pathname.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
      if (asin) return `amazon:${asin[1].toUpperCase()}`;
    }
    if (store === 'shopee') {
      const ids = u.pathname.match(/i\.(\d+)\.(\d+)/) ?? u.pathname.match(/product\/(\d+)\/(\d+)/);
      if (ids) return `shopee:${ids[1]}.${ids[2]}`;
    }
    if (store === 'mercadolivre') {
      const mlb = (u.pathname + u.search).match(/MLB-?(\d+)/i);
      if (mlb) return `ml:MLB${mlb[1]}`;
    }
    return `${store}:${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return `${store}:${url}`;
  }
}
