/* ============================================================
   ddinter.js  —  drug-drug interactions from DDInter 2.0
   ============================================================
   Data: DDInter 2.0 (https://ddinter2.scbdd.com), Computational Biology & Drug
   Design Group, Central South University — licensed CC BY-NC-SA 4.0
   (attribution, non-commercial, share-alike). The pairs in js/ddinter-data.js are
   ONLY the interactions between the medicines of this ward's catalogue, imported
   once by scripts/import-ddinter.js. DDInter itself warns it is incomplete: the
   absence of an interaction does not mean there is none.

   This file: the generic names a catalogue medicine stands for (termsOf — also
   used by the import script) and the lookups on the imported data.
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PharmacyDDInter = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const LEVELS = { 3: "Major", 2: "Moderate", 1: "Minor", 0: "Unknown" };
  // mechanism flags kept in a bit mask
  const FLAGS = [
    ["antagonistic_effect", 1, "Antagonism"], ["synergistic_effect", 2, "Synergy"], ["absorption", 4, "Absorption"],
    ["distribution", 8, "Distribution"], ["metabolism", 16, "Metabolism"], ["excretion", 32, "Excretion"], ["others", 64, "Others"]
  ];

  // Catalogue spellings → the names DDInter uses (tried in this order)
  const ALIASES = {
    "gentamycin": ["Gentamicin"], "ceftrixone": ["Ceftriaxone"], "esomprazole": ["Esomeprazole"], "pantaprazole": ["Pantoprazole"],
    "norepinephrine": ["Norepinephrine"], "adrenaline": ["Epinephrine"], "salbutamol": ["Albuterol", "Salbutamol"],
    "glyceryl trinitrate": ["Nitroglycerin", "Glyceryl trinitrate"], "hyoscine butylbromide": ["Scopolamine butylbromide", "Butylscopolamine", "Hyoscine butylbromide"],
    "paracetamol": ["Acetaminophen", "Paracetamol"], "erythropoietin": ["Epoetin alfa", "Erythropoietin"],
    "human albumin": ["Albumin human", "Human serum albumin", "Albumin"], "intravenous immunoglobulin": ["Immune globulin", "Immunoglobulin", "Immune globulin human", "Human immunoglobulin G"],
    "aspirin": ["Acetylsalicylic acid", "Aspirin"], "glibenclamide": ["Glyburide", "Glibenclamide"], "fusidic acid": ["Fusidic acid", "Fusidate sodium", "Sodium fusidate"],
    "alfacalcidol": ["Alfacalcidol"],
    "chlorphenamine maleate": ["Chlorpheniramine", "Chlorphenamine"], "phytonadione": ["Phytonadione", "Phytomenadione", "Phylloquinone", "Vitamin K"],
    "methylergometrine": ["Methylergonovine", "Methylergometrine"], "enoxaparin sodium": ["Enoxaparin"],
    "sodium valproate": ["Valproic acid", "Sodium valproate"], "valproic acid": ["Valproic acid"], "keppra": ["Levetiracetam"],
    "metoprolol succinate": ["Metoprolol"], "metoprolol tartrate": ["Metoprolol"], "diclofenac sodium": ["Diclofenac"],
    "mebeverine hydrochloride": ["Mebeverine"], "bromhexine hydrochloride": ["Bromhexine"], "fluconazole cap": ["Fluconazole"],
    "clavulanic acid": ["Clavulanic acid", "Clavulanate"], "tazobactam": ["Tazobactam"], "iron sucrose": ["Iron sucrose", "Ferric sucrose"],
    "silver sulfadiazine": ["Silver sulfadiazine"], "insulin lente": ["Insulin human", "Insulin"], "insulin mixtard": ["Insulin human", "Insulin"],
    "insulin soluble": ["Insulin human", "Insulin"], "dextrose 50%": ["Dextrose", "Glucose"], "glucose 50%": ["Dextrose", "Glucose"],
    "trimethoprim": ["Trimethoprim"], "amikacin": ["Amikacin"], "colistin": ["Colistin", "Colistimethate"], "cinnarizine": ["Cinnarizine"]
  };
  const SKIP = ["tpn bage", "beta-sitosterol"];

  const clean = (s) => String(s || "").replace(/\([^)]*\)/g, " ").replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b/gi, " ").replace(/\s+/g, " ").trim();
  const keyOf = (s) => clean(s).toLowerCase();

  // A catalogue medicine → [{ key, queries }]: the generic substances it contains
  function termsOf(med) {
    if (!med) return [];
    const base = med.nameEn || med.nameTrade || "";
    const parts = String(base).split(/\s*(?:\/|\+|\band\b)\s*/i).map(clean).filter(Boolean);
    const out = [];
    parts.forEach(p => {
      const k = p.toLowerCase();
      if (SKIP.indexOf(k) !== -1) return;
      // "Sodium Valproate / Valproic Acid": both halves name one substance
      const queries = ALIASES[k] ? ALIASES[k].slice() : [p];
      if (!out.some(o => o.key === (ALIASES[k] ? queries[0].toLowerCase() : k))) out.push({ key: ALIASES[k] ? queries[0].toLowerCase() : k, queries });
    });
    return out;
  }

  // ---- lookups on js/ddinter-data.js ----
  // data: { terms: { key: [ddId] }, drugs: { ddId: name }, pairs: ["idA|idB|level|flags"] }
  let index = null, indexFor = null;
  function build(data) {
    const m = new Map();
    (data.pairs || []).forEach(s => {
      const [a, b, lv, fl] = s.split("|");
      m.set(a + "|" + b, { level: Number(lv), flags: Number(fl) });
    });
    return m;
  }
  function pairInfo(data, a, b) {
    if (indexFor !== data) { index = build(data); indexFor = data; }
    return index.get(a < b ? a + "|" + b : b + "|" + a) || null;
  }
  function idsOf(data, med) {
    const ids = [];
    termsOf(med).forEach(t => ((data.terms || {})[t.key] || []).forEach(id => { if (ids.indexOf(id) === -1) ids.push(id); }));
    return ids;
  }
  function flagNames(mask) { return FLAGS.filter(f => mask & f[1]).map(f => f[2]); }

  // Interactions between two catalogue medicines → [{ level, label, drugA, drugB, mechanisms }]
  function check(data, medA, medB) {
    if (!data) return [];
    const A = idsOf(data, medA), B = idsOf(data, medB);
    const out = [];
    A.forEach(a => B.forEach(b => {
      if (a === b) return;
      const p = pairInfo(data, a, b);
      if (p) out.push({ level: p.level, label: LEVELS[p.level], drugA: data.drugs[a], drugB: data.drugs[b], mechanisms: flagNames(p.flags) });
    }));
    return out.sort((x, y) => y.level - x.level);
  }

  // All interactions among a patient's medicines (each pair once)
  function forMeds(data, meds) {
    const out = [];
    for (let i = 0; i < meds.length; i++) for (let j = i + 1; j < meds.length; j++) {
      check(data, meds[i], meds[j]).forEach(r => out.push(Object.assign({ medA: meds[i], medB: meds[j] }, r)));
    }
    return out.sort((x, y) => y.level - x.level);
  }

  return { LEVELS, FLAGS, ALIASES, termsOf, keyOf, check, forMeds, flagNames, idsOf };
});
