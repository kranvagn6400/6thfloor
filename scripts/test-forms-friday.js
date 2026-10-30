// Friday albumin rule: a Thursday form printed and not refused covers Friday. node scripts/test-forms-friday.js
const assert = require("assert");
let today = "2026-10-30";                 // a Friday
global.window = global;
global.document = { readyState: "complete", getElementById: () => null, addEventListener() {} };
global.PharmacyChartSync = { todayISO: () => today };
global.PharmacyClinical = { isAlbumin: (m) => /albumin/i.test(m.id), abxDay: () => 2 };
global.PharmacyApp = { state: { medications: [{ id: "albumin" }], patients: {} } };
require("../js/patient-forms.js");
const { dueInfo } = window.PharmacyPatientForms;
const patient = (albumin) => ({ name: "x", medications: [{ id: "albumin" }], labs: { _forms: { albumin } } });
const THU = "2026-10-29";

assert.strictEqual(dueInfo("albumin", patient({ hist: [{ date: THU }] })).state, "covered", "printed Thursday → covered on Friday");
assert.strictEqual(dueInfo("albumin", patient({ hist: [] })).state, "due", "admitted on Friday → due");
assert.strictEqual(dueInfo("albumin", patient({ hist: [], rej: [{ date: THU }] })).state, "due", "refused on Thursday → due on Friday");
assert.strictEqual(dueInfo("albumin", patient({ hist: [], pending: { date: THU } })).state, "due", "file made, not printed on Thursday → due");
assert.strictEqual(dueInfo("albumin", patient({ hist: [{ date: "2026-10-28" }] })).state, "due", "last form on Wednesday → due");
assert.strictEqual(dueInfo("albumin", patient({ hist: [{ date: THU }, { date: today }] })).state, "done", "printed on Friday anyway → done");
today = "2026-10-31";                     // Saturday: everything is normal again
assert.strictEqual(dueInfo("albumin", patient({ hist: [{ date: THU }] })).state, "due", "Saturday → due");
today = THU;                              // Thursday itself
assert.strictEqual(dueInfo("albumin", patient({ hist: [{ date: "2026-10-28" }] })).state, "due", "Thursday → due");
console.log("forms Friday rule: all passed");
process.exit(0);
