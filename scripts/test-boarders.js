// node scripts/test-boarders.js — boarders.js rules + boarder split in the monthly report
const assert = require("assert");
global.window = global;
require("../js/clinical.js");
require("../js/boarders.js");
require("../js/monthly-report.js");
const B = global.PharmacyBoarders;
const R = global.PharmacyMonthlyReport;

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("✓ " + name); }

t("our own patient is not a boarder and is ordered", () => {
  const p = { name: "أ", originWard: "" };
  assert.ok(!B.isBoarder(p));
  assert.ok(!B.isNoOrder(p));
  assert.strictEqual(B.label(p), "");
});
t("oncology boarder: still ordered", () => {
  const p = { name: "ب", originWard: "oncology", originNote: "الطابق 4" };
  assert.ok(B.isBoarder(p));
  assert.ok(!B.isNoOrder(p));
  assert.strictEqual(B.label(p), "الأورام · الطابق 4");
});
t("7th-floor hematology boarder: never ordered", () => {
  assert.ok(B.isNoOrder({ originWard: "hematology-7" }));
});
t("origin list offers our ward, ط10, ط9, ط7, ط6 (legacy values hidden)", () => {
  const offered = B.ORIGINS.filter(o => !o.legacy).map(o => o.option);
  assert.deepStrictEqual(offered, ["مريض الردهة", "ط10", "ط9", "ط7", "ط6"]);
  assert.strictEqual(B.badge({ originWard: "floor-10" }), "طابق 10");
  assert.ok(!B.isNoOrder({ originWard: "floor-10" }));
  assert.strictEqual(B.badge({ originWard: "floor-9" }), "طابق 9");
  assert.strictEqual(B.badge({ originWard: "floor-6" }), "طابق 6");
  assert.ok(B.isNoOrder({ originWard: "hematology-7" }));
  assert.ok(!B.isNoOrder({ originWard: "floor-9" }) && !B.isNoOrder({ originWard: "floor-6" }));
});
t("bed badge shows the floor number", () => {
  assert.strictEqual(B.badge({ originWard: "medical", originNote: "9" }), "طابق 9");
  assert.strictEqual(B.badge({ originWard: "medical", originNote: "الطابق 6" }), "طابق 6");
  assert.strictEqual(B.badge({ originWard: "hematology-7" }), "طابق 7");
  assert.strictEqual(B.badge({ originWard: "oncology" }), "الأورام", "no floor typed → ward name");
  assert.strictEqual(B.badge({ originWard: "" }), "");
});
t("orderedPatients drops only the no-order boarders", () => {
  const map = {
    "room-1-bed-1": { name: "ward" },
    "room-1-bed-2": { name: "onc", originWard: "oncology" },
    "room-1-bed-3": { name: "hem", originWard: "hematology-7" }
  };
  assert.deepStrictEqual(Object.keys(B.orderedPatients(map)), ["room-1-bed-1", "room-1-bed-2"]);
});

t("details hidden only for pharmacists viewing 7th-floor patients", () => {
  let role = "pharmacist";
  global.PharmacyAuth = { isPharmacist: () => role === "pharmacist" };
  assert.ok(B.hidesDetails({ originWard: "hematology-7" }));
  assert.ok(!B.hidesDetails({ originWard: "oncology" }));
  assert.ok(!B.hidesDetails({ originWard: "" }));
  role = "doctor";
  assert.ok(!B.hidesDetails({ originWard: "hematology-7" }));
  delete global.PharmacyAuth;
});
t("report: boarder antibiotics are counted apart from the ward's", () => {
  const from = new Date(2026, 8, 1), to = new Date(2026, 9, 1);
  const at = (d) => new Date(2026, 8, d, 10).toISOString();
  const events = [
    { bed_key: "b1", event: "admitted", created_at: at(2) },
    { bed_key: "b1", event: "med_added", med_id: "ceftriaxone", med_name: "Ceftriaxone", created_at: at(2) },
    { bed_key: "b1", event: "med_removed", med_id: "ceftriaxone", med_name: "Ceftriaxone", created_at: at(6) },  // 5 days, ours
    { bed_key: "b2", event: "admitted", created_at: at(3) },
    { bed_key: "b2", event: "origin", detail: "oncology", created_at: at(3) },
    { bed_key: "b2", event: "med_added", med_id: "meropenem", med_name: "Meropenem", created_at: at(3) },
    { bed_key: "b2", event: "discharged", created_at: at(12) }                                                  // 10 days, boarder
  ];
  const exits = [{ kind: "discharged" }, { kind: "transferred" }, { kind: "dead" }];
  const rep = R.build(events, from, to, exits);
  assert.strictEqual(rep.admissions, 2);
  assert.strictEqual(rep.abxDot, 5, "only our patient's ceftriaxone");
  assert.strictEqual(rep.abxRows.length, 1);
  assert.strictEqual(rep.boarderRows.length, 1);
  assert.strictEqual(rep.boarderRows[0].label, "الأورام");
  assert.strictEqual(rep.boarderRows[0].admitted, 1);
  assert.strictEqual(rep.boarderRows[0].bedDays, 10);
  assert.strictEqual(rep.boarderRows[0].abxDot, 10);
  assert.strictEqual(rep.discharges, 1);
  assert.strictEqual(rep.transfers, 1);
  assert.strictEqual(rep.deaths, 1);
});
t("report: a new patient in the same bed starts a new (non-boarder) stay", () => {
  const from = new Date(2026, 8, 1), to = new Date(2026, 9, 1);
  const at = (d) => new Date(2026, 8, d, 10).toISOString();
  const events = [
    { bed_key: "b", event: "admitted", created_at: at(1) },
    { bed_key: "b", event: "origin", detail: "hematology-7", created_at: at(1) },
    { bed_key: "b", event: "discharged", created_at: at(4) },
    { bed_key: "b", event: "admitted", created_at: at(5) },
    { bed_key: "b", event: "med_added", med_id: "vancomycin", med_name: "Vancomycin", created_at: at(5) },
    { bed_key: "b", event: "med_removed", med_id: "vancomycin", med_name: "Vancomycin", created_at: at(7) }
  ];
  const rep = R.build(events, from, to, null);
  assert.strictEqual(rep.abxDot, 3);
  assert.strictEqual(rep.boarderRows[0].bedDays, 4);
  assert.strictEqual(rep.discharges, 1, "falls back to discharge events without the archive");
});

console.log(`\n${passed} tests passed`);
