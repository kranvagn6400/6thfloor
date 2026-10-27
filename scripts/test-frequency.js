// Half-tablet frequencies ("½×2"): parsing, dose sums, chart quantities
const assert = require("assert");
global.window = global;
require("../js/medications.js");
global.PharmacyWard = { ROOMS: [], bedKey: (r, b) => "room-" + r + "-bed-" + b };
require("../js/chart-bridge.js");
const M = window.PharmacyMedications, C = window.PharmacyChartBridge;
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("parse N×M with half tablets", () => {
  assert.deepStrictEqual(M.parseFreq("½×2"), { n: 0.5, m: 2 });
  assert.deepStrictEqual(M.parseFreq("1½×1"), { n: 1.5, m: 1 });
  assert.deepStrictEqual(M.parseFreq("2 x 3"), { n: 2, m: 3 });
  assert.strictEqual(M.parseFreq("كل يومين"), null);
  assert.strictEqual(M.formatN(0.5), "½");
  assert.strictEqual(M.formatN(1.5), "1½");
});
t("half tablets are in the frequency list", () => {
  ["½×1", "½×2", "1½×1"].forEach(f => assert.ok(M.FREQUENCIES.includes(f), f));
});
t("chart quantity = whole tablets to dispense a day", () => {
  assert.strictEqual(C.freqToDose("½×1"), "1");
  assert.strictEqual(C.freqToDose("½×2"), "1");
  assert.strictEqual(C.freqToDose("½×3"), "2");
  assert.strictEqual(C.freqToDose("1½×2"), "3");
  assert.strictEqual(C.dailyQuantity("x", "½×1"), 1);
  assert.strictEqual(C.freqToDose("2×2"), "4");
});
t("dose sum understands half tablets", () => {
  if (!M.sumDose) return;
  assert.strictEqual(M.sumDose("5mg", "½×2"), "2.5mg ×2");   // half of 5mg, twice a day
  assert.strictEqual(M.sumDose("5mg", "2×1"), "10mg ×1");
});
t("Infusion 24h / Bolus are a separate mode, not frequencies (old ones still read right)", () => {
  assert.ok(!M.FREQUENCIES.includes("Infusion 24h") && !M.FREQUENCIES.includes("Bolus"));
  assert.deepStrictEqual(M.ADMIN_MODES, ["Infusion 24h", "Bolus"]);
  assert.strictEqual(M.medMode({ frequency: "Infusion 24h" }), "Infusion 24h");   // legacy
  assert.strictEqual(M.medFrequency({ frequency: "Infusion 24h" }), "1×1");
  assert.strictEqual(M.medMode({ frequency: "1×2", mode: "Bolus" }), "Bolus");
  assert.strictEqual(M.medFrequency({ frequency: "1×2", mode: "Bolus" }), "1×2");
  assert.strictEqual(C.freqToDose("Infusion 24h"), "1");                          // legacy rows on the chart
  assert.strictEqual(C.dailyQuantity("x", "Bolus"), 1);
});
console.log(n + " tests passed");
