// Specialist names typed differently by different people → one specialist
const assert = require("assert");
global.window = global;
require("../js/specialists.js");
const S = window.PharmacySpecialists;
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("space inside «عبد الرسول» does not make a new specialist", () => {
  assert.strictEqual(S.key("عبد الرسول الموسوي"), S.key("عبدالرسول الموسوي"));
});
t("hamza / ؤ / ة spellings are the same", () => {
  assert.strictEqual(S.key("أحمد مؤيد"), S.key("احمد مويد"));
  assert.strictEqual(S.key("د. احمد مؤيد"), S.key("احمد مويد"));
});
t("different people stay different", () => {
  assert.notStrictEqual(S.key("احمد مؤيد"), S.key("احمد منير"));
  assert.notStrictEqual(S.key("علي حسين"), S.key("عمر حسين"));
});
t("two swapped letters («امحد مويد») is a probable match, not an exact one", () => {
  assert.ok(S.similar(S.key("امحد مويد"), S.key("احمد مؤيد")));
});
t("short names never match loosely", () => {
  assert.ok(!S.similar(S.key("علي"), S.key("عمر")));
});
t("resolve: same person spelled differently takes the ward's spelling", () => {
  const r = S.resolve("عبدالرسول الموسوي", ["عبد الرسول الموسوي", "عبد الرسول الموسوي", "احمد مؤيد"]);
  assert.deepStrictEqual(r, { name: "عبدالرسول الموسوي" });   // already the known spelling: nothing to change
});
t("resolve: a typo is only suggested, never applied", () => {
  const r = S.resolve("امحد مويد", ["احمد مؤيد"]);
  assert.strictEqual(r.how, "similar");
  assert.strictEqual(r.suggest, "احمد مؤيد");
  assert.strictEqual(r.name, "امحد مويد");
});
t("resolve: for a name outside the known list, the most used spelling wins", () => {
  const map = S.canonical(["سعد كريم", "سعد  كريمة", "سعد كريمه", "سعد كريمه"]);
  assert.strictEqual(map.get(S.key("سعد كريمه")).display, "سعد كريمه");
});
t("known specialists: any spelling is mapped to the given one, even when patients hold another", () => {
  assert.deepStrictEqual(S.resolve("عبد الرسول الموسوي", []), { name: "عبدالرسول الموسوي", how: "exact" });
  assert.deepStrictEqual(S.resolve("أحمد مويد", ["أحمد مويد", "أحمد مويد"]), { name: "احمد مؤيد", how: "exact" });
  assert.deepStrictEqual(S.resolve("د. غيث شلال", []), { name: "غيث شلال", how: "exact" });
});
t("known specialists: a typo is only suggested", () => {
  const r = S.resolve("امحد عماد", []);
  assert.strictEqual(r.how, "similar");
  assert.strictEqual(r.suggest, "احمد عماد");
});
t("the nine known specialists are all different people", () => {
  const keys = S.KNOWN.map(S.key);
  assert.strictEqual(new Set(keys).size, 9);
  keys.forEach((a, i) => keys.forEach((b, j) => { if (i < j) assert.ok(!S.similar(a, b), S.KNOWN[i] + " ~ " + S.KNOWN[j]); }));
});
t("resolve: a new specialist is left alone; extra spaces are tidied", () => {
  assert.deepStrictEqual(S.resolve("  سعد   كريم ", ["احمد مؤيد"]), { name: "سعد كريم" });
});
t("resolve: ward spelling of a non-listed specialist is still honoured", () => {
  assert.deepStrictEqual(S.resolve("سعدكريم", ["سعد كريم"]), { name: "سعد كريم", how: "exact" });
});
console.log(n + " tests passed");
