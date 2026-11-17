/**
 * Filtros de oferta por regra:
 * - blockWords: se a mensagem tiver alguma, não envia (ex.: "grupo vip", "cupom esgotado")
 * - requireWords: se tiver lista, só envia se tiver pelo menos uma (ex.: "3d", "filamento")
 * - minPrice / maxPrice: faixa de preço da oferta
 * - dropLines: linhas que contêm estes textos são apagadas antes de enviar
 *   (ex.: "entre no grupo", "link do grupo")
 * Comparação sem diferença de maiúsculas e acentos.
 */

export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Preços "R$ 1.234,56" / "R$79" / "R$ 79,90" da mensagem, em número. */
export function findPrices(text) {
  const prices = [];
  for (const m of String(text).matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)) {
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) prices.push(n);
  }
  return prices;
}

/** Preço da oferta: o menor da mensagem ("De R$ 129 por R$ 79" -> 79). */
export function offerPrice(text) {
  const prices = findPrices(text);
  return prices.length ? Math.min(...prices) : null;
}

export const brl = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Motivo para NÃO enviar, ou null se passou nos filtros. */
export function filterReason(text, rule) {
  const t = fold(text);
  const blocked = (rule.blockWords ?? []).find((w) => w && t.includes(fold(w)));
  if (blocked) return `Filtro: tem a palavra proibida "${blocked}"`;

  const required = (rule.requireWords ?? []).filter(Boolean);
  if (required.length && !required.some((w) => t.includes(fold(w)))) {
    return `Filtro: não tem nenhuma das palavras obrigatórias (${required.join(', ')})`;
  }

  if (rule.minPrice != null || rule.maxPrice != null) {
    const price = offerPrice(text);
    // Sem preço na mensagem: deixa passar (melhor que perder a oferta).
    if (price != null) {
      if (rule.minPrice != null && price < rule.minPrice) return `Filtro: preço R$ ${brl(price)} abaixo do mínimo de R$ ${brl(rule.minPrice)}`;
      if (rule.maxPrice != null && price > rule.maxPrice) return `Filtro: preço R$ ${brl(price)} acima do máximo de R$ ${brl(rule.maxPrice)}`;
    }
  }

  if (rule.minDiscount) {
    const prices = findPrices(text);
    if (prices.length >= 2) {
      const high = Math.max(...prices);
      const pct = ((high - Math.min(...prices)) / high) * 100;
      if (pct < rule.minDiscount) return `Filtro: desconto de ${Math.round(pct)}% abaixo do mínimo de ${rule.minDiscount}%`;
    }
  }
  return null;
}

/** Apaga as linhas que contêm algum dos textos de `dropLines`. */
export function dropLines(text, phrases = []) {
  const list = phrases.filter(Boolean).map(fold);
  if (!list.length) return text;
  return text
    .split('\n')
    .filter((line) => !list.some((p) => fold(line).includes(p)))
    .join('\n');
}
