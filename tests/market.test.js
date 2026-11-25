import test from "node:test";
import assert from "node:assert/strict";
import { assembleSnapshot, bookPrice, valueMarket } from "../js/market.js";
import { DEFAULTS } from "../js/model.js";
import { REFERENCE } from "../js/reference.js";
import { ITEMS } from "../js/data.js";

const item = "TUNGSTEN_KEY";
const snapshot = { quotes: { ...REFERENCE.quotes, [item]: { market: "BZ", ask: 100, bid: 80, npc: 0 } } };
test("Bazaar sides use the best executable price across non-empty book entries", () => {
  const rows = [{ amount: 1, pricePerUnit: 7 }, { amount: 0, pricePerUnit: 1 }, { amount: 10, pricePerUnit: 5 }];
  assert.equal(bookPrice(rows, "ask"), 5); assert.equal(bookPrice(rows, "bid"), 7);
  assert.equal(bookPrice([], "ask"), null);
  for (const buy of ["instant", "order"]) for (const sell of ["instant", "order"]) {
    const values = valueMarket(snapshot, {}, { ...DEFAULTS, bzTax: 10, buy, sell });
    assert.equal(values.buy[item], buy === "instant" ? 100 : 80);
    assert.equal(values.sell[item], (sell === "instant" ? 80 : 100) * .9);
  }
});

test("manual prices apply before tax, sale floors apply after tax, key buys require a quote", () => {
  const manual = valueMarket(snapshot, { [item]: 30, CAGED_WISP: 100 }, { ...DEFAULTS, bzTax: 10, ahTax: 3 });
  assert.equal(manual.buy[item], 30); assert.equal(manual.sell[item], 27);
  assert.equal(manual.sell.CAGED_WISP, snapshot.quotes.CAGED_WISP.npc);
  const partial = { quotes: { ...snapshot.quotes, [item]: { npc: 20 }, GLACITE_JEWEL: {} } };
  const values = valueMarket(partial, {}, DEFAULTS);
  assert.deepEqual(values.missing, [{ id: item, side: "buy" }, { id: "GLACITE_JEWEL", side: "sell" }]);
  assert.deepEqual(valueMarket(partial, { [item]: 100, GLACITE_JEWEL: 10 }, DEFAULTS).missing, []);
});

test("a feed outage preserves dated quotes and fresh empty books stay empty", async () => {
  const notAvailable = async () => { throw Error("offline"); };
  const offline = await assembleSnapshot({ fetchedAt: REFERENCE.fetchedAt + 1000 }, REFERENCE, notAvailable);
  assert.equal(offline.bazaarAt, REFERENCE.bazaarAt);
  assert.deepEqual(offline.quotes[item], REFERENCE.quotes[item]);
  assert.deepEqual(offline.quotes.DYE_FROSTBITTEN, REFERENCE.quotes.DYE_FROSTBITTEN);
  assert.deepEqual(new Set(offline.issues), new Set(["bazaar", "catalog", "auctions"]));
  const empty = await assembleSnapshot({ bazaar: { success: true, lastUpdated: 200, products: { [item]: { buy_summary: [], sell_summary: [] } } }, fetchedAt: 201 }, REFERENCE, async () => 11);
  assert.equal(empty.quotes[item].ask, null); assert.equal(empty.quotes[item].bid, null);
  assert.equal(empty.quotes.DYE_FROSTBITTEN.ah, 11); assert.equal(empty.quotes.DYE_FROSTBITTEN.source, "coflnet");
});

test("the dated opening snapshot covers all tradable items in both Bazaar modes", () => {
  assert.equal(Object.keys(REFERENCE.quotes).length, Object.keys(ITEMS).length);
  for (const mode of ["instant", "order"]) assert.deepEqual(valueMarket(REFERENCE, {}, { ...DEFAULTS, buy: mode, sell: mode }).missing, []);
});
