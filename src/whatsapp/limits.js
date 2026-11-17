/**
 * Limites contra bloqueio: quantos posts o número extra pode fazer
 * por grupo (por hora e por dia) e no total (por hora).
 * Posts acima do limite são pulados, com o motivo no histórico.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEFAULT_LIMITS = { perGroupHour: 8, perGroupDay: 80, totalHour: 30 };

export function validateLimits(input = {}) {
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_LIMITS)) {
    const n = Number(input[key] ?? def);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      throw Object.assign(new Error('Os limites precisam ser números inteiros entre 1 e 1000'), { status: 400 });
    }
    out[key] = n;
  }
  if (out.perGroupHour > out.perGroupDay) {
    throw Object.assign(new Error('O limite por hora não pode ser maior que o limite por dia'), { status: 400 });
  }
  return out;
}

export class RateLimiter {
  constructor({ limits = DEFAULT_LIMITS, now = Date.now, file = null } = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
    this.file = file;
    this.sent = new Map(); // grupo -> [horários]
    this.saveTimer = null;
  }

  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.limits) this.limits = validateLimits(data.limits);
      for (const [target, times] of Object.entries(data.sent ?? {})) this.sent.set(target, times);
      this.#prune();
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Limites ilegíveis, usando o padrão:', error.message);
    }
  }

  #prune() {
    const cutoff = this.now() - DAY;
    for (const [target, times] of this.sent) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) this.sent.set(target, kept);
      else this.sent.delete(target);
    }
  }

  #count(target, windowMs) {
    const cutoff = this.now() - windowMs;
    return (this.sent.get(target) ?? []).filter((t) => t > cutoff).length;
  }

  #total(windowMs) {
    let n = 0;
    for (const target of this.sent.keys()) n += this.#count(target, windowMs);
    return n;
  }

  /** Motivo do bloqueio, ou null se pode postar. */
  check(target) {
    const { perGroupHour, perGroupDay, totalHour } = this.limits;
    if (this.#total(HOUR) >= totalHour) return `Limite de ${totalHour} posts por hora no total atingido`;
    if (this.#count(target, HOUR) >= perGroupHour) return `Limite de ${perGroupHour} posts por hora neste grupo atingido`;
    if (this.#count(target, DAY) >= perGroupDay) return `Limite de ${perGroupDay} posts por dia neste grupo atingido`;
    return null;
  }

  record(target) {
    const times = this.sent.get(target) ?? [];
    times.push(this.now());
    this.sent.set(target, times);
    this.#scheduleSave();
  }

  async setLimits(input) {
    this.limits = validateLimits(input);
    await this.flush();
    return this.limits;
  }

  usage() {
    const groups = {};
    for (const target of this.sent.keys()) groups[target] = { hour: this.#count(target, HOUR), day: this.#count(target, DAY) };
    return { limits: this.limits, totalHour: this.#total(HOUR), groups };
  }

  #scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush().catch((e) => console.error('Falha ao salvar limites:', e.message)), 2000);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    this.#prune();
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ limits: this.limits, sent: Object.fromEntries(this.sent) }));
    await rename(tmp, this.file);
  }
}
