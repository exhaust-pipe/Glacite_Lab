import { CORPSES, ITEMS } from "./data.js";
import { COPY, translate } from "./i18n.js";
import { buildModel, DEFAULTS, inspect, MAX_PERKS, MAX_XP, NO_PERKS, perkEffects, policyBands, STEP, TARGETS } from "./model.js";
import { positive, refreshMarket, valueMarket } from "./market.js";
import { REFERENCE } from "./reference.js";

const $ = id => document.getElementById(id);
const storageKey = "glacite-lab/v2/";
function read(key) {
  try { return JSON.parse(localStorage.getItem(storageKey + key)); } catch { return null; }
}
function save(key, data) {
  try { localStorage.setItem(storageKey + key, JSON.stringify(data)); } catch { /* Private browsing can disable storage. */ }
}
function node(tag, text, cls) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
function row(body, values) {
  const tr = body.insertRow();
  values.forEach(value => {
    const cell = tr.insertCell();
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value;
  });
  return tr;
}

let language = read("language") === "zh" ? "zh" : "en";
const t = (key, vars) => translate(language, key, vars);
const locale = () => language === "zh" ? "zh-CN" : "en-US";
let number, compact, decimals, date;
function formats() {
  number = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 });
  decimals = new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 });
  compact = new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 2 });
  date = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" });
}
const amount = n => Number.isFinite(n) ? (Math.abs(n) >= 100000 ? compact : decimals).format(n) : "—";
const coin = n => Number.isFinite(n) ? decimals.format(n) : "—";
const actionName = id => id === "skip" || id === "none" ? t(id) : t("openTarget", { item: ITEMS[id][language] });
const saved = read("preferences") || {};
const config = { ...DEFAULTS };
const overrides = Object.fromEntries(Object.entries(saved.overrides || {}).filter(([id, n]) => Object.hasOwn(ITEMS, id) && positive(n)));
const savedMarket = read("market");
const cached = savedMarket?.quotes && savedMarket.bazaarAt >= REFERENCE.bazaarAt && Array.isArray(savedMarket.issues);
let snapshot = cached ? savedMarket : REFERENCE;
let origin = cached ? "cached" : "reference";
let refreshing = false;
let prices, model, result, worker;
let solveKey = "", state = "waiting", iteration = 0, serial = 0, scheduled;
let xp = Number.isInteger(saved.xp) && saved.xp >= 0 && saved.xp <= MAX_XP ? saved.xp : 0;
const priceRows = new Map();
const brokenIds = () => new Set(prices.missing.map(m => m.id));

function translatedText(element, key) {
  element.dataset.i = key;
  element.textContent = t(key);
  return element;
}

function createPerks() {
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII"];
  for (const id of ["resourceful", "gifts", "deadMan", "milestone", "pity", "blueCheese"]) {
    const wrapper = node("div", null, "perk-row");
    const copy = node("div");
    const label = translatedText(node("label"), id);
    label.htmlFor = id;
    if (language === "zh") label.title = COPY[id][0];
    const hint = translatedText(node("span", null, "hint"), id === "blueCheese" ? "blueInfo" : id + "Info");
    hint.id = id + "-hint";
    copy.append(label, hint);
    const input = node(id === "milestone" ? "select" : "input");
    input.id = id;
    input.setAttribute("aria-describedby", hint.id);
    wrapper.append(copy);
    if (id === "blueCheese") {
      input.type = "checkbox";
      input.className = "switch";
      input.setAttribute("role", "switch");
      wrapper.append(input);
    } else if (id === "milestone") {
      roman.forEach((stage, i) => {
        const option = node("option", stage);
        if (!i) translatedText(option, "off");
        option.value = i;
        input.append(option);
      });
      wrapper.append(input);
    } else {
      const stepper = node("div", null, "stepper");
      input.type = "number"; input.min = 0; input.max = MAX_PERKS[id]; input.step = 1; input.required = true;
      input.inputMode = "numeric";
      const buttons = [-1, 1].map(direction => {
        const btn = node("button", direction < 0 ? "−" : "+");
        btn.type = "button"; btn.dataset.adjust = id; btn.dataset.direction = direction;
        btn.onclick = () => {
          const old = input.valueAsNumber;
          input.value = Math.max(0, Math.min(MAX_PERKS[id], (Number.isFinite(old) ? old : 0) + direction));
          input.dispatchEvent(new Event("change"));
        };
        return btn;
      });
      stepper.append(buttons[0], input, buttons[1]);
      wrapper.append(stepper);
    }
    $("perk-fields").append(wrapper);
  }
}

