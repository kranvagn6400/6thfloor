// node scripts/test-chart-bridge.js — quantities sent to the chart (الجارت)
const assert = require("assert");
global.window = global;
global.PharmacyMedications = {
  getFrequencyInterval: (f) => ({ "كل يومين": 2, "كل 3 أيام": 3, "كل أسبوع": 7 })[f] || 0
};
global.PharmacyWard = {
  ROOMS: [{ id: 1, beds: [{ number: 1 }, { number: 2 }] }],
  bedKey: (r, b) => `room-${r}-bed-${b}`
};
require("../js/clinical.js");
require("../js/chart-bridge.js");
const C = global.PharmacyChartBridge;

let passed = 0;
// the order of the medicines in the chart's columns / «الطلبية»
function t(name, fn) { fn(); passed++; console.log("✓ " + name); }

t("daily quantity is the product N × M", () => {
  assert.strictEqual(C.freqToDose("1×3"), "3");
  assert.strictEqual(C.freqToDose("3x1"), "3");
  assert.strictEqual(C.freqToDose("2×2"), "4");
  assert.strictEqual(C.freqToDose("1×1"), "1");
  assert.strictEqual(C.freqToDose("3"), "3");
});
t("non-daily frequencies are sent as text", () => {
  assert.strictEqual(C.freqToDose("كل يومين"), "كل يومين");
});
t("non-numeric frequency falls back to 1", () => {
  assert.strictEqual(C.freqToDose("حسب القياس"), "1");
});
t("review-list quantity matches what is sent (incl. heparin exception)", () => {
  assert.strictEqual(C.dailyQuantity("x", "2×3"), 6);
  assert.strictEqual(C.dailyQuantity("heparin-vial", "1×4"), 1);
  assert.strictEqual(C.dailyQuantity("x", "كل أسبوع"), null);
});
t("TSV rows carry the daily quantities", () => {
  const state = {
    medications: [],
    patients: {
      "room-1-bed-1": { name: "أ", plateNumber: "11", medications: [
        { id: "a", nameChart: "Meropenem", frequency: "1×3" },
        { id: "heparin-vial", nameChart: "Heparin", frequency: "1×4" }] },
      "room-1-bed-2": { name: "ب", plateNumber: "22", medications: [
        { id: "a", nameChart: "Meropenem", frequency: "2×2" }] }
    }
  };
  const rows = C.buildChartTSV(state).split("\n").map(r => r.split("\t"));
  assert.deepStrictEqual(rows[0], ["", "", "Meropenem", "Heparin"]);
  assert.deepStrictEqual(rows[1], ["أ", "11", "3", "1"]);
  assert.deepStrictEqual(rows[2], ["ب", "22", "4", ""]);
});

t("chart names: nameChart only — a medicine without one is not sent; supplies by chart name", () => {
  const state = {
    medications: [
      { id: "eso", nameTrade: "Esomprazole 40mg vial", nameEn: "Esomprazole" },
      { id: "cef", nameTrade: "Ceftriaxone 1g", nameEn: "Ceftriaxone", nameChart: "Ceftrixone 1g vial" }
    ],
    patients: {
      "room-1-bed-1": { name: "أ", plateNumber: "11", medications: [{ id: "eso", frequency: "1×1" }, { id: "cef", frequency: "1×2" }] }
    }
  };
  const p = C.collectPatientsFromApp(state, { "glucose-5": { "room-1-bed-1": 3 }, "cannula": { "room-1-bed-1": 1 } });
  assert.deepStrictEqual(p[0].meds.map(m => m.name), ["Ceftrixone 1g vial", "G/W 5% 500ml", "كانيولا"]);   // eso: no chart name → not sent
});
t("as-needed frequencies count as 1 in the review list, as on the chart", () => {
  assert.strictEqual(C.freqToDose("حسب الحاجة"), "1");
  assert.strictEqual(C.dailyQuantity("x", "حسب الحاجة"), 1);
  assert.strictEqual(C.dailyQuantity("x", "كل أسبوع"), null);
});
t("syrups / drops / ointments: one container a day whatever the frequency; other solutions by frequency", () => {
  const state = {
    medications: [
      { id: "syr", nameTrade: "Lactulose Syp", nameChart: "Lactulose Syp", form: "syrup-and-oral-drop" },
      { id: "oint", nameTrade: "Fucidin cream", nameChart: "Fucidin cream", form: "solution" },
      { id: "tab", nameTrade: "Paracetamol 500mg Tab", nameChart: "Paracetamol 500mg Tab", form: "tablet" }
    ],
    patients: { "room-1-bed-1": { name: "أ", plateNumber: "1", medications: [
      { id: "syr", frequency: "1×3" }, { id: "oint", frequency: "1×2" }, { id: "tab", frequency: "2×3" }
    ] } }
  };
  const rows = C.buildChartTSV(state).split("\n");
  assert.deepStrictEqual(rows[1].split("\t").slice(2), ["2", "6", "1"]);   // Fucidin cream is a solution form → by its frequency (1×2 = 2); only Ventolin is one container
  assert.strictEqual(C.dailyQuantity("syr", "1×3", "syrup-and-oral-drop"), 1);
  assert.strictEqual(C.dailyQuantity("tab", "2×3", "tablet"), 6);
});

