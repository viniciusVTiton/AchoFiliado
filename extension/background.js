/**
 * Fica ligado ao robô (http://localhost:3000) esperando pedidos de link do Mercado Livre.
 * Cada pedido é atendido dentro de uma aba do Mercado Livre (onde você está logado).
 */
import { mlCreateLink, mlSyncCoupons, readMlListing, mlCreateAffiliateList, mlListOps } from './ml.js';

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
async function inTab(url, func, args, world = 'ISOLATED') {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve) => {
      // Só vale o "carregou" da página de verdade (não o da aba em branco do começo).
      const done = (id, info, t) => {
        // Busca com filtro abre antes uma tela de "carregando" (?loader=true) e depois recarrega: espera a página final.
        if (id === tab.id && info.status === 'complete' && /^https:/.test(t?.url ?? '') && !/[?&]loader=true/.test(t?.url ?? '')) {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(resolve, 25_000);
    });
    // Limite de tempo: se a página travar, devolve erro em vez de deixar o pedido sem resposta.
    const run = chrome.scripting.executeScript({ target: { tabId: tab.id }, world, func, args });
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error(`A página ${new URL(url).host} demorou demais para responder`)), 90_000));
    const [r] = await Promise.race([run, late]);
    return r?.result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Espera a aba terminar de carregar a página final (não a tela de "carregando" da busca). */
async function pageReady(tabId, maxMs = 20_000) {
  const ok = (t) => t?.status === 'complete' && /^https:/.test(t?.url ?? '') && !/[?&]loader=true/.test(t?.url ?? '');
  if (ok(await chrome.tabs.get(tabId).catch(() => null))) return;
  await new Promise((resolve) => {
    const done = (id, info, t) => {
      if (id === tabId && info.status === 'complete' && ok(t)) {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(done);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, maxMs);
  });
}

/**
 * Lê os produtos de uma busca do Mercado Livre. Com filtro, o Mercado Livre passa por
 * uma ou duas telas de "carregando" antes da página final: tenta de novo até achar os produtos.
 */
async function readListingTab(url, limit) {
  const tab = await chrome.tabs.create({ url, active: false });
  let last = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await pageReady(tab.id);
      try {
        const run = chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readMlListing, args: [limit] });
        const late = new Promise((_, reject) => setTimeout(() => reject(new Error('demorou')), 30_000));
        const [r] = await Promise.race([run, late]);
        last = r?.result ?? null;
      } catch {
        last = null; // a página trocou no meio da leitura: lê de novo
      }
      if (Array.isArray(last) && last.length) return last;
      if (last?.blocked || last?.noResults) return last;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return last;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Produtos válidos do cupom para cada palavra ("notebook", "playstation 5"), já com o seu link. */
/**
 * Filtros da busca do Mercado Livre no endereço: preço ("_PriceRange_2400-0") e ordem ("_OrderId_PRICE").
 * O filtro de preço do Mercado Livre usa o preço do anúncio antes de cupom.
 */
export function searchUrl(productsUrl, word, { minPrice = 0, maxPrice = 0, sort = '' } = {}) {
  const slug = encodeURIComponent(String(word).trim().toLowerCase().replace(/\s+/g, '-'));
  const u = new URL(productsUrl);
  // "/_Container_…" → "/notebook_Container_…"; categoria "/saude/" → "/saude/whey"
  const base = u.pathname.replace(/\/+$/, '');
  // Os filtros vão logo depois da palavra, na ordem do próprio Mercado Livre (ordem, preço, depois o resto).
  // Em outra ordem ele devolve uma tela de "carregando" que só redireciona com a aba visível.
  const min = Math.max(0, Math.floor(Number(minPrice) || 0));
  const max = Math.max(0, Math.ceil(Number(maxPrice) || 0));
  let filters = '';
  if (sort === 'price_asc') filters += '_OrderId_PRICE';
  if (sort === 'price_desc') filters += '_OrderId_PRICE*DESC';
  if (min || max) filters += `_PriceRange_${min}-${max}`;
  u.pathname = base.startsWith('/_') || !base
    ? `/${slug}${filters}${base.replace(/^\//, '')}`
    : `${base}/${slug}${filters}`;
  return u.toString();
}

const toNumber = (s) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;