function setField(id, value) {
  const field = $(id);
  if (field.type === "checkbox") field.checked = value === true;
  else field.value = value;
}
function getField(id) {
  const field = $(id);
  if (field.type === "checkbox") return field.checked;
  return typeof DEFAULTS[id] === "number" ? Number(field.value) : field.value;
}
function valid(id) {
  const field = $(id);
  return field.type === "checkbox" || (field.value !== "" && field.checkValidity());
}
function savePrefs() { save("preferences", { settings: config, overrides, xp }); }
function readControls() {
  let allValid = true;
  for (const id of Object.keys(DEFAULTS)) {
    if (valid(id)) config[id] = getField(id);
    else allValid = false;
  }
  return allValid;
}

function drawPerks() {
  for (const button of document.querySelectorAll("[data-adjust]")) {
    const { adjust, direction } = button.dataset;
    const plus = Number(direction) > 0;
    button.disabled = plus ? config[adjust] >= MAX_PERKS[adjust] : config[adjust] <= 0;
    button.setAttribute("aria-label", t(plus ? "increase" : "decrease", { perk: t(adjust) }));
  }
  for (const id of Object.keys(MAX_PERKS)) document.querySelector(`label[for="${id}"]`).title = language === "zh" ? COPY[id][0] : "";
  for (const [button, preset] of [["max-perks", MAX_PERKS], ["no-perks", NO_PERKS]]) {
    $(button).setAttribute("aria-pressed", String(Object.entries(preset).every(([key, value]) => config[key] === value)));
  }
  const effects = perkEffects(config);
  const percent = new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 1 });
  $("effect-roll").textContent = percent.format(effects.extraRoll);
  $("effect-key").textContent = percent.format(effects.saveKey);
  $("effect-count").textContent = decimals.format(effects.normalCount);
}

function drawFeed() {
  const missing = brokenIds().size;
  const issues = snapshot.issues;
  let key = origin, tone = "neutral";
  if (origin === "live") {
    const stale = Date.now() - snapshot.bazaarAt > 300000;
    key = issues.length ? "partial" : stale ? "stale" : "live";
    tone = issues.length || stale || missing ? "warn" : "live";
  } else if (issues.length) tone = "warn";
  $("feed-state").textContent = t(key);
  $("feed-state").dataset.tone = tone;
  const notes = [t("priceTime", { time: date.format(snapshot.bazaarAt) }), t("dataset", { n: priceRows.size - missing, total: priceRows.size })];
  if (issues.length) notes.push(t("unavailable", { feeds: issues.map(id => t(id)).join(" / ") }));
  const n = Object.keys(overrides).length;
  if (n) notes.push(t("manualCount", { n }));
  $("feed-detail").textContent = notes.join(" · ");
  $("refresh").disabled = refreshing;
  $("refresh").setAttribute("aria-busy", String(refreshing));
  $("refresh-label").textContent = t(refreshing ? "refreshing" : "refresh");
}

function drawState() {
  $("solve-state").textContent = state === "missing" ? t("missing", { n: brokenIds().size }) :
    state === "waiting" && iteration ? t("solving", { n: number.format(iteration) }) : t(state);
  $("strategy").setAttribute("aria-busy", String(state === "waiting"));
}

function drawCurrent() {
  const percent = 100 * xp / MAX_XP + "%";
  $("xp-range").style.setProperty("--fill", percent);
  $("chart").style.setProperty("--cursor", percent);
  $("decisions").replaceChildren();
  $("break-rows").replaceChildren();
  const effects = perkEffects(config);
  CORPSES.forEach((corpse, i) => {
    const c = model?.corpses[i];
    const gain = c?.xp ?? Math.round(corpse.xp * effects.xpFactor);
    const identity = node("div", null, "corpse-cell");
    const name = node("div");
    name.append(node("strong", corpse[language]), node("small", "+" + number.format(gain) + " XP"));
    identity.append(node("span", null, "mineral " + corpse.id), name);
    const choice = c && result ? inspect(c, result.bias, xp, result.step) : null;
    const action = choice?.action;
    const badge = action ? node("span", actionName(action), "action " + (action === "skip" ? "skip" : action === "none" ? "bank" : "target")) : "—";
    const margin = choice ? node("span", (choice.margin > 0 ? "+" : "") + amount(choice.margin), choice.margin >= 0 ? "positive" : "negative") : "—";
    if (choice) margin.title = coin(choice.margin);
    row($("decisions"), [identity, badge, margin]);
    row($("break-rows"), [corpse[language], coin(c?.loot), corpse.key ? coin(c?.cost) : t("keyFree"), coin(c?.base), decimals.format(c?.rolls ?? corpse.minRolls + 1.5 + effects.extraRoll), number.format(gain)]);
  });
}

