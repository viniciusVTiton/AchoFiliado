/**
 * Ponte com a extensão do Chrome para o Mercado Livre.
 *
 * O servidor NÃO tem a sessão do Mercado Livre. Quando precisa de um link de afiliado,
 * coloca um pedido na fila; a extensão (no Chrome onde você está logado) busca o pedido,
 * gera o link na sua conta e devolve só o link curto. A sessão nunca sai do Chrome.
 */
import { randomUUID } from 'node:crypto';

export class MlBridge {
  constructor({ timeoutMs = 30_000, onlineWindowMs = 75_000, now = Date.now } = {}) {
    this.timeoutMs = timeoutMs;
    this.onlineWindowMs = onlineWindowMs;
    this.now = now;
    this.pending = []; // pedidos ainda não entregues à extensão
    this.waiting = new Map(); // id -> { resolve, timer }
    this.pollers = []; // extensões esperando pedido (long-poll)
    this.lastSeen = 0;
    this.lastError = null;
    this.extensionInfo = null;
  }

  /** A extensão apareceu nos últimos segundos? */
  online() {
    return this.now() - this.lastSeen < this.onlineWindowMs;
  }

  status() {
    return { online: this.online(), lastSeen: this.lastSeen || null, lastError: this.lastError, extension: this.extensionInfo };
  }

  /** Pede um link de afiliado para a URL do produto. */
  request(url) {
    if (!this.online()) {
      return Promise.resolve({ status: 'needs_provider', reason: 'Extensão do Mercado Livre desconectada (Chrome fechado?)' });
    }
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        this.pending = this.pending.filter((j) => j.id !== id);
        resolve({ status: 'unsupported', reason: 'A extensão do Mercado Livre não respondeu a tempo' });
      }, this.timeoutMs);
      this.waiting.set(id, { resolve, timer });
      const job = { id, url };
      const poller = this.pollers.shift();
      if (poller) poller(job);
      else this.pending.push(job);
    });
  }

  /** Long-poll da extensão: devolve um pedido ou null depois de `waitMs`. */
  next({ waitMs = 25_000, info } = {}) {
    this.lastSeen = this.now();
    if (info) this.extensionInfo = info;
    const job = this.pending.shift();
    if (job) return Promise.resolve(job);
    return new Promise((resolve) => {
      const poller = (j) => {
        clearTimeout(timer);
        resolve(j);
      };
      const timer = setTimeout(() => {
        this.pollers = this.pollers.filter((p) => p !== poller);
        this.lastSeen = this.now();
        resolve(null);
      }, waitMs);
      this.pollers.push(poller);
    });
  }

  /** A extensão devolve o resultado de um pedido. */
  result({ id, shortUrl, error }) {
    this.lastSeen = this.now();
    const entry = this.waiting.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.waiting.delete(id);
    if (shortUrl && /^https:\/\/(meli\.la|mercadolivre\.com|www\.mercadolivre\.com\.br)\//.test(shortUrl)) {
      this.lastError = null;
      entry.resolve({ status: 'ok', url: shortUrl });
    } else {
      this.lastError = error || 'Resposta inválida da extensão';
      entry.resolve({ status: 'unsupported', reason: `Mercado Livre: ${this.lastError}` });
    }
    return true;
  }
}

/* ---------- Descobrir o produto ---------- */

const PRODUCT_RE =
  /https:\/\/(?:www\.mercadolivre\.com\.br\/[^"'\s\\<>]*\/p\/MLB\d+|(?:produto|articulo)\.mercadolivre\.com\.br\/MLB-\d+[^"'\s\\<>?#]*)/;

/** Deixa só o endereço do produto (sem rastreio de outro afiliado). */
export function cleanMlProductUrl(url) {
  const u = new URL(url);
  return `https://${u.hostname}${u.pathname}`;
}

/**
 * Link de afiliado de outra pessoa abre a página de perfil dela (/social/...), com o
 * produto em destaque. O primeiro produto da página é o da oferta.
 */
export function productFromSocialHtml(html) {
  const m = html.match(PRODUCT_RE);
  return m ? cleanMlProductUrl(m[0].replace(/&amp;/g, '&')) : null;
}

/**
 * Provider no formato de converters.js.
 * @param {MlBridge} bridge
 * @param {{ fetch?: typeof fetch }} [opts]
 */
export function createMlProvider(bridge, { fetch: fetchImpl = fetch } = {}) {
  return async function mercadoLivreProvider(url) {
    let product;
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/social/')) {
        const res = await fetchImpl(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'pt-BR' },
          signal: AbortSignal.timeout(10_000),
        });
        product = productFromSocialHtml(await res.text());
        if (!product) return { status: 'unsupported', reason: 'Não achei o produto no link do Mercado Livre' };
      } else if (PRODUCT_RE.test(url) || /MLB-?\d+/i.test(u.pathname)) {
        product = cleanMlProductUrl(url);
      } else {
        return { status: 'unsupported', reason: 'Link do Mercado Livre não é de um produto' };
      }
    } catch {
      return { status: 'unsupported', reason: 'Não consegui abrir o link do Mercado Livre' };
    }
    return bridge.request(product);
  };
}