async function searchCouponProducts({ productsUrl, keywords = [], perKeyword = 3, minPrice = 0, maxPrice = 0, sort = '' }, tag, { links = true } = {}) {
  // Só a lista oficial do cupom ("_Container_…") garante que todo produto achado aceita o cupom.
  if (!/^https:\/\/lista\.mercadolivre\.com\.br\/_Container_/.test(productsUrl ?? '')) {
    return { error: 'Este cupom não tem uma lista oficial de produtos para procurar (o Mercado Livre mostra só uma página de ofertas ou de categoria), então não dá para garantir que o produto aceita o cupom. Abra "Produtos válidos" e cole os links na lista.' };
  }
  if (links && !tag) return { error: 'Etiqueta do Mercado Livre (ML_TAG) não configurada no robô' };
  const groups = [];
  for (const word of keywords.slice(0, 8)) {
    const url = searchUrl(productsUrl, word, { minPrice, maxPrice, sort });
    const found = (await readListingTab(url, Math.min(Number(perKeyword) || 3, 10))) ?? null;
    if (found?.blocked) {
      return { error: 'O Mercado Livre pediu uma verificação de segurança. Abra o Mercado Livre no Chrome, confirme que é você e tente de novo.' };
    }
    // Uma pausa entre as buscas, para o Mercado Livre não estranhar.
    await new Promise((r) => setTimeout(r, 2500));
    const items = [];
    if (!Array.isArray(found)) {
      groups.push({ keyword: word, items: [], debug: found?.empty ? found : { page: url, note: 'a aba não devolveu nada' } });
      continue;
    }
    // Confere de novo o preço (o Mercado Livre já filtra; aqui é só uma garantia).
    // O cartão pode mostrar o preço já com algum desconto, então vale o maior entre "de" e "por".
    const inRange = (it) => {
      const base = Math.max(toNumber(it.price), toNumber(it.oldPrice));
      if (Number(minPrice) > 0 && base > 0 && base < Number(minPrice)) return false;
      if (Number(maxPrice) > 0 && toNumber(it.price) > Number(maxPrice)) return false;
      return true;
    };
    const rawCount = found.length;
    found.splice(0, found.length, ...found.filter(inRange));
    if (!links) {
      groups.push({ keyword: word, items: found });
      continue;
    }
    const linkErrors = [];
    for (const item of found) {
      try {
        const late = new Promise((_, reject) => setTimeout(() => reject(new Error('o gerador de links demorou demais')), 30_000));
        const link = await Promise.race([generateLink(item.url, tag), late]);
        if (link?.shortUrl) items.push({ ...item, affiliateUrl: link.shortUrl });
        else linkErrors.push(link?.error || 'sem link');
      } catch (e) {
        // sem link de afiliado, o produto fica de fora (nunca vai link sem a sua etiqueta)
        linkErrors.push(e.message);
      }
    }
    groups.push({ keyword: word, items, ...(items.length ? {} : { debug: { read: rawCount, inPrice: found.length, prices: found.slice(0, 3).map((i) => `${i.price}|${i.oldPrice}`), linkErrors: linkErrors.slice(0, 3) } }) });
  }
  return { groups };
}

/**
 * Lista de afiliado no Mercado Livre: procura os produtos válidos do cupom e cria a lista
 * no seu perfil, com um link só para mandar no grupo.
 */
async function createCouponList(job) {
  const search = await searchCouponProducts(job, '', { links: false });
  if (search.error) return search;
  const seen = new Set();
  const items = [];
  for (const g of search.groups) {
    for (const it of g.items ?? []) {
      if (!it.itemId || seen.has(it.itemId)) continue;
      seen.add(it.itemId);
      items.push(it);
    }
  }
  if (!items.length) return { groups: search.groups, url: '', added: 0 };
  const made = await inTab(
    'https://myaccount.mercadolivre.com.br/bookmarks/list?tab=list',
    mlCreateAffiliateList,
    [String(job.name || 'Ofertas').slice(0, 60), items.map((i) => i.itemId)],
    'MAIN',
  );
  if (!made) return { error: 'A página de listas do Mercado Livre não respondeu' };
  if (made.error && !made.url) return { error: made.error };
  return { groups: search.groups, url: made.url, added: made.added, failed: made.failed ?? [] };
}

const LISTS_PAGE = 'https://myaccount.mercadolivre.com.br/bookmarks/list?tab=list';

/** Uma operação nas suas listas de afiliado (ler, adicionar, remover, renomear, excluir, publicar). */
async function listOp(op, args) {
  const r = await inTab(LISTS_PAGE, mlListOps, [op, args ?? {}], 'MAIN');
  return r ?? { error: 'A página de listas do Mercado Livre não respondeu' };
}

/** Mais produtos do cupom numa lista que já existe (só os que ainda não estão nela). */
async function addMoreFromCoupon(job) {
  const search = await searchCouponProducts(job, '', { links: false });
  if (search.error) return search;
  const current = await listOp('items', { listId: job.listId });
  if (current.error) return current;
  const have = new Set((current.items ?? []).map((i) => i.itemId));
  const ids = [];
  for (const g of search.groups) {
    for (const it of g.items ?? []) {
      if (it.itemId && !have.has(it.itemId) && !ids.includes(it.itemId)) ids.push(it.itemId);
    }
  }
  if (!ids.length) return { groups: search.groups, added: 0, failed: [] };
  const r = await listOp('add', { listId: job.listId, itemIds: ids });
  if (r.error) return r;
  return { groups: search.groups, added: r.added, failed: r.failed ?? [] };
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
      // Lista de afiliado no Mercado Livre com os produtos válidos do cupom (um link só).
      if (job.kind === 'couponMlList') {
        let result;
        try {
          result = await createCouponList(job);
        } catch (e) {
          result = { error: e.message };
        }
        await post('/api/ml/result', { id: job.id, data: result.error ? undefined : result, error: result.error ?? '' });
        continue;
      }
      // Suas listas de afiliado: ler, editar, excluir e completar com mais produtos do cupom.
      if (job.kind === 'mlListOp' || job.kind === 'couponMlListMore') {
        let result;
        try {
          result = job.kind === 'mlListOp' ? await listOp(job.op, job.args) : await addMoreFromCoupon(job);
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
