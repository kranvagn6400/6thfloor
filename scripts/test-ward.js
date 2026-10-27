// Ward-wide bed numbers 1-50 (the order the user gave)
const assert = require("assert");
global.window = global;
require("../js/ward.js");
const W = window.PharmacyWard;
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("room 1: bed 3 = 1, bed 2 = 2, bed 1 = 3, then 4, 5, 6", () => {
  assert.deepStrictEqual([3, 2, 1, 4, 5, 6].map(b => W.bedLabel(1, b)), [1, 2, 3, 4, 5, 6]);
});
t("room 2 continues: bed 3 = 7, bed 2 = 8", () => {
  assert.strictEqual(W.bedLabel(2, 3), 7);
  assert.strictEqual(W.bedLabel(2, 2), 8);
  assert.strictEqual(W.bedLabel(2, 6), 12);
});
t("4-bed rooms: room 6 bed 2 = 31, bed 1 = 32, bed 3 = 33, bed 4 = 34; the last bed is 50", () => {
  assert.deepStrictEqual([2, 1, 3, 4].map(b => W.bedLabel(6, b)), [31, 32, 33, 34]);
  assert.strictEqual(W.bedLabel(10, 4), 50);
});
t("every bed gets a different number 1-50", () => {
  const all = [];
  W.ROOMS.forEach(r => r.beds.forEach(b => all.push(W.bedLabel(r.id, b.number))));
  assert.deepStrictEqual(all.slice().sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
});
t("from a key / as text", () => {
  assert.strictEqual(W.bedLabelOfKey("room-2-bed-3"), 7);
  assert.strictEqual(W.bedText("room-6-bed-2"), "غرفة 6 · سرير 31");
});
console.log(n + " tests passed");
