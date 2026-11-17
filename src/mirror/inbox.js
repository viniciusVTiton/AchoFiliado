/**
 * Entrada do espelhamento: recebe UMA mensagem que chegou em um grupo e devolve
 * tudo o que deve ser enviado, aplicando todas as regras ativas daquele grupo.
 *
 * É o ponto onde o conector do WhatsApp (ou outro) vai se ligar:
 *   mensagem chega -> handleIncoming -> conector envia cada item de `sends`.
 */
import { processMessage } from './engine.js';

/**
 * @param {{sourceId: string, text: string, mediaHash?: string, at?: Date}} message
 * @param {object} deps
 * @param {object[]} deps.rules
 * @param {import('./dedupe.js').SeenStore} deps.seen
 * @param {object} [deps.accounts]
 * @param {(target: string) => object} [deps.accountsFor]
 */
export async function handleIncoming(message, { rules, seen, accounts, accountsFor, limiter }) {
  const sends = [];
  const skipped = [];

  const matching = rules.filter((r) => r.enabled !== false && r.sources?.includes(message.sourceId));
  if (!matching.length) return { sends, skipped: [{ ruleId: null, reason: 'Nenhuma regra para este grupo' }] };

  for (const rule of matching) {
    const result = await processMessage(message, rule, { seen, accounts, accountsFor, limiter });
    if (result.action === 'send') {
      for (const s of result.sends) sends.push({ ...s, ruleId: rule.id, imageMode: rule.imageMode });
    }
    const perTarget = result.skippedTargets ?? [];
    for (const t of perTarget) skipped.push({ ruleId: rule.id, target: t.target, reason: t.reason });
    // Motivo geral só quando nenhum destino explicou o bloqueio (ex.: fora do horário).
    if (result.action === 'skip' && !perTarget.length) skipped.push({ ruleId: rule.id, reason: result.reason });
  }
  return { sends, skipped };
}
