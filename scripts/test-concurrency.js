// Two devices editing at once, against a fake Supabase that applies the
// same version rule as features.sql §7 (patients_version_guard).
const assert = require("assert");
const path = require("path");

// ---- fake cloud: rows by bed_key + the version trigger ----
const cloud = new Map();
let pidSeq = 0;
// app_move_patient: the row keeps its pid and version history, only the key changes
function cloudMove(from, to) {
  const r = Object.assign({}, cloud.get(from));
  cloud.delete(from);
  r.bed_key = to; r.version += 1;
  cloud.set(to, r);
}
function guardedUpsert(rows) {
  const saved = [];
  rows.forEach(r => {
    const old = cloud.get(r.bed_key);
    const row = Object.assign({}, r);
    if (old) {
      if (row.base_version != null && row.base_version < old.version) return;   // refused
      if (row.base_pid != null && old.pid && row.base_pid !== old.pid) return;  // another patient's copy (§21)
      row.version = old.version + 1;
      row.pid = old.pid;
    } else {
      row.version = 1;
      row.pid = "pid-" + (++pidSeq);
    }
    delete row.base_version; delete row.base_pid;
    cloud.set(row.bed_key, row);
    saved.push(Object.assign({}, row));
  });
  return saved;
}
function fakeClient() {
  return {
    from() {
      return {
        upsert(rows) {
          const saved = guardedUpsert(rows);
          const result = { data: null, error: null };
          const p = Promise.resolve(result);
          p.select = () => Promise.resolve({ data: saved, error: null });
          return p;
        },
        delete() {
          const f = {};
          const q = { eq(col, v) { f[col] = v; return q; },
            then(res, rej) {
              const row = cloud.get(f.bed_key);
              if (row && (f.pid === undefined || row.pid === f.pid)) cloud.delete(f.bed_key);
              return Promise.resolve({ error: null }).then(res, rej);
            } };
          return q;
        },
        select() {
          const all = Promise.resolve({ data: Array.from(cloud.values()).map(r => Object.assign({}, r)), error: null });
          all.eq = (_c, key) => ({ maybeSingle: async () => ({ data: cloud.has(key) ? Object.assign({}, cloud.get(key)) : null, error: null }) });
          return all;
        }
      };
    }
  };
}

// ---- one "device" = its own localStorage + fresh copies of the modules ----
function device() {
  const store = new Map();
  const win = {
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    PharmacySupabase: { isConfigured: () => true, getClient: () => fakeClient() }
  };
  const load = (f) => {
    const file = path.join(__dirname, "..", "js", f);
    delete require.cache[require.resolve(file)];
    const src = require("fs").readFileSync(file, "utf8");
    new Function("window", "self", "localStorage", "module", src)(win, win, win.localStorage, undefined);
  };
  load("patient-merge.js");
  load("storage.js");
  load("supabase-sync.js");
  return win;
}

const KEY = "room-1-bed-1", OTHER = "room-1-bed-2";
const med = (id) => ({ id, dose: "", frequency: "1×1" });

