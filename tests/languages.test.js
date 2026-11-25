import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY, translate } from "../js/i18n.js";

test("both languages cover every labelled static control and use matching message parameters", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="en">/);
  for (const [, key] of html.matchAll(/data-(?:i|label|placeholder)="(\w+)"/g)) assert.ok(COPY[key], key);
  for (const [key, [en, zh]] of Object.entries(COPY)) {
    assert.ok(en && zh, key);
    assert.deepEqual(en.match(/\{\w+\}/g)?.sort() || [], zh.match(/\{\w+\}/g)?.sort() || []);
  }
  assert.equal(translate("en", "openTarget", { item: "Shattered Locket" }), "Target Shattered Locket");
  assert.equal(translate("zh", "openTarget", { item: "破碎吊坠" }), "选取破碎吊坠");
});
