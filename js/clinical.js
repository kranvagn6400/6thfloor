/* ============================================================
   clinical.js  —  Clinical decision support (pure logic, no DOM)
   ============================================================
   Exposes window.PharmacyClinical:
     - calculateGFR(patient)         CKD-EPI 2021 eGFR + KDIGO stage
     - isAntibiotic(med), isAlbumin(med)
     - abxDay(med, patient)          day number of THIS antibiotic course
     - setAbxDay(med, dayNumber)     back-date the course start
     - checkDrugInteractions(meds)   known interacting pairs
     - medAlerts(patient)            per-med alerts (renal, allergy,
                                     duplicates, antibiotic duration)
     - allergyConflicts(text, med)   used before adding a med

   ⚠ The rules below are decision SUPPORT, written from common adult
   references (eGFR used as a proxy for CrCl). They must be reviewed
   against the hospital's own protocols. Every alert tells the user to
   verify; none of them blocks prescribing.
   ============================================================ */

(function (global) {
  "use strict";

  // ---------- Trade names / catalog spellings → generic names ----------
  // The ward catalog names many drugs by local trade name or with a
  // different spelling ("Ceftrixone", "Amoxil", "Voltarin"). Every rule
  // below matches GENERIC names, so a med's text is extended with the
  // generic for any alias it contains. Add new catalog names here.
  const GENERIC_ALIASES = {
    // antibiotics
    "ceftrixone": "ceftriaxone", "ceftriaxon": "ceftriaxone", "rocephin": "ceftriaxone",
    "keflex": "cephalexin", "cefalexin": "cephalexin",
    "amoxil": "amoxicillin", "amoxycillin": "amoxicillin",
    // flucloxacillin: spellings / trade names / Arabic
    "fluclox": "flucloxacillin", "flucox": "flucloxacillin", "floxapen": "flucloxacillin",
    "cloxacillin": "flucloxacillin", "فلوكساسلين": "flucloxacillin", "فلوكلوكساسيلين": "flucloxacillin",
    "فلوكلوكساسلين": "flucloxacillin", "فلوكسابين": "flucloxacillin",
    "augmentin": "amoxicillin clavulanate", "amoxclav": "amoxicillin clavulanate",
    "ciprodar": "ciprofloxacin", "ciprobay": "ciprofloxacin",
    "garamycin": "gentamicin",
    "methoprim": "co-trimoxazole sulfamethoxazole trimethoprim",
    "septrin": "co-trimoxazole sulfamethoxazole trimethoprim",
    "bactrim": "co-trimoxazole sulfamethoxazole trimethoprim",
    "flamazine": "silver sulfadiazine",
    "tazocin": "piperacillin tazobactam", "meronem": "meropenem", "flagyl": "metronidazole",
    "fucidin": "fusidic acid", "zovirax": "acyclovir",
    // NSAIDs / analgesics
    "voltarin": "diclofenac", "voltaren": "diclofenac", "mobic": "meloxicam", "brufen": "ibuprofen",
    // PPIs
    "esomprazole": "esomeprazole", "pantaprazole": "pantoprazole", "nexium": "esomeprazole",
    "controloc": "pantoprazole", "losec": "omeprazole",
    // steroids
    "decadrone": "dexamethasone", "decadron": "dexamethasone",
    "depomedrol": "methylprednisolone", "depo-medrol": "methylprednisolone",
    "solumedrol": "methylprednisolone", "solu-medrol": "methylprednisolone",
    // benzodiazepines
    "valium": "diazepam", "librium": "chlordiazepoxide", "rivotrel": "clonazepam", "rivotril": "clonazepam",
    // others used by the renal / interaction rules
    "plasil": "metoclopramide", "primperan": "metoclopramide", "zofran": "ondansetron",
    "lasix": "furosemide", "clexane": "enoxaparin", "glucophage": "metformin",
    "keppra": "levetiracetam", "aldactone": "spironolactone", "lanoxin": "digoxin",
    // used by the "available alternative" groups
    "amaryl": "glimepiride", "diamicron": "gliclazide", "daonil": "glibenclamide",
    "lipitor": "atorvastatin", "crestor": "rosuvastatin", "zocor": "simvastatin",
    "norvasc": "amlodipine", "adalat": "nifedipine", "cozaar": "losartan", "diovan": "valsartan",
    "capoten": "captopril", "renitec": "enalapril", "tritace": "ramipril",
    "pepcid": "famotidine", "zantac": "ranitidine", "kytril": "granisetron"
  };
  const ALIAS_KEYS = Object.keys(GENERIC_ALIASES);

  // ---------- Matching helpers ----------
  function medText(m) {
    if (!m) return "";
    const t = ((m.id || "") + " " + (m.nameTrade || "") + " " + (m.nameEn || "") + " " + (m.nameAr || "")).toLowerCase();
    const generics = ALIAS_KEYS.filter(a => t.indexOf(a) >= 0).map(a => GENERIC_ALIASES[a]);
    return generics.length ? t + " " + generics.join(" ") : t;
  }
  function matchesAny(m, keywords) {
    const t = medText(m);
    return keywords.some(k => t.indexOf(k) >= 0);
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(fromISO, toDate) {
    const start = new Date(fromISO);
    if (isNaN(start.getTime())) return null;
    const a = new Date(start); a.setHours(0, 0, 0, 0);
    const b = new Date(toDate || Date.now()); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
  }

  // ---------- eGFR (CKD-EPI 2021, race-free) ----------
  //   eGFR = 142 × min(Scr/κ,1)^α × max(Scr/κ,1)^-1.200 × 0.9938^age × (1.012 if female)
  //   κ = 0.7 (F) / 0.9 (M), α = -0.241 (F) / -0.302 (M), Scr in mg/dL
  function calculateGFR(patient) {
    if (!patient) return null;
    const age = parseFloat(String(patient.age || "").trim());
    const scr = parseFloat(String((patient.labs && patient.labs.creatinine) || "").trim());
    const gender = patient.gender || "";
    if (!isFinite(age) || age <= 0 || age > 120) return null;
    if (!isFinite(scr) || scr <= 0) return null;
    if (gender !== "male" && gender !== "female") return null;
    const k = gender === "female" ? 0.7 : 0.9;
    const a = gender === "female" ? -0.241 : -0.302;
    const ratio = scr / k;
    let gfr = 142 * Math.pow(Math.min(ratio, 1), a) * Math.pow(Math.max(ratio, 1), -1.2) * Math.pow(0.9938, age);
    if (gender === "female") gfr *= 1.012;
    gfr = Math.max(0, Math.min(250, gfr));
    let stage, stageLabel;
    if (gfr >= 90)      { stage = "g1";  stageLabel = "G1 طبيعي"; }
    else if (gfr >= 60) { stage = "g2";  stageLabel = "G2 انخفاض طفيف"; }
    else if (gfr >= 45) { stage = "g3a"; stageLabel = "G3a انخفاض متوسط-بسيط"; }
    else if (gfr >= 30) { stage = "g3b"; stageLabel = "G3b انخفاض متوسط-شديد"; }
    else if (gfr >= 15) { stage = "g4";  stageLabel = "G4 شديد"; }
    else                { stage = "g5";  stageLabel = "G5 فشل كلوي"; }
    return { gfr: Math.round(gfr * 10) / 10, stage, stageLabel };
  }

  // ---------- CrCl (Cockcroft-Gault) — the basis of most drug-dosing tables ----------
  //   CrCl = (140 − age) × weight / (72 × Scr)  × 0.85 if female   [mL/min]
  // Weight (stored in patient.labs.weight / labs.height, kg / cm):
  //   - no height: actual body weight
  //   - with height: ideal body weight (Devine: 50 M / 45.5 F + 0.9055 kg per cm over 152.4)
  //       actual < IBW        → actual weight
  //       actual > 1.2 × IBW  → adjusted weight = IBW + 0.4 × (actual − IBW)   (obesity)
  //       otherwise           → IBW
  function idealBodyWeight(heightCm, gender) {
    return (gender === "female" ? 45.5 : 50) + 0.9055 * (heightCm - 152.4);
  }
  function calculateCrCl(patient) {
    if (!patient) return null;
    const labs = patient.labs || {};
    const age = parseFloat(String(patient.age || "").trim());
    const scr = parseFloat(String(labs.creatinine || "").trim());
    const weight = parseFloat(String(labs.weight || "").trim());
    const height = parseFloat(String(labs.height || "").trim());
    const gender = patient.gender || "";
    if (!isFinite(age) || age <= 0 || age > 120) return null;
    if (!isFinite(scr) || scr <= 0) return null;
    if (!isFinite(weight) || weight < 2 || weight > 400) return null;
    if (gender !== "male" && gender !== "female") return null;

    let used = weight;
    let basis = "actual";
    if (isFinite(height) && height >= 100 && height <= 250) {
      const ibw = idealBodyWeight(height, gender);
      if (weight > 1.2 * ibw)  { used = ibw + 0.4 * (weight - ibw); basis = "adjusted"; }
      else if (weight >= ibw)  { used = ibw; basis = "ideal"; }
    }
    let crcl = ((140 - age) * used) / (72 * scr);
    if (gender === "female") crcl *= 0.85;
    crcl = Math.max(0, Math.min(250, crcl));
    return {
      crcl: Math.round(crcl * 10) / 10,
      weightUsed: Math.round(used * 10) / 10,
      basis,
      basisLabel: basis === "adjusted" ? "الوزن المعدّل (سمنة)" : basis === "ideal" ? "الوزن المثالي" : "الوزن الفعلي"
    };
  }

  // Kidney function used for dose alerts: CrCl when the weight is known
  // (what dosing tables are built on), otherwise eGFR as a proxy.
  function renalFunction(patient) {
    const c = calculateCrCl(patient);
    if (c) return { value: c.crcl, label: "CrCl" };
    const g = calculateGFR(patient);
    if (g) return { value: g.gfr, label: "eGFR" };
    return null;
  }

  // ---------- Antibiotics / albumin ----------
  // Catalog ids used by the ward + name keywords so meds added later
  // (other strengths, new trade names) are recognised too.
  const ANTIBIOTIC_IDS = [
    "ceftriaxone", "meropenem", "vancomycin", "amoxycillin-500", "ceftazidime-1g",
    "ciprofloxacin-200", "cefotaxime-1g", "colistin", "tigecycline", "amoxclav",
    "azithromycin-500", "metronidazole-500", "flagyl-500", "fucidin"
  ];
  const ANTIBIOTIC_KEYWORDS = [
    "ceftriaxone", "cefotaxime", "ceftazidime", "cefepime", "cefuroxime", "cefazolin", "cefixime",
    "cefoperazone", "meropenem", "meronem", "imipenem", "ertapenem", "vancomycin", "teicoplanin",
    "linezolid", "amoxicillin", "amoxycillin", "amoxclav", "augmentin", "ampicillin", "piperacillin",
    "tazocin", "flucloxacillin", "ciprofloxacin", "levofloxacin", "moxifloxacin", "azithromycin",
    "clarithromycin", "erythromycin", "metronidazole", "flagyl", "colistin", "tigecycline",
    "amikacin", "gentamicin", "clindamycin", "doxycycline", "co-trimoxazole", "sulfamethoxazole",
    "fosfomycin", "nitrofurantoin", "rifampicin", "fusidic", "fucidin", "cephalexin",
    "nystatin"                       // an antifungal, but the ward counts it with the antibiotics (the user asked)
  ];
  const ALBUMIN_IDS = ["human-albumin-20"];

  function isAntibiotic(m) {
    if (!m) return false;
    return ANTIBIOTIC_IDS.indexOf(m.id) !== -1 || matchesAny(m, ANTIBIOTIC_KEYWORDS);
  }
  function isAlbumin(m) {
    if (!m) return false;
    return ALBUMIN_IDS.indexOf(m.id) !== -1 || matchesAny(m, ["albumin", "ألبومين"]);
  }

  // Other critical medicines tracked in «مراقبة الأدوية الحرجة» (beside the
  // antibiotics and albumin): kind → names that identify it. Matches the
  // id / trade / English / Arabic name, so trade names count (MabThera, AmBisome…).
  const CRITICAL_KINDS = [
    { kind: "ivig",         label: "I.V.I.G",       words: ["ivig", "i.v.i.g", "immunoglobulin", "immune globulin", "غلوبيولين"] },
    { kind: "epo",          label: "Aranesp/Eprex", words: ["aranesp", "aransip", "darbepoetin", "eprex", "epoetin", "erythropoietin", "epogen", "ارانسب", "ارانيسب", "ايبركس"] },
    // the two antifungals share one card
    { kind: "antifungal",   label: "Amphoter/Caspo", words: ["amphotericin", "ambisome", "fungizone", "امفوترسين", "أمفوتريسين", "caspofungin", "cancidas", "كاسبوفانجين", "كاسبوفنجين"] }
  ];
  function criticalKind(m) {
    if (!m) return null;
    for (const c of CRITICAL_KINDS) { if (matchesAny(m, c.words)) return c.kind; }
    return null;
  }

  // Day number of this med's course (D1 = start day). Uses the med's
  // own startDate (set when it was added); older meds fall back to the
  // patient-level firstMedDate. null when no date is known.
  function abxDay(med, patient) {
    const start = (med && med.startDate) || (patient && patient.firstMedDate) || "";
    if (!start) return null;
    const diff = daysBetween(start);
    return diff === null ? null : Math.max(1, diff + 1);
  }
  function abxDayLabel(med, patient) {
    const d = abxDay(med, patient);
    return d ? "D" + d : "";
  }
  // The course day may be corrected for 3 days only (D1–D3); from D4 nobody can change it. The 3 days run from the day the
  // medicine was added to the patient (med.addedAt — a correction that moves the start date does not restart them);
  // medicines added before that field existed use the day they show now.
  const DAY_EDIT_DAYS = 3;
  function dayEditLocked(med, patient) {
    if (!med) return false;
    if (med.addedAt) { const e = daysBetween(med.addedAt); return e !== null && e >= DAY_EDIT_DAYS; }
    const d = abxDay(med, patient);
    return d != null && d > DAY_EDIT_DAYS;
  }
  function setAbxDay(med, dayNumber) {
    const n = parseInt(dayNumber, 10);
    if (!med || !isFinite(n) || n < 1 || n > 365) return false;
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    med.startDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return true;
  }

  // ---------- Renal dose adjustment (by eGFR) ----------
  // Each drug: ordered tiers, first tier whose `below` > eGFR applies.
  const RENAL_RULES = [
    { name: "Meropenem", match: ["meropenem", "meronem", "ميروب", "ميرون"], tiers: [
      { below: 10, msg: "500mg كل 24 ساعة" },
      { below: 26, msg: "500mg كل 12 ساعة" },
      { below: 51, msg: "الجرعة كاملة كل 12 ساعة" } ] },
    { name: "Imipenem", match: ["imipenem", "tienam"], tiers: [
      { below: 30, msg: "خفّض الجرعة — خطر نوبات" } ] },
    { name: "Ertapenem", match: ["ertapenem", "invanz"], tiers: [
      { below: 30, msg: "500mg مرة يومياً" } ] },
    { name: "Vancomycin", match: ["vancomycin", "vancocin", "فانكو"], tiers: [
      { below: 50, msg: "باعد الجرعات حسب مستوى الدواء (Trough/AUC)" } ] },
    { name: "Aminoglycosides", match: ["amikacin", "gentamicin", "tobramycin", "أميكاسين"], tiers: [
      { below: 60, msg: "مدّد الفاصل وتابع المستوى — سمية كلوية وسمعية" } ] },
    { name: "Piperacillin/Tazobactam", match: ["piperacillin", "tazocin"], tiers: [
      { below: 20, msg: "2.25g كل 8 ساعات" },
      { below: 40, msg: "2.25g كل 6 ساعات" } ] },
    { name: "Ceftazidime", match: ["ceftazidime", "fortum"], tiers: [
      { below: 16, msg: "500mg–1g كل 24 ساعة" },
      { below: 31, msg: "1g كل 24 ساعة" },
      { below: 51, msg: "1g كل 12 ساعة" } ] },
    { name: "Cefepime", match: ["cefepime", "maxipime"], tiers: [
      { below: 30, msg: "خفّض الجرعة (مثلاً 1g يومياً) — خطر سمية عصبية" },
      { below: 61, msg: "كل 12–24 ساعة حسب الشدة" } ] },
    { name: "Ciprofloxacin", match: ["ciprofloxacin", "ciprobay", "سيبرو"], tiers: [
      { below: 30, msg: "كل 18–24 ساعة" },
      { below: 50, msg: "كل 12 ساعة (بدون جرعات 8 ساعات)" } ] },
    { name: "Levofloxacin", match: ["levofloxacin", "tavanic"], tiers: [
      { below: 20, msg: "750mg كل 48 ساعة" },
      { below: 50, msg: "750mg كل 48 ساعة أو 250mg يومياً بعد التحميل" } ] },
    { name: "Amoxicillin(±clav)", match: ["amoxicillin", "amoxycillin", "amoxclav", "augmentin", "أموكسي"], tiers: [
      { below: 30, msg: "تجنّب 875mg — 500mg كل 12 ساعة (كل 24 إذا <10)" } ] },
    { name: "Co-trimoxazole", match: ["co-trimoxazole", "sulfamethoxazole", "septrin", "bactrim"], tiers: [
      { below: 15, msg: "تجنّب" },
      { below: 30, msg: "نصف الجرعة" } ] },
    { name: "Nitrofurantoin", match: ["nitrofurantoin", "macrodantin"], tiers: [
      { below: 45, msg: "تجنّب — فعالية أقل وخطر سمية" } ] },
    { name: "Colistin", match: ["colistin", "colomycin"], tiers: [
      { below: 50, msg: "خفّض جرعة الصيانة حسب البروتوكول" } ] },
    { name: "Acyclovir", match: ["acyclovir", "aciclovir", "zovirax"], tiers: [
      { below: 10, msg: "نصف الجرعة كل 24 ساعة" },
      { below: 25, msg: "كل 24 ساعة" },
      { below: 50, msg: "كل 12 ساعة" } ] },
    { name: "Fluconazole", match: ["fluconazole", "diflucan"], tiers: [
      { below: 50, msg: "نصف الجرعة بعد جرعة التحميل" } ] },
    { name: "Oseltamivir", match: ["oseltamivir", "tamiflu"], tiers: [
      { below: 30, msg: "30mg يومياً" },
      { below: 60, msg: "30mg مرتين يومياً" } ] },
    { name: "Enoxaparin", match: ["enoxaparin", "clexane", "إينوك", "كليكسان"], tiers: [
      { below: 30, msg: "علاجية 1mg/kg مرة يومياً · وقائية 20–30mg يومياً" } ] },
    { name: "Rivaroxaban", match: ["rivaroxaban", "xarelto"], tiers: [
      { below: 15, msg: "تجنّب" },
      { below: 50, msg: "راجع الجرعة حسب الاستطباب (15mg في الرجفان الأذيني)" } ] },
    { name: "Apixaban", match: ["apixaban", "eliquis"], tiers: [
      { below: 15, msg: "تجنّب" },
      { below: 30, msg: "راجع معايير خفض الجرعة (2.5mg مرتين)" } ] },
    { name: "Dabigatran", match: ["dabigatran", "pradaxa"], tiers: [
      { below: 30, msg: "مضاد استطباب" },
      { below: 50, msg: "راجع الجرعة" } ] },
    { name: "Metformin", match: ["metformin", "glucophage"], tiers: [
      { below: 30, msg: "مضاد استطباب — أوقفه" },
      { below: 45, msg: "لا تبدأ به؛ الحد الأقصى 1000mg يومياً" } ] },
    { name: "Gabapentin", match: ["gabapentin", "neurontin"], tiers: [
      { below: 15, msg: "100–300mg يومياً" },
      { below: 30, msg: "200–700mg يومياً" },
      { below: 60, msg: "400–1400mg يومياً مقسّمة" } ] },
    { name: "Pregabalin", match: ["pregabalin", "lyrica"], tiers: [
      { below: 30, msg: "25–150mg يومياً" },
      { below: 60, msg: "نصف الجرعة" } ] },
    { name: "Levetiracetam", match: ["levetiracetam", "keppra"], tiers: [
      { below: 30, msg: "250–500mg كل 12 ساعة" },
      { below: 50, msg: "250–750mg كل 12 ساعة" },
      { below: 80, msg: "500–1000mg كل 12 ساعة" } ] },
    { name: "H2 blockers", match: ["famotidine", "ranitidine"], tiers: [
      { below: 50, msg: "نصف الجرعة" } ] },
    { name: "Spironolactone", match: ["spironolactone", "aldactone"], tiers: [
      { below: 30, msg: "تجنّب — خطر فرط بوتاسيوم" } ] },
    { name: "NSAIDs", match: ["diclofenac", "ibuprofen", "ketorolac", "ketoprofen", "meloxicam", "naproxen", "voltaren", "brufen", "فولتارين"], tiers: [
      { below: 30, msg: "تجنّب" },
      { below: 60, msg: "بحذر وبأقصر مدة — خطر أذية كلوية" } ] },
    { name: "Tramadol", match: ["tramadol", "tramal"], tiers: [
      { below: 30, msg: "كل 12 ساعة، الحد الأقصى 200mg يومياً" } ] },
    { name: "Morphine", match: ["morphine", "مورفين"], tiers: [
      { below: 30, msg: "خفّض الجرعة وباعد — تراكم مستقلبات" } ] },
    { name: "Digoxin", match: ["digoxin", "lanoxin"], tiers: [
      { below: 50, msg: "خفّض الجرعة وتابع المستوى" } ] },
    { name: "Allopurinol", match: ["allopurinol", "zyloric"], tiers: [
      { below: 30, msg: "ابدأ بـ 50–100mg يومياً" },
      { below: 60, msg: "خفّض الجرعة" } ] },
    { name: "Potassium", match: ["potassium chloride", "kcl", "بوتاسيوم"], tiers: [
      { below: 30, msg: "حذر — تابع K+ (خطر فرط بوتاسيوم)" } ] }
  ];

  // `fn` is the kidney function value (CrCl or eGFR); `label` names it.
  // Topical forms (eye / ear drops, creams, ointments, gels) don't need
  // renal dose adjustment.
  const TOPICAL = /\b(drops?|cream|oint(ment)?|gel|eye|ear)\b/i;

  function renalAlert(med, fn, label) {
    if (fn == null) return null;
    if (TOPICAL.test(medText(med))) return null;
    for (const rule of RENAL_RULES) {
      if (!matchesAny(med, rule.match)) continue;
      const tier = rule.tiers.find(t => fn < t.below);
      if (!tier) return null;
      return {
        type: "renal",
        level: fn < 30 ? "danger" : "warning",
        msg: `كلوي (${label || "eGFR"} ${fn}): ${tier.msg}`
      };
    }
    return null;
  }

  // ---------- Allergies ----------
  const ALLERGY_CLASSES = [
    { key: "penicillin", label: "البنسلين", words: ["بنسلين", "بنسيلين", "بينسلين"],
      match: ["penicillin", "amoxicillin", "amoxycillin", "amoxclav", "augmentin", "ampicillin", "piperacillin",
              "tazocin", "flucloxacillin", "cloxacillin", "unasyn", "sulbactam", "بنسلين", "أموكسي", "أوغمنتين"],
      cross: [{ cls: "cephalosporin", msg: "حساسية متصالبة محتملة (منخفضة) مع البنسلين" },
              { cls: "carbapenem",    msg: "حساسية متصالبة نادرة مع البنسلين" }] },
    { key: "cephalosporin", label: "السيفالوسبورين", words: ["سيفال", "سفالو", "سيفالو", "cephalosporin"],
      match: ["ceftriaxone", "cefotaxime", "ceftazidime", "cefepime", "cefuroxime", "cefazolin", "cephalexin",
              "cefixime", "cefoperazone", "rocephin", "fortum", "zinnat", "سيفتر", "سيفو"] },
    { key: "carbapenem", label: "الكاربابينيم", words: ["كاربا", "كاربي"],
      match: ["meropenem", "meronem", "imipenem", "ertapenem", "ميروب", "ميرون"] },
    { key: "sulfa", label: "السلفا", words: ["سلفا", "سولفا", "sulfa", "sulpha"],
      match: ["sulfamethoxazole", "co-trimoxazole", "trimethoprim", "septrin", "bactrim", "sulfasalazine", "sulfadiazine", "سلفا"] },
    { key: "nsaid", label: "مضادات الالتهاب NSAIDs", words: ["nsaid", "مضادات الالتهاب", "مضاد التهاب", "مسكنات غير"],
      match: ["diclofenac", "ibuprofen", "ketorolac", "ketoprofen", "meloxicam", "naproxen", "aspirin", "celecoxib",
              "voltaren", "brufen", "فولتارين", "بروفين", "أسبرين"] },
    { key: "quinolone", label: "الكينولونات", words: ["كينولون", "quinolone"],
      match: ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin", "tavanic", "سيبرو"] },
    { key: "macrolide", label: "الماكروليدات", words: ["ماكرولي", "macrolide"],
      match: ["azithromycin", "clarithromycin", "erythromycin", "zithromax", "klacid"] },
    { key: "vancomycin", label: "الفانكومايسين", match: ["vancomycin", "فانكو"] },
    { key: "metronidazole", label: "الميترونيدازول", match: ["metronidazole", "flagyl", "فلاجيل"] },
    { key: "opioid", label: "الأفيونات", words: ["أفيون", "افيون", "opioid", "opiate"],
      match: ["morphine", "tramadol", "pethidine", "fentanyl", "codeine", "nalbuphine", "مورفين", "ترامادول"] },
    { key: "heparin", label: "الهيبارين", match: ["heparin", "enoxaparin", "clexane", "هيبارين"] }
  ];
  // Quick-pick list in the patient view
  const ALLERGY_OPTIONS = ALLERGY_CLASSES.map(c => c.label);

  // patient.allergies is one text: "البنسلين، السلفا، Ceftriaxone".
  // Split it into the classes ticked from the list and anything typed.
  function splitAllergies(text) {
    const items = String(text || "").split(/\s*[,،;]\s*/).map(s => s.trim()).filter(Boolean);
    return {
      known: ALLERGY_OPTIONS.filter(o => items.indexOf(o) !== -1),
      other: items.filter(i => ALLERGY_OPTIONS.indexOf(i) === -1)
    };
  }
  function joinAllergies(known, otherText) {
    const other = String(otherText || "").split(/\s*[,،;]\s*/).map(s => s.trim()).filter(Boolean);
    return known.concat(other).join("، ");
  }

  function allergyClassesMentioned(text) {
    const t = String(text || "").toLowerCase();
    if (!t.trim()) return [];
    return ALLERGY_CLASSES.filter(c =>
      t.indexOf(c.label.toLowerCase()) >= 0 || t.indexOf(c.key) >= 0 ||
      (c.words || []).some(w => t.indexOf(w) >= 0) || c.match.some(k => t.indexOf(k) >= 0)
    );
  }

  // Alerts for one med against the patient's allergy text.
  function allergyConflicts(allergiesText, med) {
    const out = [];
    const text = String(allergiesText || "").toLowerCase();
    if (!text.trim() || !med) return out;
    const mentioned = allergyClassesMentioned(text);
    const seen = new Set();
    mentioned.forEach(c => {
      if (matchesAny(med, c.match)) {
        seen.add(c.key);
        out.push({ type: "allergy", level: "danger", msg: `حساسية مسجّلة: ${c.label}` });
      }
    });
    mentioned.forEach(c => {
      (c.cross || []).forEach(x => {
        const target = ALLERGY_CLASSES.find(k => k.key === x.cls);
        if (target && !seen.has(target.key) && matchesAny(med, target.match)) {
          out.push({ type: "allergy", level: "warning", msg: x.msg });
        }
      });
    });
    // Free-text drug names typed by the user (e.g. "Ceftriaxone")
    if (out.length === 0) {
      const t = medText(med);
      text.split(/[,،;\n]+/).map(s => s.trim()).filter(s => s.length >= 4).forEach(tok => {
        if (t.indexOf(tok) >= 0) out.push({ type: "allergy", level: "danger", msg: `حساسية مسجّلة: ${tok}` });
      });
    }
    return out;
  }

  // ---------- Therapeutic duplication ----------
  const DUPLICATE_CLASSES = [
    { label: "مثبطات مضخة البروتون (PPI)",
      match: ["omeprazole", "esomeprazole", "pantoprazole", "lansoprazole", "rabeprazole", "nexium", "controloc", "losec", "كونترولوك"] },
    { label: "مضادات التخثر",
      match: ["enoxaparin", "clexane", "heparin", "rivaroxaban", "apixaban", "warfarin", "dabigatran", "fondaparinux", "إينوك", "هيبارين"] },
    { label: "مضادات الالتهاب NSAIDs",
      match: ["diclofenac", "ibuprofen", "ketorolac", "ketoprofen", "meloxicam", "naproxen", "celecoxib", "voltaren", "brufen"] },
    { label: "الكينولونات", match: ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin"] },
    { label: "بيتا-لاكتام",
      match: ["penicillin", "amoxicillin", "amoxycillin", "amoxclav", "augmentin", "ampicillin", "piperacillin", "tazocin",
              "ceftriaxone", "cefotaxime", "ceftazidime", "cefepime", "cefuroxime", "cefazolin",
              "meropenem", "meronem", "imipenem", "ertapenem"] },
    { label: "مدرّات العروة", match: ["furosemide", "lasix", "torsemide", "bumetanide", "فيوروسيميد", "لازكس"] },
    { label: "الأفيونات", match: ["morphine", "tramadol", "pethidine", "fentanyl", "nalbuphine", "codeine"] },
    { label: "البنزوديازيبينات", match: ["diazepam", "midazolam", "lorazepam", "alprazolam", "clonazepam", "chlordiazepoxide"] },
    { label: "الستيرويدات الجهازية",
      match: ["hydrocortisone", "dexamethasone", "methylprednisolone", "prednisolone", "solu-cortef", "solu-medrol"] }
  ];

  // Returns Map<medIndex, alert[]> for meds that duplicate a class.
  function duplicateAlerts(meds) {
    const res = new Map();
    const add = (i, a) => { if (!res.has(i)) res.set(i, []); res.get(i).push(a); };
    DUPLICATE_CLASSES.forEach(c => {
      const hits = [];
      meds.forEach((m, i) => { if (m && matchesAny(m, c.match)) hits.push(i); });
      const distinct = new Set(hits.map(i => meds[i].id));
      if (hits.length >= 2 && distinct.size >= 2) {
        hits.forEach(i => add(i, { type: "duplicate", level: "warning", msg: `ازدواجية علاجية: أكثر من دواء من ${c.label}` }));
      }
    });
    // Same med entered twice
    const byId = {};
    meds.forEach((m, i) => { if (m && m.id) (byId[m.id] = byId[m.id] || []).push(i); });
    Object.values(byId).forEach(idxs => {
      if (idxs.length >= 2) idxs.forEach(i => add(i, { type: "duplicate", level: "warning", msg: "الدواء نفسه مضاف أكثر من مرة" }));
    });
    return res;
  }

  // ---------- Drug interactions (pairs) ----------
  const DRUG_INTERACTIONS = [
    { matchA: ["ciprofloxacin", "cipro", "سيبروف"], matchB: ["vancomycin", "فانكو"], severity: "warning", msg: "Ciprofloxacin + Vancomycin: زيادة خطر اعتلال الكلى" },
    { matchA: ["furosemide", "lasix", "فيورو"], matchB: ["vancomycin", "فانكو"], severity: "danger", msg: "Furosemide + Vancomycin: خطر سمية كلوية" },
    { matchA: ["furosemide", "lasix", "فيورو"], matchB: ["amikacin", "أميكاسين"], severity: "danger", msg: "Furosemide + Amikacin: خطر سمية سمعية وكلوية" },
    { matchA: ["enoxaparin", "clexane", "إينوك"], matchB: ["heparin", "هيبا"], severity: "warning", msg: "Enoxaparin + Heparin: مضادات تخثر متعددة — خطر نزيف" },
    { matchA: ["enoxaparin", "clexane", "إينوك"], matchB: ["warfarin", "وارفارين"], severity: "danger", msg: "Enoxaparin + Warfarin: خطر نزيف شديد" },
    { matchA: ["aspirin", "أسبرين"], matchB: ["enoxaparin", "clexane", "إينوك"], severity: "warning", msg: "Aspirin + Enoxaparin: خطر نزيف" },
    { matchA: ["metronidazole", "flagyl", "فلاجيل"], matchB: ["alcohol", "كحول"], severity: "danger", msg: "Metronidazole + Alcohol: تفاعل ديسولفيرام (غثيان شديد)" },
    { matchA: ["ondansetron", "zofran", "أوندان"], matchB: ["metoclopramide", "primperan", "ميتوكلو"], severity: "warning", msg: "Ondansetron + Metoclopramide: زيادة خطر إطالة QT" },
    { matchA: ["amlodipine", "أملودي"], matchB: ["simvastatin", "سيمفا"], severity: "warning", msg: "Amlodipine + Simvastatin: زيادة خطر ألم عضلي" },
    { matchA: ["ciprofloxacin", "cipro", "سيبروف"], matchB: ["theophylline", "ثيوفل"], severity: "warning", msg: "Ciprofloxacin + Theophylline: زيادة مستوى Theophylline" }
  ];

  function checkDrugInteractions(medications) {
    if (!Array.isArray(medications) || medications.length < 2) return [];
    return DRUG_INTERACTIONS.filter(it =>
      medications.some(m => matchesAny(m, it.matchA)) && medications.some(m => matchesAny(m, it.matchB))
    );
  }

  // ---------- Antibiotic duration ----------
  function durationAlert(med, patient) {
    if (!isAntibiotic(med)) return null;
    const d = abxDay(med, patient);
    if (!d) return null;
    if (d >= 14) return { type: "duration", level: "danger", msg: `اليوم ${d} من المضاد — راجع ضرورة الاستمرار` };
    return null;
  }

  // ---------- Available alternatives for an unavailable med ----------
  // 1) the same substance under another name / strength / form, then
  // 2) a drug of the same interchangeable class. Only groups where a
  // switch is routine are listed; every suggestion says to verify the
  // dose. Never blocks — the doctor decides.
  const SUBSTITUTE_CLASSES = [
    { label: "PPI", match: ["omeprazole", "esomeprazole", "pantoprazole", "lansoprazole", "rabeprazole"] },
    { label: "H2 blocker", match: ["famotidine", "ranitidine"] },
    { label: "Loop diuretic", match: ["furosemide", "torsemide", "bumetanide"] },
    { label: "Statin", match: ["atorvastatin", "rosuvastatin", "simvastatin", "pravastatin"] },
    { label: "ACE inhibitor", match: ["captopril", "enalapril", "lisinopril", "ramipril", "perindopril"] },
    { label: "ARB", match: ["losartan", "valsartan", "candesartan", "irbesartan", "telmisartan"] },
    { label: "Calcium channel blocker", match: ["amlodipine", "nifedipine", "felodipine"] },
    { label: "Sulfonylurea", match: ["glimepiride", "gliclazide", "glibenclamide"] },
    { label: "NSAID", match: ["diclofenac", "ibuprofen", "ketoprofen", "meloxicam", "naproxen", "ketorolac"] },
    { label: "5-HT3 antiemetic", match: ["ondansetron", "granisetron"] },
    { label: "3rd-gen cephalosporin", match: ["ceftriaxone", "cefotaxime"] },
    { label: "Carbapenem", match: ["meropenem", "imipenem"] }
  ];

  // The substance a catalog entry is: an alias's generic, else the
  // first word of its name ("Amikacin 500mg Vial" → "amikacin").
  function genericKey(m) {
    if (!m) return "";
    const name = String(m.nameTrade || m.nameEn || m.id || "").toLowerCase();
    const alias = ALIAS_KEYS.find(a => name.indexOf(a) >= 0);
    if (alias) return GENERIC_ALIASES[alias];
    const first = name.match(/[a-z][a-z-]{2,}/);
    return first ? first[0] : "";
  }
  function substituteClass(m) {
    return SUBSTITUTE_CLASSES.find(c => matchesAny(m, c.match)) || null;
  }

  // → [{ med, kind: "same" | "class", label }] — available only, same
  // dosage form first, at most `limit`.
  function availableAlternatives(med, catalog, limit) {
    if (!med || !Array.isArray(catalog)) return [];
    const max = limit || 3;
    const key = genericKey(med);
    const cls = substituteClass(med);
    const form = med.form || "vial";
    const out = [];
    const seen = new Set([med.id]);
    const take = (list, kind, label) => {
      list.sort((a, b) => ((b.form || "vial") === form) - ((a.form || "vial") === form))
        .forEach(m => { if (out.length < max && !seen.has(m.id)) { seen.add(m.id); out.push({ med: m, kind, label }); } });
    };
    const pool = catalog.filter(m => m && m.id && m.available !== false && !seen.has(m.id));
    if (key) take(pool.filter(m => genericKey(m) === key), "same", "نفس المادة");
    if (cls) take(pool.filter(m => substituteClass(m) === cls), "class", cls.label + " — راجع الجرعة");
    return out;
  }

  // ---------- All alerts for one patient ----------
  // Returns { renal, byMed: Map<index, alert[]>, interactions: [], count }
  function medAlerts(patient) {
    const meds = (patient && Array.isArray(patient.medications)) ? patient.medications : [];
    const renal = renalFunction(patient);
    const byMed = duplicateAlerts(meds);
    const push = (i, a) => { if (!a) return; if (!byMed.has(i)) byMed.set(i, []); byMed.get(i).push(a); };
    meds.forEach((m, i) => {
      push(i, renal ? renalAlert(m, renal.value, renal.label) : null);
      allergyConflicts(patient && patient.allergies, m).forEach(a => push(i, a));
      push(i, durationAlert(m, patient));
    });
    const interactions = checkDrugInteractions(meds);
    let count = interactions.length;
    byMed.forEach(list => { count += list.length; });
    return { renal, byMed, interactions, count };
  }

  global.PharmacyClinical = {
    todayISO,
    calculateGFR,
    calculateCrCl, idealBodyWeight, renalFunction,
    ANTIBIOTIC_IDS, ALBUMIN_IDS,
    isAntibiotic, isAlbumin, criticalKind, CRITICAL_KINDS,
    abxDay, abxDayLabel, setAbxDay, dayEditLocked, DAY_EDIT_DAYS,
    RENAL_RULES, renalAlert,
    ALLERGY_CLASSES, ALLERGY_OPTIONS, allergyConflicts, splitAllergies, joinAllergies,
    DUPLICATE_CLASSES, duplicateAlerts,
    checkDrugInteractions, DRUG_INTERACTIONS,
    durationAlert,
    SUBSTITUTE_CLASSES, genericKey, availableAlternatives,
    medAlerts
  };
})(window);
