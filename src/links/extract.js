/**
 * Encontra links dentro de um texto de mensagem e permite substituí-los.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function extractLinks(text) {
  const found = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(TRAILING_PUNCTUATION, '');
    found.push({
      url,
      start: match.index,
      end: match.index + url.length,
    });
  }
  return found;
}

/**
 * Substitui cada link do texto pelo valor devolvido por `replacer`.
 * `replacer(url)` recebe a URL e devolve a nova URL, ou null para manter a original.
 * É assíncrono porque a conversão de algumas lojas consulta uma API.
 */
export async function replaceLinks(text, replacer) {
  const links = extractLinks(text);
  let result = '';
  let cursor = 0;
  const changes = [];

  for (const link of links) {
    const next = await replacer(link.url);
    result += text.slice(cursor, link.start);
    if (next && next !== link.url) {
      result += next;
      changes.push({ from: link.url, to: next });
    } else {
      result += link.url;
    }
    cursor = link.end;
  }
  result += text.slice(cursor);

  return { text: result, changes };
}
