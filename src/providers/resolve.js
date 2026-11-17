/**
 * Segue links curtos (amzn.to, meli.la, ...) até a página do produto.
 *
 * Por segurança só segue redirecionamentos HTTPS entre domínios de loja conhecidos:
 * um link curto nunca faz o servidor acessar outro site ou a rede interna.
 */
import { detectStore } from '../links/detect.js';

const MAX_HOPS = 5;

function isStoreHttps(url) {
  try {
    return new URL(url).protocol === 'https:' && detectStore(url) !== null;
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {{ fetch?: typeof fetch }} [opts]
 * @returns {Promise<string|null>} URL final ou null se não deu para seguir
 */
export async function resolveShortLink(url, { fetch: fetchImpl = fetch } = {}) {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isStoreHttps(current)) return null;

    let res;
    try {
      res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AchoFiliado/1.0)' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return null;
    }
    res.body?.cancel?.().catch(() => {});

    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return hop === 0 ? null : current;

    current = new URL(location, current).toString();
  }
  return isStoreHttps(current) ? current : null;
}
