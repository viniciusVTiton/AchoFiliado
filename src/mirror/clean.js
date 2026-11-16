/**
 * Limpeza de mensagens espelhadas: troca ou remove o @ e o site de quem postou na origem.
 * Links de loja nunca são tocados aqui; eles são convertidos à parte.
 */
import { detectStore } from '../links/detect.js';
import { extractLinks } from '../links/extract.js';

// @usuario do Instagram/Telegram. Não pega e-mails (exige início de palavra antes do @).
const HANDLE = /(^|[^\w.@])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;

/**
 * @param {string} text
 * @param {object} opts
 * @param {'replace'|'remove'} [opts.handleMode]
 * @param {string} [opts.handle]   seu @, ex.: "@viniachados"
 * @param {'replace'|'remove'} [opts.siteMode]
 * @param {string} [opts.site]     seu site, ex.: "https://viniachados.com.br"
 */
export function cleanMessage(text, { handleMode = 'remove', handle = '', siteMode = 'remove', site = '' } = {}) {
  let out = text;

  // 1) Sites de terceiros: qualquer link que não seja de loja
  const links = extractLinks(out).filter((l) => !detectStore(l.url));
  for (let i = links.length - 1; i >= 0; i--) {
    const { start, end } = links[i];
    const replacement = siteMode === 'replace' && site ? site : '';
    out = out.slice(0, start) + replacement + out.slice(end);
  }

  // 2) @ de terceiros
  const myHandle = handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '';
  out = out.replace(HANDLE, (match, before, name) => {
    if (myHandle && `@${name}`.toLowerCase() === myHandle.toLowerCase()) return match;
    if (handleMode === 'replace' && myHandle) return `${before}${myHandle}`;
    return before;
  });

  return tidy(out);
}

/** Remove espaços sobrando e linhas que ficaram vazias de conteúdo. */
export function tidy(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, ''))
    .filter((line, i, all) => !(line.trim() === '' && (all[i - 1] ?? '').trim() === ''))
    .join('\n')
    .trim();
}
