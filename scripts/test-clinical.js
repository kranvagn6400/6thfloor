// node scripts/test-clinical.js — checks clinical.js + monthly-report.js logic
const assert = require("assert");
global.window = global;
require("../js/clinical.js");
require("../js/monthly-report.js");
const C = global.PharmacyClinical;

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("✓ " + name); }

const iso = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().slice(0, 10); };

t("eGFR CKD-EPI 2021: male 60y Scr 1.0 ≈ 86", () => {
  const g = C.calculateGFR({ age: "60", gender: "male", labs: { creatinine: "1.0" } });
  assert.ok(Math.abs(g.gfr - 86) <= 1, g.gfr);
});
t("eGFR null when data missing", () => {
  assert.strictEqual(C.calculateGFR({ age: "60", labs: { creatinine: "1" } }), null);
});
t("CrCl Cockcroft-Gault: male 60y 70kg Scr 1.0 = 77.8", () => {
  const c = C.calculateCrCl({ age: "60", gender: "male", labs: { creatinine: "1.0", weight: "70" } });
  assert.strictEqual(c.crcl, 77.8);
  assert.strictEqual(c.basis, "actual");
});
t("CrCl female factor 0.85", () => {
  const c = C.calculateCrCl({ age: "60", gender: "female", labs: { creatinine: "1.0", weight: "70" } });
  assert.strictEqual(c.crcl, 66.1);
});
t("CrCl obese uses adjusted body weight", () => {
  // IBW(170cm, M) = 65.94; 120 kg > 1.2×IBW → AdjBW = 65.94 + 0.4×54.06 = 87.56
  const c = C.calculateCrCl({ age: "60", gender: "male", labs: { creatinine: "1.0", weight: "120", height: "170" } });
  assert.strictEqual(c.basis, "adjusted");
  assert.strictEqual(c.weightUsed, 87.6);
  assert.strictEqual(c.crcl, 97.3);
});
t("CrCl normal-weight with height uses ideal body weight", () => {
  const c = C.calculateCrCl({ age: "60", gender: "male", labs: { creatinine: "1.0", weight: "70", height: "170" } });
  assert.strictEqual(c.basis, "ideal");
});
t("CrCl null without weight; dose alerts fall back to eGFR", () => {
  const p = { age: "80", gender: "male", labs: { creatinine: "3" }, medications: [{ nameEn: "Meropenem" }] };
  assert.strictEqual(C.calculateCrCl(p), null);
  assert.ok(C.medAlerts(p).byMed.get(0)[0].msg.indexOf("eGFR") >= 0);
  p.labs.weight = "60";
  assert.ok(C.medAlerts(p).byMed.get(0)[0].msg.indexOf("CrCl") >= 0);
});
t("antibiotic detection by id and by name", () => {
  assert.ok(C.isAntibiotic({ id: "ceftriaxone" }));
  assert.ok(C.isAntibiotic({ id: "x-1", nameEn: "Piperacillin/Tazobactam 4.5g" }));
  assert.ok(!C.isAntibiotic({ id: "paracetamol", nameEn: "Paracetamol" }));
});
t("per-med antibiotic day uses startDate, falls back to firstMedDate", () => {
  assert.strictEqual(C.abxDay({ startDate: iso(2) }, {}), 3);
  assert.strictEqual(C.abxDay({}, { firstMedDate: iso(0) }), 1);
  assert.strictEqual(C.abxDay({}, {}), null);
});
t("setAbxDay back-dates the start", () => {
  const m = {};
  assert.ok(C.setAbxDay(m, 5));
  assert.strictEqual(C.abxDay(m, {}), 5);
  assert.ok(!C.setAbxDay(m, "abc"));
});
t("renal alert for meropenem at eGFR ~20 (danger)", () => {
  const a = C.renalAlert({ nameEn: "Meropenem 1g" }, 20);
  assert.strictEqual(a.level, "danger");
  assert.ok(a.msg.indexOf("500mg كل 12") >= 0, a.msg);
});
t("no renal alert when eGFR is normal or drug not listed", () => {
  assert.strictEqual(C.renalAlert({ nameEn: "Meropenem" }, 95), null);
  assert.strictEqual(C.renalAlert({ nameEn: "Paracetamol" }, 10), null);
});
t("penicillin allergy blocks amoxicillin, warns on ceftriaxone", () => {
  const amox = C.allergyConflicts("البنسلين", { id: "amoxclav", nameEn: "Amoxicillin/Clavulanate" });
  assert.strictEqual(amox[0].level, "danger");
  const cef = C.allergyConflicts("البنسلين", { id: "ceftriaxone", nameEn: "Ceftriaxone" });
  assert.strictEqual(cef[0].level, "warning");
});
t("catalog spellings / trade names are recognised (Ceftrixone, Keflex, Amoxil, Ciprodar…)", () => {
  const ceftrixone = { id: "ceftrixone-1g-vial", nameTrade: "Ceftrixone 1g vial", nameEn: "Ceftrixone 1g vial" };
  // the reported case: cephalosporin allergy + ceftriaxone spelled "Ceftrixone"
  assert.strictEqual(C.allergyConflicts("السيفالوسبورين", ceftrixone)[0].level, "danger");
  assert.strictEqual(C.allergyConflicts("السيفالسبورين", ceftrixone)[0].level, "danger", "Arabic spelling without و");
  assert.ok(C.isAntibiotic(ceftrixone));
  assert.ok(C.allergyConflicts("السيفالوسبورين", { nameEn: "Keflex 500mg cap" }).length > 0);
  assert.ok(C.allergyConflicts("البنسلين", { nameEn: "Amoxil 500mg Cap" }).length > 0);
  assert.ok(C.allergyConflicts("الكينولونات", { nameEn: "Ciprodar 500mg Tab" }).length > 0);
  assert.ok(C.allergyConflicts("السلفا", { nameEn: "Methoprim 480mg Tab" }).length > 0);
  assert.ok(C.allergyConflicts("مضادات الالتهاب NSAIDs", { nameEn: "Voltarin 75mg Amp" }).length > 0);
  assert.ok(C.isAntibiotic({ nameEn: "Garamycin 80mg Amp" }));
});
t("PPI duplication across catalog spellings (Esomprazole + Pantaprazole)", () => {
  assert.strictEqual(C.duplicateAlerts([{ id: "a", nameEn: "Esomprazole 40mg vial" }, { id: "b", nameEn: "Pantaprazole 40mg cap" }]).size, 2);
});
t("no renal alert for topical forms (gentamicin drop)", () => {
  assert.strictEqual(C.renalAlert({ nameEn: "gentamicin drop" }, 10), null);
  assert.ok(C.renalAlert({ nameEn: "Garamycin 80mg Amp" }, 10));
});
t("free-text allergy matches a drug name", () => {
  const a = C.allergyConflicts("Ceftriaxone", { id: "ceftriaxone", nameEn: "Ceftriaxone 1g" });
  assert.ok(a.length > 0);
});
t("no allergy text → no conflicts", () => {
  assert.deepStrictEqual(C.allergyConflicts("", { nameEn: "Amoxicillin" }), []);
});
t("duplicate therapy: two PPIs flagged, one is not", () => {
  const two = C.duplicateAlerts([{ id: "a", nameEn: "Omeprazole" }, { id: "b", nameEn: "Pantoprazole" }]);
  assert.strictEqual(two.size, 2);
  const one = C.duplicateAlerts([{ id: "a", nameEn: "Omeprazole" }, { id: "c", nameEn: "Paracetamol" }]);
  assert.strictEqual(one.size, 0);
});
t("duration alert only at D14 (danger) — the D7 «review the culture» warning was removed", () => {
  const p = { medications: [{ id: "ceftriaxone", nameEn: "Ceftriaxone", startDate: iso(6) },
                            { id: "meropenem", nameEn: "Meropenem", startDate: iso(13) }] };
  const res = C.medAlerts(p);
  const dur = (i) => res.byMed.get(i).find(a => a.type === "duration");
  assert.strictEqual(dur(0), undefined);
  assert.strictEqual(dur(1).level, "danger");
  // ceftriaxone + meropenem together is also a beta-lactam duplication
  assert.ok(res.byMed.get(0).some(a => a.type === "duplicate"));
});
t("interactions still detected (furosemide + vancomycin)", () => {
  const a = C.checkDrugInteractions([{ nameEn: "Furosemide" }, { nameEn: "Vancomycin" }]);
  assert.strictEqual(a.length, 1);
});

