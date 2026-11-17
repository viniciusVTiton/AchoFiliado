/**
 * Avisa uma vez quando o WhatsApp fica fora do ar por mais tempo que `alertAfterMs`.
 * Reconexões rápidas não disparam aviso.
 */
const DOWN_STATUSES = ['reconnecting', 'error'];

export function createDownWatch({ alertAfterMs = 120_000, now = Date.now } = {}) {
  let since = null;
  let alerted = false;
  return (status) => {
    if (!DOWN_STATUSES.includes(status)) {
      since = null;
      alerted = false;
      return false;
    }
    since ??= now();
    if (!alerted && now() - since >= alertAfterMs) {
      alerted = true;
      return true;
    }
    return false;
  };
}
