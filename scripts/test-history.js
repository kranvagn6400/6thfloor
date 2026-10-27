// Tests for patient-history.js cutStay: a bed's log shows the current stay only
const assert = require("assert");
global.window = {};
require("../js/patient-history.js");
const { cutStay } = window.PharmacyPatientHistory;
let n = 0;
const t = (name, fn) => { fn(); n++; };
const ev = (event, patient_name) => ({ event, patient_name });

t("stops at the admission (inclusive)", () => {
  const r = cutStay([ev("med_added", "B"), ev("admitted", "B"), ev("med_added", "A")], "B");
  assert.deepStrictEqual(r.map(e => e.event), ["med_added", "admitted"]);
});
t("never passes a previous patient's exit", () => {
  const r = cutStay([ev("med_added", "B"), ev("discharged", "A"), ev("med_added", "A"), ev("admitted", "A")], "B");
  assert.deepStrictEqual(r.map(e => e.event), ["med_added"]);
});
t("new patient with no events yet sees nothing", () => {
  assert.strictEqual(cutStay([ev("discharged", "A"), ev("med_added", "A")], "B").length, 0);
});
t("stops at another patient's name (no admission logged)", () => {
  const r = cutStay([ev("moved", "B"), ev("med_added", "B"), ev("med_added", "A")], "B");
  assert.strictEqual(r.length, 2);
});
t("name compare ignores extra spaces", () => {
  assert.strictEqual(cutStay([ev("med_added", " علي  حسن "), ev("admitted", "علي حسن")], "علي حسن").length, 2);
});
t("unknown current name: still cut at exit", () => {
  assert.strictEqual(cutStay([ev("med_added", "A"), ev("discharged", "Z")], "").length, 1);
});
console.log(n + " tests passed");
