/* ============================================================
   patient-merge.js  —  merging two people's edits of one patient
   ============================================================
   Each patient row carries a server version (patients.version,
   features.sql). A device remembers the copy it last synced
   (patient._base = snapshot) and its version. When it saves a copy
   built on an older version, the database refuses it; the device then
   merges three copies:
       base  — what both started from
       local — this device's edit
       cloud — the newer row someone else saved
   Rules: a field changed here wins, otherwise the cloud's value stays;
   medications are merged one by one (added / removed / edited here are
   applied on top of the cloud's list, which keeps the other person's
   changes); lab values per test.
   Pure — tests in scripts/test-patient-merge.js.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PharmacyPatientMerge = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCALARS = ["name", "plateNumber", "doctor", "diagnosis", "age", "gender",
    "firstMedDate", "allergies", "originWard", "originNote"];

  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

  // The synced fields only (no local bookkeeping)
  function snapshot(p) {
    const s = {};
    SCALARS.forEach(k => { s[k] = p && p[k] != null ? p[k] : ""; });
    s.labs = p && p.labs ? JSON.parse(JSON.stringify(p.labs)) : {};
    s.labHistory = p && Array.isArray(p.labHistory) ? JSON.parse(JSON.stringify(p.labHistory)) : [];
    s.medications = p && Array.isArray(p.medications) ? JSON.parse(JSON.stringify(p.medications)) : [];
    return s;
  }

  // med list → Map(key → med); the key tells two entries of the same
  // catalogue medicine apart by their order ("id#0", "id#1")
  function keyed(list) {
    const seen = {}, m = new Map();
    (list || []).forEach(x => {
      if (!x) return;
      const id = x.id || x.nameTrade || x.nameEn || "?";
      const n = seen[id] = (seen[id] == null ? 0 : seen[id] + 1);
      m.set(id + "#" + n, x);
    });
    return m;
  }

  function mergeMeds(base, local, cloud) {
    const B = keyed(base), L = keyed(local), C = keyed(cloud);
    const out = [];
    C.forEach((cm, k) => {
      if (B.has(k) && !L.has(k)) return;                                  // removed here
      if (B.has(k) && L.has(k) && !same(L.get(k), B.get(k))) { out.push(L.get(k)); return; } // edited here
      out.push(cm);                                                       // the cloud's (incl. others' edits)
    });
    L.forEach((lm, k) => { if (!B.has(k) && !C.has(k)) out.push(lm); });  // added here
    return out;
  }

  function mergeLabs(base, local, cloud) {
    const out = Object.assign({}, cloud || {});
    const b = base || {}, l = local || {};
    new Set(Object.keys(b).concat(Object.keys(l))).forEach(k => {
      if (!same(l[k], b[k])) {
        if (l[k] == null || l[k] === "") delete out[k]; else out[k] = l[k];
      }
    });
    return out;
  }

  // → { merged (synced fields), touched: true when the cloud had changes too }
  function merge3(base, local, cloud) {
    const b = snapshot(base || {}), l = snapshot(local), c = snapshot(cloud);
    const m = {};
    SCALARS.forEach(k => { m[k] = !same(l[k], b[k]) ? l[k] : c[k]; });
    m.labs = mergeLabs(b.labs, l.labs, c.labs);
    if (!same(l.labHistory, b.labHistory)) {
      const all = c.labHistory.slice();
      l.labHistory.forEach(e => { if (!all.some(x => same(x, e))) all.push(e); });
      m.labHistory = all;
    } else {
      m.labHistory = c.labHistory;
    }
    m.medications = mergeMeds(b.medications, l.medications, c.medications);
    return { merged: m, touched: !same(snapshot(c), b) };
  }

  return { snapshot, merge3, SCALARS };
});
