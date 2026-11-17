/**
 * Vitrine: produtos que a extensão adicionou, esperando você escolher para onde enviar.
 * Guardados em data/products.json.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORES = ['mercadolivre', 'shopee', 'amazon'];
// Fotos só de servidores de imagem das lojas (o servidor baixa a foto na hora de enviar).
const IMAGE_HOSTS = /(^|\.)(mlstatic\.com|susercontent\.com|media-amazon\.com|ssl-images-amazon\.com)$/i;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function httpsUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

export function isAllowedImage(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && IMAGE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export function validateProduct(input) {
  const fail = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  if (!input || typeof input !== 'object') fail('Produto inválido');
  const product = {
    id: randomUUID(),
    addedAt: new Date().toISOString(),
    store: STORES.includes(input.store) ? input.store : 'mercadolivre',
    title: text(input.title, 200),
    price: text(input.price, 30),
    oldPrice: text(input.oldPrice, 30),
    url: httpsUrl(input.url),
    affiliateUrl: httpsUrl(input.affiliateUrl),
    image: isAllowedImage(input.image) ? input.image : '',
    sentTo: [],
  };
  if (!product.title) fail('Produto sem nome');
  if (!product.affiliateUrl) fail('Produto sem link de afiliado');
  return product;
}

/** Texto padrão da oferta, que você pode editar antes de enviar. */
export function defaultText(p) {
  const lines = [`🔥 ${p.title}`];
  if (p.price) lines.push(p.oldPrice ? `💰 De ~R$ ${p.oldPrice}~ por *R$ ${p.price}*` : `💰 *R$ ${p.price}*`);
  lines.push('', `🛒 ${p.affiliateUrl}`);
  return lines.join('\n');
}

export class ProductStore {
  constructor(file) {
    this.file = file;
    this.items = [];
  }

  async load() {
    try {
      this.items = JSON.parse(await readFile(this.file, 'utf8')).items ?? [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.items = [];
    }
    return this.items;
  }

  list() {
    return this.items;
  }

  get(id) {
    return this.items.find((p) => p.id === id);
  }

  async add(input) {
    const product = validateProduct(input);
    // Mesmo produto adicionado de novo: atualiza em vez de duplicar.
    const i = this.items.findIndex((p) => p.affiliateUrl === product.affiliateUrl || (product.url && p.url === product.url));
    if (i >= 0) this.items[i] = { ...this.items[i], ...product, id: this.items[i].id, sentTo: this.items[i].sentTo };
    else this.items.unshift(product);
    this.items = this.items.slice(0, 300);
    await this.#persist();
    return i >= 0 ? this.items[i] : product;
  }

  async markSent(id, targets) {
    const p = this.get(id);
    if (!p) return;
    p.sentTo = [...new Set([...(p.sentTo ?? []), ...targets])];
    p.lastSentAt = new Date().toISOString();
    await this.#persist();
  }

  async remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((p) => p.id !== id);
    if (this.items.length !== before) await this.#persist();
    return this.items.length !== before;
  }

  async #persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ items: this.items }, null, 2));
    await rename(tmp, this.file);
  }
}

/** Baixa a foto do produto para enviar junto (limite de 5 MB). */
export async function downloadImage(url, { fetch: fetchImpl = fetch } = {}) {
  if (!isAllowedImage(url)) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= 5 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}
