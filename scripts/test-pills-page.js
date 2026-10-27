// «الحبوب» page: who has tablets and in which section (men / women / ICU)
const assert = require("assert");
global.window = global;
require("../js/ward.js");
require("../js/pills-page.js");
const W = window.PharmacyWard, P = window.PharmacyPillsPage;
let n = 0;
const t = (name, fn) => { fn(); n++; };

const meds = [
  { id: "apx", nameTrade: "Apixaban 5mg", form: "tablet" },
  { id: "cef", nameTrade: "Ceftriaxone 1g", form: "vial" }
];
const pt = (name, ids, gender) => ({ name, gender: gender || "", medications: ids.map(id => ({ id, dose: "", frequency: "1×2" })) });

t("rooms 1-4 men, 5 and 7-10 women, 6 = ICU", () => {
  [1, 2, 3, 4].forEach(r => assert.strictEqual(W.roomGender(r), "male"));
  [5, 7, 8, 9, 10].forEach(r => assert.strictEqual(W.roomGender(r), "female"));
  assert.strictEqual(W.roomGender(6), "");
});
t("only patients with tablets, split by the room; room 6 by the patient's gender", () => {
  const g = P.groups({
    "room-1-bed-1": pt("رجل", ["apx", "cef"]),
    "room-2-bed-1": pt("بلا حبوب", ["cef"]),
    "room-5-bed-2": pt("امرأة", ["apx"], "male"),     // the room wins over a wrong gender
    "room-6-bed-1": pt("عناية رجل", ["apx"], "male"),
    "room-6-bed-2": pt("عناية امرأة", ["apx"], "female"),
    "room-6-bed-3": pt("عناية ؟", ["apx"]),
    "room-9-bed-4": { name: "", medications: [{ id: "apx" }] }
  }, meds);
  assert.deepStrictEqual(g.men.map(x => x.patient.name), ["رجل", "عناية رجل"]);
  assert.deepStrictEqual(g.women.map(x => x.patient.name), ["امرأة", "عناية امرأة"]);
  assert.deepStrictEqual(g.icu.map(x => x.patient.name), ["عناية ؟"]);
  assert.deepStrictEqual(g.men[0].meds.map(m => [m.index, m.pm.id]), [[0, "apx"]]);   // tablets only, index kept
});
console.log(n + " tests passed");
