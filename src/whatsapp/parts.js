/**
 * Partes do conector que não dependem do WhatsApp (testáveis sozinhas).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Lê o texto de uma mensagem já "desembrulhada" (normalizeMessageContent).
 * @returns {{ text: string, kind: 'text'|'image'|'video' } | null}
 */
export function readContent(content) {
  if (!content) return null;
  if (content.conversation) return { text: content.conversation, kind: 'text' };
  if (content.extendedTextMessage?.text) return { text: content.extendedTextMessage.text, kind: 'text' };
  if (content.imageMessage) return { text: content.imageMessage.caption ?? '', kind: 'image' };
  if (content.videoMessage) return { text: content.videoMessage.caption ?? '', kind: 'video' };
  return null;
}

/**
 * Fila de envio: manda uma mensagem por vez, com pausa aleatória entre elas.
 * Disparos em rajada são o que mais chama atenção do WhatsApp.
 */
export class SendQueue {
  constructor({ send, minDelayMs = 4000, maxDelayMs = 9000, sleep, random = Math.random, onError } = {}) {
    this.sendFn = send;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = random;
    this.onError = onError ?? (() => {});
    this.items = [];
    this.running = null;
    this.sentOnce = false;
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    if (!this.running) this.running = this.#drain().finally(() => (this.running = null));
    return this.running;
  }

  async #drain() {
    while (this.items.length) {
      const item = this.items.shift();
      if (this.sentOnce) {
        const span = Math.max(0, this.maxDelayMs - this.minDelayMs);
        await this.sleep(this.minDelayMs + Math.round(this.random() * span));
      }
      try {
        await this.sendFn(item);
      } catch (error) {
        this.onError(error, item);
      }
      this.sentOnce = true;
    }
  }
}

/** Histórico do que aconteceu: mostra os mais recentes na página e guarda mais em disco. */
export class ActivityLog {
  constructor(limit = 50, { file, keep = 5000 } = {}) {
    this.limit = limit;
    this.file = file;
    this.keep = keep;
    this.items = [];
  }

  async load() {
    if (!this.file) return;
    try {
      this.items = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  add(entry) {
    this.items.unshift({ at: new Date().toISOString(), ...entry });
    if (this.items.length > this.keep) this.items.length = this.keep;
    this.#save();
  }

  list() {
    return this.items.slice(0, this.limit);
  }

  /** Contagem de hoje (dia local) por tipo. */
  summary(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const counts = { sent: 0, skipped: 0, received: 0, error: 0 };
    const byGroup = {};
    for (const item of this.items) {
      if (new Date(item.at) < start) break;
      if (item.type in counts) counts[item.type]++;
      if (item.type === 'sent' && item.group) byGroup[item.group] = (byGroup[item.group] ?? 0) + 1;
    }
    return { day: start.toLocaleDateString('pt-BR'), ...counts, byGroup };
  }

  #save() {
    if (!this.file) return;
    mkdir(dirname(this.file), { recursive: true })
      .then(() => writeFile(this.file, JSON.stringify(this.items)))
      .catch((error) => console.warn('Não consegui salvar o histórico:', error.message));
  }
}