(async () => {
  let n = 0;
  const t = async (name, fn) => { cloud.clear(); await fn(); n++; console.log("✓ " + name); };

  await t("same patient: doctor adds a med, pharmacist sets the plate at the same time → both kept", async () => {
    const A = device(), B = device();
    // A creates the patient, B pulls it
    A.PharmacyStorage.upsertPatient(KEY, { name: "أحمد", plateNumber: "", medications: [med("cef")] });
    assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);
    await B.PharmacySupabaseSync.pullPatients();
    await A.PharmacySupabaseSync.pullPatients();
    // both edit the copy they have (version 1)
    const pa = A.PharmacyStorage.loadPatients()[KEY]; pa.medications.push(med("apx")); A.PharmacyStorage.upsertPatient(KEY, pa);
    const pb = B.PharmacyStorage.loadPatients()[KEY]; pb.plateNumber = "123"; B.PharmacyStorage.upsertPatient(KEY, pb);
    assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);          // doctor first → v2
    const rb = await B.PharmacySupabaseSync.pushPatient(KEY);               // pharmacist: refused → merged → v3
    assert.ok(rb.ok && rb.merged);
    const final = cloud.get(KEY);
    assert.strictEqual(final.plate_number, "123");
    assert.deepStrictEqual(JSON.parse(final.medications).map(m => m.id), ["cef", "apx"]);
    assert.strictEqual(final.version, 3);
    assert.strictEqual(B.PharmacyStorage.loadPatients()[KEY]._dirty, false);
  });

  await t("a stale device saving the whole ward never overwrites newer patients", async () => {
    const A = device(), B = device();
    A.PharmacyStorage.upsertPatient(KEY, { name: "أحمد", medications: [med("cef")] });
    A.PharmacyStorage.upsertPatient(OTHER, { name: "سعاد", medications: [] });
    await A.PharmacySupabaseSync.pushPatients();
    await B.PharmacySupabaseSync.pullPatients();
    await A.PharmacySupabaseSync.pullPatients();
    // B adds a med to سعاد (v2); A never hears about it (phone asleep)
    const s = B.PharmacyStorage.loadPatients()[OTHER]; s.medications.push(med("omz")); B.PharmacyStorage.upsertPatient(OTHER, s);
    await B.PharmacySupabaseSync.pushPatient(OTHER);
    // A edits أحمد and pushes EVERYTHING it has (old full-push path)
    const a = A.PharmacyStorage.loadPatients()[KEY]; a.name = "أحمد علي"; A.PharmacyStorage.upsertPatient(KEY, a);
    await A.PharmacySupabaseSync.pushPatients();
    assert.deepStrictEqual(JSON.parse(cloud.get(OTHER).medications).map(m => m.id), ["omz"]);   // B's med survived
    assert.strictEqual(cloud.get(KEY).name, "أحمد علي");
    // and A catches up on the next pull
    await A.PharmacySupabaseSync.pullPatients();
    assert.deepStrictEqual(A.PharmacyStorage.loadPatients()[OTHER].medications.map(m => m.id), ["omz"]);
  });

  await t("pull: a newer cloud copy replaces an untouched local one, and merges with unsent edits", async () => {
    const A = device(), B = device();
    A.PharmacyStorage.upsertPatient(KEY, { name: "أ", plateNumber: "", allergies: "", medications: [] });
    await A.PharmacySupabaseSync.pushPatient(KEY);
    await B.PharmacySupabaseSync.pullPatients();
    // A edits offline (not pushed); B saves another field
    const a = A.PharmacyStorage.loadPatients()[KEY]; a.allergies = "Penicillins"; A.PharmacyStorage.upsertPatient(KEY, a);
    const b = B.PharmacyStorage.loadPatients()[KEY]; b.plateNumber = "55"; B.PharmacyStorage.upsertPatient(KEY, b);
    await B.PharmacySupabaseSync.pushPatient(KEY);
    await A.PharmacySupabaseSync.pullPatients();       // merges, then pushes the merge back
    const c = cloud.get(KEY);
    assert.strictEqual(c.plate_number, "55");
    assert.strictEqual(c.allergies, "Penicillins");
  });

  await t("a brand-new patient (no version yet) is saved as version 1", async () => {
    const A = device();
    A.PharmacyStorage.upsertPatient(KEY, { name: "أ", medications: [] });
    const r = await A.PharmacySupabaseSync.pushPatient(KEY);
    assert.ok(r.ok);
    assert.strictEqual(cloud.get(KEY).version, 1);
    assert.strictEqual(A.PharmacyStorage.loadPatients()[KEY].version, 1);
  });

  await t("a doctor adds a patient → the other device's poll shows it, even with another card open", async () => {
    const A = device(), B = device();
    B.PharmacyStorage.upsertPatient(OTHER, { name: "مفتوح", medications: [] });
    await B.PharmacySupabaseSync.pushPatient(OTHER);
    A.PharmacyStorage.upsertPatient(KEY, { name: "جديد", medications: [] });
    await A.PharmacySupabaseSync.pushPatient(KEY);
    // B has OTHER open with an edit not yet saved to the cloud
    const open = B.PharmacyStorage.loadPatients()[OTHER]; open.plateNumber = "9";
    B.PharmacyStorage.savePatients(Object.assign(B.PharmacyStorage.loadPatients(), { [OTHER]: open }));
    assert.ok((await B.PharmacySupabaseSync.pullPatients({ keepBed: OTHER })).ok);
    const now = B.PharmacyStorage.loadPatients();
    assert.strictEqual(now[KEY].name, "جديد");
    assert.strictEqual(now[OTHER].plateNumber, "9");
  });

  await t("bed reuse: patient moved 22→23 and a new one admitted to 22 → a device that missed it ends up right", async () => {
  const A = device(), B = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "علي علي", medications: [med("cef")] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  await A.PharmacySupabaseSync.pullPatients();
  await B.PharmacySupabaseSync.pullPatients();               // B holds علي at KEY (never told about the move)
  // A moves him (server rename), then admits a new patient in the old bed
  cloudMove(KEY, OTHER);
  A.PharmacyStorage.deletePatient(KEY); A.PharmacyStorage.saveLocalDeletion(KEY);
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض جديد", medications: [] });
  // A pulls BEFORE its new patient reaches the cloud: it must not be dropped
  await A.PharmacySupabaseSync.pullPatients();
  assert.strictEqual(A.PharmacyStorage.loadPatients()[KEY].name, "مريض جديد", "new patient kept on A");
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);
  // B was offline: it pulls now
  await B.PharmacySupabaseSync.pullPatients();
  const b = B.PharmacyStorage.loadPatients();
  assert.strictEqual(b[KEY].name, "مريض جديد", "B shows the new patient in the old bed");
  assert.strictEqual(b[OTHER].name, "علي علي");
  });

  await t("bed reuse: a stale copy of the moved patient cannot overwrite the new patient", async () => {
  const A = device(), B = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "علي علي", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  await B.PharmacySupabaseSync.pullPatients();
  cloudMove(KEY, OTHER);
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض جديد", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  // B edits the OLD patient it still shows at KEY and saves
  const stale = B.PharmacyStorage.loadPatients()[KEY]; stale.plateNumber = "123456"; B.PharmacyStorage.upsertPatient(KEY, stale);
  const r = await B.PharmacySupabaseSync.pushPatient(KEY);
  assert.ok(r.ok);
  assert.strictEqual(cloud.get(KEY).name, "مريض جديد", "cloud still has the new patient");
  assert.strictEqual(B.PharmacyStorage.loadPatients()[KEY].name, "مريض جديد", "B's stale copy replaced");
  });

  await t("one device saving the same patient several times in a row is never reported as another person's edit", async () => {
  const A = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "أ", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);                  // saved once: version known
  const f0 = A.PharmacyStorage.loadPatients()[KEY]; f0.allergies = "a"; A.PharmacyStorage.upsertPatient(KEY, f0);
  const first = A.PharmacySupabaseSync.pushPatient(KEY);          // not awaited: typing continues
  const p1 = A.PharmacyStorage.loadPatients()[KEY]; p1.plateNumber = "1"; A.PharmacyStorage.upsertPatient(KEY, p1);
  const second = A.PharmacySupabaseSync.pushPatient(KEY);
  const p2 = A.PharmacyStorage.loadPatients()[KEY]; p2.diagnosis = "x"; A.PharmacyStorage.upsertPatient(KEY, p2);
  const third = A.PharmacySupabaseSync.pushPatient(KEY);
  const rs = await Promise.all([first, second, third]);
  rs.forEach(r => { assert.ok(r.ok); assert.ok(!r.merged, "own saves must not count as a merge"); });
  assert.strictEqual(cloud.get(KEY).plate_number, "1");
  assert.strictEqual(cloud.get(KEY).diagnosis, "x");
  });

  await t("delete then a NEW patient in the bed: a device that missed it (stale copy, no pid) ends with the new patient", async () => {
  const A = device(), B = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض قديم", medications: [med("cef")] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  await A.PharmacySupabaseSync.pullPatients();
  await B.PharmacySupabaseSync.pullPatients();
  // B's copy is an old one: no pid, clean, with a HIGH version (more saves than the new patient will have)
  const old = B.PharmacyStorage.loadPatients(); delete old[KEY].pid; old[KEY].version = 9; B.PharmacyStorage.savePatients(old);
  const pidOld = cloud.get(KEY).pid;
  // A deletes him (cloud delete), then admits another patient with another name
  A.PharmacyStorage.deletePatient(KEY);
  assert.ok((await A.PharmacySupabaseSync.pushPatientDelete(KEY, pidOld)).ok);
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض جديد", medications: [] });
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);
  // B opens the app later and pulls
  await B.PharmacySupabaseSync.pullPatients();
  assert.strictEqual(B.PharmacyStorage.loadPatients()[KEY].name, "مريض جديد");
  assert.strictEqual(cloud.get(KEY).name, "مريض جديد");
  });

  await t("a delete that arrives after the bed got a new patient does not remove him (pid filter)", async () => {
  const A = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض قديم", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  const pidOld = cloud.get(KEY).pid;
  cloud.delete(KEY);                                           // already gone in the cloud
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض جديد", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);               // new row, new pid
  assert.notStrictEqual(cloud.get(KEY).pid, pidOld);
  await A.PharmacySupabaseSync.pushPatientDelete(KEY, pidOld); // the old patient's late delete
  assert.strictEqual(cloud.get(KEY).name, "مريض جديد", "the new patient survives");
  });

  await t("a delete and the next save of the bed run in order: delete first, then the new patient is inserted", async () => {
  const A = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض قديم", medications: [] });
  await A.PharmacySupabaseSync.pushPatient(KEY);
  const pidOld = cloud.get(KEY).pid;
  A.PharmacyStorage.deletePatient(KEY);
  const del = A.PharmacySupabaseSync.pushPatientDelete(KEY, pidOld);          // not awaited
  A.PharmacyStorage.upsertPatient(KEY, { name: "مريض جديد", medications: [] });
  const save = A.PharmacySupabaseSync.pushPatient(KEY);                       // queued behind the delete
  await Promise.all([del, save]);
  assert.strictEqual(cloud.get(KEY).name, "مريض جديد");
  assert.notStrictEqual(cloud.get(KEY).pid, pidOld, "a fresh row, not the old patient's");
  });

  await t("the app keeps ONE in-memory object per bed: successive edits built on it are never reported as another person's edit", async () => {
  const A = device();
  const mem = { name: "أ", medications: [] };                      // state.patients[bed] — lives on between saves
  A.PharmacyStorage.upsertPatient(KEY, mem);
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);   // storage now has version 1 / pid; mem does not
  for (let i = 1; i <= 3; i++) {
    mem.plateNumber = String(i);
    A.PharmacyStorage.upsertPatient(KEY, mem);                     // writes the stale object again
    const r = await A.PharmacySupabaseSync.pushPatient(KEY);
    assert.ok(r.ok);
    assert.ok(!r.merged, "edit " + i + " must not be reported as someone else's");
  }
  assert.strictEqual(cloud.get(KEY).plate_number, "3");
  });

  await t("a rename just saved is not undone by an older cloud copy arriving from a pull in flight", async () => {
  const A = device();
  A.PharmacyStorage.upsertPatient(KEY, { name: "اسم اول", medications: [] });
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);
  const older = JSON.parse(JSON.stringify(cloud.get(KEY)));        // what a poll fetched BEFORE the rename
  const p = A.PharmacyStorage.loadPatients()[KEY]; p.name = "اسم ثان"; A.PharmacyStorage.upsertPatient(KEY, p);
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);   // saved: local is clean with the new name
  const local = A.PharmacyStorage.loadPatients();
  const remote = { [KEY]: A.PharmacySupabaseSync.cloudPatient(older) };   // the stale poll result
  const merged = A.PharmacyStorage.mergePatients(local, remote);
  assert.strictEqual(merged[KEY].name, "اسم ثان", "the newer rename survives");
  });

  await t("the in-memory copy never learns the saved version: the 3rd edit built on it is still not 'someone else's'", async () => {
  const A = device();
  const mem = { name: "أ", medications: [] };
  A.PharmacyStorage.upsertPatient(KEY, mem);
  assert.ok((await A.PharmacySupabaseSync.pushPatient(KEY)).ok);          // cloud v1; storage has v1 + pid
  const s1 = A.PharmacyStorage.loadPatients()[KEY];
  mem.version = s1.version; mem.pid = s1.pid; mem._base = s1._base;       // the first echo reached the in-memory copy…
  for (let i = 1; i <= 3; i++) {                                           // …but the later ones did not
    mem.plateNumber = String(i);
    A.PharmacyStorage.upsertPatient(KEY, mem);
    const r = await A.PharmacySupabaseSync.pushPatient(KEY);
    assert.ok(r.ok);
    assert.ok(!r.merged, "edit " + i + " must not be reported as someone else's");
    A.PharmacySupabaseSync.adoptSavedVersion(KEY, mem);                    // what app.js persistPatient does when a save returns
  }
  assert.strictEqual(cloud.get(KEY).plate_number, "3");
  });

  console.log(n + " tests passed");
})().catch(e => { console.error(e); process.exit(1); });
