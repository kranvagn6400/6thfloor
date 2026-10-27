/* ============================================================
   boarders.js  —  Patients hosted from other wards (مرضى مستضافون)
   ============================================================
   A patient's `originWard` ('' = our own ward patient) says which
   ward they belong to — chosen by floor (ط10 / ط9 / ط8 / ط7). Rules for
   this floor (Baghdad Teaching Hospital, 6th floor, internal medicine,
   units 1 and 3):
     - Boarders come only from other medical wards or oncology.
     - Our doctors don't print their treatment sheets → boarders are
       left out of "print all sheets".
     - Pharmacists order their meds as usual, EXCEPT patients from the
       7th floor (hematology): never ordered → left out of the supply
       distribution, the chart, the pills form and the chart bridge,
       and pharmacists see only their name + attending doctor.
   ============================================================ */

(function (global) {
  "use strict";

  // Offered in the origin list (in this order): our floor (6th), ط10, ط9, ط8, ط7.
  // `legacy` entries are kept only so older records still display.
  const ORIGINS = [
    { key: "",             label: "مريض الردهة",  option: "مريض الردهة" },
    { key: "floor-10",     label: "الطابق 10",    option: "ط10", floor: "10" },
    { key: "floor-9",      label: "الطابق 9",     option: "ط9", floor: "9" },
    { key: "floor-8",      label: "الطابق 8",     option: "ط8", floor: "8" },
    { key: "hematology-7", label: "الطابق 7 — أمراض الدم", option: "ط7", floor: "7", noOrder: true },
    { key: "medical",      label: "ردهة باطنية أخرى", legacy: true },
    { key: "oncology",     label: "الأورام",          legacy: true }
  ];

  function originOf(p) {
    const key = (p && p.originWard) || "";
    return ORIGINS.find(o => o.key === key) || { key, label: key };
  }
  function isBoarder(p) { return !!(p && p.originWard); }
  // Meds for this patient are never ordered by the ward pharmacy
  function isNoOrder(p) { return !!originOf(p).noOrder && isBoarder(p); }

  // Floor number of a boarder: from the chosen floor; legacy records
  // kept it as digits in originNote ("9", "الطابق 9" → "9").
  function floorOf(p) {
    if (!isBoarder(p)) return "";
    const fixed = originOf(p).floor;
    if (fixed) return fixed;
    const m = String((p && p.originNote) || "").match(/\d+/);
    return m ? m[0] : "";
  }

  // Bed badge: "طابق 9"; without a floor number, the ward name
  function badge(p) {
    if (!isBoarder(p)) return "";
    const floor = floorOf(p);
    return floor ? "طابق " + floor : originOf(p).label;
  }

  function label(p) {
    if (!isBoarder(p)) return "";
    const floor = floorOf(p);
    const o = originOf(p);
    return o.floor ? o.label : o.label + (floor ? " · الطابق " + floor : "");
  }

  // Pharmacists see only the name + attending doctor of 7th-floor
  // patients (no demographics, labs, allergies, diagnosis, meds).
  function hidesDetails(p) {
    const Auth = global.PharmacyAuth;
    return isNoOrder(p) && !!(Auth && Auth.isPharmacist && Auth.isPharmacist());
  }

  // { bedKey: patient } without the patients we never order for
  function orderedPatients(patientsMap) {
    const out = {};
    Object.keys(patientsMap || {}).forEach(k => {
      const p = patientsMap[k];
      if (p && !isNoOrder(p)) out[k] = p;
    });
    return out;
  }

  global.PharmacyBoarders = {
    ORIGINS, originOf, isBoarder, isNoOrder, floorOf, badge, hidesDetails, label, orderedPatients
  };
})(window);
