/* ============================================================
   supabase-sync.js
   Bridges the localStorage catalog ↔ Supabase `medications` table.

   Strategy: localStorage stays the source of truth for instant UI
   rendering (no async waits). Supabase is the cloud replica.

   - pullCatalog()   : fetch all rows from Supabase and merge with local
                       (local wins for items newer than the cloud —
                        to prevent a stale pull from overwriting local
                        edits that haven't been pushed yet)
   - pushCatalog()   : upsert the current localStorage catalog into
                       Supabase (safer than delete+insert: if push fails
                        mid-way, the cloud stays consistent)

   The `medications` table schema (see schema.sql):
     id              TEXT PRIMARY KEY
     name_trade      TEXT
     name_ar         TEXT
     name_en         TEXT
     name_chart      TEXT        (optional — used by جارت الجارت + printed chart)
     form            TEXT NOT NULL DEFAULT 'vial'
     default_dose    TEXT NOT NULL
     default_frequency TEXT NOT NULL
     sort_order      INT  NOT NULL DEFAULT 0
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   ============================================================ */

(function (global) {
  "use strict";

  const SB = global.PharmacySupabase;
  const Local = global.PharmacyStorage;

  // Sync state tracking — prevents a stale pull from overwriting local edits
  const SYNC_STATE_KEY = "pharma.supabase.syncstate.v1";
  // We consider a recent failed push as "don't pull" for this long (ms):
  const PULL_BLOCK_AFTER_FAILED_PUSH_MS = 30 * 60 * 1000; // 30 minutes

  function loadSyncState() {
    try {
      const raw = localStorage.getItem(SYNC_STATE_KEY);
      if (!raw) return { lastPushOk: null, lastPushAt: 0 };
      const s = JSON.parse(raw);
      return {
        lastPushOk: typeof s.lastPushOk === "boolean" ? s.lastPushOk : null,
        lastPushAt: typeof s.lastPushAt === "number" ? s.lastPushAt : 0
      };
    } catch (e) {
      return { lastPushOk: null, lastPushAt: 0 };
    }
  }

  function saveSyncState(patch) {
    try {
      const cur = loadSyncState();
      const next = Object.assign({}, cur, patch);
      localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(next));
    } catch (e) { /* ignore */ }
  }

  // Should we skip the next pull? True if the last push failed recently.
  function shouldSkipPull() {
    const s = loadSyncState();
    if (s.lastPushOk === false) {
      const age = Date.now() - (s.lastPushAt || 0);
      if (age < PULL_BLOCK_AFTER_FAILED_PUSH_MS) return true;
    }
    return false;
  }

  // Convert local med objects (camelCase) ↔ Supabase rows (snake_case).
  // IMPORTANT: we only set `updated_at = now()` for rows that are NEW
  // to the cloud (we don't know their previous cloud state). For rows
  // that we're going to upsert, the database default `updated_at` won't
  // auto-update on UPDATE (Postgres doesn't do that automatically), so
  // we must set it ourselves — but we should set it ONLY when the row's
  // content actually changed vs the cloud version, otherwise every
  // push refreshes ALL updated_at and makes future pulls think the
  // cloud is newer than the local (false-positive sync conflict).
  // Simplest robust approach: don't set updated_at on upsert; let the
  // DB trigger handle it. (We add a trigger in schema.sql v2.)
  // For now (no trigger), we set updated_at only for the insert path
  // by passing it only when the row is new — but upsert can't tell
  // insert vs update apart from the client. So we just don't touch
  // updated_at here and accept that the trigger-less version will
  // refresh updated_at on every upsert. The local-vs-cloud comparison
  // still works because we ALSO bump localMs only on REAL edits.
  function medToRow(m, sortOrder) {
    return {
      id: m.id,
      name_trade: m.nameTrade || null,
      name_ar: m.nameAr || null,
      name_en: m.nameEn || null,
      name_chart: m.nameChart || null,
      form: m.form || "vial",
      default_dose: m.defaultDose || "",
      default_frequency: m.defaultFrequency || "",
      available: m.available !== false,   // توفر الدواء في المستشفى
      sort_order: sortOrder
    };
  }
  function rowToMed(row) {
    return {
      id: row.id,
      nameTrade: row.name_trade || "",
      nameAr: row.name_ar || "",
      nameEn: row.name_en || "",
      nameChart: row.name_chart || "",
      form: row.form || "vial",
      defaultDose: row.default_dose || "",
      defaultFrequency: row.default_frequency || "",
      available: row.available !== false   // missing column → available
    };
  }

  // Pull the catalog from Supabase → write into localStorage.
  // Returns { ok: true, count: N } on success or { ok: false, error }.
  // Refuses to pull if:
  //   (a) the last push failed recently, OR
  //   (b) the local catalog has unsynced edits (modified after last
  //       successful sync). This is the key fix: it prevents a stale
  //       cloud (where a previous push failed) from overwriting local
  //       edits on the next boot.
  async function pullCatalog(force) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    if (!force && shouldSkipPull()) {
      const s = loadSyncState();
      return {
        ok: false,
        error: "تم تجاهل السحب — آخر رفع فشل، الكتالوج المحلي محفوظ",
        skipped: true,
        reason: "push-failed-recently",
        lastFailedPushAt: s.lastPushAt
      };
    }
    // Check for unsynced local edits — skip pull if local is fresher
    // than the last successful sync.
    if (!force && Local.hasUnsyncedLocalEdits && Local.hasUnsyncedLocalEdits()) {
      return {
        ok: false,
        error: "تم تجاهل السحب — لديك تعديلات محلية لم تُرفع بعد",
        skipped: true,
        reason: "local-unsynced"
      };
    }
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    try {
      const { data, error } = await client
        .from("medications")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) return { ok: false, error: error.message };
      if (!Array.isArray(data)) return { ok: false, error: "استجابة غير متوقعة" };

      const meds = data.map(rowToMed);
      // Cloud is the source of truth: OVERWRITE local with cloud.
      // No merge, no "local-only meds" — those would be stale or
      // duplicate of what's already in the cloud. If the user wants
      // new meds added, they must be added via the admin (which
      // pushes them to the cloud); the local catalog is just a
      // cache of what's in the cloud.
      Local.saveMedications(meds);
      // Mark local as "synced" at this moment — both localModifiedAt
      // and localSyncedAt are now equal, so future pulls are allowed
      // until the user makes another local edit.
      const nowMs = Date.now();
      try {
        localStorage.setItem("pharma.medications.modified.v1", String(nowMs));
        Local.setLocalCatalogSyncedAt(nowMs);
      } catch (e) { /* ignore */ }
      return { ok: true, count: meds.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Push the current localStorage catalog → Supabase.
  // Uses upsert (insert with ON CONFLICT DO UPDATE) so partial failures
  // don't leave the cloud table empty. Also deletes any rows that exist
  // in the cloud but not locally (so removals propagate).
  //
  // Optional column fallback for the medications table.
  // Similar to upsertWithFallback() for the patients table — but
  // with a different (smaller) set of optional columns. The only
  // optional column on `medications` is `name_chart`, which was
  // added in a schema migration. Legacy installs that haven't run
  // the migration don't have the column, and the upsert would fail
  // with: "Could not find the 'name_chart' column of 'medications'
  // in the schema cache". We catch that, strip the column, retry.
  const OPTIONAL_MED_COLS = ["available", "name_chart"];

  async function upsertMedicationsWithFallback(client, slice) {
    let currentSlice = slice;
    let strippedCols = new Set();
    // Max 1 retry per optional column.
    for (let attempt = 0; attempt <= OPTIONAL_MED_COLS.length; attempt++) {
      const { error: upErr } = await client
        .from("medications")
        .upsert(currentSlice, { onConflict: "id" });
      if (!upErr) {
        if (strippedCols.size > 0) {
          console.warn("[Supabase] med upsert succeeded after stripping columns:", Array.from(strippedCols).join(", "));
        }
        return { ok: true, stripped: Array.from(strippedCols) };
      }
      const msg = upErr.message || "";
      const colMatch = msg.match(/Could not find the '([a-zA-Z_]+)' column/);
      const missingCol = colMatch ? colMatch[1] : null;
      if (!missingCol || !OPTIONAL_MED_COLS.includes(missingCol)) {
        return { ok: false, error: msg };
      }
      if (!strippedCols.has(missingCol)) {
        console.warn("[Supabase] stripping missing med column '" + missingCol + "' and retrying upsert");
        strippedCols.add(missingCol);
        currentSlice = currentSlice.map(row => stripColumn(row, missingCol));
      } else {
        return { ok: false, error: msg };
      }
    }
    return { ok: false, error: "Exhausted med column-stripping retries" };
  }

  // Returns { ok: true } on success or { ok: false, error }.
  // Only the given medicines (the availability page): one small upsert instead of all 178 rows — no deletes, and no flood
  // of realtime events that make every device pull the catalog in the middle of the push.
  async function pushMedicationRows(ids) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    const want = new Set(ids || []);
    const rows = [];
    (Local.loadMedications() || []).forEach((m, i) => { if (m && want.has(m.id)) rows.push(medToRow(m, i)); });
    if (!rows.length) return { ok: true, count: 0 };
    try {
      const result = await upsertMedicationsWithFallback(client, rows);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, count: rows.length, stripped: result.stripped || [] };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  }

  async function pushCatalog() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    const meds = Local.loadMedications();
    if (!Array.isArray(meds)) return { ok: false, error: "كتالوج محلي غير صالح" };

    try {
      // 1) Upsert all rows (insert OR update on conflict by id).
      // We use upsertMedicationsWithFallback() which retries with
      // progressively stripped optional columns (currently only
      // `name_chart`) — this lets the app keep working on legacy
      // Supabase installs that haven't yet run the latest schema
      // migration that adds the `name_chart` column.
      const rows = meds.map((m, i) => medToRow(m, i));
      const CHUNK = 100;
      const stripped = new Set();   // optional columns the cloud doesn't have
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const result = await upsertMedicationsWithFallback(client, slice);
        (result.stripped || []).forEach(c => stripped.add(c));
        if (!result.ok) {
          saveSyncState({ lastPushOk: false, lastPushAt: Date.now() });
          return { ok: false, error: result.error };
        }
      }

      // 2) Delete rows that exist in the cloud but not in the local catalog
      //    (so removals propagate). We build a list of local IDs and ask
      //    Supabase to delete anything not in that list.
      const localIds = meds.map(m => m.id);
      // Supabase PostgREST filter: .not("id", "in", '("a","b","c")')
      if (localIds.length > 0) {
        const inList = "(" + localIds.map(id => JSON.stringify(id)).join(",") + ")";
        const { error: delErr } = await client
          .from("medications")
          .delete()
          .not("id", "in", inList);
        if (delErr) {
          // Deletion failure is less critical — the catalog is still
          // consistent (just may have stale rows). Log but report OK.
          console.warn("[Supabase] cleanup delete failed:", delErr.message);
        }
      } else {
        // No local meds → wipe cloud (rare case)
        const { error: delErr } = await client
          .from("medications")
          .delete()
          .neq("id", "__never__");
        if (delErr) console.warn("[Supabase] wipe failed:", delErr.message);
      }

      saveSyncState({ lastPushOk: true, lastPushAt: Date.now() });
      // Mark local catalog as fully synced (modified == synced)
      if (Local.setLocalCatalogSyncedAt) {
        Local.setLocalCatalogSyncedAt(Date.now());
      }
      return { ok: true, count: meds.length , stripped: Array.from(stripped) };
    } catch (e) {
      saveSyncState({ lastPushOk: false, lastPushAt: Date.now() });
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // ---------- Patient sync (bed_key → patient) ----------
  // Strategy: MERGE (not overwrite).
  //
  //   pullPatients()
  //     - Fetch all rows from Supabase
  //     - Merge with the LOCAL map using last-write-wins on `updated_at`
  //     - Save the merged map back to localStorage
  //     - Push the merged map back to Supabase (so any local-only
  //       entries — present only on this device — propagate to the
  //       cloud and from there to other devices)
  //
  //   pushPatients()
  //     - UPSERT only. NEVER bulk-delete rows that aren't in local,
  //       because those rows belong to other devices and we'd be
  //       wiping their data. (Bulk delete is only available via the
  //       explicit `pushPatientsWipe()` used by the admin "wipe all"
  //       action.)
  //
  //   pushPatientDelete(bedKey)
  //     - Delete a single bed_key from the cloud. Used by the per-bed
  //       "delete patient" action so a deletion on one device propagates
  //       to others on their next pull.
  //
  // Each local patient carries an `updatedAt` (ms) field set by
  // `Storage.upsertPatient()`. The cloud stores `updated_at` as
  // TIMESTAMPTZ (ISO 8601 string). `mergePatients()` normalizes both.

  function _toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }

  // Convert a local patient object → Supabase row.
  function patientToRow(bedKey, p) {
    const m = bedKey.match(/room-(\d+)-bed-(\d+)/);
    const roomId = m ? parseInt(m[1], 10) : 0;
    const bedNum = m ? parseInt(m[2], 10) : 0;
    return {
      bed_key:      bedKey,
      room_id:      roomId,
      bed_number:   bedNum,
      name:         (p && p.name) ? p.name : "",
      plate_number: (p && p.plateNumber) ? String(p.plateNumber) : "",
      doctor:       (p && p.doctor) ? String(p.doctor) : "",   // الطبيب المعالج
      diagnosis:    (p && p.diagnosis) ? String(p.diagnosis) : "", // التشخيص
      age:          (p && p.age) ? String(p.age) : "",            // العمر (سنة)
      gender:       (p && p.gender) ? String(p.gender) : "",     // الجنس: "male" | "female" | ""
      first_med_date: (p && p.firstMedDate) ? String(p.firstMedDate) : "", // تاريخ أول دواء حرج (لتتبع D1, D2...)
      allergies:    (p && p.allergies) ? String(p.allergies) : "",  // الحساسية الدوائية
      origin_ward:  (p && p.originWard) ? String(p.originWard) : "", // القسم الأصلي (مريض مستضاف)
      origin_note:  (p && p.originNote) ? String(p.originNote) : "",
      labs:         (p && p.labs) ? JSON.stringify(p.labs) : "", // التحاليل المختبرية
      lab_history:  (p && p.labHistory) ? JSON.stringify(p.labHistory) : "", // سجل التحاليل السابقة
      medications:  JSON.stringify((p && p.medications) || []),
      // The server version this copy was built on (features.sql §7 refuses
      // a save based on an older version than the row has now)
      base_version: (p && Number.isInteger(p.version) && p.version > 0) ? p.version : null,
      // WHICH patient this copy is (features.sql §21): a bed key is reused
      // after a move / discharge, so a copy of the previous patient must not
      // overwrite the new one
      base_pid:     (p && p.pid) ? String(p.pid) : null,
      // Use the local updatedAt if present (ms → ISO); otherwise now.
      updated_at:   new Date(_toMs(p && p.updatedAt) || Date.now()).toISOString()
    };
  }

  // Convert a Supabase row → local patient object. Preserves the
  // cloud's `updated_at` as a JS number (ms) under `updatedAt` so the
  // merge function can compare apples to apples.
  function rowToPatientRaw(row) {
    let meds = [];
    try {
      meds = typeof row.medications === "string"
        ? JSON.parse(row.medications)
        : (row.medications || []);
    } catch (e) { meds = []; }
    return {
      name:        row.name || "",
      plateNumber: row.plate_number || "",
      doctor:      row.doctor || "",   // الطبيب المعالج (attending physician)
      diagnosis:   row.diagnosis || "",   // التشخيص
      age:         row.age || "",          // العمر (سنة)
      gender:      row.gender || "",       // الجنس: "male" | "female" | ""
      firstMedDate: row.first_med_date || "", // تاريخ أول دواء حرج
      allergies:    row.allergies || "",      // الحساسية الدوائية
      originWard:   row.origin_ward || "",    // القسم الأصلي (مريض مستضاف)
      originNote:   row.origin_note || "",
      labs:        row.labs ? (typeof row.labs === "string" ? JSON.parse(row.labs) : row.labs) : {}, // التحاليل
      labHistory:   row.lab_history ? (typeof row.lab_history === "string" ? JSON.parse(row.lab_history) : row.lab_history) : [], // سجل التحاليل
      medications: Array.isArray(meds) ? meds : [],
      updatedAt:   _toMs(row.updated_at),
      version:     Number.isInteger(row.version) ? row.version : null,
      pid:         row.pid || null
    };
  }
  // A cloud row as a local patient that is in sync (base snapshot kept
  // for merging later edits, not dirty)
  function cloudPatient(row) {
    const p = rowToPatientRaw(row);
    const PM = global.PharmacyPatientMerge;
    if (PM) p._base = PM.snapshot(p);
    p._dirty = false;
    return p;
  }

  // Upsert ALL local patients to Supabase. Does NOT delete cloud rows
  // that aren't local — those belong to other devices.
  async function pushPatients() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    const patients = Local.loadPatients();
    // Only copies edited here (or never confirmed by the cloud): re-sending
    // unchanged patients would bump their versions and wake every device.
    const entries = Object.entries(patients)
      .filter(([, p]) => p && p._dirty !== false)
      .map(([k, p]) => patientToRow(k, p));

    try {
      const refused = [];
      if (entries.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < entries.length; i += CHUNK) {
          const slice = entries.slice(i, i + CHUNK);
          const result = await upsertWithFallback(client, slice, { select: "bed_key,version" });
          if (!result.ok) return { ok: false, error: result.error };
          if (result.versioned && Array.isArray(result.data)) {
            const back = new Map(result.data.map(r => [r.bed_key, r.version]));
            const now = Local.loadPatients();
            slice.forEach(row => {
              const cur = now[row.bed_key];
              if (!cur) return;
              if (back.has(row.bed_key)) {
                if (Number.isInteger(back.get(row.bed_key))) cur.version = back.get(row.bed_key);
                if (_toMs(cur.updatedAt) === _toMs(patients[row.bed_key].updatedAt)) markSynced(cur);
              } else if (row.base_version != null && cur._dirty) {
                refused.push(row.bed_key);          // someone saved a newer copy
              }
            });
            Local.savePatients(now);
          }
        }
      }
      for (const k of refused) await pushPatient(k);   // merge + save again
      // No bulk delete — see header comment.
      return { ok: true, count: entries.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Upsert with progressive fallback for older Supabase installs
  // that may be missing newer columns. The 'patients' table has been
  // extended several times since the original release:
  //   v1: bed_key, room_id, bed_number, name, plate_number,
  //       medications, updated_at (the original 7 columns)
  //   v2: + doctor, diagnosis, first_med_date (legacy 3 extra)
  //   v3: + labs, lab_history (the lab-tracking extras)
  //   v4: + age, gender (the demographics extras)
  //
  // Old installs that were created before v4 don't have age/gender
  // columns, and may also be missing labs/lab_history. When the upsert
  // fails with "Could not find the 'X' column" error, we strip the
  // named column + retry. This loops until either:
  //   - The upsert succeeds (with whatever columns ARE present), OR
  //   - We've stripped every optional column + still fail (real error).
  //
  // The CORE columns (bed_key, room_id, bed_number, name, plate_number,
  // medications, updated_at) are NEVER stripped — those have been there
  // since v1.
  //   v5: + allergies, origin_ward, origin_note (features.sql)
  // Keys are the real (snake_case) column names — earlier versions sent
  // camelCase keys for first_med_date / lab_history, which the server
  // rejected, so those two fields were silently stripped on every push.
  const OPTIONAL_COLS = [
    "base_version", "base_pid", "origin_note", "origin_ward", "allergies", "age", "gender", "lab_history", "labs",
    "first_med_date", "diagnosis", "doctor"
  ];

  // Strip a single column from a row object (returns a new object
  // without that key).
  function stripColumn(row, col) {
    const { [col]: _removed, ...rest } = row;
    return rest;
  }

  // Try upsert → on column-missing error → strip + retry → loop.
  // opts.select → also return the saved rows (rows the version check
  // refused are not returned)
  async function upsertWithFallback(client, slice, opts) {
    let currentSlice = slice;
    let strippedCols = new Set();
    // Max 7 retries (one per optional column).
    for (let attempt = 0; attempt <= OPTIONAL_COLS.length; attempt++) {
      let q = client.from("patients").upsert(currentSlice, { onConflict: "bed_key" });
      if (opts && opts.select) q = q.select(opts.select);
      const { data, error: upErr } = await q;
      if (!upErr) {
        if (strippedCols.size > 0) {
          console.warn("[Supabase] upsert succeeded after stripping columns:", Array.from(strippedCols).join(", "));
        }
        return { ok: true, data: data || null, versioned: !strippedCols.has("base_version") };
      }
      // Parse the error message to find the missing column name.
      // PostgREST returns messages like:
      //   "Could not find the 'age' column of 'patients' in the schema cache"
      // We extract the column name from the single-quoted part.
      const msg = upErr.message || "";
      const colMatch = msg.match(/Could not find the '([a-zA-Z_]+)' column/);
      const missingCol = colMatch ? colMatch[1] : null;
      if (!missingCol || !OPTIONAL_COLS.includes(missingCol)) {
        // Not a column-missing error we can handle → real error.
        return { ok: false, error: msg };
      }
      // Strip this column from every row in the slice + retry.
      // Also remember it so we don't try again on the next iteration.
      if (!strippedCols.has(missingCol)) {
        console.warn("[Supabase] stripping missing column '" + missingCol + "' and retrying upsert");
        strippedCols.add(missingCol);
        currentSlice = currentSlice.map(row => stripColumn(row, missingCol));
      } else {
        // Already stripped — this shouldn't happen but break to
        // avoid infinite loop.
        return { ok: false, error: msg };
      }
    }
    return { ok: false, error: "Exhausted column-stripping retries" };
  }

  // Delete a single bed_key from the cloud (used when the user
  // explicitly deletes a patient on this device).
  // Deleting the patient who WAS in the bed: with his pid the row is deleted only while it is still his — a
  // new patient who took the bed meanwhile (same bed_key, another pid) is never touched.
  async function pushPatientDeleteNow(bedKey, pid) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      let q = client.from("patients").delete().eq("bed_key", bedKey);
      if (pid) q = q.eq("pid", pid);
      const { error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Wipe ALL patients from the cloud (used by the admin "wipe all
  // patients" action). This is the ONLY place that bulk-deletes.
  async function pushPatientsWipe() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { error } = await client
        .from("patients")
        .delete()
        .neq("bed_key", "__never__"); // matches all rows
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  function markSynced(p) {
    const PM = global.PharmacyPatientMerge;
    p._dirty = false;
    if (PM) p._base = PM.snapshot(p);
  }

  // Save ONE patient (the one just edited). If the database refuses it
  // because someone saved a newer copy meanwhile, merge the two edits
  // (patient-merge.js) and save the merge. → { ok, merged? }
  async function pushPatientNow(bedKey) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    const PM = global.PharmacyPatientMerge;
    let merged = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sent = Local.loadPatients()[bedKey];
        if (!sent) return { ok: true, skipped: true };
        const row = patientToRow(bedKey, sent);
        const res = await upsertWithFallback(client, [row], { select: "*" });
        if (!res.ok) return res;
        const back = Array.isArray(res.data) ? res.data[0] : null;
        if (back || !res.versioned || row.base_version == null || !PM) {
          const now = Local.loadPatients();
          const cur = now[bedKey];
          if (cur) {
            if (back && Number.isInteger(back.version)) cur.version = back.version;
            if (back && back.pid) cur.pid = back.pid;
            // edited again while saving? then it stays dirty for the next save
            if (_toMs(cur.updatedAt) === _toMs(sent.updatedAt)) markSynced(cur);
            Local.savePatients(now);
          }
          return { ok: true, merged: merged };
        }
        // Refused: a newer copy is in the cloud → merge into it, then save again
        const { data, error } = await client.from("patients").select("*").eq("bed_key", bedKey).maybeSingle();
        if (error) return { ok: false, error: error.message };
        const now = Local.loadPatients();
        if (!data) {                       // the row was removed meanwhile: save as new
          if (now[bedKey]) { now[bedKey].version = null; Local.savePatients(now); }
          continue;
        }
        const cloud = cloudPatient(data);
        if (sent.pid && cloud.pid && sent.pid !== cloud.pid) {
          // Another patient is in this bed now (the one we edited was moved
          // or discharged): the cloud copy is right, this copy is stale
          now[bedKey] = cloud;
          Local.savePatients(now);
          return { ok: true, replaced: true };
        }
        const r = PM.merge3(sent._base, sent, cloud);
        now[bedKey] = Object.assign({}, sent, r.merged, {
          version: cloud.version, pid: cloud.pid, _base: cloud._base, _dirty: true, updatedAt: Date.now()
        });
        Local.savePatients(now);
        merged = merged || r.touched;
      }
      return { ok: false, error: "تعارض متكرر في حفظ المريض — أعد المحاولة" };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // One save per bed at a time. Typing / leaving the card fires several saves
  // in a row; a second one sent before the first came back was built on the
  // old version, got refused, and "merged" with the user's OWN earlier save —
  // which showed «عدّل شخص آخر هذا المريض». A save waiting in line sends the
  // latest copy, so any number of calls while one is running collapse into one.
  const _pushQueue = {};
  // A delete waits for the saves of that bed already running, and the saves after it wait for the delete
  function pushPatientDelete(bedKey, pid) {
    const q = _pushQueue[bedKey] || (_pushQueue[bedKey] = { tail: Promise.resolve(), waiting: null });
    q.waiting = null;
    const p = q.tail.then(() => pushPatientDeleteNow(bedKey, pid));
    q.tail = p.catch(() => {});
    return p;
  }
  // After OUR save came back, the app's in-memory copy of the patient still holds the version it had before it.
  // Left like that, the next edit is built on an old version, the database refuses it, and the merge is reported as
  // «someone else edited this patient». The version / pid the save returned (kept in local storage) are copied onto it.
  function adoptSavedVersion(bedKey, mem) {
    const fresh = Local.loadPatients()[bedKey];
    if (!fresh || !mem || !Number.isInteger(fresh.version)) return false;
    if (mem.pid && fresh.pid && mem.pid !== fresh.pid) return false;               // another patient
    if (Number.isInteger(mem.version) && mem.version >= fresh.version) return false;  // already up to date
    mem.version = fresh.version;
    if (fresh.pid) mem.pid = fresh.pid;
    if (fresh._dirty === false) {                                                    // the save was confirmed as it was sent
      mem._base = fresh._base;
      if (_toMs(mem.updatedAt) === _toMs(fresh.updatedAt)) mem._dirty = false;       // (not typed on since)
    }
    return true;
  }

  // One bed as the cloud has it now → { ok, row | null }
  async function fetchBed(bedKey) {
    if (!SB || !SB.isConfigured()) return { ok: false };
    const client = SB.getClient();
    if (!client) return { ok: false };
    try {
      const { data, error } = await client.from("patients").select("*").eq("bed_key", bedKey).maybeSingle();
      if (error) return { ok: false };
      return { ok: true, row: data || null };
    } catch (e) { return { ok: false }; }
  }
  function pushPatient(bedKey) {
    const q = _pushQueue[bedKey] || (_pushQueue[bedKey] = { tail: Promise.resolve(), waiting: null });
    if (q.waiting) return q.waiting;
    const p = q.tail.then(() => { q.waiting = null; return pushPatientNow(bedKey); });
    q.waiting = p;
    q.tail = p.catch(() => {});
    return p;
  }

  async function applyWipeMarker(client) {
    try {
      const { data } = await client.from("app_settings").select("value").eq("key", "patients_wiped").maybeSingle();
      const at = data && data.value && data.value.at;
      if (!at) return false;
      const seen = Local.getWipeSeen();
      if (!seen) { Local.setWipeSeen(at); return false; }   // first look on this device: nothing stale to drop
      if (at <= seen) return false;
      Local.wipeAllPatients();
      Local.setWipeSeen(at);
      return true;
    } catch (e) { return false; }   // table missing / offline
  }
  // The admin's wipe: every patient row in the cloud + a marker telling the
  // other devices to drop their own copies (they would push them back).
  async function wipeAllPatientsEverywhere() {
    const res = await pushPatientsWipe();
    if (!res.ok) return res;
    const client = SB.getClient();
    const at = new Date().toISOString();
    try {
      await client.from("app_settings").upsert({ key: "patients_wiped", value: { at }, updated_at: at }, { onConflict: "key" });
    } catch (e) { /* the cloud rows are gone anyway */ }
    Local.setWipeSeen(at);
    return { ok: true };
  }

  // Pull all patients from Supabase and MERGE with local.
  // After merging locally, also push the merged result back so any
  // local-only entries propagate to the cloud.
  // opts.keepBed: the bed open on screen keeps its local copy.
  // Measure how far this phone's clock is from the database's (RPC
  // app_server_time, features.sql §20) so deletion times and cloud
  // timestamps are compared on one clock. Silent if the RPC isn't there yet.
  async function syncServerClock(client) {
    try {
      const t0 = Date.now();
      const { data, error } = await client.rpc("app_server_time");
      if (error || !data) return;
      const t1 = Date.now();
      const server = Date.parse(data);
      if (isNaN(server)) return;
      Local.setServerOffset(server - (t0 + t1) / 2);
    } catch (e) { /* offline / RPC missing: keep the last offset */ }
  }

  async function pullPatients(opts) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    try {
      await syncServerClock(client);
      const { data, error } = await client
        .from("patients")
        .select("*");
      if (error) return { ok: false, error: error.message };
      if (!Array.isArray(data)) return { ok: false, error: "استجابة غير متوقعة" };

      // Build the remote map (bed_key → patient)
      const remote = {};
      data.forEach(row => {
        if (!row.bed_key) return;
        remote[row.bed_key] = cloudPatient(row);
      });

      // The admin wiped every patient (app_settings 'patients_wiped'): drop
      // this device's cards — named or not — once, so none comes back
      await applyWipeMarker(client);

      // Merge with local (last-write-wins on updatedAt)
      const localNow = Local.loadPatients();
      const keep = opts && opts.keepBed;
      if (keep && localNow[keep] && remote[keep] &&
          !(localNow[keep].pid && remote[keep].pid && localNow[keep].pid !== remote[keep].pid)) {
        remote[keep] = localNow[keep];
      }
      const merged = Local.mergePatients(localNow, remote);

      // Persist the merged map locally. Use the raw save (not
      // upsertPatient) so we don't overwrite the existing updatedAt
      // stamps with "now".
      Local.savePatients(merged);

      // Push the merged result back so local-only entries propagate
      // to the cloud (and from there to other devices). Best-effort:
      // failure here just means another device will pull a slightly
      // older cloud, which is fine.
      const pushRes = await pushPatients();
      // We don't propagate pushRes.error to the caller — the pull
      // itself succeeded and the merge is consistent locally.
      return {
        ok: true,
        count: Object.keys(merged).length,
        pushedBack: pushRes.ok
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacySupabaseSync = {
    pullCatalog,
    pushMedicationRows,
    pushCatalog,
    pushPatients,
    pushPatient,
    adoptSavedVersion,
    fetchBed,
    pullPatients,
    wipeAllPatientsEverywhere,
    cloudPatient,
    pushPatientDelete,
    pushPatientsWipe,
    patientToRow,
    rowToPatient: rowToPatientRaw,
    medToRow,
    rowToMed,
    loadSyncState,
    saveSyncState,
    shouldSkipPull,
    SYNC_STATE_KEY
  };
})(window);

