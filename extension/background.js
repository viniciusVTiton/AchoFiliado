/**
 * Fica ligado ao robô (http://localhost:3000) esperando pedidos de link do Mercado Livre.
 * Cada pedido é atendido dentro de uma aba do Mercado Livre (onde você está logado).
 */
import { mlCreateLink } from './ml.js';

export const SERVER = 'http://localhost:3000';
const ML_HOME = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const VERSION = chrome.runtime.getManifest().version;

let running = false;

async function serverTag() {
  const res = await fetch(`${SERVER}/api/status`);
  const data = await res.json();
  return data.mlTag || '';
}

/** Acha uma aba do Mercado Livre; se não houver, abre uma fixada, em segundo plano. */
async function mlTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.mercadolivre.com.br/*' });
  const ready = tabs.find((t) => t.status === 'complete') ?? tabs[0];
  if (ready) return ready.id;
  const tab = await chrome.tabs.create({ url: ML_HOME, active: false, pinned: true });
  await new Promise((resolve) => {
    const done = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(done);
    setTimeout(resolve, 20_000);
  });
  return tab.id;
}

export async function generateLink(productUrl, tag, tabId) {
  const target = tabId ?? (await mlTab());
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: target },
    world: 'MAIN',
    func: mlCreateLink,
    args: [productUrl, tag],
  });
  return result?.result ?? { error: 'A aba do Mercado Livre não respondeu' };
}

async function post(path, body) {
  return fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Laço de pedidos: long-poll no robô, atende, repete. */
async function loop() {
  if (running) return;
  running = true;
  try {
    const tag = await serverTag();
    for (;;) {
      const res = await fetch(`${SERVER}/api/ml/next?v=${VERSION}`);
      if (!res.ok) break;
      const { job } = await res.json();
      if (!job) continue;
      let out;
      if (!tag) out = { error: 'Etiqueta do Mercado Livre (ML_TAG) não configurada no robô' };
      else {
        try {
          out = await generateLink(job.url, tag);
        } catch (e) {
          out = { error: e.message };
        }
      }
      await post('/api/ml/result', { id: job.id, shortUrl: out.shortUrl ?? '', error: out.error ?? '' });
    }
  } catch {
    // robô desligado: tenta de novo no próximo alarme
  } finally {
    running = false;
  }
}

chrome.alarms.create('acho-kick', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
chrome.runtime.onInstalled.addListener(() => loop());
loop();
