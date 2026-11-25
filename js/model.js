import { CORPSES, ITEMS } from "./data.js";

export const STEP = 2500;
export const MAX_XP = 5050000;
export const MAX_PERKS = Object.freeze({
  resourceful: 5, gifts: 100, deadMan: 50, milestone: 7, blueCheese: true, pity: 10,
});
export const NO_PERKS = Object.freeze({
  resourceful: 0, gifts: 0, deadMan: 0, milestone: 0, blueCheese: false, pity: 0,
});
export const DEFAULTS = Object.freeze({
  ...MAX_PERKS, fairy: 8.6, chest: 0, lock: true, guarantee: "pool",
  buy: "instant", sell: "instant", bzTax: 1.125, ahTax: 3, auto: true,
});

export function perkEffects(s) {
  const hotm = level => level + Number(s.blueCheese && level > 0);
  const reached = level => Number(s.milestone >= level);
  const extraRoll = (2 * hotm(s.gifts) + 100 * (reached(3) + reached(6))) / 1000;
  const extraCorpse = (5 * hotm(s.deadMan) + 100 * (reached(2) + reached(5))) / 1000;
  return { extraRoll, extraCorpse, normalCount: 2.5 + extraCorpse, saveKey: s.resourceful / 100, xpFactor: 1 + s.pity / 100 };
}

const DYE = "DYE_FROSTBITTEN";
export const TARGETS = Object.keys(ITEMS).filter(id => ITEMS[id].xp > 0);

export function buildModel(settings, prices) {
  const effects = perkEffects(settings);
  const fairy = settings.fairy / 100;
  const ordinary = (1 - fairy) * effects.normalCount;
  const count = ordinary + fairy;
  const frequencies = [ordinary / 2, ordinary / 4, ordinary / 4, fairy].map(n => n / count);
  const corpses = CORPSES.map(corpse => {
    const rows = [...corpse.pool];
    if (corpse.id === "vanguard" && settings.chest > 0) rows.push(["DEAD_MANS_CHESTPLATE", settings.chest, 1]);
    const weight = rows.reduce((sum, row) => sum + row[1], settings.lock ? 0 : corpse.crystalWeight);
    const normal = rows.reduce((sum, [id, w, quantity]) => sum + w * quantity * prices.sell[id], 0) / weight;
    const baseRoll = (1 - corpse.dye) * normal + corpse.dye * prices.sell[DYE];
    const rolls = corpse.minRolls + 1.5 + effects.extraRoll;
    const loot = rolls * baseRoll;
    const cost = corpse.key ? prices.buy[corpse.key] * (1 - effects.saveKey) : 0;
    const targets = [];
    for (const id of TARGETS) {
      const bundles = rows.filter(row => row[0] === id);
      const targetWeight = bundles.reduce((sum, row) => sum + row[1], 0);
      const isDye = id === DYE;
      if (!isDye && !targetWeight && settings.guarantee !== "any") continue;
      const share = isDye ? corpse.dye : targetWeight / weight;
      const probability = isDye ? share : (1 - corpse.dye) * share;
      const price = prices.sell[id];
      const bundleValue = targetWeight ? price * bundles.reduce((sum, row) => sum + row[1] * row[2], 0) / targetWeight : price;
      const otherValue = isDye ? normal : (normal - share * bundleValue) / (1 - share);
      targets.push({ id, threshold: ITEMS[id].xp, share, probability, price, gainPerHit: bundleValue - otherValue });
    }
    return { id: corpse.id, base: loot - cost, cost, loot, baseRoll, rolls, minRolls: corpse.minRolls,
      extraRoll: effects.extraRoll, xp: Math.round(corpse.xp * effects.xpFactor), targets };
  });
  return { corpses, frequencies, count };
}

// A guaranteed target replaces one roll. Natural hits settle once at the end of a corpse.
export function outcome(corpse, target, xp) {
  if (xp >= target.threshold) return { reward: corpse.base + target.price - corpse.baseRoll, miss: 0, guaranteed: true };
  const increase = 2 * xp / target.threshold;
  const boosted = target.probability * (1 + increase) / (1 + target.share * increase);
  const q = 1 - boosted;
  // Average q^n for four equally likely base roll counts, then mix in the independent bonus roll.
  const miss = q ** corpse.minRolls * (1 + q) * (1 + q * q) / 4 * (1 - corpse.extraRoll * boosted);
  return { reward: corpse.base + corpse.rolls * (boosted - target.probability) * target.gainPerHit, miss, guaranteed: false };
}

function valueAt(values, xp, step) {
  const index = Math.max(0, Math.min(values.length - 1, xp / step));
  const left = Math.floor(index);
  return values[left] + (index - left) * (values[Math.min(left + 1, values.length - 1)] - values[left]);
}

