/**
 * Liga o motor de espelhamento a uma conexão de WhatsApp.
 *
 * A conexão é injetada como `adapter`, com esta forma:
 *   adapter.onMessage((msg) => void)   msg = { sourceId, text, mediaHash?, at? }
 *   adapter.send(groupId, text)        => Promise<void>
 *   adapter.listGroups()               => Promise<Array<{ id, name }>>
 *
 * Assim o motor não depende de nenhuma biblioteca específica do WhatsApp.
 */
import { processMessage } from '../mirror/engine.js';
import { SeenStore } from '../mirror/dedupe.js';

export function createMirrorRunner({ adapter, getRules, accountsFor, accounts = {}, seen = new SeenStore(), log = () => {} }) {
  if (!adapter?.onMessage || !adapter?.send) throw new Error('Adapter de WhatsApp incompleto');

  const history = [];
  const record = (entry) => {
    history.unshift({ ...entry, at: new Date().toISOString() });
    if (history.length > 200) history.length = 200;
  };

  async function handle(message) {
    const rules = (getRules() ?? []).filter((r) => r.enabled !== false);
    for (const rule of rules) {
      if (!rule.sources?.includes(message.sourceId)) continue;
      const result = await processMessage(message, rule, { accounts, accountsFor, seen });
      if (result.action === 'skip') {
        record({ rule: rule.id, source: message.sourceId, action: 'skip', reason: result.reason });
        continue;
      }
      for (const s of result.sends) {
        try {
          await adapter.send(s.target, s.text);
          record({ rule: rule.id, source: message.sourceId, target: s.target, action: 'sent' });
        } catch (err) {
          // Se o envio falhou, a oferta não deve ficar marcada como enviada.
          seen.remove(s.target, s.fingerprint);
          record({ rule: rule.id, source: message.sourceId, target: s.target, action: 'error', reason: err.message });
          log(`Falha ao enviar para ${s.target}: ${err.message}`);
        }
      }
    }
  }

  // Mensagens são processadas uma por vez, para a deduplicação não ser burlada por corrida.
  let queue = Promise.resolve();
  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      adapter.onMessage((msg) => {
        queue = queue.then(() => handle({ ...msg, at: msg.at ?? new Date() })).catch((err) => {
          record({ action: 'error', reason: err.message });
          log(`Erro no espelhamento: ${err.message}`);
        });
        return queue;
      });
    },
    history: () => [...history],
  };
}
