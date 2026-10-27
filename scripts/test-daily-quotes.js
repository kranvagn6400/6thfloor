// Display sayings: the admin's pinned one, else one a day; verse input
const assert = require("assert");
global.window = global;
require("../js/daily-quotes.js");
const Q = window.PharmacyDailyQuotes;
let n = 0;
const t = (name, fn) => { fn(); n++; };
const list = ["أ", "ب", "ج"];
const day = (i) => new Date(2026, 0, 1 + i);

t("automatic: one a day, the same all day, cycling", () => {
  const seen = [0, 1, 2, 3].map(i => Q.pick(list, "", day(i)));
  assert.strictEqual(new Set(seen.slice(0, 3)).size, 3);
  assert.strictEqual(seen[3], seen[0]);
  assert.strictEqual(Q.pick(list, "", new Date(2026, 0, 1, 1)), Q.pick(list, "", new Date(2026, 0, 1, 23)));
});
t("a pinned saying stays; a pinned one that was deleted falls back to automatic", () => {
  assert.strictEqual(Q.pick(list, "ب", day(0)), "ب");
  assert.strictEqual(Q.pick(list, "ب", day(7)), "ب");
  assert.strictEqual(Q.pick(list, "محذوفة", day(0)), Q.pick(list, "", day(0)));
  assert.strictEqual(Q.pick([], "", day(0)), "");
});
t("a verse typed on two lines becomes two halves", () => {
  assert.strictEqual(Q.normalize(" الشطر الأول \n\n الشطر الثاني "), "الشطر الأول ... الشطر الثاني");
  assert.strictEqual(Q.normalize("مقولة   واحدة"), "مقولة واحدة");
});
t("until the admin saves, the built-in list is shown", () => {
  assert.ok(Q.QUOTES.indexOf(Q.current()) !== -1);
});
console.log(n + " tests passed");
