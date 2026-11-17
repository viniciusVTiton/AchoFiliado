/**
 * Regras de espelhamento salvas em um arquivo JSON (data/rules.json).
 * Simples de propósito: dá para trocar por um banco depois sem mudar quem usa.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeRule } from './engine.js';
import { validateGroupTag } from './group-tags.js';

const STORES = ['amazon', 'shopee', 'mercadolivre'];
const MODES = ['replace', 'remove'];
const IMAGE_MODES = ['off', 'original', 'always', 'link'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida e limpa uma regra vinda da API. Lança erro com mensagem em português. */
export function validateRule(input) {
  const fail = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  if (!input || typeof input !== 'object') fail('Regra inválida');

  const list = (v, name) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) fail(`"${name}" precisa ser uma lista de textos`);
    return [...new Set(v.map((x) => x.trim()))];
  };
  const text = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const rule = normalizeRule({
    id: text(input.id, 64) || randomUUID(),
    name: text(input.name, 80),
    enabled: input.enabled !== false,
    sources: list(input.sources ?? [], 'sources'),
    targets: list(input.targets ?? [], 'targets'),
    stores: list(input.stores ?? STORES, 'stores'),
    onlyStoreOffers: input.onlyStoreOffers !== false,
    testMode: input.testMode === true,
    handleMode: MODES.includes(input.handleMode) ? input.handleMode : 'remove',
    handle: text(input.handle, 40),
    siteMode: MODES.includes(input.siteMode) ? input.siteMode : 'remove',
    site: text(input.site),
    footer: text(input.footer, 500),
    schedule: null,
    replacements: [],
    textMode: input.textMode === 'template' ? 'template' : 'edit',
    template: text(input.template, 2000),
    imageMode: IMAGE_MODES.includes(input.imageMode) ? input.imageMode : input.keepImage === false ? 'off' : 'original',
    noRepeatPhoto: input.noRepeatPhoto === true,
    randomOpener: input.randomOpener !== false,
    minDiscount: null,
    amazonTag: '',
    shopeeSubId: '',
  });

  const discount = Number(String(input.minDiscount ?? '').replace(',', '.'));
  if (input.minDiscount !== '' && input.minDiscount != null) {
    if (!Number.isFinite(discount) || discount < 0 || discount > 99) fail('Desconto mínimo precisa ser de 0 a 99%');
    rule.minDiscount = discount || null;
  }
  const tags = validateGroupTag({ amazonTag: input.amazonTag, shopeeSubId: input.shopeeSubId });
  rule.amazonTag = tags.amazonTag;
  rule.shopeeSubId = tags.shopeeSubId;

  if (rule.textMode === 'template' && !rule.template) fail('Escreva o seu modelo de texto, ou volte para repetir o texto original');

  if (rule.stores.some((s) => !STORES.includes(s))) fail('Loja desconhecida em "stores"');
  if (rule.sources.some((s) => rule.targets.includes(s))) fail('Um grupo não pode ser origem e destino da mesma regra');

  if (input.schedule) {
    const { start, end } = input.schedule;
    if (!HHMM.test(start ?? '') || !HHMM.test(end ?? '')) fail('Horário precisa estar no formato HH:MM');
    rule.schedule = { start, end };
  }
  // Filtros
  const words = (v) =>
    [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []).map((w) => String(w).trim().slice(0, 60)).filter(Boolean))].slice(0, 50);
  rule.blockWords = words(input.blockWords);
  rule.requireWords = words(input.requireWords);
  rule.dropLines = words(input.dropLines);
  const price = (v, name) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) fail(`${name} inválido`);
    return n;
  };
  rule.minPrice = price(input.minPrice, 'Preço mínimo');
  rule.maxPrice = price(input.maxPrice, 'Preço máximo');
  if (rule.minPrice != null && rule.maxPrice != null && rule.minPrice > rule.maxPrice) {
    fail('O preço mínimo não pode ser maior que o máximo');
  }

  if (Array.isArray(input.replacements)) {
    rule.replacements = input.replacements
      .filter((r) => r && typeof r.from === 'string' && r.from)
      .slice(0, 50)
      .map((r) => ({ from: r.from.slice(0, 200), to: typeof r.to === 'string' ? r.to.slice(0, 200) : '' }));
  }
  return rule;
}

export class RulesStore {
  constructor(file) {
    this.file = file;
    this.rules = [];
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      this.rules = Array.isArray(data.rules) ? data.rules.map(normalizeRule) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.rules = [];
    }
    return this.rules;
  }

  list() {
    return this.rules;
  }

  /** Cria ou substitui (pelo id). */
  async save(input) {
    const rule = validateRule(input);
    const i = this.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.rules[i] = rule;
    else this.rules.push(rule);
    await this.#persist();
    return rule;
  }

  async remove(id) {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length === before) return false;
    await this.#persist();
    return true;
  }

  async #persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ rules: this.rules }, null, 2));
    await rename(tmp, this.file);
  }
}
