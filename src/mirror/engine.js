/**
 * Motor de espelhamento.
 *
 * Recebe uma mensagem de um grupo de origem e decide, para cada grupo de destino,
 * se ela deve ser reenviada e com qual texto. Não sabe nada de WhatsApp: quem chama
 * entrega a mensagem e executa os envios devolvidos.
 *
 * Regra de segurança: se um link de loja não puder ser convertido, a oferta NÃO é enviada,
 * para nunca postar o link de afiliado de outra pessoa nos seus grupos.
 */
import { detectStore } from '../links/detect.js';
import { extractLinks } from '../links/extract.js';
import { convertMessage } from '../links/index.js';
import { cleanMessage, tidy } from './clean.js';
import { fingerprint, productKey } from './dedupe.js';

export const DEFAULT_RULE = {
  id: '',
  name: '',
  enabled: true,
  sources: [],
  targets: [],
  stores: ['amazon', 'shopee', 'mercadolivre'],
  onlyStoreOffers: true,
  handleMode: 'remove',
  handle: '',
  siteMode: 'remove',
  site: '',
  schedule: null, // { start: '08:00', end: '22:00' }
  footer: '',
  replacements: [], // [{ from: 'texto', to: 'outro' }]
};

export function normalizeRule(rule) {
  return { ...DEFAULT_RULE, ...rule };
}

/** Verifica se `date` está dentro da janela "HH:MM"-"HH:MM" (aceita janela que vira a meia-noite). */
export function inSchedule(schedule, date, timeZone = 'America/Sao_Paulo') {
  if (!schedule?.start || !schedule?.end) return true;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(date);
  const toMin = (s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  const now = toMin(hm);
  const start = toMin(schedule.start);
  const end = toMin(schedule.end);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

function applyReplacements(text, replacements = []) {
  let out = text;
  for (const { from, to = '' } of replacements) {
    if (from) out = out.split(from).join(to);
  }
  return out;
}

/**
 * @param {object} message  { sourceId, text, mediaHash?, at?: Date }
 * @param {object} rule     regra de espelhamento (ver DEFAULT_RULE)
 * @param {object} deps
 * @param {object} deps.accounts       contas de afiliado (amazonTag, shopeeProvider, ...)
 * @param {import('./dedupe.js').SeenStore} [deps.seen]
 * @param {(target: string) => object} [deps.accountsFor]  contas por destino (etiqueta por grupo)
 * @returns {Promise<{action: 'send'|'skip', reason?: string, sends?: Array<{target: string, text: string}>, failed?: object[]}>}
 */
export async function processMessage(message, rawRule, deps = {}) {
  const rule = normalizeRule(rawRule);
  const at = message.at ?? new Date();

  if (!rule.enabled) return { action: 'skip', reason: 'Espelhamento desativado' };
  if (!rule.sources.includes(message.sourceId)) return { action: 'skip', reason: 'Grupo não é origem desta regra' };
  if (!rule.targets.length) return { action: 'skip', reason: 'Nenhum grupo de destino' };
  if (!inSchedule(rule.schedule, at)) return { action: 'skip', reason: 'Fora do horário configurado' };

  const text = message.text ?? '';
  const storeLinks = extractLinks(text)
    .map((l) => ({ url: l.url, store: detectStore(l.url) }))
    .filter((l) => l.store);

  const wanted = storeLinks.filter((l) => rule.stores.includes(l.store));
  const unwanted = storeLinks.filter((l) => !rule.stores.includes(l.store));

  if (rule.onlyStoreOffers && wanted.length === 0) {
    return { action: 'skip', reason: 'Mensagem sem link das lojas escolhidas' };
  }
  if (unwanted.length) {
    return { action: 'skip', reason: 'Mensagem tem link de loja não habilitada nesta regra' };
  }

  const cleaned = cleanMessage(applyReplacements(text, rule.replacements), rule);
  const fp = fingerprint({
    productKeys: wanted.map((l) => productKey(l.url, l.store)),
    mediaHash: message.mediaHash,
  });

  const sends = [];
  let lastFailed = [];
  const skippedTargets = [];

  for (const target of rule.targets) {
    if (fp && deps.seen?.has(target, fp)) {
      skippedTargets.push({ target, reason: 'Oferta já enviada nas últimas 24 horas' });
      continue;
    }
    const accounts = deps.accountsFor ? deps.accountsFor(target) : deps.accounts ?? {};
    const { text: converted, failed } = await convertMessage(cleaned, accounts);
    if (failed.length) {
      lastFailed = failed;
      skippedTargets.push({ target, reason: 'Link de loja não convertido' });
      continue;
    }
    const finalText = tidy(rule.footer ? `${converted}\n\n${rule.footer}` : converted);
    sends.push({ target, text: finalText, fingerprint: fp });
  }

  if (!sends.length) {
    const reason = lastFailed.length
      ? 'Não enviei para não postar link de afiliado de outra pessoa: ' + lastFailed.map((f) => f.reason ?? f.store).join('; ')
      : skippedTargets[0]?.reason ?? 'Nada para enviar';
    return { action: 'skip', reason, failed: lastFailed, skippedTargets };
  }

  for (const s of sends) if (fp) deps.seen?.add(s.target, fp);
  return { action: 'send', sends, skippedTargets };
}