t("monthly report: admissions, DOT and course counts", () => {
  const R = global.PharmacyMonthlyReport;
  const from = new Date(2026, 8, 1), to = new Date(2026, 9, 1); // September 2026
  const ev = (d, event, extra) => Object.assign({ bed_key: "room-1-bed-1", created_at: new Date(2026, 8, d, 10).toISOString(), event }, extra || {});
  const events = [
    ev(3, "admitted", { patient_name: "A" }),
    ev(3, "med_added", { med_id: "ceftriaxone", med_name: "Ceftriaxone" }),
    ev(9, "med_removed", { med_id: "ceftriaxone", med_name: "Ceftriaxone" }),   // Sep 3–9 = 7 days
    ev(5, "med_added", { med_id: "paracetamol", med_name: "Paracetamol" }),
    ev(12, "discharged", { patient_name: "A" })
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const rep = R.build(events, from, to);
  assert.strictEqual(rep.admissions, 1);
  assert.strictEqual(rep.discharges, 1);
  assert.strictEqual(rep.abxStarts, 1);
  assert.strictEqual(rep.abxDot, 7);
  assert.strictEqual(rep.abxPatients, 1);
  assert.strictEqual(rep.topMeds.length, 2);
});
t("monthly report: course from previous month counts only days inside", () => {
  const R = global.PharmacyMonthlyReport;
  const from = new Date(2026, 8, 1), to = new Date(2026, 9, 1);
  const events = [
    { bed_key: "b", event: "med_added", med_id: "meropenem", med_name: "Meropenem", created_at: new Date(2026, 7, 28, 9).toISOString() },
    { bed_key: "b", event: "med_removed", med_id: "meropenem", med_name: "Meropenem", created_at: new Date(2026, 8, 4, 9).toISOString() }
  ];
  const rep = R.build(events, from, to);
  assert.strictEqual(rep.abxDot, 4);       // Sep 1–4
  assert.strictEqual(rep.abxStarts, 0);    // started in August
});

t("alternatives: same substance first, then same class, available only", () => {
  const cat = [
    { id: "nexium-40-vial", nameTrade: "Nexium 40mg vial", form: "vial", available: false },
    { id: "esomeprazole-40-tab", nameTrade: "Esomeprazole 40mg tab", form: "tablet" },
    { id: "pantoprazole-40-vial", nameTrade: "Pantoprazole 40mg vial", form: "vial" },
    { id: "omeprazole-20-cap", nameTrade: "Omeprazole 20mg cap", form: "tablet", available: false },
    { id: "paracetamol-tab", nameTrade: "Paracetamol 500mg tab", form: "tablet" }
  ];
  const alt = C.availableAlternatives(cat[0], cat);
  assert.deepStrictEqual(alt.map(a => a.med.id), ["esomeprazole-40-tab", "pantoprazole-40-vial"]);
  assert.strictEqual(alt[0].kind, "same");
  assert.strictEqual(alt[1].kind, "class");
});
t("alternatives: catalog misspelling maps to the generic (Ceftrixone → Cefotaxime)", () => {
  const cat = [
    { id: "ceftrixone-1g", nameTrade: "Ceftrixone 1g vial", form: "vial", available: false },
    { id: "cefotaxime-1g", nameTrade: "Cefotaxime 1g vial", form: "vial" },
    { id: "meropenem-1g", nameTrade: "Meropenem 1g vial", form: "vial" }
  ];
  const alt = C.availableAlternatives(cat[0], cat);
  assert.deepStrictEqual(alt.map(a => a.med.id), ["cefotaxime-1g"]);   // never a carbapenem
});
t("alternatives: none for a drug outside the listed classes", () => {
  const cat = [{ id: "amikacin-500", nameTrade: "Amikacin 500mg Vial", available: false }, { id: "gent", nameTrade: "Gentamicin 80mg amp" }];
  assert.strictEqual(C.availableAlternatives(cat[0], cat).length, 0);
});

t("flucloxacillin is an antibiotic, whatever its spelling / trade name", () => {
  ["Flucloxacillin 500mg vial", "Fluclox 500mg cap", "Flucoxacillin vial", "Floxapen 500mg", "Cloxacillin 500mg"]
    .forEach(n => assert.ok(C.isAntibiotic({ id: "x", nameTrade: n }), n));
  assert.ok(C.isAntibiotic({ id: "x", nameTrade: "X", nameAr: "فلوكساسلين" }));
});

t("critical medicines monitor: IVIG / Aranesp-Eprex / Amphotericin / Caspofungin are recognised by any name", () => {
  const k = (m) => C.criticalKind(Object.assign({ id: "x" }, m));
  assert.strictEqual(k({ nameTrade: "IVIG" }), "ivig");
  assert.strictEqual(k({ nameTrade: "I.V.I.G 5g" }), "ivig");
  assert.strictEqual(k({ nameEn: "Intravenous Immunoglobulin" }), "ivig");
  assert.strictEqual(k({ id: "erythropoietin", nameTrade: "Eprex", nameEn: "Erythropoietin" }), "epo");
  assert.strictEqual(k({ id: "aransip-40mcg-pfs", nameTrade: "Aranesp", nameEn: "Darbepoetin" }), "epo");
  assert.strictEqual(k({ nameTrade: "MabThera 500mg" }), null);   // Rituximab is not tracked
  assert.strictEqual(k({ nameTrade: "AmBisome 50mg" }), "antifungal");
  assert.strictEqual(k({ nameTrade: "Amphotericin", nameAr: "امفوترسين" }), "antifungal");
  assert.strictEqual(k({ nameTrade: "Cancidas" }), "antifungal");          // Caspofungin shares Amphotericin's card
  assert.strictEqual(k({ nameTrade: "AmBisome 50mg" }), "antifungal");
  assert.strictEqual(k({ nameTrade: "Paracetamol" }), null);
});

console.log(`\n${passed} tests passed`);
