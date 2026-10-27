// Ward display alerts: which colour a bed lights up with, and for how long
const assert = require("assert");
global.window = global;
require("../js/tv-alerts.js");
const T = window.PharmacyTvAlerts;
let n = 0;
const t = (name, fn) => { fn(); n++; };
const now = Date.parse("2026-10-17T10:00:00Z");
const at = (min) => new Date(now - min * 60000).toISOString();

t("medicine added / stopped / changed → orange (med)", () => {
  const m = T.build([
    { bed_key: "room-1-bed-1", event: "med_added", med_name: "Ceftriaxone", created_at: at(5) },
    { bed_key: "room-1-bed-2", event: "med_changed", created_at: at(5) },
    { bed_key: "room-1-bed-3", event: "moved", created_at: at(5) }      // not a medicine change
  ], [], now);
  assert.strictEqual(m.get("room-1-bed-1").type, "med");
  assert.strictEqual(m.get("room-1-bed-1").detail, "إضافة Ceftriaxone");
  assert.strictEqual(m.get("room-1-bed-2").type, "med");
  assert.ok(!m.has("room-1-bed-3"));
});
t("discharge → pink (out), return to floor → nothing, death → black (dead), on the right bed", () => {
  const m = T.build([], [
    { kind: "discharged", name: "أ", record: { roomNumber: 2, bedNumber: 3 }, event_at: at(10) },
    { kind: "transferred", name: "ب", record: { roomNumber: 2, bedNumber: 4 }, event_at: at(10) },
    { kind: "dead", name: "ج", record: { roomNumber: 6, bedNumber: 1 }, event_at: at(10) }
  ], now);
  assert.strictEqual(m.get("room-2-bed-3").type, "out");
  assert.ok(!m.has("room-2-bed-4"));                        // returned to their floor: not lit
  assert.strictEqual(m.get("room-6-bed-1").type, "dead");
  assert.strictEqual(m.get("room-6-bed-1").name, "ج");
});
t("the newest event of a bed wins; older than an hour is ignored", () => {
  const m = T.build(
    [{ bed_key: "room-3-bed-1", event: "med_added", created_at: at(2) },
     { bed_key: "room-3-bed-2", event: "med_added", created_at: at(61) }],
    [{ kind: "dead", name: "د", record: { roomNumber: 3, bedNumber: 1 }, event_at: at(20) }], now);
  assert.strictEqual(m.get("room-3-bed-1").type, "med");     // a new patient's medicines after the death
  assert.ok(!m.has("room-3-bed-2"));
});
t("a new patient → green, and writing their medicines keeps it green; a later change of an old patient is orange", () => {
  const m = T.build([
    { bed_key: "room-4-bed-1", event: "admitted", patient_name: "جديد", created_at: at(10) },
    { bed_key: "room-4-bed-1", event: "med_added", created_at: at(9) },
    { bed_key: "room-4-bed-1", event: "med_changed", created_at: at(5) },
    { bed_key: "room-4-bed-2", event: "med_added", created_at: at(5) }       // admitted earlier than the hour
  ], [], now);
  assert.strictEqual(m.get("room-4-bed-1").type, "new");
  assert.strictEqual(m.get("room-4-bed-2").type, "med");
});
t("a death after the admission wins (newest)", () => {
  const m = T.build([{ bed_key: "room-4-bed-3", event: "admitted", created_at: at(30) }],
    [{ kind: "dead", name: "ه", record: { roomNumber: 4, bedNumber: 3 }, event_at: at(5) }], now);
  assert.strictEqual(m.get("room-4-bed-3").type, "dead");
});
console.log(n + " tests passed");
