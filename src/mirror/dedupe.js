import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Memória de ofertas já enviadas, por grupo de destino, com validade.
 * Evita mandar a mesma oferta duas vezes no mesmo grupo quando ela aparece em várias origens.
 * Com `file`, fica salva em disco: reiniciar o robô não faz repetir ofertas.
 */
export class SeenStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, now = Date.now, file = null, saveDelayMs = 2000 } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.entries = new Map();
    this.saveTimer = null;
    this.saving = Promise.resolve();
  }

  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      const now = this.now();
      for (const [key, expires] of data.entries ?? []) if (expires > now) this.entries.set(key, expires);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Memória de ofertas ilegível, começando vazia:', error.message);
    }
  }

  /** Grava agora (usado nos testes e ao desligar). */
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return Promise.resolve();
    const now = this.now();
    const entries = [...this.entries].filter(([, exp]) => exp > now);
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify({ entries }));
      await rename(tmp, this.file);
    });
    return this.saving;
  }

  #scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush().catch((e) => console.error('Falha ao salvar memória de ofertas:', e.message)), this.saveDelayMs);
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
    this.#scheduleSave();
  }
}

/**
 * Identidade de uma oferta: os produtos (lojas + código do produto) e, se houver, a mídia.
 * Ignora o texto, que costuma mudar entre grupos.
 */
export function fingerprint({ productKeys = [], mediaHash = '' }) {
  const parts = [...new Set(productKeys)].sort();
  // A foto só identifica a oferta quando não há produto: grupos diferentes usam fotos diferentes do mesmo item.
  if (mediaHash && !parts.length) parts.push(`media:${mediaHash}`);
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
