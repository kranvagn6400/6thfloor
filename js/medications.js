/* ============================================================
   medications.js
   Default (DEMO) medication catalog.
   NOTE: Doses/frequencies here are PLACEHOLDERS, not clinical
   recommendations. The hospital/pharmacy administrator is
   responsible for configuring the actual defaults.
   ============================================================ */

(function (global) {
  "use strict";

  // Frequency shorthand options used across the app
  // Frequency format: "N×M" where N = dose multiplier (units per dose),
  // M = times per day. Examples:
  //   "1×3" = 1 unit, 3 times/day (default)
  //   "2×3" = 2 units, 3 times/day (double dose, 3 times)
  //   "2×1" = 2 units, once/day (double dose, once)
  // N may be a half tablet: "½×2" = half a tablet twice a day, "1½×1".
  // "O/N" = on need (عند الحاجة) — counted as 1 on the chart like any word frequency
  const FREQUENCIES = ["½×1", "½×2", "½×3", "1×1", "1×2", "1×3", "1×4", "1×5", "1×6", "1½×1", "1½×2", "1½×3", "2×1", "2×2", "2×3", "2×4", "2×5", "2×6", "3×1", "3×2", "3×3", "3×4", "3×5", "3×6", "4×1", "4×2", "4×3", "4×4", "4×5", "4×6", "5×1", "6×1", "7×1", "8×1", "9×1", "10×1", "11×1", "12×1", "O/N", "كل يومين", "كل 3 أيام", "كل أسبوع"];
  // How the dose is given — its own field (med.mode), not a frequency.
  // Older prescriptions stored these AS the frequency: medMode() /
  // medFrequency() read those as mode + "1×1" (and the chart still
  // counts such a legacy frequency as one preparation: SINGLE_DOSE_FREQS).
  const ADMIN_MODES = ["Infusion 24h", "Bolus"];
  const SINGLE_DOSE_FREQS = ADMIN_MODES;
  function isLegacyModeFreq(f) { return ADMIN_MODES.indexOf(String(f || "").trim()) !== -1; }
  function medMode(m) {
    if (!m) return "";
    if (m.mode) return m.mode;
    return isLegacyModeFreq(m.frequency) ? String(m.frequency).trim() : "";
  }
  function medFrequency(m, fallback) {
    const f = (m && m.frequency) || fallback || "";
    return isLegacyModeFreq(f) ? "1×1" : f;
  }

  // "N×M" → { n, m } with N = units per dose (½, 1½, 2, 0.5 …), M = times a
  // day. null for non-daily / free-text frequencies.
  function parseFreqN(s) {
    s = String(s || "").trim();
    if (s === "½") return 0.5;
    const half = s.match(/^(\d+)½$/);
    if (half) return parseInt(half[1], 10) + 0.5;
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : null;
  }
  function parseFreq(freq) {
    const f = String(freq || "").replace(/x/gi, "×").replace(/\s+/g, "");
    const m = f.match(/^(\d*½|\d+(?:\.\d+)?)×(\d+)$/);
    if (!m) return null;
    const n = parseFreqN(m[1]);
    return n ? { n: n, m: parseInt(m[2], 10) } : null;
  }
  // 0.5 → "½", 1.5 → "1½", 2 → "2"
  function formatN(n) {
    if (n === 0.5) return "½";
    if (n % 1 === 0.5) return Math.floor(n) + "½";
    return String(n);
  }

  // Form / dosage-form categories. Each medication has a `form` value.
  // Eight forms are supported (ordered as they appear in the UI):
  //   "vial"              → Vial (حقن وريدية / عضلية - مسحوق يُحل)
  //   "ampule"            → Ampule (أمبول - سائل جاهز للحقن)
  //   "prefilled-syringe" → Prefilled Syringe (سرنجة جاهزة - مثل Enoxaparin)
  //   "tablet"            → Tablet (أقراص / كبسولات)
  //   "effervescent"      → Effervescent (فوار)
  //   "syrup-and-oral-drop" → OSD (Ointment, Syrup, Drops)
  //   "suppository"       → Suppository (تحاميل)
  //   "solution"          → Solution (محلول للاستنشاق/ال topical)
  //   "supplies"          → Supplies (مستلزمات طبية)
  const FORM_LABELS = {
    vial:              "Vial",
    ampule:            "Ampule",
    "prefilled-syringe":"Prefilled Syringe",
    tablet:            "Tablet",
    effervescent:      "Effervescent",
    "syrup-and-oral-drop": "OSD",
    suppository:       "Suppository",
    solution:          "Solution",
    supplies:          "Supplies"
  };
  // Short abbreviations for each form — used in the patient sheet
  // print view (left of each med line). These are simple text labels
  // (not images) so they render correctly in the print window which
  // doesn't have access to the app's image files.
  const FORM_ABBR = {
    vial:                  "V",
    ampule:                "A",
    "prefilled-syringe":   "PS",
    tablet:                "T",
    effervescent:          "EF",
    "syrup-and-oral-drop": "OSD",
    suppository:           "S",
    solution:              "Sol",
    supplies:              "Sup"
  };
  // Fluid IDs — these are IV fluids (N/S, G/S, R/L, G/W) that stay
  // in the "supplies" form category but get a special abbreviation
  // "F" (Fluids) in the patient sheet instead of "Sup".
  const FLUID_IDS = [
    "dextrose-saline",     // G/S
    "ringers-lactate",     // R/L
    "glucose-5",           // G/W
    "sodium-chloride-09",  // N/S 500ml
    "nacl-100ml"           // N/S 100ml
  ];
  // Display order — determines tab order in the bottom-sheet
  const FORM_ORDER = ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
  // Icons for each form — emoji strings or special image markers
  // 'img:vial-icon.png' means render an <img> instead of emoji text
  const FORM_ICONS = {
    vial:                "img:img/vial-icon.png",
    ampule:              "img:img/ampule-icon.png",
    "prefilled-syringe": "💉",
    tablet:              "img:img/tablet-icon.png",
    effervescent:        "🫧",
    "syrup-and-oral-drop":  "img:img/syrup-icon.png",
    suppository:         "img:img/suppository-icon.png",
    solution:            "img:img/solution-icon.png",
    supplies:            "img:img/supplies-icon.png"
  };

  // ===== DISABLED CATALOG =====
  // The old default catalog is kept here (disabled) so existing
  // patient prescriptions that reference these med IDs still have
  // a lookup entry. These meds will NOT appear in the med-selection
  // sheet (bottom-sheet) because the seed-merge logic only adds
  // DEFAULT_MEDICATIONS (below) — not this list.
  // When the user provides their new list, it will replace
  // DEFAULT_MEDICATIONS entirely.
  const DISABLED_MEDICATIONS = [];
  // ===== NEW DEFAULT CATALOG =====
  // This will be replaced with the user's new med list when they
  // provide it. For now it's empty — the old meds are disabled
  // (moved to DISABLED_MEDICATIONS above) but still available as
  // lookup entries for existing patient prescriptions.
  // The disabled meds are merged into the user's local catalog
  // as "hidden" entries so existing patient meds still resolve
  // their names + forms for the chart + patient sheet printing.
  const DEFAULT_MEDICATIONS = [
  // The ward's catalogue as it is in the cloud (copied 2026-10-18, 178 medicines).
  // The cloud stays the source of truth; this is the seed / the fallback offline.
    { id: "lasix-20mg-amp", nameTrade: "Lasix", nameAr: "لازكس", nameEn: "Furosemide", form: "ampule", defaultDose: "20mg", defaultFrequency: "1×3", nameChart: "Lasix 20mg Amp" },
    { id: "calcium-amp", nameTrade: "Calcium", nameAr: "كالسيوم", nameEn: "Calcium Gluconate", form: "ampule", defaultDose: "", defaultFrequency: "1×3", nameChart: "Calcium amp" },
    { id: "kcl-15-amp", nameTrade: "Potassium", nameAr: "بوتاسيوم", nameEn: "Potassium Chloride", form: "ampule", defaultDose: "", defaultFrequency: "1×2", nameChart: "KCl 15% amp" },
    { id: "plasil-10mg-amp", nameTrade: "Plasil", nameAr: "بلاسيل", nameEn: "Metoclopramide", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×2", nameChart: "Plasil 10mg Amp" },
    { id: "zofran-ampoule-8mg", nameTrade: "Zofran", nameAr: "زوفران", nameEn: "Ondansetron", form: "ampule", defaultDose: "8mg", defaultFrequency: "1×2", nameChart: "Zofran ampoule 8mg" },
    { id: "acupan-amp", nameTrade: "Acupan amp", nameAr: "اكيوبان", nameEn: "Nefopam", form: "ampule", defaultDose: "20mg", defaultFrequency: "1×2", nameChart: "Acupan amp" },
    { id: "vit-k-10mg-amp", nameTrade: "Vitamin K", nameAr: "فيتامين k", nameEn: "Phytonadione", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Vit. K 10mg Amp" },
    { id: "garamycin-80mg-amp", nameTrade: "Garamycin", nameAr: "غارامايسين", nameEn: "Gentamycin", form: "ampule", defaultDose: "80mg", defaultFrequency: "1×3", nameChart: "Garamycin 80mg Amp" },
    { id: "buscopan-10mg-amp", nameTrade: "Buscopan", nameAr: "بسكوبان", nameEn: "Hyoscine Butylbromide", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×3", nameChart: "Buscopan 10mg amp" },
    { id: "decadrone-8mg-amp", nameTrade: "Decadron", nameAr: "ديكادرون", nameEn: "Dexamethasone", form: "ampule", defaultDose: "8mg", defaultFrequency: "1×1", nameChart: "Decadrone 8mg Amp" },
    { id: "allermine-10mg-amp", nameTrade: "Allermine", nameAr: "الرمين", nameEn: "Chlorphenamine maleate", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Allermine 10mg Amp" },
    { id: "amlodipine-5mg-tab", nameTrade: "Amlodipine", nameAr: "املودبين", nameEn: "Amlodipine", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Amlodipine 5mg tab" },
    { id: "amaryl-2mg-tab", nameTrade: "Amaryl", nameAr: "اماريل", nameEn: "Glimepiride", form: "tablet", defaultDose: "1mg", defaultFrequency: "1×1", nameChart: "Amaryl 2mg Tab" },
    { id: "ceftrixone-1g-vial", nameTrade: "Ceftrixone", nameAr: "سفترايكزون", nameEn: "Ceftrixone", form: "vial", defaultDose: "1g", defaultFrequency: "1×2", nameChart: "Ceftrixone 1g vial" },
    { id: "meronem-1g-vial", nameTrade: "Meronem", nameAr: "ميرونيم", nameEn: "Meropenem", form: "vial", defaultDose: "1g", defaultFrequency: "1×3", nameChart: "Meronem 1g Vial" },
    { id: "meronem-500mg-vial", nameTrade: "Meronem", nameAr: "ميرونيم", nameEn: "Meropenem", form: "vial", defaultDose: "500mg", defaultFrequency: "1×2", nameChart: "Meronem 500mg Vial" },
    { id: "paracetamol-1g-vial", nameTrade: "Paracetamol", nameAr: "باراسيتامول", nameEn: "Paracetamol", form: "vial", defaultDose: "1g", defaultFrequency: "1×3", nameChart: "Paracetamol 1g vial" },
    { id: "esomprazole-40mg-vial", nameTrade: "Nexium", nameAr: "نگزيوم", nameEn: "Esomprazole", form: "vial", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Esomprazole 40mg vial" },
    { id: "omeprazole-40mg-vial", nameTrade: "Omeprazole", nameAr: "اومبرازول", nameEn: "Omeprazole", form: "vial", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Omeprazole 40mg vial", available: false },
    { id: "vancomycin-1g-vial", nameTrade: "Vancomycin", nameAr: "فانكومايسين", nameEn: "Vancomycin", form: "vial", defaultDose: "1g", defaultFrequency: "1×2", nameChart: "Vancomycin 1g vial" },
    { id: "zovirax-vial-250mg", nameTrade: "Zovirax", nameAr: "اسايكلوفير", nameEn: "Acyclovir", form: "vial", defaultDose: "250mg", defaultFrequency: "3×3", nameChart: "Zovirax vial 250mg" },
    { id: "heparin-vial", nameTrade: "Heparin", nameAr: "هيبارين", nameEn: "Heparin", form: "vial", defaultDose: "1cc", defaultFrequency: "1×2", nameChart: "Heparin vial" },
    { id: "flagyl-500mg-vial", nameTrade: "Flagyl", nameAr: "فلاجيل", nameEn: "Metronidazole", form: "vial", defaultDose: "500mg", defaultFrequency: "1×3", nameChart: "Flagyl 500mg Vial" },
    { id: "amikacin-500mg-vial", nameTrade: "Amikacin", nameAr: "اميكاسين", nameEn: "Amikacin", form: "vial", defaultDose: "500mg", defaultFrequency: "1×2", nameChart: "Amikacin 500mg Vial" },
    { id: "amitriptyline-25mg-tab", nameTrade: "Amitriptyline", nameAr: "اميتربتالين", nameEn: "Amitriptyline", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1", nameChart: "Amitriptyline 25mg tab" },
    { id: "ciprodar-200mg-vial", nameTrade: "Ciprodar", nameAr: "سبرودار", nameEn: "Ciprofloxacin", form: "vial", defaultDose: "200mg", defaultFrequency: "2×2", nameChart: "Ciprodar 200mg vial" },
    { id: "hydrocortisone-100mg-vial", nameTrade: "Hydrocortisone", nameAr: "هايدروكورتزون", nameEn: "Hydrocortisone", form: "vial", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "Hydrocortisone 100mg vial" },
    { id: "amoxil-500mg-vial", nameTrade: "Amoxicillin", nameAr: "اموكسيسيلين", nameEn: "Amoxicillin", form: "vial", defaultDose: "500mg", defaultFrequency: "2×3", nameChart: "Amoxil 500mg vial" },
    { id: "angesid-0-5mg-tab", nameTrade: "Angesid", nameAr: "انجسيد", nameEn: "Glyceryl Trinitrate", form: "tablet", defaultDose: "500mcg", defaultFrequency: "1×1", nameChart: "Angesid 0.5mg Tab" },
    { id: "angesid-10mg-ampoule", nameTrade: "Angesid", nameAr: "انجسيد", nameEn: "Glyceryl Trinitrate", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Angesid 10mg ampoule" },
    { id: "apixaban-5mg-tab", nameTrade: "Apixaban", nameAr: "ابيكزابان", nameEn: "Apixaban", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Apixaban 5mg tab" },
    { id: "clexane-syringe-4000-iu", nameTrade: "Clexane", nameAr: "كلكسان", nameEn: "Enoxaparin Sodium", form: "prefilled-syringe", defaultDose: "4000iu", defaultFrequency: "1×1", nameChart: "Clexane syringe 4000 IU" },
    { id: "clexane-syringe-6000-iu", nameTrade: "Clexane", nameAr: "كلكسان", nameEn: "Enoxaparin Sodium", form: "prefilled-syringe", defaultDose: "6000iu", defaultFrequency: "1×1", nameChart: "Clexane syringe 6000 IU" },
    { id: "erythropoietin", nameTrade: "Eprex", nameAr: "ايبركس", nameEn: "Erythropoietin", form: "prefilled-syringe", defaultDose: "4000iu", defaultFrequency: "كل 3 أيام" },
    { id: "aransip-40mcg-pfs", nameTrade: "Aranesp", nameAr: "ارانسب", nameEn: "Darbepoetin", form: "prefilled-syringe", defaultDose: "40mcg", defaultFrequency: "كل أسبوع", nameChart: "Aransip 40mcg PFS" },
    { id: "aspirin-100mg-tab", nameTrade: "Aspirin", nameAr: "اسبرين", nameEn: "Aspirin", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "Aspirin 100mg Tab" },
    { id: "noradrenaline-amp", nameTrade: "Noradrenaline", nameAr: "نورادرينالين", nameEn: "Norepinephrine", form: "ampule", defaultDose: "4mg", defaultFrequency: "1×4", nameChart: "Noradrenaline amp" },
    { id: "augmentin-625mg-tablet", nameTrade: "Augmentin", nameAr: "اوغمنتين", nameEn: "Amoxicillin/Clavulanic Acid", form: "tablet", defaultDose: "625mg", defaultFrequency: "1×3", nameChart: "Augmentin 625mg tablet" },
    { id: "avas-40mg-tab", nameTrade: "Avas", nameAr: "افاس", nameEn: "Atorvastatin", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Avas 40mg Tab" },
    { id: "azithromycin-500mg-tab", nameTrade: "Azithromycin", nameAr: "ازثرومايسين", nameEn: "Azithromycin", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1", nameChart: "Azithromycin 500mg tab" },
    { id: "n-s-100ml", nameTrade: "N/S", nameAr: "نورمال سلاين صغير", nameEn: "Normal Saline", form: "supplies", defaultDose: "100ml", defaultFrequency: "1", nameChart: "N/S 100ml" },
    { id: "n-s-500ml", nameTrade: "N/S", nameAr: "نورمال سلاين كبير", nameEn: "N/S 500ml", form: "supplies", defaultDose: "Normal Saline", defaultFrequency: "1×3", nameChart: "N/S 500ml" },
    { id: "g-w-5-500ml", nameTrade: "G/W", nameAr: "", nameEn: "Dextrose Saline", form: "supplies", defaultDose: "", defaultFrequency: "1×2", nameChart: "G/W 5% 500ml" },
    { id: "ringer-sol", nameTrade: "R/S", nameAr: "رنكر", nameEn: "Ringer's Solution", form: "supplies", defaultDose: "", defaultFrequency: "1×2", nameChart: "Ringer sol" },
    { id: "ringer-lactate", nameTrade: "R/L", nameAr: "رنكر لاكتيت", nameEn: "Ringer Lactate", form: "supplies", defaultDose: "", defaultFrequency: "1×2", nameChart: "Ringer Lactate" },
    { id: "mannitol-20", nameTrade: "Mannitol", nameAr: "", nameEn: "Mannitol 20%", form: "supplies", defaultDose: "200cc", defaultFrequency: "1×2", nameChart: "Mannitol 20%" },
    { id: "iv-set", nameTrade: "I.V. Set", nameAr: "جهاز اعطاء سوائل", nameEn: "Intravenous Set", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "IV set" },
    { id: "blood-giving-set", nameTrade: "I.V. Blood Set", nameAr: "جهاز اعطاء دم", nameEn: "Intravenous Blood Set", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Blood giving set" },
    { id: "brilinta-90mg-tab", nameTrade: "Brilinta", nameAr: "برلينتا", nameEn: "Ticagrelor", form: "tablet", defaultDose: "90mg", defaultFrequency: "1×1", nameChart: "Brilinta 90mg tab" },
    { id: "brufen-200mg-tab", nameTrade: "Brufen", nameAr: "بروفين", nameEn: "Ibuprofen", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Brufen 200mg Tab" },
    { id: "buscopan-10mg-tab", nameTrade: "Buscopan", nameAr: "بسكوبان", nameEn: "Hyoscine Butylbromide", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×3", nameChart: "Buscopan 10mg Tab" },
    { id: "calcium-500mg-tab", nameTrade: "Calcium Carbonate", nameAr: "كالسيوم", nameEn: "Calcium Carbonate", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×3", nameChart: "Calcium 500mg Tab" },
    { id: "candesartan-8mg-tab", nameTrade: "Atacand", nameAr: "اتاكاند", nameEn: "Candesartan", form: "tablet", defaultDose: "8mg", defaultFrequency: "1×1", nameChart: "Candesartan 8mg tab" },
    { id: "capoten-25mg-tab", nameTrade: "Capoten", nameAr: "كابوتين", nameEn: "Captopril", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1", nameChart: "Capoten 25mg Tab" },
    { id: "carvedilol-6-25mg-tab", nameTrade: "Carvedilol", nameAr: "كارفيديلول", nameEn: "Carvedilol", form: "tablet", defaultDose: "6.25mg", defaultFrequency: "1×2", nameChart: "Carvedilol 6.25mg Tab" },
    { id: "caspofungin-50mg-vial", nameTrade: "Caspofungin", nameAr: "كاسبوفانجين", nameEn: "Caspofungin", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Caspofungin 50mg vial" },
    { id: "cefotaxime-1g-vial", nameTrade: "Cefotaxime", nameAr: "سيفوتاكسيم", nameEn: "Cefotaxime", form: "vial", defaultDose: "1g", defaultFrequency: "1×3", nameChart: "Cefotaxime 1g vial" },
    { id: "ceftazidime-1g-vial", nameTrade: "Ceftazidime", nameAr: "سفتازديم", nameEn: "Ceftazidime", form: "vial", defaultDose: "1g", defaultFrequency: "1×3", nameChart: "Ceftazidime 1g vial" },
    { id: "ciprodar-500mg-tab", nameTrade: "Ciprodar", nameAr: "سبرودار", nameEn: "Ciprofloxacin", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×2", nameChart: "Ciprodar 500mg Tab" },
    { id: "colchicine-0-5mg-tab", nameTrade: "Colchicine", nameAr: "كولجسين", nameEn: "Colchicine", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1×1", nameChart: "Colchicine 0.5mg tab" },
    { id: "colistin-1000000-iu-vial", nameTrade: "Colistin", nameAr: "كولستين", nameEn: "Colistin", form: "vial", defaultDose: "1M", defaultFrequency: "1×1", nameChart: "Colistin 1000000 IU vial" },
    { id: "concor-5mg-tab", nameTrade: "Concor", nameAr: "كونكور", nameEn: "Bisoprolol", form: "tablet", defaultDose: "2.5mg", defaultFrequency: "1×1", nameChart: "Concor 5mg tab" },
    { id: "cordarone-150mg-amp", nameTrade: "Cordarone 150mg amp", nameAr: "كوردارون", nameEn: "Amiodarone", form: "ampule", defaultDose: "150mg", defaultFrequency: "1×1", nameChart: "Cordarone 150mg amp" },
    { id: "cordarone-200mg-tab", nameTrade: "Cordarone", nameAr: "كوردارون", nameEn: "Amiodarone", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Cordarone 200mg tab" },
    { id: "crestor-20mg-tab", nameTrade: "Crestor", nameAr: "كرستور", nameEn: "Rosuvastatin", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1", nameChart: "Crestor 20mg tab" },
    { id: "crestor-40mg-tab", nameTrade: "Crestor", nameAr: "كرستور", nameEn: "Rosuvastatin", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Crestor 40mg tab" },
    { id: "mgso4-amp", nameTrade: "MgSO4", nameAr: "", nameEn: "Magnesium Sulfate", form: "ampule", defaultDose: "2g", defaultFrequency: "1×1", nameChart: "MgSO4 amp" },
    { id: "cyclocapron-500mg-amp", nameTrade: "Cyklokapron", nameAr: "سايكلوكابرون", nameEn: "Tranexamic acid", form: "ampule", defaultDose: "500mg", defaultFrequency: "1×1", nameChart: "Cyclocapron 500mg Amp" },
    { id: "daonil-5mg-tab", nameTrade: "Daonil", nameAr: "دائونيل", nameEn: "Glibenclamide", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Daonil 5mg Tab" },
    { id: "depakine-200mg-tab", nameTrade: "Depakine", nameAr: "ديباكين", nameEn: "Sodium Valproate / Valproic Acid", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Depakine 200mg tab" },
    { id: "digoxin-250mcg-tab", nameTrade: "Digoxin", nameAr: "ديجوكسين", nameEn: "Digoxin", form: "tablet", defaultDose: "250mcg", defaultFrequency: "1×1", nameChart: "Digoxin 250mcg Tab" },
    { id: "digoxin-amp", nameTrade: "Digoxin", nameAr: "ديجوكسين", nameEn: "Digoxin", form: "ampule", defaultDose: "500mcg", defaultFrequency: "1×1", nameChart: "digoxin amp" },
    { id: "diltiazem-60mg-tab", nameTrade: "Diltiazem", nameAr: "دلتيازم", nameEn: "Diltiazem", form: "tablet", defaultDose: "60mg", defaultFrequency: "1×1", nameChart: "Diltiazem 60mg tab" },
    { id: "valium-10mg-amp", nameTrade: "Valium", nameAr: "فاليوم", nameEn: "Diazepam", form: "ampule", defaultDose: "10mg", defaultFrequency: "حسب الحاجة", nameChart: "Valium 10mg amp" },
    { id: "phenytoin-250mg-amp", nameTrade: "Phenytoin", nameAr: "فنيتوين", nameEn: "Phenytoin", form: "ampule", defaultDose: "250mg", defaultFrequency: "1×3", nameChart: "phenytoin 250mg amp" },
    { id: "venofer-2-amp", nameTrade: "Venofer", nameAr: "فينوفير", nameEn: "Iron Sucrose", form: "ampule", defaultDose: "100mg", defaultFrequency: "2×1", nameChart: "Venofer 2% Amp" },
    { id: "haloperidol-10mg-amp", nameTrade: "Haloperidol", nameAr: "هالوبيريدول", nameEn: "Haloperidol", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Haloperidol 10mg amp" },
    { id: "dobutamine-vial-250mg", nameTrade: "Dobutamine", nameAr: "دوبيوتامين", nameEn: "Dobutamine", form: "ampule", defaultDose: "250mg", defaultFrequency: "1×1", nameChart: "Dobutamine vial 250mg" },
    { id: "dopamine-200mg-amp", nameTrade: "Dopamine", nameAr: "دوبامين", nameEn: "Dopamine", form: "ampule", defaultDose: "200mg", defaultFrequency: "1×1", nameChart: "Dopamine 200mg Amp" },
    { id: "doxycycline-100mg-cap", nameTrade: "Doxydar", nameAr: "دوكسيدار", nameEn: "Doxycycline", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×2", nameChart: "Doxycycline 100mg cap" },
    { id: "dusptalin-135mg-tab", nameTrade: "Dusptalin", nameAr: "دسبتالين", nameEn: "Mebeverine Hydrochloride", form: "tablet", defaultDose: "135mg", defaultFrequency: "1×3", nameChart: "Dusptalin 135mg Tab" },
    { id: "empadil-10mg-tab", nameTrade: "Empadil", nameAr: "ايمباديل", nameEn: "Empagliflozin", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Empadil 10mg tab" },
    { id: "endoxan-500mg-vial", nameTrade: "Endoxan", nameAr: "اندوكسان", nameEn: "Cyclophosphamide", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1", nameChart: "Endoxan 500mg vial" },
    { id: "ferrofolic-cap", nameTrade: "Ferrofolic", nameAr: "فيروفولك", nameEn: "Iron / Folic acid", form: "tablet", defaultDose: "", defaultFrequency: "1×1", nameChart: "Ferrofolic cap" },
    { id: "flagyl-500mg-tab", nameTrade: "Flagyl", nameAr: "فلاجيل", nameEn: "Metronidazole", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×3", nameChart: "Flagyl 500mg Tab" },
    { id: "flamazine-1-cream", nameTrade: "Flamazine", nameAr: "فلامازين", nameEn: "Silver Sulfadiazine", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×2", nameChart: "Flamazine 1% Cream" },
    { id: "fluconazole-150mg-cap", nameTrade: "Fluconazole", nameAr: "فلوكانازول", nameEn: "Fluconazole 150mg cap", form: "tablet", defaultDose: "150mg", defaultFrequency: "1×1", nameChart: "Fluconazole 150mg cap" },
    { id: "fluoxetine-20mg-cap", nameTrade: "Fluoxetine", nameAr: "فلوكستين", nameEn: "Fluoxetine", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1", nameChart: "Fluoxetine 20mg cap" },
    { id: "folic-acid-5mg-tab", nameTrade: "Folic acid", nameAr: "فولك اسد", nameEn: "Folic acid", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Folic acid 5mg tab" },
    { id: "forxiga-10mg-tab", nameTrade: "Forxiga", nameAr: "فورزيكا", nameEn: "Dapagliflozin", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Forxiga 10mg tab" },
    { id: "fucidin-cream", nameTrade: "Fucidin", nameAr: "فيوسدين", nameEn: "Fusidic acid", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×2", nameChart: "Fucidin cream" },
    { id: "gabapentin-300mg-cap", nameTrade: "Gabapentin", nameAr: "غابابنتين", nameEn: "Gabapentin", form: "tablet", defaultDose: "300mg", defaultFrequency: "1×1", nameChart: "Gabapentin 300mg cap" },
    { id: "glucophage-500mg-tab", nameTrade: "Glucophage", nameAr: "غلوكوفيج", nameEn: "Metformin", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1", nameChart: "Glucophage 500mg Tab" },
    { id: "human-albumin-20-i-v", nameTrade: "Albumin", nameAr: "البومين", nameEn: "Human Albumin", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "Human albumin 20% I.V" },
    { id: "hypertonic-glucose-vial", nameTrade: "Hypertonic Glucose", nameAr: "هايبرتونك غلوكوز", nameEn: "Glucose 50% / Dextrose 50%", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "Hypertonic glucose vial" },
    { id: "inderal-40mg-tab", nameTrade: "Inderal", nameAr: "انيدرال", nameEn: "Propranolol", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Inderal 40mg Tab" },
    { id: "insulin-lente-vial", nameTrade: "Insulin lente", nameAr: "انسولين خابط", nameEn: "Insulin lente", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "Insulin lente vial" },
    { id: "insulin-mixtard-vial", nameTrade: "Insulin mixtard", nameAr: "انسولين مخلوط", nameEn: "Insulin mixtard", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "Insulin mixtard vial" },
    { id: "insulin-soluble-vial", nameTrade: "Regular Insulin", nameAr: "انسولين صافي", nameEn: "Insulin Soluble", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "Insulin soluble vial" },
    { id: "isordil-10mg-tab", nameTrade: "Isordil", nameAr: "ايزورديل", nameEn: "Isosorbide Dinitrate", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Isordil 10mg tab" },
    { id: "ivig-vial", nameTrade: "IVIG", nameAr: "", nameEn: "Intravenous Immunoglobulin", form: "vial", defaultDose: "", defaultFrequency: "1×1", nameChart: "IVIG vial" },
    { id: "keflex-500mg-cap", nameTrade: "Keflex", nameAr: "كيفلكس", nameEn: "Cephalexin", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×4", nameChart: "Keflex 500mg cap" },
    { id: "keppra-1000mg-tab", nameTrade: "Keppra", nameAr: "كيبرا", nameEn: "Levetiracetam", form: "tablet", defaultDose: "1000mg", defaultFrequency: "1×2", nameChart: "Keppra 1000mg tab" },
    { id: "keppra-500mg-tab", nameTrade: "Keppra", nameAr: "كيبرا", nameEn: "Levetiracetam", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×2", nameChart: "Keppra 500mg tab" },
    { id: "keppra-vial-100mg-ml", nameTrade: "Keppra vial", nameAr: "كيبرا", nameEn: "Keppra", form: "vial", defaultDose: "500mg", defaultFrequency: "1×2", nameChart: "Keppra vial 100mg/ml" },
    { id: "ketorolac-30mg-amp", nameTrade: "Ketorolac", nameAr: "كترولاك", nameEn: "Ketorolac", form: "ampule", defaultDose: "30mg", defaultFrequency: "1×1", nameChart: "Ketorolac 30mg amp" },
    { id: "lactulose-syp", nameTrade: "Lactulose", nameAr: "لاكتلوز", nameEn: "Lactulose", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×3", nameChart: "Lactulose Syp" },
    { id: "lasix-40mg-tab", nameTrade: "Lasix", nameAr: "لازكس", nameEn: "Furosemide", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Lasix 40mg Tab" },
    { id: "laxadyl-supp", nameTrade: "Laxadyl", nameAr: "لاكسديل", nameEn: "Bisacodyl", form: "suppository", defaultDose: "", defaultFrequency: "1×2", nameChart: "Laxadyl supp" },
    { id: "librium-5mg-tab", nameTrade: "Librium", nameAr: "ليبيريوم", nameEn: "chlordiazepoxide", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Librium 5mg Tab" },
    { id: "lidocaine-oint", nameTrade: "Xylocane", nameAr: "زايلوكين", nameEn: "Lidocaine", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Lidocaine oint" },
    { id: "foly-catheter", nameTrade: "Foley Catheter", nameAr: "فولي", nameEn: "Foley Catheter", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Foly catheter" },
    { id: "lisinopril-10mg-tab", nameTrade: "Lisinopril", nameAr: "ليزنوبريل", nameEn: "Lisinopril", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Lisinopril 10mg tab" },
    { id: "lorazepam-2mg-tab", nameTrade: "Lorazepam", nameAr: "لورازيبام", nameEn: "Lorazepam", form: "tablet", defaultDose: "2mg", defaultFrequency: "1×1", nameChart: "Lorazepam 2mg tab" },
    { id: "losartan-50mg-tab", nameTrade: "Losartan", nameAr: "لوسارتان", nameEn: "Losartan", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Losartan 50mg Tab" },
    { id: "mebo-oint", nameTrade: "Mebo Ointment", nameAr: "ميبو", nameEn: "Beta-sitosterol", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×2", nameChart: "Mebo oint" },
    { id: "methoprim-480mg-tab", nameTrade: "Methoprim", nameAr: "ميثوبريم", nameEn: "Trimethoprim", form: "tablet", defaultDose: "480mg", defaultFrequency: "2×2", nameChart: "Methoprim 480mg Tab" },
    { id: "methotrexate-50mg-vial", nameTrade: "Methotrexate", nameAr: "ميثوتركسيت", nameEn: "Methotrexate", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Methotrexate 50mg vial" },
    { id: "methyldopa-250mg-tab", nameTrade: "Aldomet", nameAr: "الدوميت", nameEn: "Methyldopa", form: "tablet", defaultDose: "250mg", defaultFrequency: "1×3", nameChart: "Methyldopa 250mg Tab" },
    { id: "metoprolol-100mg-tab", nameTrade: "Metoprolol", nameAr: "ميتوبرولول سكسنيت", nameEn: "Metoprolol Succinate", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "Metoprolol 100mg tab" },
    { id: "metoprolol-50mg-tab", nameTrade: "Metoprolol", nameAr: "ميتوبرولول سكسنيت", nameEn: "Metoprolol Succinate", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Metoprolol 50mg tab" },
    { id: "mobic-7-5mg-tab", nameTrade: "Mobic", nameAr: "موبك", nameEn: "Meloxicam", form: "tablet", defaultDose: "7.5mg", defaultFrequency: "1×1", nameChart: "Mobic 7.5mg Tab" },
    { id: "moxifloxacin-400mg-tab", nameTrade: "Moxifloxacin", nameAr: "موكسيفلوكساسين", nameEn: "Moxifloxacin", form: "tablet", defaultDose: "400mg", defaultFrequency: "1×1", nameChart: "Moxifloxacin 400mg tab" },
    { id: "ng-tube", nameTrade: "NG Tube", nameAr: "ان جي", nameEn: "NG Tube", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "NG Tube" },
    { id: "nimodipine-30mg-tab", nameTrade: "Nimodipine", nameAr: "نيمودبين", nameEn: "Nimodipine", form: "tablet", defaultDose: "30mg", defaultFrequency: "1×1", nameChart: "Nimodipine 30mg Tab" },
    { id: "nystatin-susp", nameTrade: "Nystatin", nameAr: "نستاتين", nameEn: "Nystatin", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×4", nameChart: "Nystatin Susp" },
    { id: "octreotide-amp", nameTrade: "Octreotide", nameAr: "اوكتريوتايد", nameEn: "Octreotide", form: "ampule", defaultDose: "", defaultFrequency: "1×1", nameChart: "Octreotide amp" },
    { id: "olan-5mg-tab", nameTrade: "Olan", nameAr: "اولان", nameEn: "Olanzapine", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Olan 5mg tab" },
    { id: "omeprazole-20mg-cap", nameTrade: "Omeprazole", nameAr: "اومبرازول", nameEn: "Omeprazole", form: "tablet", defaultDose: "20mg", defaultFrequency: "2×1", nameChart: "Omeprazole 20mg cap" },
    { id: "one-alpha-1mg-cap", nameTrade: "One alpha", nameAr: "ون الفا", nameEn: "Alfacalcidol", form: "tablet", defaultDose: "1mg", defaultFrequency: "1×1", nameChart: "One alpha 1mg cap" },
    { id: "pantaprazole-40mg-cap", nameTrade: "Pantaprazole", nameAr: "بانتوبرازول", nameEn: "Pantaprazole", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1", nameChart: "Pantaprazole 40mg cap" },
    { id: "paracetamol-500mg-tab", nameTrade: "Paracetamol", nameAr: "باراسيتامول", nameEn: "Paracetamol", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×3", nameChart: "Paracetamol 500mg Tab" },
    { id: "plasil-10mg-tab", nameTrade: "Plasil", nameAr: "بلاسيل", nameEn: "Metoclopramide", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1", nameChart: "Plasil 10mg tab" },
    { id: "plavix-75mg-tab", nameTrade: "Plavix", nameAr: "بلافكس", nameEn: "Clopidogrel", form: "tablet", defaultDose: "75mg", defaultFrequency: "1×1", nameChart: "Plavix 75mg tab" },
    { id: "prednisolone-5mg-tab", nameTrade: "Prednisolone", nameAr: "بريدنيزولون", nameEn: "Prednisolone", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Prednisolone 5mg Tab" },
    { id: "pulmicort-0-5-mg-nebulizer", nameTrade: "Pulmicort", nameAr: "بلموكورت", nameEn: "Budesonide", form: "solution", defaultDose: "", defaultFrequency: "1×2", nameChart: "Pulmicort 0.5 mg nebulizer" },
    { id: "risperidone-2mg-tab", nameTrade: "Risperdal", nameAr: "ريسبيريدال", nameEn: "Risperidone", form: "tablet", defaultDose: "2mg", defaultFrequency: "1×1", nameChart: "Risperidone 2mg tab" },
    { id: "sevelamer-800mg-tab", nameTrade: "Sevelamer", nameAr: "سيفيلامير", nameEn: "Sevelamer", form: "tablet", defaultDose: "800mg", defaultFrequency: "1×3", nameChart: "Sevelamer 800mg Tab" },
    { id: "sinemet-tab", nameTrade: "Sinemet Tab", nameAr: "سيناميت", nameEn: "Levodopa/Carbidopa", form: "tablet", defaultDose: "25/250mg", defaultFrequency: "1×1", nameChart: "Sinemet Tab" },
    { id: "sitagliptin-100mg-tab", nameTrade: "Sitagliptin", nameAr: "سيتاغليبتين", nameEn: "Sitagliptin", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "Sitagliptin 100mg tab" },
    { id: "solumedrol-500mg-vial", nameTrade: "Solumedrol", nameAr: "سولومدرول", nameEn: "Methylprednisolone", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1", nameChart: "Solumedrol 500mg vial" },
    { id: "solvodin-4mg-5ml-syp", nameTrade: "Solvodin", nameAr: "سولفودين", nameEn: "Bromhexine Hydrochloride", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×3", nameChart: "Solvodin 4mg/5ml Syp" },
    { id: "spironolactone-tab-100mg", nameTrade: "Aldactone", nameAr: "الداكتون", nameEn: "Spironolactone", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "spironolactone tab 100mg" },
    { id: "spironolactone-tab-25mg", nameTrade: "Aldactone", nameAr: "الداكتون", nameEn: "Spironolactone", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1", nameChart: "spironolactone tab 25mg" },
    { id: "stugeron-25mg-tab", nameTrade: "Stugeron", nameAr: "ستوجيرون", nameEn: "Cinnarizine", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1", nameChart: "Stugeron 25mg Tab" },
    { id: "symbicort-turbuhaler", nameTrade: "Symbicort", nameAr: "سيمبيكورت", nameEn: "Budesonide/Formoterol", form: "solution", defaultDose: "", defaultFrequency: "1×1", nameChart: "Symbicort turbuhaler" },
    { id: "urine-bag", nameTrade: "Urine bag", nameAr: "كيس ادرار", nameEn: "Urine bag", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Urine bag" },
    { id: "cannula", nameTrade: "Cannula", nameAr: "كانيولا", nameEn: "Cannula", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "كانيولا" },
    { id: "1cc-syringe", nameTrade: "1cc Syringe", nameAr: "سرنجة 1 سيسي", nameEn: "1cc Syringe", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "سرنجة 1 سيسي" },
    { id: "5cc-syringe", nameTrade: "5cc Syringe", nameAr: "سرنجة 5 سيسي", nameEn: "5cc Syringe", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "سرنجة ٥ سيسي" },
    { id: "syringe-10cc", nameTrade: "10cc Syringe", nameAr: "", nameEn: "Syringe", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Syringe 10cc" },
    { id: "syringe-20cc", nameTrade: "20cc Syringe", nameAr: "", nameEn: "Syringe", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Syringe 20cc" },
    { id: "syringe-50cc", nameTrade: "50cc Syringe", nameAr: "", nameEn: "Syringe", form: "supplies", defaultDose: "", defaultFrequency: "1", nameChart: "Syringe 50cc" },
    { id: "tazocin-vial", nameTrade: "Tazocin", nameAr: "تازوسين", nameEn: "Piperacillin/Tazobactam", form: "vial", defaultDose: "4.5g", defaultFrequency: "1×4", nameChart: "Tazocin vial" },
    { id: "ambisome-50mg-vial", nameTrade: "Amphotericin", nameAr: "امفوترسين", nameEn: "Amphotericin B", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "AmBisome 50mg vial" },
    { id: "tegretol-200mg-tab", nameTrade: "Tegretol", nameAr: "تيكريتول", nameEn: "Carbamazepine", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Tegretol 200mg Tab" },
    { id: "thyroxine-100mg-tab", nameTrade: "Thyroxine", nameAr: "ثايروكسين", nameEn: "Levothyroxine", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1", nameChart: "Thyroxine 100mg tab" },
    { id: "thyroxine-50mg-tab", nameTrade: "Thyroxine", nameAr: "ثايروكسين", nameEn: "Levothyroxine", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Thyroxine 50mg tab" },
    { id: "tigecycline-vial-500mg", nameTrade: "Tigecycline", nameAr: "تيكاسايكلين", nameEn: "Tigecycline", form: "vial", defaultDose: "50mg", defaultFrequency: "1×2", nameChart: "Tigecycline vial 500mg" },
    { id: "tpn-i-v-infusion", nameTrade: "TPN", nameAr: "كيس التغذية الوريدية", nameEn: "TPN bage", form: "solution", defaultDose: "", defaultFrequency: "1×1", nameChart: "TPN I.V. infusion" },
    { id: "urso-300mg-cap", nameTrade: "Urso", nameAr: "اورسو", nameEn: "Ursodeoxycholic Acid", form: "tablet", defaultDose: "300mg", defaultFrequency: "1×1", nameChart: "Urso 300mg cap" },
    { id: "valium-5mg-tab", nameTrade: "Valium", nameAr: "فاليوم", nameEn: "Diazepam", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Valium 5mg Tab" },
    { id: "vastarel-35mg-mr", nameTrade: "Vastarel", nameAr: "فاستريل", nameEn: "Trimetazidine", form: "tablet", defaultDose: "35mg", defaultFrequency: "1×1", nameChart: "Vastarel 35mg MR" },
    { id: "voltarin-75mg-amp", nameTrade: "Voltarin", nameAr: "فولتارين", nameEn: "Diclofenac Sodium", form: "ampule", defaultDose: "75mg", defaultFrequency: "1×1", nameChart: "Voltarin 75mg Amp" },
    { id: "isoptin-5mg-amp", nameTrade: "Isoptin", nameAr: "ايزوبتين", nameEn: "Verapamil", form: "ampule", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Isoptin 5mg Amp" },
    { id: "adrenaline-amp-1mg", nameTrade: "Adrenaline", nameAr: "ادرينالين", nameEn: "Adrenaline", form: "ampule", defaultDose: "1mg", defaultFrequency: "1×1", nameChart: "Adrenaline amp 1mg" },
    { id: "ventolin-inhalation", nameTrade: "Ventolin", nameAr: "فنتولين", nameEn: "Salbutamol", form: "solution", defaultDose: "", defaultFrequency: "1×4", nameChart: "Ventolin inhalation" },
    { id: "voltarin-25mg-tab", nameTrade: "Voltarin", nameAr: "فولتارين", nameEn: "Diclofenac", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1", nameChart: "Voltarin 25mg Tab" },
    { id: "atropine-1mg-amp", nameTrade: "Atropine", nameAr: "اتروبين", nameEn: "Atropine", form: "ampule", defaultDose: "1mg", defaultFrequency: "1×1", nameChart: "Atropine 1mg amp" },
    { id: "aminophylline-250mg-amp", nameTrade: "Aminophylline", nameAr: "الرمين", nameEn: "Aminophylline", form: "ampule", defaultDose: "250mg", defaultFrequency: "1×1", nameChart: "Aminophylline 250mg amp" },
    { id: "hydralazine-amp", nameTrade: "Hydralazine", nameAr: "", nameEn: "Hydralazine", form: "ampule", defaultDose: "", defaultFrequency: "1×1", nameChart: "Hydralazine amp" },
    { id: "metoprolol-amp", nameTrade: "Betaloc", nameAr: "بيتالوك", nameEn: "Metoprolol Tartrate", form: "ampule", defaultDose: "5mg", defaultFrequency: "1×1", nameChart: "Metoprolol amp" },
    { id: "luminal-200mg-amp", nameTrade: "Luminal", nameAr: "لومينال", nameEn: "Phenobarbital", form: "ampule", defaultDose: "200mg", defaultFrequency: "1×1", nameChart: "Luminal 200mg Amp" },
    { id: "largactil-50mg-amp", nameTrade: "Largactil", nameAr: "لارجكتيل", nameEn: "Chlorpromazine", form: "ampule", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "Largactil 50mg Amp" },
    { id: "mtx-50mg-amp", nameTrade: "MTX", nameAr: "", nameEn: "Methotrexate", form: "ampule", defaultDose: "50mg", defaultFrequency: "1×1", nameChart: "MTX 50mg amp" },
    { id: "methergin-amp", nameTrade: "Methergin", nameAr: "مثرجين", nameEn: "Methylergometrine", form: "ampule", defaultDose: "", defaultFrequency: "1×1", nameChart: "Methergin amp" },
    { id: "voriconazole-200mg-tab", nameTrade: "Voriconazole", nameAr: "فوريكانازول", nameEn: "Voriconazole", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Voriconazole 200mg tab" },
    { id: "voriconazole-vial-200mg", nameTrade: "Voriconazole", nameAr: "فوريكانازول", nameEn: "Voriconazole", form: "vial", defaultDose: "200mg", defaultFrequency: "1×2", nameChart: "Voriconazole vial 200mg" },
  ];

  // Bump this number whenever you add new medications to
  // DEFAULT_MEDICATIONS and want existing users to receive them on
  // their next app open. The storage layer compares this version to
  // the user's `pharma.catalog.seed.v1` localStorage key; if the
  // version is higher, missing meds are merged into the user's
  // saved catalog (one-time, then the stamp is updated).
  //
  // History:
  //   v1 = added 24 new meds (Amoxycillin, Ceftazidime, etc.) +
  //        NaCl 100ml + 5cc Syringe auto-add rule + 14 supplies
  //   v2 = added non-daily frequencies (كل يومين, كل 3 أيام, كل أسبوع) +
  //        changed vancomycin default frequency to 'كل يومين' +
  //        changed vancomycin default dose to 'حسب البروتوكول'
  //   v8 = user's full 235-med list re-added with full names (form kept)
  const DEFAULT_MEDICATIONS_VERSION = 9;

  // ---- Non-daily frequency helpers ----
  // Maps a non-daily frequency string to the number of days between
  // doses. Returns 0 for daily frequencies (1×N) and custom text.
  const NON_DAILY_INTERVALS = {
    "كل يومين":  2,   // every 2 days
    "كل 3 أيام": 3,   // every 3 days
    "كل أسبوع":  7    // every week
  };

  // ---- Dose summation helper (sumDose) ----
  // تجمع قيمة الجرعة بناءً على معامل التكرار وتبسّط الوحدة.
  // مثال: sumDose("500mg", "2×1") → "1g ×1"
  //       sumDose("250mg", "2×3") → "500mg ×3"
  //       sumDose("100mcg", "3×1") → "300mcg ×1"
  //       sumDose("1g", "2×1")     → "2g ×1"
  //
  // المنطق:
  //   1) نحلّل الجرعة إلى (قيمة رقمية + وحدة)
  //   2) نحلّل التكرار إلى (معامل N + مرات في اليوم M)
  //   3) نضرب: القيمة × N
  //   4) نبسّط الوحدة للأعلى إذا تجاوزت 1000 (mcg→mg→g→kg, mL→L)
  //   5) نعيد النتيجة بصيغة "{قيمة}{وحدة} ×{مرات في اليوم}"
  //
  // حالات خاصة:
  //   - التكرار غير يومي ("كل أسبوع") أو غير رقمي ("حسب القياس")
  //     → نعيد الجرعة + التكرار كما هما (لا يمكن جمعهما)
  //   - الجرعة غير قابلة للتحليل (نص حر مثل "حسب الخطة")
  //     → نعيد معامل التكرار فقط "N×M"
  //   - الجرعة أو التكرار فارغ → نعيد النص غير الفارغ فقط
  const UNIT_STEPS = {
    // الكتلة (mass)
    "mcg": { up: 1000, next: "mg" },
    "mg":  { up: 1000, next: "g"  },
    "g":   { up: 1000, next: "kg" },
    // الحجم (volume)
    "ml":  { up: 1000, next: "L"  },
    "l":   { up: null,  next: null }
  };

  // يحلّل نص الجرعة إلى {value, unit}. يعيد null إذا لم يطابق النمط.
  // يقبل: "500mg", "1g", "0.5mg", "250mcg", "5%", "1000"
  // يرفض: "حسب الخطة", "1-2g", "mg/kg", "5mg/5ml"
  function parseDose(dose) {
    if (dose == null) return null;
    const s = String(dose).trim();
    if (!s) return null;
    const m = s.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z%µμ]+)?$/i);
    if (!m) return null;
    return {
      value: parseFloat(m[1]),
      unit: (m[2] || "").toLowerCase()
    };
  }

  // يبسّط الوحدة للأعلى طالما القيمة ≥ 1000 ولها وحدة أكبر.
  // مثال: 1000mg → 1g, 1500mcg → 1.5mg, 2000g → 2kg
  function normalizeUp(value, unit) {
    let v = value;
    let u = unit;
    while (UNIT_STEPS[u] && UNIT_STEPS[u].up && v >= UNIT_STEPS[u].up) {
      v = v / UNIT_STEPS[u].up;
      u = UNIT_STEPS[u].next;
    }
    return { value: v, unit: u };
  }

  // ينسّق الرقم: 1.0 → "1", 1.5 → "1.5", 0.5 → "0.5"
  function formatDoseNumber(n) {
    if (Number.isInteger(n)) return String(n);
    return parseFloat(n.toFixed(3)).toString();
  }

  function sumDose(dose, freq) {
    const d = (dose == null) ? "" : String(dose).trim();
    const f = (freq == null)  ? "" : String(freq).trim();
    if (!d && !f) return "";
    if (!d) return f;
    if (!f) return d;

    // التكرار غير اليومي → لا يمكن جمعه، أعد النصين كما هما
    if (NON_DAILY_INTERVALS[f]) return d + " " + f;

    // حاول تحليل "N×M" أو "NxM" (N قد يكون نصف حبة: ½×2)
    const pf = parseFreq(f);
    let multiplier = 1, timesPerDay = 1;
    if (pf) {
      multiplier = pf.n;
      timesPerDay = pf.m;
    } else {
      // رقم مفرد؟ مثل "3" → نُعامله كـ 3×1
      const singleN = parseInt(f, 10);
      if (!isNaN(singleN) && singleN > 0) {
        multiplier = singleN;
        timesPerDay = 1;
      } else {
        // تكرار غير رقمي ("حسب القياس", "حسب الحاجة"...) → أعد النصين
        return d + " " + f;
      }
    }

    // حاول تحليل الجرعة
    const parsed = parseDose(d);
    if (!parsed) {
      // جرعة غير قابلة للتحليل → أعد معامل التكرار فقط
      return formatN(multiplier) + "×" + timesPerDay;
    }

    // اضرب القيمة في المعامل
    let value = parsed.value * multiplier;
    let unit = parsed.unit;

    // بسّط الوحدة للأعلى إن أمكن
    if (UNIT_STEPS[unit]) {
      const normalized = normalizeUp(value, unit);
      value = normalized.value;
      unit = normalized.unit;
    }

    // النتيجة النهائية: "1g ×1"
    return formatDoseNumber(value) + unit + " ×" + timesPerDay;
  }

  // Returns the interval (in days) for a frequency string.
  //   "1×3"       → 0 (daily, 3 times per day)
  //   "كل يومين"  → 2 (every 2 days)
  //   "كل أسبوع"  → 7 (every week)
  //   "حسب القياس" → 0 (custom — treat as daily for chart purposes)
  function getFrequencyInterval(freq) {
    if (!freq) return 0;
    if (NON_DAILY_INTERVALS[freq]) return NON_DAILY_INTERVALS[freq];
    // "1×N" or plain "N" → daily (interval = 0)
    if (/×\s*\d+/.test(freq) || /^\d+$/.test(freq)) return 0;
    return 0; // custom → treat as daily
  }

  // Returns true if the med is "due today" — i.e. the patient should
  // receive this medication today based on the dosing interval + the
  // date the med was first prescribed.
  //
  // For daily meds (interval = 0): always due → returns true.
  // For non-daily meds (interval > 0): calculates the day number
  // since firstMedDate. If (dayNumber % interval) === 0 → due today.
  //
  // Parameters:
  //   freq        — the frequency string (e.g. "1×3", "كل يومين")
  //   firstMedDate — ISO date string of when the med was first prescribed
  //                  (optional — if missing, defaults to "always due")
  function isMedDueToday(freq, firstMedDate) {
    const interval = getFrequencyInterval(freq);
    if (interval === 0) return true;  // daily med → always due
    if (!firstMedDate) return true;    // no start date → assume due
    try {
      const start = new Date(firstMedDate);
      start.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor((now - start) / 86400000);
      if (daysSinceStart < 0) return false; // med hasn't started yet
      return (daysSinceStart % interval) === 0;
    } catch (e) {
      return true;  // date parse error → assume due
    }
  }

  global.PharmacyMedications = {
    FREQUENCIES,
    SINGLE_DOSE_FREQS,
    ADMIN_MODES, medMode, medFrequency, isLegacyModeFreq,
    parseFreq,
    formatN,
    FORM_LABELS,
    FORM_ABBR,
    FLUID_IDS,
    FORM_ORDER,
    FORM_ICONS,
    DEFAULT_MEDICATIONS,
    DEFAULT_MEDICATIONS_VERSION,
    DISABLED_MEDICATIONS,
    NON_DAILY_INTERVALS,
    getFrequencyInterval,
    isMedDueToday,
    sumDose,
    parseDose,
    normalizeUp
  };
})(window);