t("columns are ordered: antibiotics, then tablets/syrups/…, prefilled syringes, ampoules, vials, supplies", () => {
  const med = (id, form, name, extra) => Object.assign({ id, form, nameTrade: name, nameEn: name, nameChart: name }, extra);
  const meds = [
    med("v1", "vial", "Zinc vial"), med("am1", "ampule", "Atropine amp"), med("pf1", "prefilled-syringe", "Enoxaparin pfs"),
    med("t1", "tablet", "Paracetamol tab"), med("s1", "syrup-and-oral-drop", "Zinc syrup"), med("su1", "suppository", "Voltarin supp"),
    med("so1", "solution", "Betadine sol"), med("sup1", "supplies", "5cc Syringe"), med("cef", "vial", "Ceftriaxone 1g vial"),
    med("cip", "tablet", "Ciprofloxacin 500mg tab")
  ];
  const state = { medications: meds, patients: { "room-1-bed-1": { name: "أ", plateNumber: "1",
    medications: meds.map(m => ({ id: m.id, frequency: "1×1" })) } } };
  const head = C.buildChartTSV(state).split("\n")[0].split("\t").slice(2);
  assert.deepStrictEqual(head, [
    "Ceftriaxone 1g vial", "Ciprofloxacin 500mg tab",                    // antibiotics first, whatever their form (vials before tablets)
    "Paracetamol tab", "Zinc syrup", "Voltarin supp", "Betadine sol",    // tablets, syrups, suppositories, solutions
    "Enoxaparin pfs",                                                    // prefilled syringes
    "Atropine amp", "Zinc vial",                                         // the other ampoules, then vials
    "5cc Syringe"                                                        // supplies
  ]);
});
t("solutions: only Ventolin is one container a day, any other solution is requested by its frequency", () => {
  assert.strictEqual(C.dailyQuantity("ventolin-inhalation", "1×4", "solution"), 1);
  assert.strictEqual(C.dailyQuantity("pulmicort-0-5-mg-nebulizer", "1×2", "solution"), 2);
  assert.strictEqual(C.dailyQuantity("symbicort-turbuhaler", "2×2", "solution"), 4);
  assert.strictEqual(C.dailyQuantity("x-syrup", "1×3", "syrup-and-oral-drop"), 1);   // syrups / drops / ointments unchanged
  const state = { medications: [
      { id: "ventolin-inhalation", nameTrade: "Ventolin", nameChart: "Ventolin inhalation", form: "solution" },
      { id: "pulmicort", nameTrade: "Pulmicort", nameChart: "Pulmicort neb", form: "solution" }],
    patients: { "room-1-bed-1": { name: "أ", plateNumber: "1", medications: [
      { id: "ventolin-inhalation", frequency: "1×4" }, { id: "pulmicort", frequency: "1×2" }] } } };
  const rows = C.buildChartTSV(state).split("\n");
  const names = rows[0].split("\t").slice(2), qtys = rows[1].split("\t").slice(2);
  const byName = {}; names.forEach((n, i) => { byName[n] = qtys[i]; });
  assert.deepStrictEqual(byName, { "Ventolin inhalation": "1", "Pulmicort neb": "2" });
});


console.log("\n" + passed + " tests passed");
