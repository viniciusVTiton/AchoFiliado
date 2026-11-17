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
import { filterReason, dropLines } from './filters.js';
import { offerData, renderTemplate } from './template.js';
import { pickOpener } from './openers.js';
import { productInfo } from '../providers/title.js';

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
  testMode: false, // repassa a mensagem SEM nenhum link, só para testar o clonador
  footer: '',
  replacements: [], // [{ from: 'texto', to: 'outro' }]
  blockWords: [], // não envia se tiver alguma
  requireWords: [], // só envia se tiver pelo menos uma (lista vazia = tudo)
  minPrice: null,
  maxPrice: null,
  dropLines: [], // apaga linhas que contêm estes textos
  textMode: 'edit', // 'edit' = repete o texto original trocando os links; 'template' = usa o modelo abaixo
  template: '',
  imageMode: 'original', // 'off' = só texto; 'original' = repete a foto do post; 'always' = sempre com foto (da loja se preciso); 'link' = só o link
  noRepeatPhoto: false, // a mesma foto não vai de novo para o mesmo grupo em 24 horas
  randomOpener: true, // no modelo, sorteia uma frase de abertura para cada post
  minDiscount: null, // desconto mínimo em % (precisa de preço antigo e novo na mensagem)
  amazonTag: '', // etiqueta da Amazon desta regra (vazia = a do grupo de destino)
  shopeeSubId: '', // sub-ID da Shopee desta regra (vazio = o do grupo de destino)
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

/** Tira TODOS os links do texto (de loja ou não). */
function stripAllLinks(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const links = extractLinks(line);
    let out = line;
    for (let i = links.length - 1; i >= 0; i--) out = out.slice(0, links[i].start) + out.slice(links[i].end);
    // Linha que era só o link some inteira, em vez de virar uma linha em branco.
    if (links.length && !out.trim()) continue;
    lines.push(out);
  }
  return tidy(lines.join('\n'));
}

/**
 * Modo teste: repassa a mensagem sem nenhum link, para conferir que o clonador
 * recebe e envia. Como não sobra link, nunca posta afiliado de outra pessoa.
 */
