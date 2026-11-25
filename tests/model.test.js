import test from "node:test";
import assert from "node:assert/strict";
import { CORPSES, ITEMS } from "../js/data.js";
import { buildModel, DEFAULTS, inspect, MAX_XP, NO_PERKS, outcome, perkEffects, policyBands, solve } from "../js/model.js";
import { valueMarket } from "../js/market.js";
import { REFERENCE } from "../js/reference.js";

const near = (actual, expected, precision = 1e-8) => assert.ok(Math.abs(actual - expected) < precision, `${actual} != ${expected}`);
function fixture(perks = {}) {
  const s = { ...DEFAULTS, ...perks };
  return buildModel(s, valueMarket(REFERENCE, {}, s));
}

test("maxed and untrained loadouts reproduce the published roll, key, XP and spawn effects", () => {
  const max = perkEffects(DEFAULTS), zero = perkEffects(NO_PERKS);
  near(max.extraRoll, 0.402); near(max.normalCount, 2.955); near(max.saveKey, .05); near(max.xpFactor, 1.1);
  near(zero.extraRoll, 0); near(zero.normalCount, 2.5); near(zero.saveKey, 0); near(zero.xpFactor, 1);
  const maxModel = fixture(), zeroModel = fixture(NO_PERKS);
  for (const [i, c] of maxModel.corpses.entries()) {
    near(c.rolls, CORPSES[i].minRolls + 1.902); near(c.cost, zeroModel.corpses[i].cost * .95);
    near(c.xp, CORPSES[i].xp * 1.1);
    near(c.loot, zeroModel.corpses[i].loot / zeroModel.corpses[i].rolls * c.rolls);
  }
});

test("the omelette only upgrades learned HotM perks and can pass the trained cap", () => {
  const omelette = { ...NO_PERKS, blueCheese: true };
  assert.deepEqual(perkEffects(omelette), perkEffects(NO_PERKS));
  near(perkEffects({ ...omelette, gifts: 1 }).extraRoll, .004);
  near(perkEffects({ ...omelette, deadMan: 1 }).extraCorpse, .01);
  near(perkEffects({ ...omelette, gifts: 100 }).extraRoll, .202);
  near(perkEffects({ ...omelette, deadMan: 50 }).extraCorpse, .255);
  near(perkEffects({ ...omelette, resourceful: 3, pity: 7 }).saveKey, .03);
  near(perkEffects({ ...omelette, resourceful: 3, pity: 7 }).xpFactor, 1.07);
});

test("milestone II/V affect spawns and III/VI affect loot cumulatively", () => {
  const spawns = [0, 0, .1, .1, .1, .2, .2, .2], rolls = [0, 0, 0, .1, .1, .1, .2, .2];
  for (let milestone = 0; milestone <= 7; milestone++) {
    const effects = perkEffects({ ...NO_PERKS, milestone });
    near(effects.extraCorpse, spawns[milestone]); near(effects.extraRoll, rolls[milestone]);
  }
});

test("Fairy shafts always contain one Vanguard and spawn perks affect only regular shafts", () => {
  const regular = fixture({ ...NO_PERKS, fairy: 0 }), fairy = fixture({ fairy: 100 }), mixed = fixture();
  near(regular.count, 2.5); assert.deepEqual(regular.frequencies, [.5, .25, .25, 0]);
  near(fairy.count, 1); assert.deepEqual(fairy.frequencies, [0, 0, 0, 1]);
  near(mixed.count, .914 * 2.955 + .086);
  near(mixed.frequencies.reduce((a, b) => a + b, 0), 1);
});

test("natural target miss probability uses the full configured roll distribution", () => {
  for (const levels of [NO_PERKS, { gifts: 37, milestone: 3, blueCheese: false }, DEFAULTS]) {
    const c = fixture(levels).corpses[1];
    for (const id of ["FROZEN_SCUTE", "DYE_FROSTBITTEN"]) {
      const target = c.targets.find(t => t.id === id);
      for (const progress of [0, .5, .999]) {
        const p = target.probability * (1 + 2 * progress) / (1 + target.share * 2 * progress);
        let miss = 0;
        for (let n = c.minRolls; n < c.minRolls + 4; n++) {
          miss += ((1 - c.extraRoll) * (1 - p) ** n + c.extraRoll * (1 - p) ** (n + 1)) / 4;
        }
        const roll = outcome(c, target, target.threshold * progress);
        near(roll.miss, miss); assert.equal(roll.guaranteed, false);
        if (!progress) near(roll.reward, c.base);
      }
    }
  }
});

test("non-grid guarantees, crystal weights, unknown chestplate weight and pool eligibility", () => {
  const normal = fixture(), metal = normal.corpses[1];
  const target = metal.targets.find(t => t.id === "DEAD_MANS_CHESTPLATE");
  assert.equal(outcome(metal, target, 11999).guaranteed, false);
  const forced = outcome(metal, target, 12000);
  assert.equal(forced.guaranteed, true); near(forced.reward, metal.base + target.price - metal.baseRoll);
  assert.ok(!normal.corpses[0].targets.some(t => t.id === "SHATTERED_PENDANT"));
  const any = fixture({ guarantee: "any" }).corpses[0];
  const locket = any.targets.find(t => t.id === "SHATTERED_PENDANT");
  near(outcome(any, locket, 2400000).miss, 1);
  assert.equal(outcome(any, locket, 2500000).guaranteed, true);
  assert.ok(!normal.corpses[3].targets.some(t => t.id === "DEAD_MANS_CHESTPLATE"));
  assert.ok(fixture({ chest: 20 }).corpses[3].targets.some(t => t.id === "DEAD_MANS_CHESTPLATE"));
  assert.ok(fixture({ lock: false }).corpses[1].loot < metal.loot);
  near(fixture({ lock: false }).corpses[0].loot, normal.corpses[0].loot);
});

test("exact-XP decisions switch at the threshold even when it falls inside a grid cell", () => {
  const c = { base: -10, baseRoll: 0, xp: 550, rolls: 4.5, extraRoll: 0, minRolls: 3,
    targets: [{ id: "reward", price: 90, threshold: 12000, probability: 0, share: 0, gainPerHit: 0 }] };
  const bias = new Float64Array(10);
  assert.equal(inspect(c, bias, 11999).action, "skip");
  assert.deepEqual(inspect(c, bias, 12000), { action: "reward", margin: 80 });
});

test("Bellman objective, policy IDs and inclusive intervals agree with exact inspection on the grid", () => {
  const m = fixture(), sol = solve(m, () => {}, { step: 25000, limit: 28 });
  assert.ok(Number.isFinite(sol.low) && sol.low <= sol.estimate && sol.estimate <= sol.high);
  for (const [i, c] of m.corpses.entries()) {
    const bands = policyBands(sol.policies[i], c, sol.step);
    assert.equal(bands[0].from, 0); assert.equal(bands.at(-1).to, MAX_XP);
    const actions = ["skip", "none", ...c.targets.map(t => t.id)];
    for (let j = 0; j < sol.policies[i].length; j++) {
      assert.equal(inspect(c, sol.bias, j * sol.step, sol.step).action, actions[sol.policies[i][j]]);
    }
    bands.slice(1).forEach((band, index) => assert.equal(band.from, bands[index].to + sol.step));
  }
  const flat = { corpses: [{ ...m.corpses[0], base: 200, targets: [] }], frequencies: [1], count: 2 };
  const simple = solve(flat, () => {}, { step: 25000 });
  near(simple.low, 400); near(simple.high, 400);
  assert.ok(Object.values(ITEMS).every(item => item.en && item.zh));
});