// Evaluate the present choice at the player's exact XP, including thresholds between grid points.
export function inspect(corpse, bias, xp, step = STEP) {
  const before = valueAt(bias, xp, step);
  const after = valueAt(bias, xp + corpse.xp, step);
  let value = corpse.base + after;
  let action = "none";
  for (const target of corpse.targets) {
    const { reward, miss, guaranteed } = outcome(corpse, target, xp);
    const future = guaranteed ? valueAt(bias, xp - target.threshold + corpse.xp, step) : miss * after + (1 - miss) * bias[0];
    if (reward + future > value) {
      value = reward + future;
      action = target.id;
    }
  }
  return { action: value > before ? action : "skip", margin: value - before };
}

function transition(offset, step) {
  const cells = offset / step;
  const shift = Math.floor(cells);
  return { shift, fraction: cells - shift };
}

function shiftedValue(bias, i, move) {
  const last = bias.length - 1;
  const left = i + move.shift;
  if (left >= last) return bias[last];
  if (left < 0) return bias[0];
  return bias[left] + move.fraction * (bias[left + 1] - bias[left]);
}

// Keep repeated probability and interpolation work outside the relative-value iteration.
function solveGrid(model, notify, step, limit, tolerance, seed) {
  const size = Math.ceil(MAX_XP / step) + 1;
  const prepared = model.corpses.map(corpse => ({
    next: transition(corpse.xp, step),
    actions: corpse.targets.map(target => {
      const reward = new Float64Array(size);
      const miss = new Float64Array(size);
      const firstGuaranteed = Math.ceil(target.threshold / step);
      const forced = transition(corpse.xp - target.threshold, step);
      for (let i = 0; i < size; i++) {
        const roll = outcome(corpse, target, i * step);
        reward[i] = roll.reward;
        miss[i] = roll.miss;
      }
      return { reward, miss, firstGuaranteed, forced };
    }),
  }));
  const policies = model.corpses.map(() => new Uint8Array(size));
  let bias = new Float64Array(size);
  let buffer = new Float64Array(size);
  const best = new Float64Array(size);
  const after = new Float64Array(size);
  const rate = Math.max(0, ...model.corpses.flatMap((c, i) => model.frequencies[i] > 0
    ? c.targets.map(t => (t.price - c.baseRoll) / t.threshold) : []));
  for (let i = 0; i < size; i++) {
    bias[i] = seed ? valueAt(seed.bias, i * step, seed.step) : i * step * rate;
  }
  let low, high;
  function sweep(record) {
    buffer.fill(0);
    for (const [c, corpse] of model.corpses.entries()) {
      const { next, actions } = prepared[c];
      for (let i = 0; i < size; i++) {
        after[i] = shiftedValue(bias, i, next);
        const open = corpse.base + after[i];
        best[i] = Math.max(bias[i], open);
        if (record) policies[c][i] = Number(open > bias[i]);
      }
      for (const [j, a] of actions.entries()) {
        for (let i = 0; i < size; i++) {
          // bias[0] is zero after normalization, so a natural hit has no continuation value.
          const future = i < a.firstGuaranteed ? a.miss[i] * after[i] : shiftedValue(bias, i, a.forced);
          const value = a.reward[i] + future;
          if (value > best[i]) {
            best[i] = value;
            if (record) policies[c][i] = j + 2;
          }
        }
      }
      for (let i = 0; i < size; i++) buffer[i] += model.frequencies[c] * best[i];
    }
    low = Infinity;
    high = -Infinity;
    const origin = buffer[0] * 0.85;
    for (let i = 0; i < size; i++) {
      const residual = buffer[i] - bias[i];
      low = Math.min(low, residual);
      high = Math.max(high, residual);
      buffer[i] = bias[i] + 0.85 * residual - origin;
    }
  }
  let iterations = 0;
  while (iterations < limit) {
    sweep(false);
    iterations++;
    [bias, buffer] = [buffer, bias];
    if (high - low < tolerance) break;
    if (iterations % 250 === 0) notify(iterations);
  }
  sweep(true);
  return { bias, policies, step, iterations, low: low * model.count, high: high * model.count, estimate: (low + high) / 2 * model.count };
}

export function solve(model, notify = () => {}, { step = STEP, limit = 6000, tolerance = 800 } = {}) {
  // A coarse pass propagates high-XP guarantees before refining the full policy and its bounds.
  const seed = step === STEP ? solveGrid(model, () => {}, 25000, Math.min(limit, 4500), tolerance, null) : null;
  return solveGrid(model, notify, step, limit, tolerance, seed);
}

export function policyBands(policy, corpse, step) {
  const ids = ["skip", "none", ...corpse.targets.map(t => t.id)];
  const bands = [];
  for (let start = 0, end = 1; end <= policy.length; end++) {
    if (end < policy.length && policy[end] === policy[start]) continue;
    bands.push({ from: start * step, to: (end - 1) * step, length: end - start, id: ids[policy[start]] });
    start = end;
  }
  return bands;
}
