// Daily quantities of the medicines — "N×M" → pieces a day (the ward's order numbers, the private-ward form, the
// critical-medicines table, the handover). There is no target chart any more: nothing is sent from here.
// (File name kept: other modules read window.PharmacyChartBridge.)

(function (global) {
  "use strict";

  /* ================= الكميات اليومية ================= */

  /* ===== استثناءات الكمية في الجارت =====
     خريطة تربط مُعرّف الدواء (med id) بالكمية الثابتة المطلوبة
     في الجارت الهدف، بغضّ النظر عن التكرار المكتوب في الروشتة.

     السبب: بعض الأدوية تأتي في زجاجات كبيرة (vial) تكفي لعدة
     جرعات يومية، فلا يكون التكرار (عدد المرات) مساوياً لعدد
     القطع المطلوبة فعلياً.

     مثال — الهيبارين:
       الزجاجة = 5cc
       الجرعة المعتادة = 1cc × 4 (أي 4 جرعات × 1cc = 4cc يومياً)
       الكمية الفعلية المطلوبة = 1 زجاجة (تكفي 5cc ≥ 4cc)

     لذا نُرسل "1" دائماً للجارت، حتى لو كتب الطبيب 2cc × 2 أو
     أي تكرار آخر — لأن زجاجة واحدة تكفي الحاجة اليومية.

     لإضافة استثناء آخر لاحقاً: أضف عنصراً جديداً هنا بالصيغة:
       "<med-id>": "<الكمية المطلوبة>"
  */
  // Supplies distributed from the supply-order modal (app.js SUPPLY_RULES)
  // → their names in the chart app's medicine list (most of them are not
  // in our catalogue, and the chart drops names it doesn't know).
  const SUPPLY_CHART_NAMES = {
    "dextrose-saline":    "G/S 5%",
    "ringers-lactate":    "Ringer Lactate",
    "glucose-5":          "G/W 5% 500ml",
    "sodium-chloride-09": "N/S 500ml",
    "nacl-100ml":         "N/S 100ml",
    "iv-set":             "IV set",
    "blood-iv-set":       "Blood giving set",
    "cannula":            "كانيولا",
    "syringe-1cc":        "سرنجة 1 سيسي",
    "syringe-5cc":        "سرنجة ٥ سيسي",
    "syringe-10cc":       "Syringe 10cc",
    "syringe-20cc":       "Syringe 20cc",
    "syringe-50cc":       "Syringe 50cc",
    "urine-bag":          "Urine bag",
    "ng-tube-14":         "NG Tube",
    "floy-14":            "Foly catheter"
  };

  // Container forms: one bottle / tube / drops lasts the day however often
  // it is used — the chart gets 1 whatever the frequency ("1×3" = used 3
  // times a day, not 3 pieces). OSD = syrups, drops, ointments. Of the
  // solutions (creams, topical / inhalation / nebulizer solutions) ONLY
  // Ventolin is one container a day; every other solution is requested by
  // its frequency like any other medicine (the user's rule).
  const ONE_CONTAINER_FORMS = ["syrup-and-oral-drop"];
  function catalogEntry(medId) {
    const App = global.PharmacyApp;
    const list = (App && App.state && App.state.medications) || [];
    return list.find(x => x && x.id === medId) || null;
  }
  function catalogForm(medId) {
    const m = catalogEntry(medId);
    return m ? m.form : "";
  }
  function isVentolin(medId) {
    if (/ventolin|salbutamol/i.test(String(medId || ""))) return true;
    const m = catalogEntry(medId);
    return !!m && /ventolin|salbutamol|فنتولين/i.test([m.nameTrade, m.nameEn, m.nameAr].join(" "));
  }
  function isContainer(medId, form) {
    const f = form || catalogForm(medId);
    if (ONE_CONTAINER_FORMS.indexOf(f) !== -1) return true;
    return f === "solution" && isVentolin(medId);
  }

  /* Order of the medicines — in the chart's columns and in «الطلبية»:
       1. antibiotics (whatever their form)
       2. tablets, syrups / drops / ointments, suppositories, solutions
       3. prefilled syringes
       4. the other ampoules, then vials
       5. supplies
     Inside a group: by form (as listed), then by name. Inside the antibiotics
     the injectables come first (vials, ampoules, prefilled syringes), then
     tablets, syrups, suppositories, solutions. */
  const ORDER_GROUPS = [
    { key: "antibiotic", label: "المضادات الحيوية" },
    { key: "oral",       label: "الحبوب والشرابات والمراهم والتحاميل والمحاليل" },
    { key: "pfs",        label: "السرنجات الجاهزة" },
    { key: "inj",        label: "الأمبولات والفيالات" },
    { key: "supplies",   label: "المستلزمات" }
  ];
  const FORM_RANK = { tablet: 0, effervescent: 1, "syrup-and-oral-drop": 2, suppository: 3, solution: 4, ampule: 0, vial: 1 };
  const ANTIBIOTIC_FORM_RANK = { vial: 0, ampule: 1, "prefilled-syringe": 2, tablet: 3, effervescent: 4, "syrup-and-oral-drop": 5, suppository: 6, solution: 7 };
  // med: catalogue entry (or the patient's copy) → { group: index into ORDER_GROUPS, rank }
  function orderRank(med) {
    const m = med || {};
    const form = m.form || "";
    const Clin = global.PharmacyClinical;
    const probe = { id: m.id, nameTrade: m.nameTrade || "", nameAr: m.nameAr || "", nameEn: ((m.nameEn || "") + " " + (m.nameChart || "")).trim() };
    let g;
    if (form === "supplies" || m.category === "supplies") g = 4;
    else if (Clin && Clin.isAntibiotic && Clin.isAntibiotic(probe)) g = 0;
    else if (form === "prefilled-syringe") g = 2;
    else if (["tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution"].indexOf(form) !== -1) g = 1;
    else g = 3;
    const table = g === 0 ? ANTIBIOTIC_FORM_RANK : FORM_RANK;
    return { group: g, rank: Object.prototype.hasOwnProperty.call(table, form) ? table[form] : 9 };
  }
  function compareOrder(a, b) {
    return (a.group - b.group) || (a.rank - b.rank) || String(a.name || "").localeCompare(String(b.name || ""));
  }

  const CHART_QTY_EXCEPTIONS = {
    "heparin-vial": "1"   // Heparin 5cc vial — always request 1 piece
  };

  /* ⚠️ collectPatientsFromApp() — جمع المرضى من بيانات التطبيق
     نستخدم نفس البيانات التي يمر عليها زر الطباعة عندنا:
     - نمر على كل غرف الـ Ward.ROOMS وكل سرير فيها
     - لو السرير مشغول (له اسم) نجمعه + أدويته
     - نحول كل دواء إلى {name, freq} باستخدام getLabel للأسماء الإنجليزية

     Optionally accepts a `supplyDistribution` map (supplyId →
     { bedKey: freq }) so the supplies the user just distributed via
     the supply-order modal are injected into each patient's meds
     list — same way the med-summary modal does it. */
  // Albumin sometimes needs Lasix ampoules with it (a few more than the patient's own Lasix order):
  // med.lasixExtra on the albumin medicine = that many extra Lasix 20mg ampoules a day, added to the
  // Lasix quantity sent to the chart (the Lasix order itself is never changed).
  const LASIX_ID = "lasix-20mg-amp";

  // Tigecycline: the first dose of the first day is a double dose (100 mg = 2 vials), the next ones 1 vial (50 mg) —
  // like the Lasix that goes with albumin, the pharmacist sets the EXTRA vials on the medicine card (med.extraVial, «فيالة زائدة»);
  // they are added to the ordinary quantity (1×2 + 1 = 3 vials) — on the FIRST day of the course only (the field shows only then,
  // and the number is ignored from day 2 on).
  const isTigecycline = (m) => /tigecycline|tigacycline/i.test([m && m.id, m && m.nameEn, m && m.nameTrade, m && m.nameChart].join(" "));
  function extraVialOf(pm, patient) {
    if (!pm || !isTigecycline(pm)) return 0;
    const Clin = global.PharmacyClinical;
    if (!(Clin && Clin.abxDay && Clin.abxDay(pm, patient) === 1)) return 0;
    const n = parseInt(pm.extraVial, 10);
    return n > 0 ? n : 0;
  }
  function isAlbuminMed(pm) { return !!(pm && /albumin/i.test(String(pm.id || ""))); }
  function lasixExtraOf(patient) {
    let n = 0;
    ((patient && patient.medications) || []).forEach(pm => {
      if (isAlbuminMed(pm)) n += parseInt(pm.lasixExtra, 10) || 0;
    });
    return n;
  }

  /* تحويل التكرار إلى الكمية اليومية المكتوبة في خانة الجارت
     الكمية = حاصل ضرب الرقمين (عدد الوحدات بالجرعة × عدد المرات):
       "1×3" → "3"  /  "3x1" → "3"  /  "2×2" → "4"  /  "3" → "3"
     نطابق أنماط: N×M (حرف x أو ×) أو رقم مفرد

     للتكرارات غير اليومية (كل يومين، كل 3 أيام، كل أسبوع) نعيد
     النص كما هو حتى يظهر في الجارت بشكل واضح أن هذا الدواء
     ليس يومياً. */
  // Infusion over 24 h / a single bolus → one preparation a day
  function isSingleDose(freq) {
    const Meds = global.PharmacyMedications || {};
    return (Meds.SINGLE_DOSE_FREQS || ["Infusion 24h", "Bolus"]).indexOf(String(freq || "").trim()) !== -1;
  }

  function freqToDose(freq) {
    if (!freq) return "1";
    if (isSingleDose(freq)) return "1";
    // Non-daily frequencies → return the interval text as-is
    const Meds = global.PharmacyMedications || {};
    const getInterval = Meds.getFrequencyInterval || function() { return 0; };
    if (getInterval(freq) > 0) return freq;
    const nm = parseNM(freq);
    if (nm) return String(Math.ceil(nm.n * nm.m));  // pieces to dispense
    const n = parseInt(freq, 10);
    if (!isNaN(n) && n > 0) return String(n);
    return "1";   // القيمة الافتراضية للتكرارات غير الرقمية (مثل "حسب القياس")
  }

  // Daily quantity of one med as a number — the same value the chart
  // receives (quantity exceptions included): null only for non-daily
  // frequencies (every 2 days…); word frequencies count as 1. Used by the
  // review list before sending.
  // "N×M" incl. half tablets ("½×2") — medications.js parseFreq when loaded
  function parseNM(freq) {
    const Meds = global.PharmacyMedications || {};
    if (Meds.parseFreq) return Meds.parseFreq(freq);
    const m = String(freq).match(/(\d+)\s*[x×]\s*(\d+)/i);
    return m ? { n: parseInt(m[1], 10), m: parseInt(m[2], 10) } : null;
  }

  function dailyQuantity(medId, freq, form) {
    if (medId && Object.prototype.hasOwnProperty.call(CHART_QTY_EXCEPTIONS, medId)) {
      return parseInt(CHART_QTY_EXCEPTIONS[medId], 10);
    }
    if (isContainer(medId, form)) return 1;
    if (!freq) return null;
    if (isSingleDose(freq)) return 1;
    const Meds = global.PharmacyMedications || {};
    const getInterval = Meds.getFrequencyInterval || function() { return 0; };
    if (getInterval(freq) > 0) return null;
    const nm = parseNM(freq);
    if (nm) return Math.ceil(nm.n * nm.m);          // ½×1 → 1 whole tablet a day
    const n = parseInt(freq, 10);
    // "حسب الحاجة" / "حسب القياس"…: 1, the same as what the chart receives
    return !isNaN(n) && n > 0 ? n : 1;
  }

  // the quantity (text) the chart receives for one collected medicine — extra Lasix with albumin included
  function medQty(m) {
    let q;
    if (m.id && Object.prototype.hasOwnProperty.call(CHART_QTY_EXCEPTIONS, m.id)) q = CHART_QTY_EXCEPTIONS[m.id];
    else q = isContainer(m.id, m.form) ? "1" : freqToDose(m.freq);
    if (m.extraQty) {
      const base = m.onlyExtra ? 0 : parseInt(q, 10);
      q = String((isNaN(base) ? 0 : base) + m.extraQty);
    }
    return q;
  }

  /* الزر — يُربط في app.js */
  /* ---- Exports ---- */
  global.PharmacyChartBridge = {
    medQty,
    ONE_CONTAINER_FORMS,
    SUPPLY_CHART_NAMES,
    ORDER_GROUPS, orderRank, compareOrder,
    freqToDose,
    dailyQuantity,
    lasixExtraOf,
    extraVialOf,
    LASIX_ID,
    CHART_QTY_EXCEPTIONS
  };

})(window);
