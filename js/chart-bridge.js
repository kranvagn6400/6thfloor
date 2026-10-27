// Chart Bridge — sends patient data to the external "جارت الجارت" app
// ============================================================
// Based on the user's snippet — collects occupied patients from the
// app's state (same data the chart-print button uses), builds a TSV
// table (med names as columns, patients as rows, doses as cells),
// and opens the external جارت الجارت URL with the TSV encoded in the
// hash fragment. The جارت الجارت app reads the hash, decodes the
// TSV, and auto-fills its grid.
//
// NOTE: CHART_URL is currently a placeholder. Replace it with the
// actual URL you use daily to open جارت الجارت.

(function (global) {
  "use strict";

  /* ================= جسر الجارت ================= */
  const CHART_URL = "https://clinical-pharmacy-app.onrender.com/";

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
  function collectPatientsFromApp(state, supplyDistribution, unit) {
    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS || !state || !state.patients) return [];

    // Build a supply catalog lookup so we can get the supply's
    // English name + the supply-id → bedKey → freq mapping.
    const supplyCatalog = {};
    (state.medications || []).forEach(m => {
      if (m && m.id && (m.form === "supplies" || m.category === "supplies")) {
        supplyCatalog[m.id] = m;
      }
    });

    const out = [];
    Ward.ROOMS.filter(r => !unit || r.unit === unit).forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        const meds = (Array.isArray(p.medications) ? p.medications : [])
          .filter(pm => pm && pm.id !== "syringe-5cc")
          .map(pm => {
            const catalog = (state.medications || []).find(m => m && m.id === pm.id);
            const source = catalog || pm;
            // Only medicines with «اسم الدواء في الجارت» (nameChart) are sent —
            // a medicine without one is never sent (the user's rule; the chart
            // would drop an unknown name anyway)
            const name = String(source.nameChart || "").trim();
            if (!name) return null;
            const freq = pm.frequency || (catalog ? catalog.defaultFrequency : "") || "";
            // Include the med id so buildChartTSV can look it up in
            // CHART_QTY_EXCEPTIONS (e.g. heparin-vial → always "1").
            return Object.assign({ id: pm.id, name: name, freq: freq, form: source.form || pm.form || "" }, orderRank(source));
          })
          .filter(Boolean);

        // Inject distributed supplies as additional "meds" so the
        // جارت الجارت chart shows them with their frequencies.
        // supplyDistribution: { supplyId: { bedKey: freq, ... }, ... }
        if (supplyDistribution && typeof supplyDistribution === "object") {
          Object.keys(supplyDistribution).forEach(supplyId => {
            const dist = supplyDistribution[supplyId];
            if (!dist || typeof dist !== "object") return;
            const freq = dist[key];  // frequency assigned to THIS patient
            if (!freq) return;       // this patient didn't get this supply
            const catalog = supplyCatalog[supplyId];
            const name = (catalog && catalog.nameChart) || SUPPLY_CHART_NAMES[supplyId]
              || (catalog && (catalog.nameTrade || catalog.nameEn || catalog.nameAr))
              || supplyId;
            meds.push({ name: name, freq: String(freq), group: 4, rank: 0 });
          });
        }

        out.push({
          name: p.name.trim(),
          id: p.plateNumber || "",   // رقم الطبلة — اختياري
          meds: meds
        });
      });
    });
    return out;
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

  function buildChartTSV(state, supplyDistribution, unit) {
    const patients = collectPatientsFromApp(state, supplyDistribution, unit);

    // رؤوس الأعمدة: كل دواء فريد يظهر مرة واحدة فقط
    // مرتّبة: مضادات حيوية ← حبوب وشرابات… ← سرنجات جاهزة ← أمبولات وفيالات ← مستلزمات
    const seen = new Map();
    for (const p of patients)
      for (const m of p.meds)
        if (!seen.has(m.name)) seen.set(m.name, { name: m.name, group: m.group == null ? 3 : m.group, rank: m.rank == null ? 9 : m.rank });
    const medOrder = Array.from(seen.values()).sort(compareOrder).map(x => x.name);

    // الصف الأول: خليتان فارغتان (اسم + رقم) + أسماء الأدوية
    const rows = [["", "", ...medOrder].join("\t")];

    // بقية الصفوف: صف لكل مريض
    for (const p of patients) {
      const doses = medOrder.map(() => "");
      for (const m of p.meds) {
        const idx = medOrder.indexOf(m.name);
        if (idx >= 0) {
          // تحقق من استثناءات الكمية أولاً — بعض الأدوية (مثل
          // الهيبارين) تأتي في زجاجة كبيرة تكفي لكل جرعات اليوم،
          // فلا يكون التكرار مساوياً لعدد القطع المطلوبة. إذا كان
          // مُعرّف الدواء موجوداً في CHART_QTY_EXCEPTIONS، نستخدم
          // القيمة المُحدّدة هناك بدلاً من freqToDose.
          if (m.id && Object.prototype.hasOwnProperty.call(CHART_QTY_EXCEPTIONS, m.id)) {
            doses[idx] = CHART_QTY_EXCEPTIONS[m.id];
          } else {
            doses[idx] = isContainer(m.id, m.form) ? "1" : freqToDose(m.freq);
          }
        }
      }
      rows.push([p.name ?? "", p.id ?? "", ...doses].join("\t"));
    }
    return rows.join("\n");
  }

  /* الزر — يُربط في app.js */
  // Opens the chart with the table in the link + copies it.
  // The chart app has no import and can't be scripted from our site, so
  // the table goes through our server function (api/chart-sync.js via
  // chart-sync.js), which fills today's ward chart with the
  // pharmacist's chart account. The result is kept on the log entry.
  // date: the chart's day ("YYYY-MM-DD"); empty = today
  async function sendTsv(tsv, logId, onProgress, date, unit) {
    const Sync = global.PharmacyChartSync;
    const r = Sync ? await Sync.send(tsv, onProgress, date, unit) : { ok: false, message: "تعذّر تحميل وحدة الإرسال" };
    if (logId && global.PharmacyChartLog && !r.cancelled) global.PharmacyChartLog.setResult(logId, r);
    return r;
  }

  async function sendChart(state, supplyDistribution, onProgress, date, unit) {
    unit = unit === "3" ? "3" : "1";
    const tsv = buildChartTSV(state, supplyDistribution, unit);
    // Keep the exact table in the send log (chart-send-log.js) first,
    // so it can be re-sent if anything goes wrong on the way.
    const entry = global.PharmacyChartLog
      ? global.PharmacyChartLog.add(tsv, { withSupplies: !!(supplyDistribution && Object.keys(supplyDistribution).length), date: date || "", unit })
      : null;
    return sendTsv(tsv, entry && entry.id, onProgress, date, unit);
  }

  // Manual fallback: open the chart site (the table is on the clipboard)
  function openChart(tsv) {
    try { if (tsv) navigator.clipboard.writeText(tsv).catch(() => {}); } catch (e) {}
    window.open(CHART_URL, "_blank");
  }

  /* ---- Exports ---- */
  global.PharmacyChartBridge = {
    sendChart,
    sendTsv,
    ONE_CONTAINER_FORMS,
    SUPPLY_CHART_NAMES,
    ORDER_GROUPS, orderRank, compareOrder,
    openChart,
    collectPatientsFromApp,
    freqToDose,
    dailyQuantity,
    buildChartTSV,
    CHART_URL,
    CHART_QTY_EXCEPTIONS
  };

})(window);
