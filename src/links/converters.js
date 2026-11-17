/**
 * Conversores de link por loja.
 *
 * Cada conversor recebe a URL do produto e as credenciais da conta do afiliado,
 * e devolve um objeto:
 *   { status: 'ok', url }                 -> link de afiliado pronto
 *   { status: 'needs_resolve', url }      -> link curto que precisa ser seguido antes
 *   { status: 'unsupported', reason }     -> não foi possível converter
 *   { status: 'needs_provider', reason }  -> depende de uma API/sessão não configurada
 *
 * Amazon é 100% local (tag de associado na URL).
 * Shopee e Mercado Livre geram o link pela conta do afiliado, então recebem um
 * `provider` injetado: uma função async que devolve o link curto oficial.
 */

const AMAZON_ASIN = /\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function convertAmazon(url, { tag }) {
  if (!tag) {
    return { status: 'needs_provider', reason: 'Tag de afiliado da Amazon não configurada' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'unsupported', reason: 'URL inválida' };
  }

  if (parsed.hostname.toLowerCase() === 'amzn.to') {
    return { status: 'needs_resolve', url };
  }

  const match = parsed.pathname.match(AMAZON_ASIN);
  if (!match) {
    return { status: 'unsupported', reason: 'Não encontrei o código do produto (ASIN) na URL' };
  }

  const asin = match[1].toUpperCase();
  const clean = new URL(`https://${parsed.hostname}/dp/${asin}`);
  clean.searchParams.set('tag', tag);
  return { status: 'ok', url: clean.toString() };
}

const SHOPEE_SHORT_HOSTS = new Set(['s.shopee.com.br', 'shp.ee', 'shope.ee']);

/**
 * Link curto da Shopee carrega o afiliado de quem gerou: precisa ser aberto até o produto
 * antes. Link completo é limpo (sem utm, mmp_pid etc.) para não herdar nada de outra pessoa.
 */
export async function convertShopee(url, { provider }) {
  if (!provider) {
    return { status: 'needs_provider', reason: 'Conta da Shopee Affiliate não conectada' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'unsupported', reason: 'URL inválida' };
  }
  if (SHOPEE_SHORT_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { status: 'needs_resolve', url };
  }
  const clean = `https://${parsed.hostname}${parsed.pathname}`;
  const result = await provider(clean);
  // Nunca devolve um link curto igual ao de entrada: isso seria o link de outra pessoa.
  if (result.status === 'ok' && result.url === url) {
    return { status: 'unsupported', reason: 'A Shopee devolveu o mesmo link' };
  }
  return result;
}

/**
 * meli.la e mercadolivre.com/sec/... são links curtos de afiliado (de outra pessoa):
 * precisam ser abertos antes. O provider acha o produto e gera o link na SUA conta.
 */
export async function convertMercadoLivre(url, { provider }) {
  if (!provider) {
    return { status: 'needs_provider', reason: 'Sessão do Mercado Livre não conectada' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'unsupported', reason: 'URL inválida' };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'meli.la' || host === 'mercadolivre.com' || host === 'www.mercadolivre.com') {
    return { status: 'needs_resolve', url };
  }
  const result = await provider(url);
  if (result.status === 'ok' && result.url === url) {
    return { status: 'unsupported', reason: 'O Mercado Livre devolveu o mesmo link' };
  }
  return result;
}