function actionColor(id) {
  if (id === "skip") return "#a7b1b8";
  if (id === "none") return "#52a994";
  return `hsl(${(211 + TARGETS.indexOf(id) * 137.5) % 360} 47% 58%)`;
}
function drawPolicy() {
  const chart = $("chart"), legend = $("legend"), intervals = $("band-rows");
  chart.replaceChildren(); legend.replaceChildren(); intervals.replaceChildren();
  $("grid-step").textContent = t("precision", { n: number.format(STEP) });
  if (!result) { chart.append(node("span", t("mapEmpty"), "meta")); return; }
  const used = new Set();
  for (const [i, corpse] of model.corpses.entries()) {
    const line = node("div", null, "chart-row");
    const track = node("div", null, "track");
    line.append(node("strong", CORPSES[i][language]), track);
    const policy = result.policies[i];
    for (const band of policyBands(policy, corpse, result.step)) {
      const segment = node("i");
      segment.style.width = 100 * band.length / policy.length + "%";
      segment.style.backgroundColor = actionColor(band.id);
      segment.title = number.format(band.from) + " – " + number.format(band.to) + " XP · " + actionName(band.id);
      track.append(segment);
      used.add(band.id);
      row(intervals, [CORPSES[i][language], number.format(band.from), number.format(band.to), actionName(band.id)]);
    }
    chart.append(line);
  }
  const scale = node("div", null, "chart-scale");
  const labels = node("div", null, "scale");
  labels.append(node("span", "0 XP"), node("span", amount(MAX_XP) + " XP"));
  scale.append(node("span"), labels); chart.append(scale);
  for (const id of used) {
    const entry = node("span");
    const swatch = node("i", null, "swatch");
    swatch.style.backgroundColor = actionColor(id);
    entry.append(swatch, document.createTextNode(actionName(id))); legend.append(entry);
  }
}

function drawResults() {
  $("profit").textContent = result ? amount(result.estimate) : "—";
  $("profit").title = result ? coin(result.estimate) : "";
  $("bounds").textContent = result ? t("modelRange") + " " + number.format(Math.floor(result.low)) + " – " + number.format(Math.ceil(result.high)) : t(state === "waiting" ? "waiting" : "noSolution");
  const best = model ? TARGETS.reduce((a, b) => prices.sell[b] / ITEMS[b].xp > prices.sell[a] / ITEMS[a].xp ? b : a) : null;
  $("top-target").textContent = best ? ITEMS[best][language] : "—";
  $("top-rate").textContent = best ? decimals.format(prices.sell[best] / ITEMS[best].xp) + " " + t("perXP") : "—";
  $("top-rate").parentElement.title = t("rateTip");
  drawState(); drawCurrent(); drawPolicy();
}

function makePriceRows() {
  for (const id of Object.keys(ITEMS)) {
    const input = node("input");
    input.type = "number"; input.step = "any"; input.min = 0; input.inputMode = "decimal";
    input.value = overrides[id] ?? "";
    const tr = row($("price-rows"), ["", "", "", "", "", "", input, ""]);
    priceRows.set(id, { tr, input });
  }
}
function readOverrides() {
  let valid = true;
  for (const [id, { input }] of priceRows) {
    if (!input.checkValidity()) { valid = false; continue; }
    if (positive(input.valueAsNumber)) overrides[id] = input.valueAsNumber;
    else delete overrides[id];
  }
  return valid;
}
function drawPrices() {
  const missing = brokenIds();
  const query = $("search").value.trim().toLowerCase();
  let matches = 0;
  for (const [id, { tr, input }] of priceRows) {
    const item = ITEMS[id], q = snapshot.quotes[id] || {};
    const name = item[language], cells = tr.cells;
    const visible = (!$("missing-only").checked || missing.has(id)) && (!query || [id, item.en, item.zh].some(v => v.toLowerCase().includes(query)));
    tr.hidden = !visible;
    if (visible) matches++;
    tr.classList.toggle("missing-row", missing.has(id));
    cells[0].textContent = name; cells[0].title = item.en;
    [q.ask, q.bid, q.ah, q.npc || null, prices.sell[id]].forEach((value, i) => {
      cells[i + 1].textContent = coin(value);
      cells[i + 1].title = coin(value);
    });
    input.placeholder = t("quoteAuto");
    input.setAttribute("aria-label", t("overrideLabel", { item: name }));
    cells[7].textContent = t(overrides[id] ? "manual" : q.source || "absent");
    cells[7].title = q.at ? date.format(q.at) : "";
  }
  $("empty-search").hidden = matches > 0;
}

