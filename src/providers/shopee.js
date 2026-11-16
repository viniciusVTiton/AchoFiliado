/**
 * Provedor da Shopee Affiliate Open Platform (Brasil).
 *
 * Gera o link curto de afiliado pela mutation `generateShortLink`.
 * Autenticação: Authorization: SHA256 Credential={AppId}, Timestamp={ts}, Signature={sig}
 * onde sig = sha256_hex(AppId + Timestamp + Payload + Secret) e Timestamp em segundos.
 *
 * Roda só no servidor: o Secret nunca deve ir para o navegador.
 */
import { createHash } from 'node:crypto';

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

const ERRORS = {
  10020: 'Credencial ou assinatura inválida (confira App ID e Secret)',
  10030: 'Limite de requisições da Shopee atingido, tente de novo em instantes',
  10035: 'Conta sem acesso à Open API da Shopee',
};

export function signShopee({ appId, secret, timestamp, payload }) {
  const signature = createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

/** Sub IDs da Shopee: até 5, só letras e números. */
export function sanitizeSubIds(subIds = []) {
  return subIds
    .map((s) => String(s).replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 5);
}

export function buildShortLinkPayload(originUrl, subIds = []) {
  const ids = sanitizeSubIds(subIds);
  const input = [`originUrl: ${JSON.stringify(originUrl)}`];
  if (ids.length) input.push(`subIds: ${JSON.stringify(ids)}`);
  const query = `mutation { generateShortLink(input: { ${input.join(', ')} }) { shortLink } }`;
  return JSON.stringify({ query });
}

/**
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.secret
 * @param {string[]} [opts.subIds]   etiquetas padrão (ex.: nome do grupo)
 * @param {typeof fetch} [opts.fetch]
 * @param {() => number} [opts.now]  em milissegundos
 * @param {number} [opts.timeoutMs]
 * @returns {(url: string, options?: {subIds?: string[]}) => Promise<object>}
 */
export function createShopeeProvider({
  appId,
  secret,
  subIds = [],
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 8000,
  endpoint = SHOPEE_ENDPOINT,
}) {
  if (!appId || !secret) return null;

  return async function shopeeProvider(url, options = {}) {
    const payload = buildShortLinkPayload(url, options.subIds ?? subIds);
    const timestamp = Math.floor(now() / 1000);

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: signShopee({ appId, secret, timestamp, payload }),
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError'
        ? 'A Shopee demorou para responder'
        : 'Não consegui falar com a API da Shopee';
      return { status: 'error', reason };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { status: 'error', reason: `Resposta inválida da Shopee (HTTP ${response.status})` };
    }

    if (data?.errors?.length) {
      const first = data.errors[0];
      const code = first?.extensions?.code;
      return { status: 'error', reason: ERRORS[code] ?? first?.message ?? 'Erro da API da Shopee', code };
    }

    const shortLink = data?.data?.generateShortLink?.shortLink;
    if (!shortLink) {
      return { status: 'error', reason: 'A Shopee não devolveu o link de afiliado' };
    }
    return { status: 'ok', url: shortLink };
  };
}
