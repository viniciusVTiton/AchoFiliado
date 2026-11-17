/**
 * Biblioteca de modelos de texto: os modelos prontos e os que você salvou.
 * Os prontos não são editados nem apagados; para mudar, use "Usar" e salve como outro.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TEMPLATE_FIELDS } from './template.js';

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-padrao',
    name: 'Post padrão',
    text: '{titulo}\n\n❌ {preco_antigo}\n✅ {preco}\n\nCupom: {cupom}\n\n👉 {link}',
    builtin: true,
  },
  {
    id: 'builtin-direto',
    name: 'Direto e agressivo',
    text: '🚨 {titulo}\n❌ De {preco_antigo}\n✅ Por {preco}\nCupom: {cupom}\n👉 {link}',
    builtin: true,
  },
  {
    id: 'builtin-limpo',
    name: 'Limpo',
    text: '🔥 Oferta do dia\n{titulo}\nDe {preco_antigo} por {preco}\n👉 {link}',
    builtin: true,
  },
];

const FIELD = /\{(\w+)\}/g;

function validateTemplate({ name, text }) {
  const cleanName = String(name ?? '').trim().slice(0, 60);
  const cleanText = String(text ?? '').trim().slice(0, 2000);
  if (!cleanName) throw Object.assign(new Error('Dê um nome para o modelo'), { status: 400 });
  if (!cleanText) throw Object.assign(new Error('Escreva o texto do modelo'), { status: 400 });
  for (const [, field] of cleanText.matchAll(FIELD)) {
    if (!TEMPLATE_FIELDS.includes(field)) throw Object.assign(new Error(`Campo desconhecido no modelo: {${field}}`), { status: 400 });
  }
  return { name: cleanName, text: cleanText };
}

export class TemplateStore {
  constructor(file) {
    this.file = file;
    this.saved = [];
  }

  async load() {
    try {
      this.saved = JSON.parse(await readFile(this.file, 'utf8')).templates ?? [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.saved;
  }

  list() {
    return [...BUILTIN_TEMPLATES, ...this.saved];
  }

  /** Cria (sem id) ou atualiza (com id) um modelo salvo. */
  async save({ id, name, text } = {}) {
    const clean = validateTemplate({ name, text });
    if (id) {
      const i = this.saved.findIndex((t) => t.id === id);
      if (i < 0) throw Object.assign(new Error('Modelo não encontrado'), { status: 404 });
      this.saved[i] = { ...this.saved[i], ...clean };
    } else {
      this.saved.push({ id: randomUUID(), ...clean });
    }
    await this.#persist();
    return this.list();
  }

  async remove(id) {
    if (BUILTIN_TEMPLATES.some((t) => t.id === id)) throw Object.assign(new Error('Modelo pronto não pode ser apagado'), { status: 400 });
    const before = this.saved.length;
    this.saved = this.saved.filter((t) => t.id !== id);
    if (this.saved.length === before) throw Object.assign(new Error('Modelo não encontrado'), { status: 404 });
    await this.#persist();
    return this.list();
  }

  async #persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ templates: this.saved }, null, 2));
    await rename(tmp, this.file);
  }
}
