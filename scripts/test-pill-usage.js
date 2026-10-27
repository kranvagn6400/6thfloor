// «طريقة الاستخدام» of each catalogue tablet on the pills form
const assert = require("assert");
global.window = global;
global.document = { createElement: () => ({ getContext: () => ({}) }), addEventListener() {}, getElementById() { return null; } };
require("../js/medications.js");
require("../js/pills-form.js");
const PF = window.PharmacyPillsForm;
const meds = window.PharmacyMedications.DEFAULT_MEDICATIONS;
const byId = (id) => meds.find(m => m.id === id);
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("omeprazole / pantoprazole: before food by an hour or after it by two (not «with or without food»)", () => {
  assert.strictEqual(PF.getMedUsage(byId("omeprazole-20mg-cap")), "قبل الطعام بساعة أو بعده بساعتين");
  assert.strictEqual(PF.getMedUsage(byId("pantaprazole-40mg-cap")), "قبل الطعام بساعة أو بعده بساعتين");
});
t("levothyroxine on an empty stomach, metformin with food, GTN under the tongue", () => {
  assert.ok(/معدة فارغة/.test(PF.getMedUsage(byId("thyroxine-50mg-tab"))));
  assert.strictEqual(PF.getMedUsage(byId("glucophage-500mg-tab")), "مع الطعام");
  assert.strictEqual(PF.getMedUsage(byId("angesid-0-5mg-tab")), "تحت اللسان");
});
t("a tablet with no food rule stays «مع أو بدون طعام»; a catalogue `usage` overrides every rule", () => {
  assert.strictEqual(PF.getMedUsage(byId("paracetamol-500mg-tab")), "مع أو بدون طعام");
  assert.strictEqual(PF.getMedUsage(Object.assign({}, byId("omeprazole-20mg-cap"), { usage: "x" })), "x");
});
t("every tablet in the catalogue gets some text", () => {
  meds.filter(m => m.form === "tablet").forEach(m => assert.ok(PF.getMedUsage(m), m.id));
});
console.log(n + " tests passed");