function testModeSend(message, rule, storeLinks, deps) {
  const cleaned = cleanMessage(dropLines(applyReplacements(message.text ?? '', rule.replacements), rule.dropLines), { ...rule, siteMode: 'remove' });
  const stripped = stripAllLinks(cleaned);
  if (!stripped) return { action: 'skip', reason: 'Modo teste: mensagem só tinha links' };

  const fp =
    fingerprint({ productKeys: storeLinks.map((l) => productKey(l.url, l.store)), mediaHash: message.mediaHash }) ||
    `texto:${stripped.toLowerCase().replace(/\s+/g, ' ')}`;

  const sends = [];
  const skippedTargets = [];
  for (const target of rule.targets) {
    if (deps.seen?.has(target, fp)) {
      skippedTargets.push({ target, reason: 'Oferta já enviada nas últimas 24 horas' });
      continue;
    }
    const limited = deps.limiter?.check(target);
    if (limited) {
      skippedTargets.push({ target, reason: limited });
      continue;
    }
    sends.push({ target, text: tidy(rule.footer ? `${stripped}\n\n${rule.footer}` : stripped) });
  }
  if (!sends.length) return { action: 'skip', reason: skippedTargets[0]?.reason ?? 'Nada para enviar', skippedTargets };
  for (const s of sends) {
    deps.seen?.add(s.target, fp);
    deps.limiter?.record(s.target);
  }
  return { action: 'send', sends, skippedTargets };
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

  const filtered = filterReason(text, rule);
  if (filtered) return { action: 'skip', reason: filtered };

  if (rule.testMode) return testModeSend(message, rule, storeLinks, deps);

  const wanted = storeLinks.filter((l) => rule.stores.includes(l.store));
  const unwanted = storeLinks.filter((l) => !rule.stores.includes(l.store));

  if (rule.onlyStoreOffers && wanted.length === 0) {
    return { action: 'skip', reason: 'Mensagem sem link das lojas escolhidas' };
  }
  if (unwanted.length) {
    return { action: 'skip', reason: 'Mensagem tem link de loja não habilitada nesta regra' };
  }

  const cleaned = cleanMessage(dropLines(applyReplacements(text, rule.replacements), rule.dropLines), rule);
  const fp = fingerprint({
    productKeys: wanted.map((l) => productKey(l.url, l.store)),
    mediaHash: message.mediaHash,
  });

  const sends = [];
  let lastFailed = [];
  const skippedTargets = [];

  let infoCache;
  const storeInfo = () => {
    infoCache ??= wanted.length ? (deps.productFor ?? productInfo)(wanted[0].url) : Promise.resolve({});
    return infoCache;
  };

  const photoFp = rule.noRepeatPhoto && message.mediaHash ? `photo:${message.mediaHash}` : '';

  for (const target of rule.targets) {
    if (fp && deps.seen?.has(target, fp)) {
      skippedTargets.push({ target, reason: 'Oferta já enviada nas últimas 24 horas' });
      continue;
    }
    if (photoFp && deps.seen?.has(target, photoFp)) {
      skippedTargets.push({ target, reason: 'Esta foto já foi enviada para este grupo nas últimas 24 horas' });
      continue;
    }
    const limited = deps.limiter?.check(target);
    if (limited) {
      skippedTargets.push({ target, reason: limited });
      continue;
    }
    const accounts = deps.accountsFor ? deps.accountsFor(target, rule) : deps.accounts ?? {};
    const { text: converted, failed } = await convertMessage(cleaned, accounts);
    if (failed.length) {
      lastFailed = failed;
      skippedTargets.push({ target, reason: 'Link de loja não convertido' });
      continue;
    }
    // Depois de convertida, a oferta tem o SEU link, igual para o mesmo produto em qualquer origem.
    const convertedFp = fingerprint({
      productKeys: extractLinks(converted)
        .map((l) => ({ url: l.url, store: detectStore(l.url) }))
        .filter((l) => l.store)
        .map((l) => productKey(l.url, l.store)),
    });
    if (convertedFp && deps.seen?.has(target, convertedFp)) {
      skippedTargets.push({ target, reason: 'Oferta já enviada nas últimas 24 horas' });
      continue;
    }
    let body = converted;
    if (rule.imageMode === 'link') {
      body = extractLinks(converted)
        .filter((l) => detectStore(l.url))
        .map((l) => l.url)
        .join('\n');
    } else if (rule.textMode === 'template') {
      const info = await storeInfo();
      const data = offerData(text, converted);
      data.titulo = info.title || data.titulo;
      body = renderTemplate(rule.template, data);
      if (!body) {
        skippedTargets.push({ target, reason: 'Modelo de texto ficou vazio para esta oferta' });
        continue;
      }
      if (rule.randomOpener) body = `${pickOpener()}\n${body}`;
    }
    const finalText = tidy(rule.footer ? `${body}\n\n${rule.footer}` : body);
    let imageUrl = null;
    if (rule.imageMode === 'always' && !message.mediaHash) imageUrl = (await storeInfo()).image ?? null;
    sends.push({ target, text: finalText, convertedFp, photoFp, imageUrl });
  }

  if (!sends.length) {
    const reason = lastFailed.length
      ? 'Não enviei para não postar link de afiliado de outra pessoa: ' + lastFailed.map((f) => f.reason ?? f.store).join('; ')
      : skippedTargets[0]?.reason ?? 'Nada para enviar';
    return { action: 'skip', reason, failed: lastFailed, skippedTargets };
  }

  for (const s of sends) {
    if (fp) deps.seen?.add(s.target, fp);
    if (s.convertedFp) deps.seen?.add(s.target, s.convertedFp);
    if (s.photoFp) deps.seen?.add(s.target, s.photoFp);
    delete s.convertedFp;
    delete s.photoFp;
    deps.limiter?.record(s.target);
  }
  return { action: 'send', sends, skippedTargets };
}
