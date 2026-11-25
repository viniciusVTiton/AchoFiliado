/**
 * Fica ligado ao robô (http://localhost:3000) esperando pedidos de link do Mercado Livre.
 * Cada pedido é atendido dentro de uma aba do Mercado Livre (onde você está logado).
 */
import { mlCreateLink, mlSyncCoupons, readMlListing } from './ml.js';

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

/** Abre uma página em segundo plano, roda uma função nela e fecha a aba. */
async function inTab(url, func, args) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve) => {
      const done = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(resolve, 25_000);
    });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return r?.result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Produtos válidos do cupom para cada palavra ("notebook", "playstation 5"), já com o seu link. */
async function searchCouponProducts({ productsUrl, keywords = [], perKeyword = 3 }, tag) {
  if (!/^https:\/\/lista\.mercadolivre\.com\.br\//.test(productsUrl ?? '')) return { error: 'Cupom sem lista de produtos do Mercado Livre' };
  if (!tag) return { error: 'Etiqueta do Mercado Livre (ML_TAG) não configurada no robô' };
  const groups = [];
  for (const word of keywords.slice(0, 8)) {
    const slug = encodeURIComponent(String(word).trim().toLowerCase().replace(/\s+/g, '-'));
    const url = productsUrl.replace('https://lista.mercadolivre.com.br/', `https://lista.mercadolivre.com.br/${slug}`);
    const found = (await inTab(url, readMlListing, [Math.min(Number(perKeyword) || 3, 10)])) ?? [];
    if (found.blocked) {
      return { error: 'O Mercado Livre pediu uma verificação de segurança. Abra o Mercado Livre no Chrome, confirme que é você e tente de novo.' };
    }
    // Uma pausa entre as buscas, para o Mercado Livre não estranhar.
    await new Promise((r) => setTimeout(r, 2500));
    const items = [];
    for (const item of found) {
      try {
        const link = await generateLink(item.url, tag);
        if (link?.shortUrl) items.push({ ...item, affiliateUrl: link.shortUrl });
      } catch {
        // sem link de afiliado, o produto fica de fora (nunca vai link sem a sua etiqueta)
      }
    }
    groups.push({ keyword: word, items });
  }
  return { groups };
}

/** Abre a página de cupons em segundo plano, roda a leitura e fecha a aba. */
async function syncCoupons(codes) {
  const tab = await chrome.tabs.create({ url: 'https://www.mercadolivre.com.br/cupons', active: false });
  try {
    await new Promise((resolve) => {
      const done = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(resolve, 25_000);
    });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: mlSyncCoupons, args: [codes] });
    return r?.result ?? { error: 'A página de cupons não respondeu' };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
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
      // Lista do cupom: procura cada palavra nos produtos válidos do cupom e gera o seu link de cada um.
      if (job.kind === 'couponSearch') {
        let result;
        try {
          result = await searchCouponProducts(job, tag);
        } catch (e) {
          result = { error: e.message };
        }
        await post('/api/ml/result', { id: job.id, data: result.error ? undefined : result, error: result.error ?? '' });
        continue;
      }
      // Tarefa de cupons: lê (e ativa) os seus cupons numa aba da página de cupons.
      if (job.kind === 'coupons') {
        let result;
        try {
          result = await syncCoupons(job.codes ?? []);
        } catch (e) {
          result = { error: e.message };
        }
        await post('/api/ml/result', { id: job.id, data: result.error ? undefined : result, error: result.error ?? '' });
        continue;
      }
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
