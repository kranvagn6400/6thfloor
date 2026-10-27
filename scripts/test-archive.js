// node scripts/test-archive.js — archive-sync.js against an in-memory Supabase mock
const assert = require("assert");
global.window = global;

// ---- localStorage + Storage (just the archive lists) ----
const ls = {};
global.localStorage = {
  getItem: k => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: k => { delete ls[k]; }
};
const list = k => JSON.parse(localStorage.getItem(k) || "[]");
global.PharmacyStorage = {
  loadDischarged: () => list("d"), saveDischarged: a => localStorage.setItem("d", JSON.stringify(a)),
  loadDead: () => list("x"),       saveDead: a => localStorage.setItem("x", JSON.stringify(a)),
  loadTransferred: () => list("t"), saveTransferred: a => localStorage.setItem("t", JSON.stringify(a))
};

// ---- Supabase mock: one table, upsert(ignoreDuplicates) / select / delete ----
let db = [];
let online = true;
function query() {
  const q = { filters: [], op: "select" };
  const run = async () => {
    if (!online) return { data: null, error: { message: "Failed to fetch" } };
    if (q.op === "upsert") {
      q.rows.forEach(r => { if (!db.some(x => x.id === r.id)) db.push(JSON.parse(JSON.stringify(r))); });
      return { data: null, error: null };
    }
    let rows = db.filter(r => q.filters.every(([k, v]) => r[k] === v));
    if (q.op === "delete") { db = db.filter(r => !rows.includes(r)); return { data: null, error: null }; }
    rows = rows.slice().sort((a, b) => b.event_at.localeCompare(a.event_at)).slice(q.from, q.to + 1);
    return { data: rows, error: null };
  };
  const api = {
    upsert(rows) { q.op = "upsert"; q.rows = rows; return api; },
    select() { return api; },
    delete() { q.op = "delete"; return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    order() { return api; },
    range(a, b) { q.from = a; q.to = b; return api; },
    then(res, rej) { return run().then(res, rej); }
  };
  return api;
}
global.PharmacySupabase = { isConfigured: () => true, getClient: () => ({ from: () => query() }) };

require("../js/archive-sync.js");
const A = global.PharmacyArchive;
const tick = () => new Promise(r => setTimeout(r, 10));

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log("✓ " + name); }

(async () => {
  await t("legacy local records (no id) are uploaded on first sync", async () => {
    PharmacyStorage.saveDischarged([{ name: "قديم", dischargedAt: "2026-09-01T10:00:00Z" }]);
    assert.strictEqual(A.pendingCount(), 1);
    const res = await A.sync();
    assert.ok(res.ok, res.error);
    assert.strictEqual(db.length, 1);
    assert.strictEqual(db[0].kind, "discharged");
    assert.strictEqual(db[0].record.name, "قديم");
    assert.strictEqual(A.pendingCount(), 0);
  });

  await t("add() uploads in the background", async () => {
    A.add("dead", { name: "م", diedAt: "2026-10-01T10:00:00Z" });
    await tick();
    assert.strictEqual(db.filter(r => r.kind === "dead").length, 1);
    assert.strictEqual(A.pendingCount(), 0);
  });

  await t("offline add stays pending, uploads on the next sync", async () => {
    online = false;
    A.add("discharged", { name: "بدون إنترنت", dischargedAt: "2026-10-05T10:00:00Z" });
    await tick();
    assert.strictEqual(A.pendingCount(), 1);
    const failed = await A.sync();
    assert.ok(!failed.ok);
    assert.strictEqual(PharmacyStorage.loadDischarged().length, 2, "nothing lost while offline");
    online = true;
    assert.ok((await A.sync()).ok);
    assert.strictEqual(A.pendingCount(), 0);
    assert.strictEqual(db.filter(r => r.kind === "discharged").length, 2);
  });

  await t("records from another device appear after sync, newest first", async () => {
    db.push({ id: "other-1", kind: "discharged", record: { name: "جهاز آخر", dischargedAt: "2026-10-10T10:00:00Z" }, event_at: "2026-10-10T10:00:00Z" });
    await A.sync();
    const names = PharmacyStorage.loadDischarged().map(r => r.name);
    assert.deepStrictEqual(names, ["جهاز آخر", "بدون إنترنت", "قديم"]);
  });

  await t("remove() deletes in the cloud and locally", async () => {
    assert.ok((await A.remove("discharged", "other-1")).ok);
    assert.ok(!db.some(r => r.id === "other-1"));
    assert.ok(!PharmacyStorage.loadDischarged().some(r => r.id === "other-1"));
  });

  await t("remove() refuses offline (cloud copy would come back)", async () => {
    global.PharmacySupabase.isConfigured = () => false;
    const id = PharmacyStorage.loadDischarged()[0].id;
    assert.ok(!(await A.remove("discharged", id)).ok);
    global.PharmacySupabase.isConfigured = () => true;
  });

  await t("transfers go to their own list", async () => {
    A.add("transferred", { name: "منقول", transferredTo: "الأورام", transferredAt: "2026-10-11T10:00:00Z" });
    await tick();
    assert.strictEqual(db.filter(r => r.kind === "transferred").length, 1);
    await A.sync();
    assert.strictEqual(PharmacyStorage.loadTransferred()[0].transferredTo, "الأورام");
  });

  await t("clearAll() empties one kind only", async () => {
    assert.ok((await A.clearAll("discharged")).ok);
    assert.strictEqual(db.filter(r => r.kind === "discharged").length, 0);
    assert.strictEqual(db.filter(r => r.kind === "dead").length, 1);
    assert.strictEqual(PharmacyStorage.loadDischarged().length, 0);
  });

  console.log(`\n${passed} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
