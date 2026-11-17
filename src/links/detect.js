/**
 * Identifica a loja de um link de produto.
 * Retorna 'amazon' | 'shopee' | 'mercadolivre' | null.
 */

const RULES = [
  {
    store: 'amazon',
    test: (h) =>
      /(^|\.)amazon\.com\.br$/.test(h) ||
      /(^|\.)amazon\.com$/.test(h) ||
      h === 'amzn.to' ||
      h === 'amzn.com',
  },
  {
    store: 'shopee',
    test: (h) => /(^|\.)shopee\.com\.br$/.test(h) || h === 'shp.ee' || h === 'shope.ee',
  },
  {
    store: 'mercadolivre',
    test: (h) =>
      /(^|\.)mercadolivre\.com(\.br)?$/.test(h) || // mercadolivre.com/sec/... é o link curto de afiliado
      /(^|\.)mercadolibre\.com(\.br)?$/.test(h) ||
      h === 'meli.la',
  },
];

export function detectStore(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const rule = RULES.find((r) => r.test(host));
  return rule ? rule.store : null;
}
