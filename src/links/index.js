import { detectStore } from './detect.js';
import { convertAmazon, convertShopee, convertMercadoLivre } from './converters.js';
import { replaceLinks } from './extract.js';

/**
 * Converte um link de produto para o link do afiliado.
 *
 * @param {string} url
 * @param {object} accounts  credenciais por loja
 * @param {string} [accounts.amazonTag]
 * @param {(url: string) => Promise<object>} [accounts.shopeeProvider]
 * @param {(url: string) => Promise<object>} [accounts.mercadoLivreProvider]
 * @param {(url: string) => Promise<string>} [accounts.resolve]  segue links curtos (só no servidor)
 * @returns {Promise<{store: string|null, status: string, url?: string, reason?: string}>}
 */
export async function convertLink(url, accounts = {}) {
  const store = detectStore(url);
  if (!store) {
    return { store: null, status: 'not_a_store_link' };
  }

  let result;
  if (store === 'amazon') {
    result = convertAmazon(url, { tag: accounts.amazonTag });
  } else if (store === 'shopee') {
    result = await convertShopee(url, { provider: accounts.shopeeProvider });
  } else {
    result = await convertMercadoLivre(url, { provider: accounts.mercadoLivreProvider });
  }

  if (result.status === 'needs_resolve') {
    if (!accounts.resolve) {
      return { store, status: 'needs_resolve', url, reason: 'Link curto: precisa ser aberto no servidor antes de converter' };
    }
    const resolved = await accounts.resolve(url);
    if (resolved && resolved !== url) {
      return convertLink(resolved, { ...accounts, resolve: undefined });
    }
    return { store, status: 'unsupported', reason: 'Não consegui abrir o link curto' };
  }

  return { store, ...result };
}

/**
 * Troca todos os links de lojas de um texto pelos links de afiliado.
 * Links que não puderem ser convertidos ficam como estão e são listados em `failed`.
 */
export async function convertMessage(text, accounts = {}) {
  const failed = [];
  const { text: converted, changes } = await replaceLinks(text, async (url) => {
    const result = await convertLink(url, accounts);
    if (result.status === 'ok') return result.url;
    if (result.store) failed.push({ url, store: result.store, status: result.status, reason: result.reason });
    return null;
  });
  return { text: converted, changes, failed };
}
