// Tests for chart-names.js suggest(): our catalog names → the chart's names
const assert = require("assert");
const N = require("../js/chart-names.js");
let n = 0;
const t = (name, fn) => { fn(); n++; };
const s = (med) => N.suggest(med);

t("same name, other case / spacing / form spelling → sure", () => {
  assert.deepStrictEqual(s({ nameTrade: "paracetamol 500 mg tablet", form: "tablet" }), { name: "Paracetamol 500mg Tab", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Meronem 1 g vial", form: "vial" }), { name: "Meronem 1g Vial", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Vancomycin 500mg vial", form: "vial" }), { name: "Vancomycin 500 mg vial", sure: true });
});
t("form word missing from our name → the dosage form breaks the tie", () => {
  assert.deepStrictEqual(s({ nameTrade: "Esomprazole 40mg", form: "vial" }), { name: "Esomprazole 40mg vial", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Omeprazole 40mg", form: "vial" }), { name: "Omeprazole 40mg vial", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Omeprazole 40mg", form: "tablet" }), { name: "Omeprazole 40mg cap", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Lasix 20mg", form: "ampule" }), { name: "Lasix 20mg Amp", sure: true });
});
t("trade-name spelling differences (Ceftriaxone → Ceftrixone)", () => {
  assert.deepStrictEqual(s({ nameTrade: "Ceftriaxone 1g", form: "vial" }), { name: "Ceftrixone 1g vial", sure: true });
});
t("scientific nameEn alone is not enough, the trade name is used", () => {
  assert.deepStrictEqual(s({ nameEn: "Esomeprazole", nameTrade: "Esomprazole 40mg vial", form: "vial" }), { name: "Esomprazole 40mg vial", sure: true });
});
t("no strength in our name, one product of that drug + form → proposed for checking", () => {
  assert.deepStrictEqual(s({ nameTrade: "Heparin", form: "vial" }), { name: "Heparin vial", sure: true });
  assert.deepStrictEqual(s({ nameTrade: "Zofran", form: "ampule" }), { name: "Zofran ampoule 8mg", sure: false });
});
t("never a different strength, never a guess between products", () => {
  assert.strictEqual(s({ nameTrade: "Omeprazole 30mg", form: "tablet" }), null);
  assert.strictEqual(s({ nameTrade: "Lasix", form: "tablet" }) && s({ nameTrade: "Lasix", form: "tablet" }).name, "Lasix 40mg Tab");
  assert.strictEqual(s({ nameTrade: "Keppra", form: "tablet" }), null);   // 500 and 1000 → ambiguous
  assert.strictEqual(s({ nameTrade: "Acetylase 50mg/Vial", form: "vial" }), null); // not in the given list
});
t("autoFill: by id, fixes names not in the chart's list, keeps valid ones, leaves the rest", () => {
  const meds = [
    { id: "esomprazole-40mg-vial", nameTrade: "Esomprazole 40", nameEn: "Esomprazole", nameChart: "Esomprazole", form: "vial" },  // wrong → fixed by id
    { id: "x-1", nameTrade: "Meronem 1 g vial", form: "vial" },                                                    // no id match → name match
    { id: "x-2", nameTrade: "Lasix 20mg", nameChart: "Lasix 20mg Amp", form: "ampule" },                          // already valid → untouched
    { id: "x-3", nameTrade: "Zofran", form: "ampule" },                                                           // only a "check" proposal → left
    { id: "x-4", nameTrade: "Something 5mg", form: "tablet" }                                                     // no match → left
  ];
  const ch = N.autoFill(meds);
  assert.deepStrictEqual(ch.map(c => c.id), ["esomprazole-40mg-vial", "x-1"]);
  assert.strictEqual(meds[0].nameChart, "Esomprazole 40mg vial");
  assert.strictEqual(meds[1].nameChart, "Meronem 1g Vial");
  assert.strictEqual(meds[2].nameChart, "Lasix 20mg Amp");
  assert.strictEqual(meds[3].nameChart, undefined);
  assert.strictEqual(N.autoFill(meds).length, 0);   // idempotent
});
t("autoFill: an id from another strength is not trusted", () => {
  const meds = [{ id: "omeprazole-20mg-cap", nameTrade: "Omeprazole 40mg cap", form: "tablet" }];
  N.autoFill(meds);
  assert.strictEqual(meds[0].nameChart, "Omeprazole 40mg cap");
});
t("every id-mapped name is in the chart's list", () => {
  Object.values(N.CHART_NAME_BY_ID).forEach(v => assert.ok(N.CHART_MEDICINES.includes(v), v));
});
console.log(n + " tests passed");
