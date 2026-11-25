import { CORPSES, ITEMS } from "./data.js";

const KEYS = new Set(CORPSES.map(c => c.key).filter(Boolean));
const BAZAAR = "https://api.hypixel.net/v2/skyblock/bazaar";
const CATALOG = "https://api.hypixel.net/v2/resources/skyblock/items";
const AH = "https://raw.githubusercontent.com/SkyHelperBot/Prices/main/prices.json";
const BIN = "https://sky.coflnet.com/api/item/price/";
export const positive = n => Number.isFinite(n) && n > 0;

export function bookPrice(rows, side) {
  const prices = (rows || []).filter(order => order.amount > 0 && positive(order.pricePerUnit)).map(order => order.pricePerUnit);
  return prices.length ? (side === "ask" ? Math.min(...prices) : Math.max(...prices)) : null;
}

export function valueMarket(snapshot, overrides, settings) {
  const sell = {}, buy = {}, missing = [];
  for (const [id, item] of Object.entries(ITEMS)) {
    const q = snapshot.quotes[id] || {};
    const bazaar = (q.market || item.market) === "BZ";
    const manual = positive(overrides[id]) ? overrides[id] : null;
    const rawBuy = manual ?? (bazaar ? q[settings.buy === "instant" ? "ask" : "bid"] : q.ah);
    const rawSell = manual ?? (bazaar ? q[settings.sell === "instant" ? "bid" : "ask"] : q.ah);
    const floor = q.npc || item.npc;
    sell[id] = Math.max((rawSell || 0) * (1 - (bazaar ? settings.bzTax : settings.ahTax) / 100), floor);
    buy[id] = rawBuy ?? null;
    if (!positive(rawSell) && !floor) missing.push({ id, side: "sell" });
    if (KEYS.has(id) && !positive(rawBuy)) missing.push({ id, side: "buy" });
  }
  return { sell, buy, missing };
}

async function json(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw Error(String(response.status));
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

let catalogCache;
async function catalog() {
  if (catalogCache && Date.now() - catalogCache.time < 6 * 3600000) return catalogCache.items;
  const result = await json(CATALOG);
  if (!result.success || !Array.isArray(result.items)) throw Error("catalog");
  catalogCache = { items: result.items, time: Date.now() };
  return catalogCache.items;
}

async function lowestBin(id) {
  const response = await json(BIN + encodeURIComponent(id) + "/bin");
  return typeof response === "number" ? response : response?.lowestBin ?? response?.price;
}

export async function assembleSnapshot({ bazaar, auctions, catalogItems, fetchedAt }, previous, binLookup = lowestBin) {
  const products = bazaar?.success ? bazaar.products : null;
  const byId = new Map((catalogItems || []).map(i => [i.id, i]));
  const byName = new Map((catalogItems || []).map(i => [i.name?.replace(/§./g, ""), i]));
  const issues = new Set();
  if (!products) issues.add("bazaar");
  if (!catalogItems) issues.add("catalog");
  const quotes = {};
  await Promise.all(Object.entries(ITEMS).map(async ([id, item]) => {
    const prior = previous?.quotes[id] || {};
    const info = byId.get(id) || byName.get(item.en);
    const actualId = info?.id || id;
    const npc = Math.max(item.npc, Number(info?.npc_sell_price) || (!catalogItems ? prior.npc : 0) || 0);
    const product = products?.[id] || products?.[actualId];
    if (product) {
      quotes[id] = { market: "BZ", ask: bookPrice(product.buy_summary, "ask"), bid: bookPrice(product.sell_summary, "bid"), npc, source: "bazaar", at: bazaar.lastUpdated || fetchedAt };
      return;
    }
    if (item.market === "BZ") {
      // A successful empty book is meaningful. Only an unavailable feed may reuse its previous book.
      quotes[id] = products ? { market: "BZ", npc, source: "absent", at: fetchedAt } : { ...prior, market: "BZ", npc };
      return;
    }
    const price = auctions?.[id.toLowerCase()] ?? auctions?.[actualId.toLowerCase()] ?? auctions?.[id];
    if (positive(price)) {
      quotes[id] = { market: "AH", ah: price, npc, source: "skyhelper", at: fetchedAt };
      return;
    }
    try {
      const bin = await binLookup(actualId);
      quotes[id] = { market: "AH", ah: positive(bin) ? bin : null, npc, source: positive(bin) ? "coflnet" : "absent", at: fetchedAt };
    } catch {
      issues.add("auctions");
      quotes[id] = { ...prior, market: "AH", npc };
    }
  }));
  return { quotes, bazaarAt: products ? bazaar.lastUpdated || fetchedAt : previous?.bazaarAt || 0, issues: [...issues], fetchedAt };
}

export async function refreshMarket(previous) {
  const [bz, ah, items] = await Promise.allSettled([json(BAZAAR), json(AH), catalog()]);
  return assembleSnapshot({ bazaar: bz.value, auctions: ah.value, catalogItems: items.value, fetchedAt: Date.now() }, previous);
}
