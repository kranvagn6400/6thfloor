// A medicine made unavailable on one account reaches the others. node scripts/test-availability-sync.js
const assert = require("assert");

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.window = global;
global.document = { getElementById: () => null, querySelectorAll: () => [], readyState: "complete", addEventListener() {} };
global.addEventListener = () => {};

const meds = [{ id: "a" }, { id: "b", available: false }, { id: "c" }];
let modified = 10, synced = 10, saves = 0;
global.PharmacyStorage = {
  saveMedications() { saves++; modified = Date.now(); },
  hasUnsyncedLocalEdits: () => modified > synced,
  setLocalCatalogSyncedAt: (ms) => { synced = ms; }
};
let redrawn = 0, cloudRows = [], pushed = [], pushOk = true;
global.PharmacyApp = { state: { medications: meds }, flashHint() {}, refreshMedSheet() { redrawn++; } };
global.PharmacyAuth = { isLoggedIn: () => true };
global.PharmacySupabaseSync = {
  fetchAvailability: async () => ({ ok: true, rows: cloudRows }),
  pushMedicationRows: async (ids) => { pushed.push(ids); return pushOk ? { ok: true } : { ok: false, error: "network" }; }
};
require("../js/med-availability.js");
const MA = window.PharmacyMedAvailability;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // another user's change: stored, shown, and not counted as an edit of this device
  assert.deepStrictEqual(MA.applyCloud([{ id: "a", available: false }, { id: "b", available: true }, { id: "zzz", available: false }]), ["a", "b"]);
  assert.strictEqual(meds[0].available, false);
  assert.strictEqual(meds[1].available, true);
  assert.strictEqual(saves, 1);
  assert.strictEqual(redrawn, 1, "open pages redraw");
  assert.strictEqual(PharmacyStorage.hasUnsyncedLocalEdits(), false, "catalogue pulls keep working");

  // nothing different: no save, no redraw
  assert.deepStrictEqual(MA.applyCloud([{ id: "a", available: false }]), []);
  assert.strictEqual(saves, 1);

  // a device that already has unsent catalogue edits still receives availability, and stays «unsent»
  modified = Date.now() + 1000; synced = 0;
  assert.deepStrictEqual(MA.applyCloud([{ id: "c", available: false }]), ["c"]);
  assert.strictEqual(meds[2].available, false);
  assert.strictEqual(synced, 0);
  modified = 10; synced = 10;

  // the poll brings a missed change
  cloudRows = [{ id: "c", available: true }];
  await MA.refreshFromCloud();
  assert.strictEqual(meds[2].available, true, "a missed realtime event is caught by the poll");

  console.log("availability sync: all passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
