/**
 * Segue redirecionamentos de links curtos (amzn.to, meli.la, etc.) até a URL final.
 * Roda no servidor. Não baixa o corpo da página.
 */
export function createResolver({ fetch: fetchImpl = globalThis.fetch, maxHops = 5, timeoutMs = 6000 } = {}) {
  return async function resolve(url) {
    let current = url;
    for (let hop = 0; hop < maxHops; hop++) {
      let response;
      try {
        response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'Mozilla/5.0 (AchoFiliado link resolver)' },
        });
      } catch {
        return current;
      }
      const location = response.headers?.get?.('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return current;
    }
    return current;
  };
}
