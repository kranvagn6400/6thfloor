// Tests for patient-merge.js — two people editing the same patient
const assert = require("assert");
const M = require("../js/patient-merge.js");
let n = 0;
const t = (name, fn) => { fn(); n++; };
const med = (id, freq, extra) => Object.assign({ id, dose: "", frequency: freq || "1×1" }, extra || {});
const base = { name: "أحمد", plateNumber: "", doctor: "د. علي", labs: { hb: "11" }, medications: [med("cef", "1×2"), med("pcm", "1×3")] };

t("doctor adds a med while the pharmacist sets the plate number → both kept", () => {
  const local = Object.assign({}, base, { plateNumber: "123" });                         // pharmacist (this device)
  const cloud = Object.assign({}, base, { medications: base.medications.concat(med("apx", "½×2")) }); // doctor saved first
  const r = M.merge3(base, local, cloud);
  assert.strictEqual(r.merged.plateNumber, "123");
  assert.deepStrictEqual(r.merged.medications.map(m => m.id), ["cef", "pcm", "apx"]);
  assert.strictEqual(r.touched, true);
});
t("both add different meds → both added", () => {
  const local = Object.assign({}, base, { medications: base.medications.concat(med("omz")) });
  const cloud = Object.assign({}, base, { medications: base.medications.concat(med("apx")) });
  assert.deepStrictEqual(M.merge3(base, local, cloud).merged.medications.map(m => m.id), ["cef", "pcm", "apx", "omz"]);
});
t("removed here + edited there (another med) → removal and edit both applied", () => {
  const local = Object.assign({}, base, { medications: [med("pcm", "1×3")] });            // removed cef
  const cloud = Object.assign({}, base, { medications: [med("cef", "1×2"), med("pcm", "1×4")] }); // changed pcm
  const r = M.merge3(base, local, cloud).merged.medications;
  assert.deepStrictEqual(r.map(m => m.id + ":" + m.frequency), ["pcm:1×4"]);
});
t("same med edited on both → this device's edit wins", () => {
  const local = Object.assign({}, base, { medications: [med("cef", "1×3"), med("pcm", "1×3")] });
  const cloud = Object.assign({}, base, { medications: [med("cef", "1×1"), med("pcm", "1×3")] });
  assert.strictEqual(M.merge3(base, local, cloud).merged.medications[0].frequency, "1×3");
});
t("a med removed by the other person stays removed when untouched here", () => {
  const local = Object.assign({}, base, { name: "أحمد علي" });
  const cloud = Object.assign({}, base, { medications: [med("pcm", "1×3")] });
  const r = M.merge3(base, local, cloud).merged;
  assert.strictEqual(r.name, "أحمد علي");
  assert.deepStrictEqual(r.medications.map(m => m.id), ["pcm"]);
});
t("labs merge per test", () => {
  const local = Object.assign({}, base, { labs: { hb: "11", creatinine: "1.4" } });
  const cloud = Object.assign({}, base, { labs: { hb: "9.5" } });
  assert.deepStrictEqual(M.merge3(base, local, cloud).merged.labs, { hb: "9.5", creatinine: "1.4" });
});
t("no base (first sync) → this device's values and the union of meds", () => {
  const local = { name: "س", medications: [med("a")] };
  const cloud = { name: "ص", medications: [med("b")] };
  const r = M.merge3(null, local, cloud).merged;
  assert.strictEqual(r.name, "س");
  assert.deepStrictEqual(r.medications.map(m => m.id), ["b", "a"]);
});
t("two entries of the same medicine are kept apart", () => {
  const b2 = { medications: [med("x", "1×1"), med("x", "1×2")] };
  const local = { medications: [med("x", "1×1"), med("x", "1×3")] };
  const r = M.merge3(b2, local, b2).merged.medications;
  assert.deepStrictEqual(r.map(m => m.frequency), ["1×1", "1×3"]);
});
console.log(n + " tests passed");
