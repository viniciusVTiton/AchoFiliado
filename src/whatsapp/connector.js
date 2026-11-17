/**
 * Conector do WhatsApp (não oficial, via Baileys = WhatsApp Web).
 *
 * ATENÇÃO: vai contra os termos do WhatsApp. Use um NÚMERO EXTRA, nunca o principal.
 *
 * - Mostra o QR para conectar (como no WhatsApp Web) e guarda a sessão em data/whatsapp-auth.
 * - Lista os grupos do número.
 * - Recebe mensagens de grupos, pergunta ao servidor o que enviar (onMessage) e envia
 *   pela fila com pausas.
 * - Ignora mensagens enviadas pelo próprio número: assim um grupo de destino nunca
 *   realimenta o espelhamento.
 */
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isJidGroup,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

import { readContent, SendQueue, ActivityLog } from './parts.js';
import { downloadImage } from '../products/store.js';

/**
 * @param {object} opts
 * @param {string} opts.authDir
 * @param {(msg: {sourceId: string, text: string, mediaHash: string}) => Promise<{sends: Array<{target: string, text: string}>, skipped: object[]}>} opts.onMessage
 * @param {number} [opts.minDelayMs]
 * @param {number} [opts.maxDelayMs]
 */
export function createWhatsApp({ authDir, onMessage, minDelayMs, maxDelayMs, activityFile }) {
  const logger = pino({ level: 'silent' });
  const activity = new ActivityLog(50, { file: activityFile });
  const state = { status: 'starting', qr: null, me: null, groups: [], error: null };
  let sock = null;
  let stopped = false;

  const groupName = (jid) => state.groups.find((g) => g.id === jid)?.name ?? jid;

  const queue = new SendQueue({
    minDelayMs,
    maxDelayMs,
    async send({ target, text, image }) {
      if (!sock || state.status !== 'connected') throw new Error('WhatsApp desconectado');
      await sock.sendMessage(target, image ? { image, caption: text } : { text });
      activity.add({ type: 'sent', group: groupName(target), text });
    },
    onError(error, item) {
      activity.add({ type: 'error', group: groupName(item.target), text: `Falha ao enviar: ${error.message}` });
    },
  });

  async function refreshGroups() {
    if (!sock) return state.groups;
    const all = await sock.groupFetchAllParticipating();
    // O próprio número pode aparecer pelo telefone ou pelo identificador novo (LID) do WhatsApp.
    const bare = (jid) => (jid ?? '').split('@')[0].split(':')[0];
    const mine = new Set([bare(sock.user?.id), bare(sock.user?.lid)].filter(Boolean));
    state.groups = Object.values(all)
      .map((g) => {
        const me = g.participants?.find((p) => [p.id, p.lid, p.phoneNumber, p.jid].some((j) => mine.has(bare(j))));
        return {
          id: g.id,
          name: g.subject || g.id,
          size: g.participants?.length ?? 0,
          announce: Boolean(g.announce),
          // null = não deu para saber
          admin: me ? Boolean(me.admin) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return state.groups;
  }

  // Logo depois de conectar, o WhatsApp às vezes recusa a lista de grupos (rate-overlimit):
  // tenta de novo com intervalo maior, sem insistir em rajada.
  const GROUP_RETRY_MS = [30_000, 60_000, 120_000, 240_000];
  async function loadGroups(attempt = 0) {
    try {
      await refreshGroups();
    } catch (error) {
      if (attempt < GROUP_RETRY_MS.length) setTimeout(() => loadGroups(attempt + 1), GROUP_RETRY_MS[attempt]).unref?.();
      else activity.add({ type: 'error', text: `Não consegui carregar a lista de grupos: ${error.message}. Clique em Atualizar grupos.` });
    }
  }

  async function handleUpsert({ messages, type }) {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid || !isJidGroup(jid) || msg.key.fromMe) continue;

      const content = readContent(normalizeMessageContent(msg.message));
      if (!content?.text?.trim()) continue;

      let image = null;
      let mediaHash = '';
      if (content.kind === 'image') {
        try {
          image = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          mediaHash = createHash('sha256').update(image).digest('hex');
        } catch {
          image = null; // segue só com o texto
        }
      }

      let result;
      try {
        result = await onMessage({ sourceId: jid, text: content.text, mediaHash });
      } catch (error) {
        activity.add({ type: 'error', group: groupName(jid), text: `Erro ao processar: ${error.message}` });
        continue;
      }

      // Mensagens de grupos sem regra não aparecem no histórico, para não poluir.
      const relevant = result.sends.length || result.skipped.some((s) => s.ruleId);
      if (!relevant) continue;

      activity.add({ type: 'received', group: groupName(jid), text: content.text });
      for (const s of result.skipped.filter((x) => x.ruleId)) {
        activity.add({ type: 'skipped', group: s.target ? groupName(s.target) : groupName(jid), text: s.reason });
      }
      for (const s of result.sends) {
        let picture = s.imageMode === 'original' || s.imageMode === 'always' ? image : null;
        if (!picture && s.imageMode === 'always' && s.imageUrl) picture = await downloadImage(s.imageUrl);
        queue.push({ target: s.target, text: s.text, image: picture });
      }
    }
  }

  async function connect() {
    const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    sock = makeWASocket({
      auth,
      version,
      logger,
      browser: Browsers.windows('AchoFiliado'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', (event) => {
      handleUpsert(event).catch((error) => activity.add({ type: 'error', text: error.message }));
    });
    sock.ev.on('groups.upsert', () => refreshGroups().catch(() => {}));
    sock.ev.on('groups.update', () => refreshGroups().catch(() => {}));

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        state.status = 'qr';
        state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      }
      if (connection === 'open') {
        state.status = 'connected';
        state.qr = null;
        state.error = null;
        state.me = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null;
        activity.add({ type: 'info', text: 'WhatsApp conectado' });
        loadGroups();
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (stopped) return;
        if (code === DisconnectReason.loggedOut) {
          // Sessão encerrada no celular: apaga e mostra um QR novo.
          state.status = 'starting';
          state.me = null;
          state.groups = [];
          activity.add({ type: 'info', text: 'Sessão do WhatsApp encerrada. Escaneie o QR de novo.' });
          await rm(authDir, { recursive: true, force: true });
        } else {
          state.status = 'reconnecting';
        }
        setTimeout(() => connect().catch(fail), 3000);
      }
    });
  }

  function fail(error) {
    state.status = 'error';
    state.error = error.message;
  }

  return {
    start: () => connect().catch(fail),
    /** Envio manual (Vitrine): entra na mesma fila com pausas. */
    enqueue({ target, text, image = null }) {
      if (state.status !== 'connected') throw Object.assign(new Error('WhatsApp desconectado'), { status: 409 });
      queue.push({ target, text, image });
    },
    refreshGroups,
    async logout() {
      if (sock) await sock.logout().catch(() => {});
    },
    stop() {
      stopped = true;
      sock?.end?.(undefined);
    },
    status: () => ({
      status: state.status,
      qr: state.qr,
      me: state.me,
      error: state.error,
      groups: state.groups,
      queue: queue.size,
      activity: activity.list(),
      today: activity.summary(),
    }),
    loadHistory: () => activity.load(),
  };
}