function cancel() {
  serial++;
  clearTimeout(scheduled);
  worker?.terminate(); worker = null;
  result = null; model = null; iteration = 0;
}
function calculate(force = false) {
  const validSettings = readControls();
  const validOverrides = readOverrides();
  if (validSettings && validOverrides) savePrefs();
  prices = valueMarket(snapshot, overrides, config);
  drawPerks(); drawPrices(); drawFeed();
  if (!validSettings || !validOverrides || prices.missing.length) {
    cancel(); solveKey = ""; state = validSettings && validOverrides ? "missing" : "invalid";
    drawResults(); return;
  }
  const { auto, ...modelSettings } = config;
  const key = JSON.stringify([modelSettings, prices.sell, CORPSES.map(c => prices.buy[c.key])]);
  if (key === solveKey && !force) return;
  cancel(); solveKey = key;
  const token = serial;
  state = "waiting";
  model = buildModel(config, prices);
  drawResults();
  function failed() {
    if (serial !== token) return;
    worker?.terminate(); worker = null; state = "workerError"; drawResults();
  }
  scheduled = setTimeout(() => {
    try {
      worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (serial !== token) return;
        if (data.error) { failed(); return; }
        if (data.iterations) { iteration = data.iterations; drawState(); return; }
        result = data.result; worker.terminate(); worker = null;
        state = result.high - result.low > 10000 ? "approx" : "solved";
        drawResults();
      };
      worker.onerror = failed;
      worker.postMessage(model);
    } catch { failed(); }
  }, 100);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true; drawFeed();
  try {
    const latest = await refreshMarket(snapshot);
    const updated = !latest.issues.includes("bazaar") || Object.entries(latest.quotes).some(([id, q]) => q.at > (snapshot.quotes[id]?.at || 0));
    origin = updated ? "live" : origin === "reference" ? "reference" : "cached";
    snapshot = latest;
    if (updated) save("market", latest);
    calculate();
  } catch {
    snapshot = { ...snapshot, issues: ["bazaar", "auctions"] };
    if (origin !== "reference") origin = "cached";
  } finally {
    refreshing = false; drawFeed();
  }
}

function applyLanguage() {
  formats();
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = t("pageTitle");
  document.querySelector('meta[name="description"]').content = t("description");
  for (const el of document.querySelectorAll("[data-i]")) el.textContent = t(el.dataset.i);
  for (const el of document.querySelectorAll("[data-label]")) el.setAttribute("aria-label", t(el.dataset.label));
  for (const el of document.querySelectorAll("[data-placeholder]")) el.placeholder = t(el.dataset.placeholder);
  for (const el of document.querySelectorAll("[data-lang]")) el.setAttribute("aria-pressed", String(el.dataset.lang === language));
  for (const el of document.querySelectorAll("[data-max-xp]")) el.textContent = amount(MAX_XP) + " XP";
  $("docs").href = "https://github.com/exhaust-pipe/Glacite_Lab/blob/main/" + (language === "en" ? "README.md" : "README.zh-CN.md");
  drawPerks(); drawFeed(); drawPrices(); drawResults();
}
function setXP(value, source) {
  xp = Math.min(MAX_XP, Math.max(0, Math.round(value)));
  if (source !== $("xp")) $("xp").value = xp;
  if (source !== $("xp-range")) $("xp-range").value = xp;
  drawCurrent(); savePrefs();
}

createPerks();
for (const [id, fallback] of Object.entries(DEFAULTS)) {
  const value = saved.settings?.[id];
  setField(id, typeof value === typeof fallback ? value : fallback);
  if (!valid(id)) setField(id, fallback);
  if ($(id).type === "number") $(id).addEventListener("input", () => calculate());
  $(id).addEventListener("change", () => calculate());
}
$("xp").value = xp; $("xp-range").value = xp;
$("xp").addEventListener("input", () => {
  if ($("xp").value !== "" && $("xp").checkValidity()) setXP($("xp").valueAsNumber, $("xp"));
});
$("xp").addEventListener("change", () => setXP(Number.isFinite($("xp").valueAsNumber) ? $("xp").valueAsNumber : xp));
$("xp-range").addEventListener("input", () => setXP($("xp-range").valueAsNumber, $("xp-range")));
for (const [button, preset] of [["no-perks", NO_PERKS], ["max-perks", MAX_PERKS]]) {
  $(button).onclick = () => { for (const [id, value] of Object.entries(preset)) setField(id, value); calculate(); };
}
for (const button of document.querySelectorAll("[data-lang]")) button.onclick = () => {
  language = button.dataset.lang; save("language", language); applyLanguage();
};
$("refresh").onclick = refresh;
$("recalculate").onclick = () => calculate(true);
$("search").oninput = drawPrices; $("missing-only").onchange = drawPrices;
$("price-rows").addEventListener("input", () => calculate());
$("price-rows").addEventListener("change", ({ target }) => {
  if (target.valueAsNumber === 0) target.value = "";
  calculate();
});

makePriceRows(); readControls(); prices = valueMarket(snapshot, overrides, config);
applyLanguage(); calculate(); refresh();
setInterval(() => { if (config.auto && !document.hidden && !worker) refresh(); }, 60000);
