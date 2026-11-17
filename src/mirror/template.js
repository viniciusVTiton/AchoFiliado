/**
 * Modelo de texto próprio: o post vira o SEU texto, preenchido com os dados da oferta.
 * Só entram links já convertidos (os seus), então nunca sai link de outra pessoa.
 * Linha cujo campo ficou vazio some (ex.: sem preço antigo, a linha "De ..." não aparece).
 */
import { extractLinks } from '../links/extract.js';
import { detectStore } from '../links/detect.js';
import { tidy } from './clean.js';
import { findPrices, brl } from './filters.js';

const STORE_NAME = { amazon: 'Amazon', shopee: 'Shopee', mercadolivre: 'Mercado Livre' };
const EMOJI = /\p{Extended_Pictographic}|️/gu;

export const TEMPLATE_FIELDS = ['titulo', 'preco', 'preco_antigo', 'loja', 'link', 'links', 'cupom'];

/** "CUPOM MEUDESCONTO" ou "cupom: MEUDESCONTO" -> MEUDESCONTO. Só código em maiúsculas, para não pegar "cupom válido". */
function couponFrom(text) {
  const code = text.match(/cupom\s*[:\-]?\s*([A-Za-z0-9_-]+)/i)?.[1] ?? '';
  return /^[A-Z0-9_-]{3,40}$/.test(code) ? code : '';
}

function withoutLinks(line) {
  const links = extractLinks(line);
  let out = line;
  for (let i = links.length - 1; i >= 0; i--) out = out.slice(0, links[i].start) + out.slice(links[i].end);
  return out;
}

/** Primeira linha que parece o nome do produto (sem link, sem preço, sem emoji). */
function productTitle(text) {
  for (const line of text.split('\n')) {
    const clean = withoutLinks(line)
      .replace(EMOJI, '')
      .replace(/^[\s\-–—*_•·:>]+|[\s:*_]+$/g, '')
      .trim();
    if (!/\p{L}{3,}/u.test(clean)) continue;
    if (/R\$|cupom|^(de|por|preço|preco)\b/i.test(clean)) continue;
    return clean;
  }
  return '';
}

/** Dados da oferta: o texto original (título e preços) e o texto já convertido (seus links). */
export function offerData(originalText, convertedText) {
  const prices = findPrices(originalText);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const myLinks = extractLinks(convertedText)
    .map((l) => ({ url: l.url, store: detectStore(l.url) }))
    .filter((l) => l.store);
  return {
    titulo: productTitle(originalText),
    preco: low == null ? '' : `R$ ${brl(low)}`,
    preco_antigo: high != null && high > low ? `R$ ${brl(high)}` : '',
    loja: [...new Set(myLinks.map((l) => STORE_NAME[l.store]))].join(', '),
    link: myLinks[0]?.url ?? '',
    links: myLinks.map((l) => l.url).join('\n'),
    cupom: couponFrom(originalText),
  };
}

export function renderTemplate(template, data) {
  const lines = [];
  for (const line of template.split('\n')) {
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => TEMPLATE_FIELDS.includes(n));
    let out = line;
    let empty = false;
    for (const name of names) {
      if (!data[name]) empty = true;
      out = out.split(`{${name}}`).join(data[name] ?? '');
    }
    if (!empty) lines.push(out);
  }
  return tidy(lines.join('\n'));
}
