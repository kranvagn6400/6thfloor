/* ============================================================
   storage.js
   Local storage abstraction layer.

   The public API exposed on window.PharmacyStorage is the
   contract any future backend (Supabase / PostgreSQL / hospital
   DB / REST API) needs to implement. Replacing this file with a
   remote-backed adapter should not require touching ui.js / app.js.
   ============================================================ */

(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    PATIENTS:    "pharma.patients.v1",     // map: bedKey -> patient
    MEDICATIONS: "pharma.medications.v1",  // array: default med catalog
    MEDICATIONS_LAST_MODIFIED: "pharma.medications.modified.v1", // ms timestamp
    MEDICATIONS_LAST_SYNCED: "pharma.medications.synced.v1",     // ms timestamp
    CATALOG_SEED_VERSION: "pharma.catalog.seed.v1",               // last DEFAULT_MEDICATIONS version merged in
    DISCHARGED:  "pharma.discharged.v1",   // array: discharged patient records
    DEAD:        "pharma.dead.v1",          // array: dead patient records
    TRANSFERRED: "pharma.transferred.v1",   // array: patients transferred to another ward
    NOTIFICATIONS: "pharma.notifications.v1",   // array: pharmacist notifications
    MED_REQUESTS: "pharma.med-requests.v1"   // array: doctor → admin med approval requests
  };

  function safeParse(raw, fallback) {
    if (raw == null || raw === "") return fallback;
    try { return JSON.parse(raw); }
    catch (e) { console.warn("[PharmacyStorage] parse failed:", e); return fallback; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("[PharmacyStorage] set failed:", e); return false; }
  }

  // ----- Migration: ensure every medication has nameTrade + form -----
  // Older versions stored only nameAr + nameEn. We now use nameTrade
  // (trade/brand name) as the primary display name. If a stored
  // medication lacks nameTrade, we copy it from nameAr (or nameEn).
  // We also back-fill the `form` field (one of: vial, ampule,
  // prefilled-syringe, tablet, supplies) — defaulting to "vial"
  // since most hospital ward medications are injectables.
  // We do the same for patient.medications entries so existing
  // patient data keeps working after the upgrade.
  const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
  function migrateMed(med) {
    if (!med || typeof med !== "object") return med;
    if (!("nameTrade" in med) || !med.nameTrade) {
      med.nameTrade = med.nameAr || med.nameEn || "";
    }
    if (!("form" in med) || !med.form || VALID_FORMS.indexOf(med.form) === -1) {
      med.form = "vial";
    }
    return med;
  }
  function migrateMedsList(list) {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const out = list.map(m => {
      if (!m || typeof m !== "object") return m;
      const needsTrade = !("nameTrade" in m) || !m.nameTrade;
      const needsForm  = !("form" in m) || !m.form;
      if (needsTrade || needsForm) {
        changed = true;
        return migrateMed({ ...m });
      }
      return m;
    });
    return { list: out, changed };
  }

  // ----- Patients -----
  // Each patient may carry an `updatedAt` (ms timestamp) used by the
  // Supabase sync layer to do last-write-wins merging. If missing
  // (legacy data), we treat it as 0 so a cloud row with a real
  // updated_at always wins the first merge.
  function loadPatients() {
    const all = safeParse(localStorage.getItem(STORAGE_KEYS.PATIENTS), {});
    // Migrate patient.medications entries: back-fill nameTrade
    let changed = false;
    for (const bedKey of Object.keys(all)) {
      const p = all[bedKey];
      if (!p || !Array.isArray(p.medications)) continue;
      const res = migrateMedsList(p.medications);
      if (res.changed) {
        p.medications = res.list;
        changed = true;
      }
    }
    if (changed) savePatients(all);
    return all;
  }
  function savePatients(map) {
    return safeSet(STORAGE_KEYS.PATIENTS, map);
  }
  function getPatient(bedKey) {
    const all = loadPatients();
    return all[bedKey] || null;
  }
  // ----- Server clock -----
  // Phone clocks differ by seconds or minutes. Every time compared against a
  // cloud timestamp (updated_at is set by the database) must be on the
  // server's clock: offset = server time - this phone's time, measured on
  // each pull (supabase-sync.js syncServerClock). 0 until first measured.
  const SERVER_OFFSET_KEY = "pharma.serverOffset.v1";
  let _serverOffset = 0;
  try { _serverOffset = Number(localStorage.getItem(SERVER_OFFSET_KEY)) || 0; } catch (e) { /* ignore */ }
  function setServerOffset(ms) {
    if (!Number.isFinite(ms)) return;
    _serverOffset = ms;
    try { localStorage.setItem(SERVER_OFFSET_KEY, String(ms)); } catch (e) { /* ignore */ }
  }
  function serverNow() { return Date.now() + _serverOffset; }

  function upsertPatient(bedKey, patient) {
    const all = loadPatients();
    // Stamp the patient with the current time so the sync layer
    // can resolve conflicts with last-write-wins.
    if (patient && typeof patient === "object") {
      patient.updatedAt = serverNow();
      patient._dirty = true;      // edited here, not yet confirmed by the cloud
    }
    all[bedKey] = patient;
    return savePatients(all);
  }
  // Store a patient exactly as given (a copy from the cloud) — no
  // timestamp, not marked as a local edit.
  function putPatient(bedKey, patient) {
    const all = loadPatients();
    all[bedKey] = patient;
    return savePatients(all);
  }
  function deletePatient(bedKey) {
    const all = loadPatients();
    delete all[bedKey];
    return savePatients(all);
  }
  function allPatientsArray() {
    const all = loadPatients();
    return Object.entries(all).map(([key, p]) => ({ ...p, _key: key }));
  }

  // ----- Deleted beds tracking (tombstone) -----
  // Tracks two things:
  //   1. Local deletions: bed_keys deleted on THIS device (so the
  //      device doesn't re-introduce them via push-back).
  //   2. Last-seen cloud keys: the set of bed_keys that were in the
  //      cloud on the last successful pull. On the next pull, if a
  //      bed_key was in the last-seen set but is now MISSING from the
  //      cloud, it was deleted on ANOTHER device. We respect that
  //      deletion and remove it from the local merge result too —
  //      UNLESS the local copy was modified after the last sync (in
  //      which case the user edited it on this device and we
  //      shouldn't lose their edit).
  const DELETED_TRACKING_KEY = "pharma.patients.deleted.v1";
  const LAST_SEEN_CLOUD_KEY = "pharma.patients.lastcloud.v1";

  function loadLocalDeletions() {
    try {
      const raw = localStorage.getItem(DELETED_TRACKING_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveLocalDeletion(bedKey) {
    try {
      const dels = loadLocalDeletions();
      dels[bedKey] = serverNow();
      localStorage.setItem(DELETED_TRACKING_KEY, JSON.stringify(dels));
    } catch (e) { /* ignore */ }
  }
  function clearLocalDeletion(bedKey) {
    try {
      const dels = loadLocalDeletions();
      delete dels[bedKey];
      localStorage.setItem(DELETED_TRACKING_KEY, JSON.stringify(dels));
    } catch (e) { /* ignore */ }
  }
  function loadLastSeenCloudKeys() {
    try {
      const raw = localStorage.getItem(LAST_SEEN_CLOUD_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveLastSeenCloudKeys(keys) {
    try {
      localStorage.setItem(LAST_SEEN_CLOUD_KEY, JSON.stringify(keys || []));
    } catch (e) { /* ignore */ }
  }

  // Merge a remote (cloud) patients map with the local map.
  // Handles cross-device deletions via the "last-seen cloud keys"
  // tracking: if a bed_key was in the cloud last time but is now
  // gone, it was deleted on another device — we respect that and
  // drop it from the result (unless the local copy was modified
  // since the last sync).
  function _toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }
  function mergePatients(localMap, remoteMap) {
    const local = localMap || {};
    const remote = remoteMap || {};
    const localDeletions = loadLocalDeletions();
    const lastSeenCloud = new Set(loadLastSeenCloudKeys());
    const remoteKeys = new Set(Object.keys(remote));
    // Update last-seen cloud keys for next time (caller will save
    // after merge — but we save here so it's ready for the next call)
    saveLastSeenCloudKeys(Object.keys(remote));

    const keys = new Set(Object.keys(local).concat(Object.keys(remote)));
    const out = {};
    for (const k of keys) {
      const lp = local[k];
      const rp = remote[k];

      // 1) If this bed was deleted on THIS device, respect the local
      //    deletion UNLESS the cloud has a newer version (another
      //    device re-added the patient after our deletion). In that
      //    case, the cloud version should win — the patient is alive
      //    on another device.
      if (localDeletions[k]) {
        if (rp) {
          // Cloud still has this patient. Check if the cloud version
          // is newer than our deletion time. If so, someone re-added
          // it after we deleted it → respect the cloud version
          // (clear the tombstone and keep the cloud patient).
          const delTime = localDeletions[k] || 0;
          const cloudTime = _toMs(rp.updatedAt);
          if (cloudTime > delTime) {
            // Cloud version is newer than our deletion → re-introduce
            clearLocalDeletion(k);
            out[k] = rp;
            continue;
          }
          // Cloud version is same or older → keep our deletion
          continue;
        } else {
          // Cloud no longer has it → deletion fully propagated
          clearLocalDeletion(k);
          // …but a NEW patient entered in this bed after the deletion and not
          // saved yet is not the deleted one: keep it
          if (lp && lp._dirty !== false && _toMs(lp.updatedAt) >= (localDeletions[k] || 0)) out[k] = lp;
          continue;
        }
      }

      // 2) If the bed_key was in the last-seen cloud set but is now
      //    MISSING from the cloud, it was deleted on another device.
      //    Respect the deletion → skip, UNLESS the local copy was
      //    modified after the last sync (user edited it here).
      if (!rp && lp && lastSeenCloud.has(k) && !remoteKeys.has(k) &&
          !(lp._dirty !== false && !Number.isInteger(lp.version))) {   // never-saved new patient: keep
        // Was in cloud before, now gone = deleted on another device.
        // Check if the local copy has been modified since the last
        // sync. If the local updatedAt is recent (after the
        // tombstone deletion time, which we approximate as "now"),
        // we keep it. In practice, if the local patient was last
        // modified before this pull, it's a stale copy → drop it.
        // We use a simple heuristic: if the patient has medications
        // or a name (i.e., it's a real patient, not just a leftover),
        // and it was in the cloud before, the deletion from the
        // other device should win.
        // → Skip (drop the patient)
        continue;
      }

      if (lp && !rp) { out[k] = lp; continue; }
      if (rp && !lp) { out[k] = rp; continue; }
      // A different patient in the same bed (the previous one was moved or
      // discharged, the key was reused): versions of two patients can't be
      // compared — the cloud's is the current one.
      if (lp && rp && lp.pid && rp.pid && lp.pid !== rp.pid) { out[k] = rp; continue; }
      // …and a copy with no pid (saved before pids existed) that has no unsent edits and another name is
      // the same story: the previous patient of this bed — the cloud's is current, whatever the versions say
      // (only when OUR copy has no pid: one that has a pid and the cloud's the same pid is the same patient — a rename
      // just saved here must not be undone by an older cloud copy that a poll fetched before it)
      if (lp && rp && !lp.pid && rp.pid && lp._dirty === false && String(lp.name || "").trim() !== String(rp.name || "").trim()) { out[k] = rp; continue; }
      // Server versions (features.sql §7) decide when both sides have them:
      // a newer cloud copy wins, merged with this device's unsent edits.
      if (Number.isInteger(rp.version)) {
        const lv = Number.isInteger(lp.version) ? lp.version : -1;
        if (rp.version > lv) {
          const PM = global.PharmacyPatientMerge;
          if (lp._dirty && PM) {
            const r = PM.merge3(lp._base, lp, rp);
            out[k] = Object.assign({}, rp, r.merged, { version: rp.version, _base: rp._base, _dirty: true, updatedAt: serverNow() });
          } else {
            out[k] = rp;
          }
          continue;
        }
        out[k] = lp;              // same or newer here (own edits pending)
        continue;
      }
      const lt = _toMs(lp.updatedAt);
      const rt = _toMs(rp.updatedAt);
      // Last-write-wins. Tie → keep local.
      out[k] = rt > lt ? rp : lp;
    }
    return out;
  }

  // ----- Medications catalog -----
  // First-run detection: we only seed the default catalog if the user
  // has NEVER saved anything (key doesn't exist). Once the user has
  // saved (even an empty array), we respect their choice — deleting
  // all meds should NOT silently restore defaults on next boot.
  //
  // HOWEVER: there are a few "required supplies" that the app's
  // auto-add rules depend on (e.g. '5cc Syringe' is auto-added with
  // every vial/ampule). If a returning user has a saved catalog that
  // predates the auto-add rule, we inject the required supplies on
  // the next load. This is a one-time migration — once injected,
  // they show up like any other catalog item and the user can edit
  // or delete them (though deleting them will break the auto-add
  // rule for new vials/ampules added afterwards).
  const REQUIRED_SUPPLIES = [
    {
      id: "syringe-5cc",
      nameTrade: "5cc Syringe",
      nameAr:    "سرنجة 5 سي سي",
      nameEn:    "5cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "syringe-1cc",
      nameTrade: "1cc Syringe",
      nameAr:    "سرنجة 1 سي سي",
      nameEn:    "1cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "syringe-10cc",
      nameTrade: "10cc Syringe",
      nameAr:    "سرنجة 10 سي سي",
      nameEn:    "10cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "syringe-20cc",
      nameTrade: "20cc Syringe",
      nameAr:    "سرنجة 20 سي سي",
      nameEn:    "20cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "syringe-50cc",
      nameTrade: "50cc Syringe",
      nameAr:    "سرنجة 50 سي سي",
      nameEn:    "50cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "iv-set",
      nameTrade: "I.V. Set",
      nameAr:    "خط وريدي",
      nameEn:    "I.V. Set",
      form:      "supplies",
      defaultDose:      "1 خط",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "blood-iv-set",
      nameTrade: "Blood I.V. Set",
      nameAr:    "خط دم",
      nameEn:    "Blood I.V. Set",
      form:      "supplies",
      defaultDose:      "1 خط",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "urine-bag",
      nameTrade: "Urine Bag",
      nameAr:    "كيس بول",
      nameEn:    "Urine Bag",
      form:      "supplies",
      defaultDose:      "1 كيس",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "floy-14",
      nameTrade: "Floy size 14",
      nameAr:    "فولي 14",
      nameEn:    "Foley Catheter 14",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "floy-16",
      nameTrade: "Floy size 16",
      nameAr:    "فولي 16",
      nameEn:    "Foley Catheter 16",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "floy-18",
      nameTrade: "Floy size 18",
      nameAr:    "فولي 18",
      nameEn:    "Foley Catheter 18",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "ng-tube-14",
      nameTrade: "NG Tube size 14",
      nameAr:    "أنبوب معدي 14",
      nameEn:    "NG Tube 14",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "ng-tube-16",
      nameTrade: "NG Tube size 16",
      nameAr:    "أنبوب معدي 16",
      nameEn:    "NG Tube 16",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "ng-tube-18",
      nameTrade: "NG Tube size 18",
      nameAr:    "أنبوب معدي 18",
      nameEn:    "NG Tube 18",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "cannula",
      nameTrade: "Cannula",
      nameAr:    "كانيولا",
      nameEn:    "Cannula",
      form:      "supplies",
      defaultDose:      "1 قطعة",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "dextrose-saline",
      nameTrade: "Dextrose Saline 0.9% / 5%",
      nameAr:    "ديكستروز سالين",
      nameEn:    "Dextrose Saline 0.9% / 5%",
      form:      "supplies",
      defaultDose:      "500 ml",
      defaultFrequency: "حسب الحاجة"
    },
    {
      id: "nacl-100ml",
      nameTrade: "NaCl 0.9% 100 ml",
      nameAr:    "مغذي ملح 100 مل",
      nameEn:    "Sodium Chloride 0.9% 100 ml",
      form:      "supplies",
      defaultDose:      "100 ml",
      defaultFrequency: "حسب الحاجة"
    }
  ];
  function injectRequiredSupplies(list) {
    if (!Array.isArray(list)) return list;
    const existingIds = new Set(list.map(m => m && m.id).filter(Boolean));
    let changed = false;
    for (const req of REQUIRED_SUPPLIES) {
      if (!existingIds.has(req.id)) {
        list.push(Object.assign({}, req));
        changed = true;
      }
    }
    return { list, changed };
  }

  // Merge any NEW default-meds (in DEFAULT_MEDICATIONS but missing
  // from the user's saved catalog) into the user's catalog. This is
  // triggered when DEFAULT_MEDICATIONS' version number (in
  // medications.js) is bumped above the version the user last saw.
  //
  // Behavior:
  //   - For each med in DEFAULT_MEDICATIONS that isn't already in
  //     the user's catalog (matched by id), append it.
  //   - User's existing edits/deletes are RESPECTED — if the user
  //     previously deleted a med by id, the merge will still add it
  //     back (because we can't distinguish "deleted" from "never
  //     had"). To prevent this from re-adding user-deleted meds on
  //     every app open, we record the version we merged up to and
  //     only run the merge when the version changes.
  //
  // This means: bumping DEFAULT_MEDICATIONS_VERSION is a one-time
  // trigger; after the user's catalog is updated, future opens
  // (with the same DEFAULT_MEDICATIONS_VERSION) won't re-add
  // anything they delete.
  function mergeNewDefaultMeds(list) {
    if (!Array.isArray(list)) return { list, changed: false };
    const defaults = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    if (!Array.isArray(defaults) || defaults.length === 0) {
      return { list, changed: false };
    }
    const existingIds = new Set(list.map(m => m && m.id).filter(Boolean));
    let changed = false;
    for (const def of defaults) {
      if (def && def.id && !existingIds.has(def.id)) {
        list.push(Object.assign({}, def));
        changed = true;
      }
    }
    return { list, changed };
  }

  function loadMedications() {
    const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS);
    if (raw === null) {
      // First run: seed defaults (used only as a fallback when the
      // cloud isn't configured or reachable; once Supabase is set up,
      // pullCatalog() overwrites this with the cloud version which is
      // the source of truth).
      const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
      safeSet(STORAGE_KEYS.MEDICATIONS, def);
      return def;
    }
    // The user has a stored catalog (it's a cache of the cloud).
    // The cloud is the source of truth — local edits are pushed to
    // the cloud immediately on save, and pulls overwrite local.
    const stored = safeParse(raw, []);
    if (Array.isArray(stored)) {
      // Migrate: ensure nameTrade + form are present on every catalog entry
      const res = migrateMedsList(stored);
      if (res.changed) safeSet(STORAGE_KEYS.MEDICATIONS, res.list);
      return res.list;
    }
    // Fallback if parse failed entirely
    return [];
  }
  function saveMedications(list) {
    // Mark the local catalog as modified — pullCatalog uses this to
    // decide whether the local version is newer than the cloud version.
    try {
      localStorage.setItem(STORAGE_KEYS.MEDICATIONS_LAST_MODIFIED, String(Date.now()));
    } catch (e) { /* ignore */ }
    return safeSet(STORAGE_KEYS.MEDICATIONS, list);
  }
  function resetMedicationsToDefault() {
    const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    return saveMedications(def);
  }
  function getLocalCatalogModifiedAt() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS_LAST_MODIFIED);
      return raw ? parseInt(raw, 10) : 0;
    } catch (e) { return 0; }
  }
  function getLocalCatalogSyncedAt() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS_LAST_SYNCED);
      return raw ? parseInt(raw, 10) : 0;
    } catch (e) { return 0; }
  }
  function setLocalCatalogSyncedAt(ms) {
    try {
      localStorage.setItem(STORAGE_KEYS.MEDICATIONS_LAST_SYNCED, String(ms));
    } catch (e) { /* ignore */ }
  }
  // True if the local catalog has unsynced edits (modified after last sync)
  // Logout on a shared ward device: drop the local copies of data that
  // also lives in the cloud (patients, notifications, med requests, and
  // — once fully uploaded — the discharged / dead archive cache). They
  // are pulled again at the next login. Kept: the catalog, the
  // deleted-bed tombstones (bed keys only — they stop a deleted patient
  // from coming back).
  function wipeCloudBackedPatientData(opts) {
    const keys = [STORAGE_KEYS.PATIENTS, LAST_SEEN_CLOUD_KEY, STORAGE_KEYS.NOTIFICATIONS, STORAGE_KEYS.MED_REQUESTS];
    if (opts && opts.archives) keys.push(STORAGE_KEYS.DISCHARGED, STORAGE_KEYS.DEAD, STORAGE_KEYS.TRANSFERRED);
    keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  }

  // «مسح جميع بيانات المرضى»: every bed card on this device — named or
  // not — plus the cloud bookkeeping, so nothing is merged back.
  function wipeAllPatients() {
    [STORAGE_KEYS.PATIENTS, LAST_SEEN_CLOUD_KEY, DELETED_TRACKING_KEY].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
  }
  const WIPE_SEEN_KEY = "pharma.patients.wipe-seen.v1";
  function getWipeSeen() { try { return localStorage.getItem(WIPE_SEEN_KEY) || ""; } catch (e) { return ""; } }
  function setWipeSeen(at) { try { localStorage.setItem(WIPE_SEEN_KEY, at || ""); } catch (e) { /* ignore */ } }

  function hasUnsyncedLocalEdits() {
    const m = getLocalCatalogModifiedAt();
    const s = getLocalCatalogSyncedAt();
    return m > s;
  }

  // ----- Bulk (used for initial hydration) -----
  function loadAll() {
    return {
      patients:    loadPatients(),
      medications: loadMedications()
    };
  }

  // ---- Discharged / Dead patient records ----
  // Stored as arrays in localStorage. Each record captures the patient's
  // full data at the time of discharge/death + a timestamp.
  function loadDischarged() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.DISCHARGED), []);
  }
  function saveDischarged(arr) {
    try { localStorage.setItem(STORAGE_KEYS.DISCHARGED, JSON.stringify(arr || [])); }
    catch (e) { /* ignore quota */ }
  }
  function addDischarged(record) {
    const arr = loadDischarged();
    arr.unshift(record);  // newest first
    saveDischarged(arr);
  }

  function loadDead() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.DEAD), []);
  }
  function saveDead(arr) {
    try { localStorage.setItem(STORAGE_KEYS.DEAD, JSON.stringify(arr || [])); }
    catch (e) { /* ignore quota */ }
  }
  function addDead(record) {
    const arr = loadDead();
    arr.unshift(record);
    saveDead(arr);
  }
  // Delete individual discharged / dead records by index.
  // Used by the admin's delete-per-record buttons.
  function deleteDischarged(index) {
    const arr = loadDischarged();
    if (index >= 0 && index < arr.length) {
      arr.splice(index, 1);
      saveDischarged(arr);
    }
  }
  function deleteDead(index) {
    const arr = loadDead();
    if (index >= 0 && index < arr.length) {
      arr.splice(index, 1);
      saveDead(arr);
    }
  }
  // Clear ALL discharged / dead records (admin "clear all" button).
  function loadTransferred() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.TRANSFERRED), []);
  }
  function saveTransferred(arr) {
    try { localStorage.setItem(STORAGE_KEYS.TRANSFERRED, JSON.stringify(arr || [])); }
    catch (e) { /* ignore quota */ }
  }
  function clearDischarged() { saveDischarged([]); }
  function clearDead() { saveDead([]); }

  // The device-only monthly ABX snapshots were replaced by the cloud
  // monthly report (monthly-report.js). Drop any copies left on the
  // device — they held patient names.
  try { localStorage.removeItem("pharma.abx-snapshots.v1"); } catch (e) { /* ignore */ }

  // ---- Notifications (for pharmacist) ----
  // Each notification: { type, message, patientName, room, date, read, byUser }
  function loadNotifications() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS), []);
  }
  function saveNotifications(arr) {
    try { localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(arr || [])); }
    catch (e) { /* ignore quota */ }
  }
  function addNotification(record) {
    const arr = loadNotifications();
    arr.unshift(record);  // newest first
    // Keep max 100 notifications to avoid localStorage bloat
    if (arr.length > 100) arr.length = 100;
    saveNotifications(arr);
  }
  // A notification from the cloud (notifications table): added once,
  // keyed by its row id. → true when it was new.
  function addCloudNotification(record) {
    const arr = loadNotifications();
    if (record.cloudId != null && arr.some(n => n.cloudId === record.cloudId)) return false;
    arr.unshift(record);
    arr.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (arr.length > 100) arr.length = 100;
    saveNotifications(arr);
    return true;
  }
  function markNotificationRead(index) {
    const arr = loadNotifications();
    if (index >= 0 && index < arr.length) {
      arr[index].read = true;
      saveNotifications(arr);
    }
  }
  function markAllNotificationsRead() {
    const arr = loadNotifications();
    arr.forEach(n => n.read = true);
    saveNotifications(arr);
  }
  function clearNotifications() {
    saveNotifications([]);
  }
  function getUnreadCount() {
    return loadNotifications().filter(n => !n.read).length;
  }

  // ---- Medication requests (doctor → admin approval) ----
  // Each request: { id, nameTrade, nameAr, nameEn, form, dose, frequency,
  //                 notes, requestedBy, requestedAt, status, reviewedBy, reviewedAt }
  //   status: 'pending' | 'approved' | 'rejected'
  function loadMedRequests() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.MED_REQUESTS), []);
  }
  function saveMedRequests(arr) {
    try { localStorage.setItem(STORAGE_KEYS.MED_REQUESTS, JSON.stringify(arr || [])); }
    catch (e) { /* ignore quota */ }
  }
  function addMedRequest(record) {
    const arr = loadMedRequests();
    arr.unshift(record);  // newest first
    saveMedRequests(arr);
  }
  function updateMedRequest(id, updates) {
    const arr = loadMedRequests();
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) {
      Object.assign(arr[idx], updates);
      saveMedRequests(arr);
    }
  }
  function getPendingMedRequestsCount() {
    return loadMedRequests().filter(r => r.status === 'pending').length;
  }

  global.PharmacyStorage = {
    // patients
    loadPatients,
    savePatients,
    getPatient,
    upsertPatient,
    putPatient,
    deletePatient,
    allPatientsArray,
    mergePatients,
    // deletion tracking
    saveLocalDeletion,
    serverNow,
    setServerOffset,
    clearLocalDeletion,
    loadLocalDeletions,
    // medications catalog
    loadMedications,
    saveMedications,
    resetMedicationsToDefault,
    getLocalCatalogModifiedAt,
    getLocalCatalogSyncedAt,
    setLocalCatalogSyncedAt,
    hasUnsyncedLocalEdits,
    wipeCloudBackedPatientData,
    wipeAllPatients,
    getWipeSeen,
    setWipeSeen,
    // auto-add rule support
    REQUIRED_SUPPLIES,
    // bulk
    loadAll,
    // discharged / dead
    loadDischarged, addDischarged, saveDischarged,
    deleteDischarged, clearDischarged,
    loadDead, addDead, saveDead,
    deleteDead, clearDead,
    loadTransferred, saveTransferred,
    // notifications
    loadNotifications, addNotification, addCloudNotification, markNotificationRead,
    markAllNotificationsRead, clearNotifications, getUnreadCount,
    // med requests (doctor → admin)
    loadMedRequests, saveMedRequests, addMedRequest, updateMedRequest,
    getPendingMedRequestsCount
  };
})(window);
