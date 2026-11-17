/**
 * Etiquetas de afiliado por grupo de destino: a tag da Amazon e o sub-ID da Shopee.
 * Assim, nos relatórios de cada loja dá para ver de qual grupo veio cada venda.
 * Grupo sem etiqueta usa as etiquetas gerais do .env.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const CODE = /^[A-Za-z0-9_.-]{0,60}$/;

export function validateGroupTag({ amazonTag = '', shopeeSubId = '' } = {}) {
  const a = String(amazonTag).trim();
  const s = String(shopeeSubId).trim();
  if (!CODE.test(a)) throw Object.assign(new Error('Tag da Amazon: use só letras, números, - _ ou .'), { status: 400 });
  if (!CODE.test(s)) throw Object.assign(new Error('Sub-ID da Shopee: use só letras, números, - _ ou .'), { status: 400 });
  return { amazonTag: a, shopeeSubId: s };
}

export class GroupTagStore {
  constructor(file) {
    this.file = file;
    this.tags = {};
  }

  async load() {
    try {
      this.tags = JSON.parse(await readFile(this.file, 'utf8')).tags ?? {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.tags;
  }

  get(groupId) {
    return this.tags[groupId] ?? {};
  }

  list() {
    return this.tags;
  }

  /** Recebe { groupId: { amazonTag, shopeeSubId } }; grupo com as duas vazias sai da lista. */
  async replace(input) {
    const next = {};
    for (const [groupId, tag] of Object.entries(input ?? {})) {
      if (!groupId.endsWith('@g.us')) throw Object.assign(new Error('Grupo inválido'), { status: 400 });
      const clean = validateGroupTag(tag);
      if (clean.amazonTag || clean.shopeeSubId) next[groupId] = clean;
    }
    this.tags = next;
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ tags: this.tags }, null, 2));
    await rename(tmp, this.file);
    return this.tags;
  }
}
