/**
 * Shopee Affiliate Open Platform (Brasil).
 *
 * Gera o link curto de afiliado com a mutation `generateShortLink`.
 * Autenticação: header
 *   Authorization: SHA256 Credential={AppId}, Timestamp={ts}, Signature={sha256(AppId + ts + payload + Secret)}
 * As credenciais ficam em https://affiliate.shopee.com.br/open_api (AppID e Senha).
 *
 * Só roda no servidor: o Secret nunca vai para o navegador.
 */
import { createHash } from 'node:crypto';

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

const MUTATION = 'mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }';

export function signShopee({ appId, secret, payload, timestamp }) {
  const signature = createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

/**
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.secret
 * @param {string} [opts.subId]      identificador opcional (ex.: nome do grupo) para relatórios
 * @param {typeof fetch} [opts.fetch]
 * @param {() => number} [opts.now]  em segundos
 * @returns {(url: string) => Promise<object>} provider no formato de converters.js
 */
export function createShopeeProvider({ appId, secret, subId = '', fetch: fetchImpl = fetch, now } = {}) {
  const clock = now ?? (() => Math.floor(Date.now() / 1000));

  return async function shopeeProvider(url) {
    const input = { originUrl: url };
    if (subId) input.subIds = [subId];
    const payload = JSON.stringify({ query: MUTATION, variables: { input } });
    const timestamp = clock();

    let res;
    try {
      res = await fetchImpl(SHOPEE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: signShopee({ appId, secret, payload, timestamp }),
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { status: 'unsupported', reason: 'Shopee não respondeu' };
    }

    const data = await res.json().catch(() => null);
    const error = data?.errors?.[0];
    if (!res.ok || error) {
      const message = error?.message ?? `HTTP ${res.status}`;
      return { status: 'unsupported', reason: `Shopee recusou o link: ${message}` };
    }

    const shortLink = data?.data?.generateShortLink?.shortLink;
    if (!shortLink) return { status: 'unsupported', reason: 'Shopee não devolveu o link' };
    return { status: 'ok', url: shortLink };
  };
}
