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

export async function convertShopee(url, { provider }) {
  if (!provider) {
    return { status: 'needs_provider', reason: 'Conta da Shopee Affiliate não conectada' };
  }
  return provider(url);
}

export async function convertMercadoLivre(url, { provider }) {
  if (!provider) {
    return { status: 'needs_provider', reason: 'Sessão do Mercado Livre não conectada' };
  }
  return provider(url);
}
