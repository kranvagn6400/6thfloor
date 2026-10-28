/* ============================================================
   patient-forms.js  —  «استمارات المرضى» (header button, everyone)
   ============================================================
   Medicines that need a form filled for the storeroom (المذخر) before they are prepared:
     • الألبومين  — a form EVERY day for every patient on albumin.
     • الميرونيم / الإيميبينيم — a form on the first day, and again on the day the dispensing period ends:
       day 7 when the period is 7 days, day 14 when it is 14 (next due = last form's day + period − 1).
   The paper form is the ward's own (img/forms/*.jpg, the user's PDF as a picture); the app fills the values on top of it
   and ticks the chosen conditions, then previews / saves a PDF (same method as the private-ward form).
   Everything typed is kept inside the patient (labs._forms — no new column):
     labs._forms[id] = { vals: { key: text }, ticks: [item numbers], notes: { item: text }, culture: "after"|"before"|"none",
                         hist: [{ date, day, dur }] }   (hist = the forms already issued)
   Adding a form later = one more entry in FORMS (a picture of the paper + the positions of its fields / boxes).
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const App = () => global.PharmacyApp;
  const PF = () => global.PharmacyPrivateForm;
  const K = 0.625;                                        // design px → pt (the pictures were measured at 1.6 × 72 dpi)
  const pt = (n) => (n * K).toFixed(2) + "pt";
  const todayISO = () => (global.PharmacyChartSync && global.PharmacyChartSync.todayISO) ? global.PharmacyChartSync.todayISO() : new Date().toLocaleDateString("en-CA");
  const slash = (d) => String(d || "").replace(/-/g, "/");
  const flash = (m) => { const f = PF() && PF().flash; if (f) f(m); else if (App()) App().flashHint(m); };

  // ---------------- number in Arabic words (for «كتابة:») ----------------
  const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  function words(n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0 || n > 999) return "";
    if (n === 0) return "صفر";
    const parts = [];
    if (n >= 100) { parts.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
    if (n > 0) {
      if (n < 20) parts.push(ONES[n]);
      else { const u = n % 10, t = Math.floor(n / 10); parts.push(u ? ONES[u] + " و" + TENS[t] : TENS[t]); }
    }
    return parts.join(" و");
  }

  // ---------------- the two forms ----------------
  const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const cols3 = (x, y0, y1) => [R(x[0], y0, x[1], y1), R(x[1], y0, x[2], y1), R(x[2], y0, x[3], y1)];
  const ALB_X = [78, 352, 627, 902];
  const MER_X = [92, 348, 605, 861];
  const mk = (cells, texts, notes) => cells.map((r, i) => Object.assign({ n: 0, text: texts[i], note: !!(notes && notes[i]) }, r));

  const ALB_ITEMS = [].concat(
    mk(cols3(ALB_X, 360, 458), ["Liver cirrhosis with Paracentesis of large volumes > 4 liters", "Paracentesis <4 liters if S.Cr >= 1.5 or the condition is refractory to sodium restriction", "Liver cirrhosis with ascites not responsive to diuretics"]),
    mk(cols3(ALB_X, 458, 531), ["Liver cirrhosis with Hepatorenal syndrome", "Liver cirrhosis with high risk spontaneous bacterial peritonitis", "Acute severe peripheral or pulmonary edema with serum albumin < 2 g/dl"]),
    mk(cols3(ALB_X, 531, 604), ["acute Nephrotic syndrome", "Therapeutic plasmapheresis with large volume plasma exchange > 20ml/kg in one session", "Adult respiratory distress syndrome"]),
    mk(cols3(ALB_X, 604, 658), ["Post cardio-pulmonary bypass", "Extensive intestinal resection with serum albumin < 2 g/dl", ">40% resection of the liver With serum albumin < 2 g/dl"]),
    mk(cols3(ALB_X, 658, 806), ["Organ transplantation — Postoperative liver transplant (all: serum albumin < 2.5 g/dl, Hematocrit > 30%, Pulmonary capillary wedge pressure < 12 mmHg)", "Burns", "Hyperbilirubinemia of the newborn"]),
    mk([R(78, 806, 902, 880)], ["Malnutrition syndrome (all: significant diarrhea > 2 liters per day, serum albumin < 2 g/dl)"]),
    mk([R(78, 880, 902, 955)], ["Second line in hypovolemic, bleeding and hemorrhage shock when crystalloids at maximum dosage did not produce a clinically adequate response"])
  ).map((it, i) => Object.assign(it, { n: i + 1 }));

  const MER_ITEMS = [].concat(
    mk(cols3(MER_X, 427, 487), ["Acute mastoiditis", "Acute rhinosinusitis due to Intubation", "Bacterial meningitis"]),
    mk(cols3(MER_X, 487, 577), ["Contaminated blast injury (specify location and severity)", "Gangrenous cellulitis (necrotizing fasciitis or gas gangrene)", "HAP Post-op, Ventilator ESBL positive"], [1, 0, 0]),
    mk(cols3(MER_X, 577, 652), ["Infective bronchiectasis exacerbation (with severe lung impairment)", "Lung abscess", "NVE - Acute presentation (severe sepsis with ESBL)"]),
    mk(cols3(MER_X, 652, 708), ["Neutropenic sepsis", "Pleural empyema ESBL positive", "Proven acute pancreatitis"]),
    mk(cols3(MER_X, 708, 783), ["Pyogenic liver abscess", "Radical resection performed", "Severe CAP admitted to ICU"]),
    mk(cols3(MER_X, 783, 859), ["Severe diabetic foot Infection", "Severe secondary peritonitis", "Sepsis (specify the origin of Infection)"], [0, 0, 1]),
    mk([R(92, 859, 348, 906), R(348, 859, 861, 906)], ["Surgical site infection", "Others (specify)"], [0, 1])
  ).map((it, i) => Object.assign(it, { n: i + 1 }));
  // «Others (specify)» has a wide cell: its note goes after the printed label
  MER_ITEMS[MER_ITEMS.length - 1].noteBox = { x0: 490, x1: 852, cy: 884 };

  const MER_CULTURE = [
    { v: "after", text: "Sent after antibiotics", rect: R(283, 912, 480, 975) },
    { v: "before", text: "Sent before Antibiotics", rect: R(480, 912, 668, 975) },
    { v: "none", text: "Not sent", rect: R(668, 912, 861, 975) }
  ];

  // a field: k = key, label (Arabic, in the editor), box on the paper, side r = Arabic text hugging the label on its right
  const F = (k, label, x0, x1, cy, side, extra) => Object.assign({ k, label, x0, x1, cy, side }, extra || {});
  const FORMS = {
    albumin: {
      id: "albumin", title: "استمارة صرف الألبومين", short: "الألبومين", bg: "img/forms/albumin.jpg",
      px: [979, 1267], items: ALB_ITEMS, pdfName: "استمارة-ألبومين",
      hint: "",
      fields: [
        // like the meronem form: everything comes from the card (auto = shown, never typed) — except the diagnosis, which the
        // pharmacist's card does not show, so it stays a field (filled from the card when there is one)
        F("name", "اسم المريض", 628, 806, 129, "r", { auto: true, dy: -4 }), F("plate", "رقم الطبلة", 430, 552, 129, "r", { num: true, auto: true }),
        F("diag", "Diagnosis", 184, 425, 129, "l", { full: true }),
        F("ward", "الطابق والردهة", 430, 786, 170, "r", { auto: true }), F("alb", "Serum albumin", 226, 540, 170, "l", { auto: true }),
        F("count", "العدد المطلوب (رقمًا)", 560, 760, 211, "r", { num: true, auto: true }), F("day", "Treatment day", 216, 540, 211, "l", { auto: true }),
        F("words", "كتابةً", 560, 842, 253, "r", { auto: true }), F("weight", "Weight", 156, 540, 253, "l", { auto: true }),
        F("creat", "S.creatinine", 204, 540, 296, "l", { auto: true })
      ]
    },
    meronem: {
      id: "meronem", title: "استمارة الميرونيم / الإيميبينيم", short: "الميرونيم", bg: "img/forms/meronem.jpg",
      px: [952, 1347], items: MER_ITEMS, culture: MER_CULTURE, duration: true, pdfName: "استمارة-ميرونيم",
      hint: "",
      fields: [
        // auto = filled by the app, never typed (دائرة صحة and the hospital are fixed; the ward is the patient's unit; the rest comes from the card; no allergy)
        // each top value is CENTRED between the label's colon and the cell's left column line
        F("health", "دائرة صحة", 608, 778, 244, "r", { auto: true, center: true, kashida: { at: [1, 2], share: [1, 2] } }), F("hospital", "مستشفى", 352, 529, 244, "r", { auto: true, center: true, kashida: { at: [2, 6], share: [2, 1] } }), F("ward", "الردهة", 96, 297, 244, "r", { auto: true, center: true }),
        F("name", "اسم المريض", 608, 772, 278, "r", { auto: true, dy: -4, center: true }), F("age", "العمر", 352, 557, 278, "r", { auto: true, dy: -4, center: true }), F("weight", "الوزن", 96, 300, 278, "r", { auto: true, dy: -4, center: true }),
        F("date", "التاريخ", 608, 802, 314, "r", { auto: true, dy: -4, center: true }), F("scr", "S.cr", 352, 545, 314, "r", { auto: true, dy: -4, center: true }),
        // the two typed fields are written in the MIDDLE of their cells
        F("dose", "الجرعة", 92, 688, 999, "r", { full: true, center: true, auto: true }), F("duration", "تحديد مدة الصرف", 92, 688, 1037, "r", { full: true, hidden: true, center: true })
      ]
    }
  };

  // ---------------- the patient: eligibility, defaults, saved state ----------------
  const catalog = () => (App() && App().state.medications) || [];
  const MER_RE = /meropenem|meronem|imipenem|tienam|ميروب|ميرون|ايميبين|إيميبين/i;
  function findMed(formId, p) {
    const C = global.PharmacyClinical;
    for (const pm of (p && p.medications) || []) {
      if (!pm) continue;
      const c = catalog().find(m => m && m.id === pm.id) || {};
      const probe = Object.assign({}, pm, c);
      if (formId === "albumin" && C && C.isAlbumin(probe)) return { pm, c };
      if (formId === "meronem" && MER_RE.test([pm.id, c.nameTrade, c.nameEn, c.nameAr, pm.nameTrade, pm.nameEn].join(" "))) return { pm, c };
    }
    return null;
  }
  function savedOf(p, id, create) {
    if (!p) return null;
    if (create) {
      if (!p.labs || typeof p.labs !== "object") p.labs = {};
      if (!p.labs._forms || typeof p.labs._forms !== "object") p.labs._forms = {};
      const s = p.labs._forms[id] = p.labs._forms[id] || {};
      if (!s.vals) s.vals = {};
      if (!Array.isArray(s.ticks)) s.ticks = [];
      if (!s.notes) s.notes = {};
      if (!Array.isArray(s.hist)) s.hist = [];
      return s;
    }
    return p.labs && p.labs._forms && p.labs._forms[id] ? p.labs._forms[id] : null;
  }
  const dayOf = (hit, p) => { const C = global.PharmacyClinical; return hit && C ? C.abxDay(hit.pm, p) : null; };

  // The meronem / imipenem course (the user's rules):
  //  • a form is made on the first day, for 7 or 14 days; the next form is due on the LAST day of that period (day 7 / day 14);
  //  • a course is never longer than 21 days in all: after a 14-day period only 7 more days are allowed, and after 21 days there is
  //    no point in going on with the drug — no more forms;
  //  • patients who were already on the drug before the app: every one of them was dispensed for 14 days (from day 1).
  const MAX_COURSE = 21;
  const durationsAfter = (end) => { const rem = MAX_COURSE - end; return rem >= 14 ? [7, 14] : rem >= 7 ? [7] : []; };
  // → { first: true } on day 1 with no form made yet, else { end, legacy } = the last day covered so far
  function courseOf(p, day, ignoreToday) {
    const s = savedOf(p, "meronem", false), hist = ((s && s.hist) || []).filter(h => !(ignoreToday && h.date === todayISO()));
    const last = hist[hist.length - 1];
    if (last) return { end: last.end || ((last.start || last.day || 1) + (last.dur || 7) - 1), legacy: false };
    if (day === 1) return { first: true };
    return { end: 14, legacy: true };
  }

  // ---- «رُفضت» (ALBUMIN form only): the pharmacy division / the manager refused it → the patient is «Not indicated» for TODAY ----
  // It is counted as not taken: the albumin amount in the critical-drug monitor, today's private-ward record (not charged) and the
  // handover paper («Not indicated»). The ORDER and the CHART are NOT touched (the approval comes later than the chart is finished and
  // printed, so there is nothing to gain). Tomorrow everything is normal again.
  function rejectedToday(p, formId) {
    const st = savedOf(p, formId, false);
    return !!(st && Array.isArray(st.rej) && st.rej.some(r => r.date === todayISO()));
  }
  // is this medicine of the patient one whose form was refused today? (albumin / meronem)
  function medRejectedToday(p, pm) {
    if (!p || !pm) return false;
    const C = global.PharmacyClinical, c = catalog().find(m => m && m.id === pm.id) || {};
    const probe = Object.assign({}, pm, c);
    if (((C && C.isAlbumin(probe)) || /albumin/i.test(String(pm.id || ""))) && rejectedToday(p, "albumin")) return true;
    return false;
  }
  function markRejected(formId, p, key) {
    const st = savedOf(p, formId, true), today = todayISO();
    const snap = { hist: st.hist.slice(), pending: st.pending || null, rej: (st.rej || []).slice(), priv: null, hv: null };
    // the Lasix that goes with this albumin (counted BEFORE the refusal is recorded: afterwards it is 0)
    const BR = global.PharmacyChartBridge;
    const lasixExtra = formId === "albumin" && BR && BR.lasixExtraOf ? BR.lasixExtraOf(p) : 0;
    st.hist = st.hist.filter(h => h.date !== today);                       // a refused form was not «issued»
    delete st.pending;
    st.rej = (st.rej || []).filter(r => r.date !== today);
    st.rej.push({ date: today, day: dayOf(findMed(formId, p), p) || 1 });
    // the private-ward record: what that medicine cost today is taken off (restored by «تراجع»)
    const pr = p.labs && p.labs._priv && p.labs._priv.days && p.labs._priv.days[today];
    if (pr && Array.isArray(pr.items)) {
      snap.priv = JSON.parse(JSON.stringify(pr.items));
      const names = new Set();
      ((p && p.medications) || []).forEach(pm => {
        const hit = medRejectedToday(p, pm);
        const c = catalog().find(m => m && m.id === pm.id) || {};
        if (hit && String(c.nameChart || "").trim()) names.add(String(c.nameChart).trim());
      });
      const lasixName = lasixExtra ? String((catalog().find(m => m && m.id === BR.LASIX_ID) || {}).nameChart || "").trim() : "";
      pr.items = pr.items.map(it => (lasixName && it.k === lasixName) ? Object.assign({}, it, { q: (Number(it.q) || 0) - lasixExtra }) : it)
        .filter(it => !names.has(it.k) && (Number(it.q) || 0) > 0);
    }
    // the handover paper: «Not indicated» for the albumin of this patient
    const H = global.PharmacyHandover;
    if (formId === "albumin" && H && H.setAlbStatus && key) { snap.hv = H.getAlbStatus ? H.getAlbStatus(key) : ""; H.setAlbStatus(key, "ni"); }
    return { ok: true, undo() {
      st.hist = snap.hist; st.rej = snap.rej;
      if (snap.pending) st.pending = snap.pending; else delete st.pending;
      if (snap.priv && pr) pr.items = snap.priv;
      if (formId === "albumin" && H && H.setAlbStatus && key) H.setAlbStatus(key, snap.hv || "");
    } };
  }
  // «إلغاء الرفض»: the patient is indicated again (the albumin / meronem counts come back with the next send)
  function clearRejected(formId, p, key) {
    const st = savedOf(p, formId, true), today = todayISO(), before = (st.rej || []).slice();
    st.rej = before.filter(r => r.date !== today);
    const H = global.PharmacyHandover;
    let hv = null;
    if (formId === "albumin" && H && H.setAlbStatus && key) { hv = H.getAlbStatus ? H.getAlbStatus(key) : ""; if (hv === "ni") H.setAlbStatus(key, ""); }
    return { ok: true, undo() { st.rej = before; if (formId === "albumin" && H && H.setAlbStatus && key && hv === "ni") H.setAlbStatus(key, "ni"); } };
  }

  // the record of a form (what is kept in hist once it is printed): the day of the course, the period and the days it covers
  function buildEntry(formId, p) {
    const day = dayOf(findMed(formId, p), p) || 1;
    if (formId === "albumin") return { date: todayISO(), day, dur: 1 };
    const st = savedOf(p, formId, true);
    const dur = parseInt(st.vals.durDays, 10) || 0;
    const c = courseOf(p, day, true);
    const start = c.first ? 1 : c.end + 1;               // a renewal continues right after the period that ended
    return { date: todayISO(), day, dur, start, end: start + dur - 1 };
  }
  // «تم الطبع»: the form leaves the required list. It uses the file made today (pending); albumin has no period to choose, so it can be
  // marked at once; meronem only when its file was made (or, in the editor, once a period is chosen). → { ok, why?, undo? }
  function markPrinted(formId, p, allowBuild) {
    const st = savedOf(p, formId, true);
    let entry = st.pending && st.pending.date === todayISO() ? st.pending : null;
    if (!entry) {
      if (formId === "albumin" || allowBuild) entry = buildEntry(formId, p);
      else return { ok: false, why: "أنشئ الاستمارة أولًا: افتحها واختر مدة الصرف ثم «حفظ PDF»" };
    }
    const prevHist = st.hist.slice(), prevPending = st.pending || null;
    st.hist = st.hist.filter(h => h.date !== todayISO());
    st.hist.push(entry);
    delete st.pending;
    return { ok: true, undo() { st.hist = prevHist; if (prevPending) st.pending = prevPending; else delete st.pending; } };
  }

  // «لم تُطبع»: takes back today's «تم الطبع» — the form is required again. → { ok, undo }
  function unmarkPrinted(formId, p) {
    const st = savedOf(p, formId, true);
    const prevHist = st.hist.slice(), prevPending = st.pending || null;
    if (!st.hist.some(h => h.date === todayISO())) return { ok: false };
    st.hist = st.hist.filter(h => h.date !== todayISO());
    delete st.pending;
    return { ok: true, undo() { st.hist = prevHist; if (prevPending) st.pending = prevPending; else delete st.pending; } };
  }

  // → { state: "done" | "due" | "late" | "soon" | "none", text }
  function dueInfo(formId, p) {
    const hit = findMed(formId, p);
    if (!hit) return { state: "none", text: "ليس على الدواء" };
    const s = savedOf(p, formId, false), hist = (s && s.hist) || [];
    const day = dayOf(hit, p);
    // refused today by the pharmacy division / the manager: «Not indicated» for the day (nothing is counted as taken)
    if (formId === "albumin" && rejectedToday(p, formId)) return { state: "rej", text: "رُفضت اليوم — Not indicated", day };
    if (hist.some(h => h.date === todayISO())) return { state: "done", text: "طُبعت اليوم ✓", day };
    // the file was made today but «تم الطبع» is not pressed yet: the form is still required
    if (s && s.pending && s.pending.date === todayISO()) return { state: "due", wait: true, text: "أُنشئ الملف — بانتظار الطبع", day };
    if (formId === "albumin") return { state: "due", text: "مطلوبة اليوم", day };
    const c = courseOf(p, day);
    if (c.first) return { state: "due", text: "مطلوبة — اليوم الأول", day };
    const end = c.end;
    if (!durationsAfter(end).length) return { state: "none", text: "آخر مدة صرف (حتى اليوم " + end + ") — لا تجديد بعد 21 يومًا", day };
    if (day != null && day > MAX_COURSE) return { state: "none", text: "تجاوز 21 يومًا — لا فائدة من الاستمرار", day };
    if (day == null) return { state: "soon", text: "تُجدَّد في اليوم " + end, day };
    if (day > end) return { state: "late", text: "متأخرة (كان موعدها اليوم " + end + ")", day };
    if (day === end) return { state: "due", text: "مطلوبة اليوم — تجديد", day };
    return { state: "soon", text: "تُجدَّد في اليوم " + end + " (بعد " + (end - day) + " يوم)", day };
  }

  function unitNameOf(key) {
    const m = String(key || "").match(/room-(\d+)-bed-/);
    const u = m && global.PharmacyWard.unitOf(+m[1]);
    return u ? (global.PharmacyWard.unitLongName(u.id) || u.name) : "";
  }
  function bedText(key) {
    const m = String(key || "").match(/room-(\d+)-bed-(\d+)/);
    if (!m) return "";
    const W = global.PharmacyWard, room = W.roomById(+m[1]);
    return W.roomTitle(+m[1]) + (room && room.kind === "private" ? "" : " · سرير " + W.bedLabel(+m[1], +m[2]));
  }


  // the NEWEST result of a lab, by its date: the card's current value or any older-entered one in the lab history
  // (a result keyed in with an earlier date must not hide a newer one)
  function latestLab(p, key) {
    const labs = (p && p.labs) || {};
    let best = { v: labs[key] != null ? String(labs[key]).trim() : "", d: (labs._dates && labs._dates[key]) || "" };
    (Array.isArray(p && p.labHistory) ? p.labHistory : []).forEach(h => {
      if (h && h.key === key && h.value != null && String(h.value).trim() && h.date && h.date > best.d) best = { v: String(h.value).trim(), d: h.date };
    });
    return best.v;
  }

  // the values the form starts with (what the card knows); anything the pharmacist typed overrides it
  function defaults(formId, key, p) {
    const labs = p.labs || {}, hit = findMed(formId, p), day = dayOf(hit, p);
    const unit = unitNameOf(key);
    if (formId === "albumin") {
      let qty = 0;
      const Bridge = global.PharmacyChartBridge;
      ((p && p.medications) || []).forEach(pm => {
        const c = catalog().find(m => m && m.id === pm.id) || {};
        if (global.PharmacyClinical.isAlbumin(Object.assign({}, pm, c)) && Bridge && Bridge.dailyQuantity) qty += Bridge.dailyQuantity(pm.id, pm.frequency || c.defaultFrequency || "", c.form) || 0;
      });
      return { name: String(p.name || "").trim(), plate: String(p.plateNumber || "").trim(), diag: String(p.diagnosis || "").trim(),
        ward: "السادس - " + unit, alb: latestLab(p, "albumin"), count: qty ? String(qty) : "", words: qty ? words(qty) : "",
        day: day ? ordinal(day) : "", weight: labs.weight || "", creat: latestLab(p, "creatinine") };
    }
    // the dose as the ward writes it: «1g x 3» / «500mg x 2» (the strength × the times a day, from the card)
    let dose = "";
    if (hit) {
      const strength = String(hit.pm.dose || hit.c.defaultDose || "").trim();
      const freq = hit.pm.frequency || hit.c.defaultFrequency || "";
      const Meds = global.PharmacyMedications || {};
      const nm = Meds.parseFreq ? Meds.parseFreq(freq) : null;
      dose = strength && nm ? strength + " x " + nm.m : [strength, freq].filter(Boolean).join(" ");
    }
    return { health: "مدينة الطب", hospital: "بغداد التعليمي", ward: unit, name: String(p.name || "").trim(), age: String(p.age || "").trim(),
      weight: labs.weight || "", date: todayISO(), scr: latestLab(p, "creatinine"), dose, duration: "" };
  }

  // the dispensing period as the ward writes it: «7 أيام» / «14 يوما»
  const durText = (n) => (+n >= 3 && +n <= 10 ? n + " أيام" : n + " يوما");

  // 1 → 1st, 2 → 2nd, 3 → 3rd, 4 → 4th … 11th 12th 13th … 21st (the albumin paper's «Treatment day»)
  function ordinal(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return "";
    const v = n % 100, sfx = ["th", "st", "nd", "rd"];
    return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]);
  }

  // ---------------- the paper (picture + the values on top) ----------------
  function cssText(S) {
    const f = (n) => new URL("fonts/" + n, location.href).href;
    return `
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Regular.ttf")}") format("truetype"); font-weight: 400; font-display: block; }
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Bold.ttf")}") format("truetype"); font-weight: 700; font-display: block; }
    ${S}, ${S} * { box-sizing: border-box; }
    ${S} { margin: 0; padding: 0; background: #fff; /* the ward's forms were written in Pages on an iPhone: English = Helvetica Neue, Arabic = Geeza Pro (Apple system fonts — exact on iPhone / iPad / Mac; elsewhere the nearest installed font) */
    font-family: 'Helvetica Neue', Helvetica, 'Geeza Pro', 'GeezaPro', 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #111; }
    ${S} .pg { position: relative; overflow: hidden; background: #fff; }
    ${S} .bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
    ${S} .t { position: absolute; display: flex; align-items: center; justify-content: flex-start; text-align: right; font-size: 12pt; font-weight: 400; line-height: 1.3; white-space: nowrap; color: #000; }
    ${S} .t.c { justify-content: center; text-align: center; }
    ${S} .t.l { direction: ltr; justify-content: flex-start; text-align: left; }
    ${S} .t.k { justify-content: center; font-size: 17pt; font-weight: 700; color: #000; }
    ${S} .ring { position: absolute; border: 3.2pt solid #000; border-radius: 6pt; background: transparent; }
    ${S} .sp { display: inline-block; width: 0.32em; flex: none; }
  `;
  }
  const spaced = (html) => String(html).replace(/(^|>)([^<]*)/g, (m, a, b) => a + b.replace(/ /g, '<span class="sp"></span>'));
  const ltrWrap = (t) => (/[؀-ۿ]/.test(t) ? esc(t) : '<span style="direction:ltr;unicode-bidi:isolate;display:inline-block">' + esc(t) + "</span>");
  function tbox(cls, x0, x1, cy, html, fs) {
    const h = 44;
    return '<div class="t ' + cls + '" style="left:' + pt(x0) + ";width:" + pt(x1 - x0) + ";top:" + pt(cy - h / 2) + ";height:" + pt(h) + (fs ? ";font-size:" + fs + "pt" : "") + '">' + spaced(html) + "</div>";
  }
  // the chosen condition = its cell outlined (a tick would run over the printed text)
  const ring = (r) => '<div class="ring" style="left:' + pt(r.x0 + 1) + ";top:" + pt(r.y0 + 1) + ";width:" + pt(r.x1 - r.x0 - 2) + ";height:" + pt(r.y1 - r.y0 - 2) + '"></div>';
  // The fonts of the paper (also the stack the page CSS uses, so the measure matches what is drawn)
  const FONT_STACK = "'Helvetica Neue', Helvetica, 'Geeza Pro', 'GeezaPro', 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif";
  // «مدينة الطب» → «مـــدينة الـــطب»: tatweels are put after the letter index at[i] of each word, so the whole text just fills the
  // box (measured with the real font: n = (box − text) / width of one ـ), shared between the words by share[]
  function kashida(text, f) {
    try {
      const words = String(text).split(" ");
      if (words.length !== f.kashida.at.length) return text;
      const cv = document.createElement("canvas").getContext("2d");
      cv.font = "16px " + FONT_STACK;                                    // 12 pt
      const tat = cv.measureText("ـ").width || 4;
      const base = cv.measureText(words.join(" ")).width + 16 * 0.32 * (words.length - 1);
      const target = (f.x1 - f.x0) * K * (96 / 72) * 0.94;
      const n = Math.floor((target - base) / tat);
      if (n < words.length) return text;
      const total = f.kashida.share.reduce((a, b) => a + b, 0);
      let left = n;
      return words.map((w, i) => {
        const cnt = i === words.length - 1 ? left : Math.round(n * f.kashida.share[i] / total);
        left -= cnt;
        const at = f.kashida.at[i];
        return w.slice(0, at) + "ـ".repeat(Math.max(0, cnt)) + w.slice(at);
      }).join(" ");
    } catch (e) { return text; }
  }
  // the type size that fits the text in its box (about 0.46 em per character with the paper's own fonts, never above 12 pt, never below 7)
  // the albumin paper: these fields are nudged up a little from the general +2 (design px)
  const ALB_DY = { name: -1.5, ward: -1.5, plate: -1, words: 0.5 };
  const sizeFor = (t, x0, x1, max) => Math.max(7, Math.min(max || 12, ((x1 - x0) * K) / (Math.max(1, String(t).length) * 0.46)));

  // → the page's HTML (the picture + every value + the ticks)
  function pageHtml(form, vals, st) {
    const [w, h] = form.px;
    let o = '<div class="pg" style="width:' + pt(w) + ";height:" + pt(h) + '"><img class="bg" src="' + form.bg + '" alt="">';
    const nameField = form.fields.find(x => x.k === "name");
    const BIG = 14;
    const nameFs = nameField && vals.name ? sizeFor(String(vals.name).trim(), nameField.x0, nameField.x1, form.id === "albumin" ? BIG : 12) : 12;
    form.fields.forEach(f => {
      const v = String(vals[f.k] == null ? "" : vals[f.k]).trim();
      if (!v) return;
      let text = f.k === "date" ? slash(v) : v;
      if (f.kashida) text = kashida(text, f);
      // typed in the paper's own fonts at the label's size (11 pt), lowered onto the label's line (the first row of the meronem form only a little)
      o += tbox(f.center ? "c" : f.side === "l" ? "l" : "", f.x0, f.x1, f.cy + (f.cy === 244 ? 0 : form.id === "albumin" && ALB_DY[f.k] != null ? ALB_DY[f.k] : 2), f.side === "l" ? esc(text) : (f.num ? '<span style="direction:ltr;unicode-bidi:isolate;display:inline-block">' + esc(text) + "</span>" : ltrWrap(text)), f.kashida ? 12 : (form.id === "albumin" && f.k === "ward") ? nameFs : (form.id === "albumin" && f.k === "words") ? sizeFor(text, f.x0, f.x1, BIG) : sizeFor(text, f.x0, f.x1, form.id === "albumin" && f.k === "name" ? BIG : 12));
    });
    form.items.forEach(it => {
      if (st.ticks.indexOf(it.n) < 0) return;
      o += ring(it);
      const note = String((st.notes && st.notes[it.n]) || "").trim();
      if (it.note && note) {
        if (it.noteBox) o += tbox("l", it.noteBox.x0, it.noteBox.x1, it.noteBox.cy, esc(note), 9.5);
        else o += tbox("l", it.x0 + 10, it.x1 - 10, it.y1 - 7, esc(note), 8);
      }
    });
    (form.culture || []).forEach(c => { if (st.culture === c.v) o += ring(c.rect); });
    return o + "</div>";
  }
  // scale 3 = 4 pixels per point (about 290 dpi) — the background pictures were made at the same density, so nothing is resampled
  const renderOpts = (form) => ({ w: form.px[0] * K, h: form.px[1] * K, css: cssText("#pfs-root"), rootId: "pfs-root", scale: 3 });

  // ---------------- the screens ----------------
  let V = null;     // { view: "list" | "edit", form, filter, all, q, key, p, st, vals }
  let saveTimer = null;

  function saveSoon() {
    if (!V || !V.key) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (App() && V) App().savePatient(V.key); }, 700);
  }

  function ensureStyle() {
    if (PF() && PF().ensureStyle) PF().ensureStyle();
    if ($("pfs-style")) return;
    const st = document.createElement("style");
    st.id = "pfs-style";
    st.textContent = `
    #pf-editor .pfs-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    #pf-editor .pfs-tab { border: 1.5px solid var(--border, #dbe2e8); background: var(--surface, #fff); color: var(--text, #14211f); border-radius: 14px; padding: 12px 8px; font: inherit; font-weight: 800; font-size: 14.5px; cursor: pointer; text-align: center; }
    #pf-editor .pfs-tab small { display: block; margin-top: 3px; font-weight: 700; font-size: 11.5px; color: var(--text-muted, #5c6b73); }
    #pf-editor .pfs-tab.is-on { background: var(--fill, var(--primary, #1f6f9f)); border-color: var(--fill, var(--primary, #1f6f9f)); color: #fff; }
    #pf-editor .pfs-tab.is-on small { color: rgba(255,255,255,.85); }
    #pf-editor .pfs-search { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin-bottom: 10px; }
    #pf-editor .pfs-chip { height: 42px; padding: 0 12px; border-radius: 12px; border: 1.5px solid var(--border, #dbe2e8); background: var(--surface, #fff); color: var(--text, #14211f); font: inherit; font-weight: 800; font-size: 13px; cursor: pointer; }
    #pf-editor .pfs-chip.is-on { background: var(--bg, #eef2f6); border-color: var(--fill, var(--primary, #1f6f9f)); }
    #pf-editor .pfs-pt { display: block; width: 100%; text-align: start; border: 1px solid var(--border, #dbe2e8); background: var(--surface, #fff); color: var(--text, #14211f); border-radius: 14px; padding: 12px; margin-bottom: 10px; font: inherit; cursor: pointer; }
    #pf-editor .pfs-batch { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    #pf-editor .pfs-batch button { flex: 1 1 160px; height: 46px; border: 0; border-radius: 14px; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    #pf-editor .pfs-batch button[hidden] { display: none; }
    #pf-editor .pfs-print-all { background: var(--fill, var(--primary, #1f6f9f)); color: #fff; }
    #pf-editor .pfs-all-done { background: #1b8a3a; color: #fff; }
    #pf-editor .pfs-batch button:disabled { opacity: .6; }
    #pf-editor .pfs-main { display: block; width: 100%; text-align: start; background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; }
    #pf-editor .pfs-acts { display: flex; gap: 8px; margin-top: 10px; }
    #pf-editor .pfs-acts button { flex: 1; height: 42px; border: 0; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    #pf-editor .pfs-acts .pfs-done { margin-top: 0; width: auto; }
    #pf-editor .pfs-rej, #pf-editor .pfs-rej-sm { background: #c2412d; color: #fff; animation: pfsRejBlink .9s ease-in-out infinite; }
    @keyframes pfsRejBlink { 0%, 100% { background: #d92d2d; } 50% { background: #5a0f0f; } }
    @media (prefers-reduced-motion: reduce) { #pf-editor .pfs-rej, #pf-editor .pfs-rej-sm { animation: none; } }
    #pf-editor .pfs-unrej, #pf-editor .pfs-unrej-sm { background: var(--bg, #eef2f6); color: var(--text, #14211f); }
    #pf-editor .pfs-rej-sm, #pf-editor .pfs-unrej-sm { flex: none; height: 38px; padding: 0 14px; border: 0; border-radius: 12px; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; margin-inline-start: 8px; }
    #pf-editor .pfs-st.rej { background: #fde2e0; color: #a02315; }
    html[data-theme="dark"] #pf-editor .pfs-st.rej { background: #4d1d18; color: #ffb4a8; }
    #pf-editor .pfs-done { display: block; width: 100%; margin-top: 10px; height: 42px; border: 0; border-radius: 12px; background: #1b8a3a; color: #fff; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    #pf-editor .pfs-done-sm { flex: none; height: 38px; padding: 0 14px; border: 0; border-radius: 12px; background: #1b8a3a; color: #fff; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; margin-inline-start: 8px; }
    #pf-editor .pfs-notprinted, #pf-editor .pfs-notprinted-sm { flex: none; height: 38px; padding: 0 14px; border: 0; border-radius: 12px; background: #8a6d1b; color: #fff; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; margin-inline-start: 8px; }
    #pf-editor .pfs-st.wait { background: #dbeafe; color: #1d4ed8; }
    html[data-theme="dark"] #pf-editor .pfs-st.wait { background: #17304f; color: #9cc4ff; }
    #pf-editor .pfs-pt b { display: block; font-size: 15px; margin-bottom: 4px; }
    #pf-editor .pfs-pt span.m { display: block; font-size: 12px; color: var(--text-muted, #5c6b73); margin-bottom: 8px; }
    #pf-editor .pfs-st { display: inline-block; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 800; }
    #pf-editor .pfs-st.due { background: #fff3cd; color: #8a5a00; }
    #pf-editor .pfs-st.late { background: #fde2e0; color: #a02315; }
    #pf-editor .pfs-st.done { background: #dff5e3; color: #1b6b2f; }
    #pf-editor .pfs-st.soon, #pf-editor .pfs-st.none { background: var(--bg, #eef2f6); color: var(--text-muted, #5c6b73); }
    html[data-theme="dark"] #pf-editor .pfs-st.due { background: #4a3a10; color: #ffd978; }
    html[data-theme="dark"] #pf-editor .pfs-st.late { background: #4d1d18; color: #ffb4a8; }
    html[data-theme="dark"] #pf-editor .pfs-st.done { background: #17391f; color: #8fe0a2; }
    #pf-editor .pfs-autos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
    #pf-editor .pfs-auto { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-muted, #5c6b73); font-weight: 700; min-width: 0; }
    #pf-editor .pfs-auto b { font-size: 14px; color: var(--text, #14211f); overflow-wrap: anywhere; }
    #pf-editor .pfs-ck { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: start; padding: 10px 4px; border-bottom: 1px solid var(--border, #dbe2e8); font-size: 13.5px; line-height: 1.5; cursor: pointer; }
    #pf-editor .pfs-ck:last-child { border-bottom: 0; }
    #pf-editor .pfs-ck input { width: 22px; height: 22px; margin-top: 2px; accent-color: var(--primary, #1f6f9f); }
    #pf-editor .pfs-ck .n { font-weight: 800; color: var(--text-muted, #5c6b73); margin-inline-end: 4px; }
    #pf-editor .pfs-note { grid-column: 2; margin-top: 6px; }
    #pf-editor .pfs-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    #pf-editor .pfs-chips button { height: 40px; padding: 0 16px; border-radius: 12px; border: 1.5px solid var(--border, #dbe2e8); background: var(--surface, #fff); color: var(--text, #14211f); font: inherit; font-weight: 800; cursor: pointer; }
    #pf-editor .pfs-chips button.is-on { background: var(--fill, var(--primary, #1f6f9f)); border-color: var(--fill, var(--primary, #1f6f9f)); color: #fff; }
    `;
    document.head.appendChild(st);
  }

  function shell() {
    ensureStyle();
    let el = $("pf-editor");
    if (!el) { el = document.createElement("div"); el.id = "pf-editor"; document.body.appendChild(el); }
    return el;
  }
  function close() {
    const pv = $("pf-preview"); if (pv) pv.remove();
    const el = $("pf-editor"); if (el) el.remove();
    if (V && V.key && App()) { clearTimeout(saveTimer); App().savePatient(V.key); }
    V = null;
    setTimeout(refreshAlert, 300);
  }

  function patients() {
    const st = App() && App().state, out = [];
    Object.keys((st && st.patients) || {}).forEach(key => {
      const p = st.patients[key];
      if (!p || !p.name || !p.name.trim()) return;
      out.push({ key, p, order: global.PharmacyWard.bedLabelOfKey(key) || 999 });
    });
    return out.sort((a, b) => a.order - b.order);
  }

  // ---- list ----
  function openList() {
    V = V && V.view ? V : null;
    V = { view: "list", form: (V && V.form) || "albumin", all: false, q: "" };
    drawList();
  }
  function drawList() {
    const el = shell();
    const tabs = Object.keys(FORMS).map(id => {
      const n = patients().filter(x => { const d = dueInfo(id, x.p); return d.state === "due" || d.state === "late"; }).length;
      return '<button type="button" class="pfs-tab' + (V.form === id ? " is-on" : "") + '" data-f="' + id + '">' + esc(FORMS[id].short) + "<small>" + (n ? n + " مطلوبة" : "لا مطلوب") + "</small></button>";
    }).join("");
    el.innerHTML =
      '<div class="pfe-top"><button type="button" class="pfe-x" id="pfs-close" aria-label="إغلاق">✕</button><div><h3>استمارات المرضى</h3></div></div>' +
      '<div class="pfe-scroll"><div class="pfe-wrap">' +
        '<div class="pfs-tabs">' + tabs + "</div>" +
        (FORMS[V.form].hint ? '<p class="pfe-hint" style="margin:0 2px 10px">' + esc(FORMS[V.form].hint) + "</p>" : "") +
        '<div class="pfs-search"><input id="pfs-q" placeholder="ابحث باسم المريض أو رقم الطبلة" autocomplete="off" value="' + esc(V.q) + '"></div>' +
        '<div class="pfs-batch"><button type="button" class="pfs-print-all" id="pfs-print-all"></button><button type="button" class="pfs-all-done" id="pfs-all-done" hidden>تم طباعة الكل</button></div>' +
        '<div id="pfs-list"></div>' +
      "</div></div>";
    fillList();
    $("pfs-close").addEventListener("click", close);
    el.querySelectorAll(".pfs-tab").forEach(b => b.addEventListener("click", () => { V.form = b.dataset.f; drawList(); }));
    $("pfs-q").addEventListener("input", (e) => { V.q = e.target.value; fillList(); });
    $("pfs-print-all").addEventListener("click", () => printAll(V.form));
    $("pfs-all-done").addEventListener("click", () => printedAll(V.form));
  }
  // the batch buttons of the open tab: how many forms are required / waiting for the print
  function updateBatch() {
    const b = $("pfs-print-all"), d = $("pfs-all-done");
    if (!b || !d) return;
    let need = 0, wait = 0;
    patients().forEach(x => {
      if (!findMed(V.form, x.p)) return;
      const i = dueInfo(V.form, x.p);
      if (i.state === "due" || i.state === "late") { need++; if (i.wait) wait++; }
    });
    b.hidden = !need;
    b.textContent = "طباعة كل استمارات " + FORMS[V.form].short + " (" + need + ")";
    d.hidden = !wait;
    d.textContent = "تم طباعة الكل (" + wait + ")";
  }
  function fillList() {
    const q = V.q.trim().toLowerCase();
    const rows = patients().filter(x => {
      const on = !!findMed(V.form, x.p);
      if (!on) return false;
      // the meronem form: only the patients who deserve one now (first day, or the period ended and no new form yet —
      // a late one keeps showing on day 15, 16… until the new form is made)
      if (V.form === "meronem") { const s = dueInfo("meronem", x.p).state; if (s !== "due" && s !== "late") return false; }
      if (!q) return true;
      return (String(x.p.name || "").toLowerCase().indexOf(q) >= 0) || (String(x.p.plateNumber || "").indexOf(q) >= 0);
    });
    $("pfs-list").innerHTML = rows.length ? rows.map(x => {
      const d = dueInfo(V.form, x.p);
      // «تم الطبع» beside a form that needs printing: albumin any time, meronem once its file was made
      const canPrint = d.state === "due" || d.state === "late";
      const canReject = V.form === "albumin" && (d.state === "due" || d.state === "late" || d.state === "done");     // no refusal for the meronem form
      const acts = (canPrint ? '<button type="button" class="pfs-done">تم الطبع</button>' : "") +
        (d.state === "done" ? '<button type="button" class="pfs-notprinted">لم تُطبع</button>' : "") +
        (canReject ? '<button type="button" class="pfs-rej">رُفضت</button>' : "") +
        (d.state === "rej" ? '<button type="button" class="pfs-unrej">إلغاء الرفض</button>' : "");
      return '<div class="pfs-pt" data-key="' + esc(x.key) + '"><button type="button" class="pfs-main"><b>' + esc(x.p.name) + '</b><span class="m">' + esc(bedText(x.key)) + (x.p.plateNumber ? " · طبلة " + esc(x.p.plateNumber) : "") + (d.day ? " · اليوم " + d.day : "") + '</span><span class="pfs-st ' + (d.wait ? "wait" : d.state) + '">' + esc(d.text) + "</span></button>" +
        (acts ? '<div class="pfs-acts">' + acts + "</div>" : "") + "</div>";
    }).join("") : '<div class="pfe-empty">' + (V.form === "meronem" ? "لا يوجد مرضى يستحقون استمارة الميرونيم اليوم." : "لا يوجد مرضى على هذا الدواء حاليًا.") + "</div>";
    updateBatch();
    const list = $("pfs-list");
    list.querySelectorAll(".pfs-main").forEach(b => b.addEventListener("click", () => openForm(V.form, b.closest(".pfs-pt").dataset.key)));
    list.querySelectorAll(".pfs-done").forEach(b => b.addEventListener("click", () => printedFromList(b.closest(".pfs-pt").dataset.key)));
    list.querySelectorAll(".pfs-notprinted").forEach(b => b.addEventListener("click", () => notPrintedFromList(b.closest(".pfs-pt").dataset.key)));
    list.querySelectorAll(".pfs-rej").forEach(b => b.addEventListener("click", () => rejectFromList(b.closest(".pfs-pt").dataset.key, true)));
    list.querySelectorAll(".pfs-unrej").forEach(b => b.addEventListener("click", () => rejectFromList(b.closest(".pfs-pt").dataset.key, false)));
  }
  // asks which dispensing period (the allowed ones) — a small dialog; resolves 0 when cancelled
  function pickDuration(allowed, name) {
    return new Promise(resolve => {
      const old = $("pfs-pick"); if (old) old.remove();
      const o = document.createElement("div");
      o.id = "pfs-pick";
      o.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl;font-family:inherit";
      o.innerHTML = '<div style="background:var(--surface,#fff);color:var(--text,#14211f);border-radius:18px;padding:18px;width:100%;max-width:340px;box-shadow:0 12px 36px rgba(0,0,0,.4)"><div style="font-weight:800;font-size:15px;margin-bottom:4px">مدة الصرف</div><div style="font-size:13px;color:var(--text-muted,#5c6b73);margin-bottom:14px">' + esc(name) + '</div><div class="pfs-pk" style="display:flex;gap:10px;flex-wrap:wrap">' +
        allowed.map(n => '<button type="button" data-d="' + n + '" style="flex:1 1 120px;height:46px;border:0;border-radius:12px;background:var(--fill,var(--primary,#1f6f9f));color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer">' + esc(durText(n)) + "</button>").join("") +
        '</div><button type="button" data-d="0" style="width:100%;margin-top:12px;height:42px;border:0;border-radius:12px;background:var(--bg,#eef2f6);color:inherit;font:inherit;font-weight:800;cursor:pointer">إلغاء</button></div>';
      document.body.appendChild(o);
      o.addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (!b && e.target !== o) return; o.remove(); resolve(b ? +b.dataset.d : 0); });
    });
  }
  function notPrintedFromList(key) {
    const p = App().state.patients[key];
    if (!p) return;
    const res = unmarkPrinted(V.form, p);
    if (!res.ok) { flash("هذه الاستمارة غير مسجّلة كمطبوعة اليوم"); return; }
    App().savePatient(key);
    if (V && V.view === "list") drawList();
    refreshAlert();
    undoToast("أُلغي «تم الطبع»: " + String(p.name || "").trim(), () => { res.undo(); App().savePatient(key); if (V && V.view === "list") drawList(); refreshAlert(); });
  }
  function rejectFromList(key, reject) {
    const p = App().state.patients[key];
    if (!p) return;
    const form = V.form;
    const res = reject ? markRejected(form, p, key) : clearRejected(form, p, key);
    App().savePatient(key);
    if (V && V.view === "list") drawList();
    refreshAlert();
    undoToast((reject ? "سُجّل رفض الاستمارة (Not indicated لهذا اليوم): " : "أُلغي الرفض: ") + String(p.name || "").trim(), () => { res.undo(); App().savePatient(key); if (V && V.view === "list") drawList(); refreshAlert(); });
  }
  async function printedFromList(key) {
    const p = App().state.patients[key];
    if (!p) return;
    const form = V.form, st = savedOf(p, form, true);
    // meronem with no file made yet: the period is needed (a single allowed one is taken at once, else ask)
    if (form === "meronem" && !(st.pending && st.pending.date === todayISO())) {
      const allowed = allowedFor(p);
      if (!allowed.length) { flash("لا يجوز تجديد استمارة الميرونيم: بلغ العلاج 21 يومًا"); return; }
      let d = parseInt(st.vals.durDays, 10) || 0;
      if (allowed.indexOf(d) < 0) {
        d = allowed.length === 1 ? allowed[0] : await pickDuration(allowed, String(p.name || "").trim());
        if (!d) return;
        st.vals.durDays = String(d); st.vals.duration = durText(d);
      }
    }
    const res = markPrinted(form, p, true);
    if (!res.ok) { flash(res.why); return; }
    App().savePatient(key);
    if (V && V.view === "list") drawList();
    refreshAlert();
    undoToast("سُجّلت طباعة الاستمارة: " + String(p.name || "").trim(), () => { res.undo(); App().savePatient(key); if (V && V.view === "list") drawList(); refreshAlert(); });
  }
  // a short message with «تراجع»
  function undoToast(msg, undo) {
    const old = $("pfs-undo"); if (old) old.remove();
    const t = document.createElement("div");
    t.id = "pfs-undo";
    t.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 86px);z-index:100000;display:flex;align-items:center;gap:12px;justify-content:space-between;background:#1f2937;color:#fff;padding:12px 16px;border-radius:14px;font:700 14px/1.5 inherit;font-family:inherit;direction:rtl;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    const s = document.createElement("span"); s.textContent = msg;
    const b = document.createElement("button"); b.type = "button"; b.textContent = "تراجع";
    b.style.cssText = "border:0;border-radius:10px;padding:8px 14px;background:#f5b301;color:#1f2937;font:inherit;font-weight:800;cursor:pointer";
    b.addEventListener("click", () => { t.remove(); undo(); });
    t.appendChild(s); t.appendChild(b);
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 7000);
  }

  // ---- the form of one patient ----
  function effective() {
    const eff = Object.assign({}, V.defaults, V.st.vals);
    FORMS[V.form].fields.forEach(f => { if (f.auto) eff[f.k] = V.defaults[f.k]; });
    return eff;
  }
  function openForm(formId, key) {
    const p = App().state.patients[key];
    if (!p) return;
    const form = FORMS[formId];
    const st = savedOf(p, formId, true);
    V = { view: "edit", form: formId, key, p, st, defaults: defaults(formId, key, p), all: V && V.all, q: V && V.q };
    drawForm();
  }
  // what the app fills by itself (shown, not editable)
  function autoCard(form, eff) {
    const autos = form.fields.filter(f => f.auto);
    if (!autos.length) return "";
    const row = (f) => { const v = String(eff[f.k] == null ? "" : eff[f.k]).trim(); return '<div class="pfs-auto"><span>' + esc(f.label) + "</span><b>" + (v ? esc(f.k === "date" ? slash(v) : v) : "—") + "</b></div>"; };
    return '<div class="pfe-card"><h4 class="pfe-h">من بطاقة المريض <span class="pfe-badge">تلقائي</span></h4><div class="pfs-autos">' + autos.map(row).join("") + "</div></div>";
  }

  function drawForm() {
    const form = FORMS[V.form], eff = effective(), el = shell();
    const dateVal = String(eff.date || "");
    const field = (f) => {
      if (f.hidden || f.auto) return "";
      const type = f.date ? "date" : "text";
      const v = f.date ? dateVal : String(eff[f.k] == null ? "" : eff[f.k]);
      return '<label class="pfe-f' + (f.full ? " full" : "") + '">' + esc(f.label) + '<input data-k="' + f.k + '" type="' + type + '" value="' + esc(v) + '" autocomplete="off"' + (f.num ? ' inputmode="numeric"' : "") + "></label>";
    };
    const checks = form.items.map(it => {
      const on = V.st.ticks.indexOf(it.n) >= 0;
      return '<label class="pfs-ck"><input type="checkbox" data-n="' + it.n + '"' + (on ? " checked" : "") + '><span dir="ltr" style="text-align:left"><span class="n">' + it.n + ".</span>" + esc(it.text) + "</span>" +
        (it.note ? '<input class="pfs-note" data-note="' + it.n + '" placeholder="اكتب التفصيل (specify)" value="' + esc(V.st.notes[it.n] || "") + '"' + (on ? "" : " hidden") + ">" : "") + "</label>";
    }).join("");
    let extra = "";
    if (form.culture) {
      extra += '<div class="pfe-card"><h4 class="pfe-h">Culture &amp; sensitivity</h4><div class="pfs-chips" id="pfs-culture">' +
        form.culture.map(c => '<button type="button" data-v="' + c.v + '" class="' + (V.st.culture === c.v ? "is-on" : "") + '">' + esc(c.text) + "</button>").join("") + "</div></div>";
    }
    let dur = "";
    if (form.duration) {
      const allowed = allowedNow();
      let d = parseInt(V.st.vals.durDays, 10) || 0;
      if (allowed.length && allowed.indexOf(d) < 0) { d = allowed.length === 1 ? allowed[0] : 0; V.st.vals.durDays = d ? String(d) : ""; V.st.vals.duration = d ? durText(d) : ""; }
      const c = courseOf(V.p, dayOf(findMed("meronem", V.p), V.p));
      const note = !allowed.length
        ? "لا يجوز تجديد الاستمارة: بلغ العلاج الحد الأقصى (21 يومًا)."
        : c.first ? "تُصدر الاستمارة التالية في آخر يوم من هذه المدة (اليوم 7 أو 14). ولا يزيد العلاج عن 21 يومًا."
          : "هذا تجديد يبدأ من اليوم " + (c.end + 1) + ": يُسمح بـ " + allowed.map(durText).join(" أو ") + " فقط لأن العلاج لا يزيد عن 21 يومًا.";
      dur = '<div class="pfe-card"><h4 class="pfe-h">تحديد مدة الصرف</h4>' +
        (allowed.length ? '<div class="pfs-chips" id="pfs-dur">' + allowed.map(n => '<button type="button" data-d="' + n + '" class="' + (d === n ? "is-on" : "") + '">' + durText(n) + "</button>").join("") + "</div>" : "") +
        '<p class="pfe-hint">' + esc(note) + "</p></div>";
    }
    el.innerHTML =
      '<div class="pfe-top"><button type="button" class="pfe-x" id="pfs-back" aria-label="رجوع">✕</button><div><h3>' + esc(form.title) + "</h3><small>" + esc(V.p.name) + "</small></div></div>" +
      '<div class="pfe-scroll"><div class="pfe-wrap">' +
        autoCard(form, eff) +
        (form.fields.some(f => !f.auto && !f.hidden)
          ? '<div class="pfe-card"><h4 class="pfe-h">بيانات الاستمارة</h4><div class="pfe-fields">' + form.fields.map(field).join("") + '</div><p class="pfe-hint">تُملأ من بطاقة المريض، وكل حقل قابل للتعديل. ما تعدّله يُحفظ مع المريض.</p></div>'
          : "") +
        dur + extra +
        '<div class="pfe-card"><h4 class="pfe-h">الحالة المطابقة <span class="pfe-badge" id="pfs-nticks">' + V.st.ticks.length + '</span></h4>' + checks + "</div>" +
      "</div></div>" +
      '<div class="pfe-bottom"><div class="pfe-sum" id="pfs-sum"></div><button type="button" class="pfe-pv" id="pfs-preview">معاينة</button><button type="button" class="pfe-go" id="pfs-pdf">📄 حفظ PDF</button></div>';
    updateSum();

    $("pfs-back").addEventListener("click", () => { if (V.key) { clearTimeout(saveTimer); App().savePatient(V.key); } const f = V.form; V = { view: "list", form: f, all: V.all, q: V.q || "" }; drawList(); });
    el.querySelectorAll("input[data-k]").forEach(inp => inp.addEventListener("input", () => {
      const k = inp.dataset.k;
      V.st.vals[k] = inp.value;
      if (k === "count" && V.form === "albumin" && V.st.vals.words == null) { const w = el.querySelector('input[data-k="words"]'); if (w) w.value = words(inp.value); }
      saveSoon();
    }));
    el.querySelectorAll("input[data-n]").forEach(cb => cb.addEventListener("change", () => {
      const n = +cb.dataset.n, i = V.st.ticks.indexOf(n);
      if (cb.checked && i < 0) V.st.ticks.push(n);
      if (!cb.checked && i >= 0) V.st.ticks.splice(i, 1);
      const note = el.querySelector('input[data-note="' + n + '"]'); if (note) note.hidden = !cb.checked;
      $("pfs-nticks").textContent = V.st.ticks.length;
      saveSoon();
    }));
    el.querySelectorAll("input[data-note]").forEach(inp => inp.addEventListener("input", () => { V.st.notes[inp.dataset.note] = inp.value; saveSoon(); }));
    const cul = $("pfs-culture");
    if (cul) cul.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]"); if (!b) return;
      V.st.culture = V.st.culture === b.dataset.v ? "" : b.dataset.v;
      cul.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", x.dataset.v === V.st.culture));
      saveSoon();
    });
    const setDur = (n) => {
      V.st.vals.durDays = n ? String(n) : "";
      V.st.vals.duration = n ? durText(n) : "";
      const chips = $("pfs-dur"); if (chips) chips.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", +x.dataset.d === n));
      saveSoon();
    };
    const dchips = $("pfs-dur");
    if (dchips) dchips.addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (!b) return; setDur(+b.dataset.d); });
    $("pfs-pdf").addEventListener("click", () => savePdf($("pfs-pdf")));
    $("pfs-sum").addEventListener("click", (e) => {
      const rj = e.target.closest("#pfs-reject, #pfs-unreject");
      if (rj) {
        const key = V.key, p = V.p, form = V.form, on = rj.id === "pfs-reject";
        const res = on ? markRejected(form, p, key) : clearRejected(form, p, key);
        if (key) App().savePatient(key);
        updateSum(); refreshAlert();
        undoToast(on ? "سُجّل رفض الاستمارة (Not indicated لهذا اليوم)" : "أُلغي الرفض", () => { res.undo(); if (key) App().savePatient(key); if (V && V.p === p) updateSum(); refreshAlert(); });
        return;
      }
      if (e.target.closest("#pfs-notprinted")) {
        const key = V.key, p = V.p, res = unmarkPrinted(V.form, p);
        if (!res.ok) return;
        if (key) App().savePatient(key);
        updateSum(); refreshAlert();
        undoToast("أُلغي «تم الطبع»", () => { res.undo(); if (key) App().savePatient(key); if (V && V.p === p) updateSum(); refreshAlert(); });
        return;
      }
      if (!e.target.closest("#pfs-printed")) return;
      const key = V.key, p = V.p, form = V.form;
      const hasFile = V.st.pending && V.st.pending.date === todayISO();
      if (form === "meronem" && !hasFile && !checkDuration()) return;       // choose the period first
      const res = markPrinted(form, p, true);
      if (!res.ok) { flash(res.why); return; }
      if (key) App().savePatient(key);
      updateSum(); refreshAlert();
      undoToast("سُجّلت طباعة الاستمارة", () => { res.undo(); if (key) App().savePatient(key); if (V && V.p === p) updateSum(); refreshAlert(); });
    });
    $("pfs-preview").addEventListener("click", () => preview($("pfs-preview")));
  }
  // the dispensing periods the form may be made for now ([] = none: the 21-day limit is reached)
  function allowedFor(p) {
    const day = dayOf(findMed("meronem", p), p);
    if (day != null && day > MAX_COURSE) return [];          // past 21 days: no more forms
    const c = courseOf(p, day);
    return c.first ? [7, 14] : durationsAfter(c.end);
  }
  function allowedNow() { return allowedFor(V.p); }
  // meronem: a period must be chosen, and it must be an allowed one
  function checkDuration() {
    if (!FORMS[V.form].duration) return true;
    const allowed = allowedNow(), d = parseInt(V.st.vals.durDays, 10) || 0;
    if (!allowed.length) { flash("لا يجوز تجديد استمارة الميرونيم: بلغ العلاج 21 يومًا"); return false; }
    if (allowed.indexOf(d) < 0) { flash("اختر مدة الصرف (" + allowed.map(durText).join(" أو ") + ")"); return false; }
    return true;
  }
  function updateSum() {
    const el = $("pfs-sum"); if (!el) return;
    const d = dueInfo(V.form, V.p);
    el.innerHTML = '<span class="pfs-st ' + (d.wait ? "wait" : d.state) + '">' + esc(d.text) + "</span>" +
      ((d.state === "due" || d.state === "late") ? '<button type="button" class="pfs-done-sm" id="pfs-printed">تم الطبع</button>' : "") +
      (d.state === "done" ? '<button type="button" class="pfs-notprinted-sm" id="pfs-notprinted">لم تُطبع</button>' : "") +
      ((V.form === "albumin" && (d.state === "due" || d.state === "late" || d.state === "done")) ? '<button type="button" class="pfs-rej-sm" id="pfs-reject">رُفضت</button>' : "") +
      (d.state === "rej" ? '<button type="button" class="pfs-unrej-sm" id="pfs-unreject">إلغاء الرفض</button>' : "");
  }

  // the page(s) to print with the values as they are now
  function pages() {
    const eff = effective();
    if (FORMS[V.form].duration && !eff.duration && V.st.vals.durDays) eff.duration = durText(V.st.vals.durDays);
    return [pageHtml(FORMS[V.form], eff, V.st)];
  }
  async function preview(b) {
    if (!V || b.disabled) return;
    if (!checkDuration()) return;
    const form = FORMS[V.form];
    const label = b.textContent;
    b.disabled = true; b.textContent = "جارٍ التجهيز…";
    flash("جارٍ تجهيز المعاينة… قد تستغرق بضع ثوانٍ");
    try {
      const canvases = [];
      await PF().renderPages(pages(), (c) => canvases.push(c), renderOpts(form));
      const urls = [];
      for (const c of canvases) {
        const blob = await new Promise(res => { try { c.toBlob(res, "image/jpeg", 0.9); } catch (e) { res(null); } });
        urls.push(blob ? URL.createObjectURL(blob) : c.toDataURL("image/jpeg", 0.9));
      }
      PF().openViewer(urls, () => savePdf($("pfv-save")));
    } catch (err) {
      console.error("[patient-forms] preview", err);
      flash("تعذّرت المعاينة: " + (err && err.message || err));
    } finally { b.disabled = false; b.textContent = label; }
  }
  async function savePdf(b) {
    if (!V || (b && b.disabled)) return;
    if (!checkDuration()) return;
    const form = FORMS[V.form];
    const label = b ? b.textContent : "";
    if (b) { b.disabled = true; b.textContent = "جارٍ إنشاء الملف…"; }
    try {
      const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
      if (!JsPDF) throw new Error("مكتبة PDF غير محمّلة — تحقق من الاتصال بالإنترنت");
      const o = renderOpts(form);
      const pdf = new JsPDF({ unit: "pt", format: [o.w, o.h], orientation: o.w > o.h ? "landscape" : "portrait" });
      await PF().renderPages(pages(), (canvas, i) => {
        if (i > 0) pdf.addPage([o.w, o.h]);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, o.w, o.h);
      }, o);
      const blob = pdf.output("blob");
      const H = global.PharmacyHandover;
      const name = form.pdfName + "-" + String(V.p.name || "مريض").trim().replace(/[\\/:*?"<>|\s]+/g, "-") + ".pdf";
      // the form counts as issued only when the file was really saved / shared: closing the share sheet («إلغاء») does not
      const how = H && H.deliverPdf ? await H.deliverPdf(blob, name) : "downloaded";
      if (how === "cancelled") { flash("لم يُحفظ الملف — الاستمارة ما زالت مطلوبة"); return; }
      makePending();
    } catch (err) {
      console.error("[patient-forms] pdf", err);
      flash("تعذّر إنشاء الملف: " + (err && err.message || err));
    } finally { if (b) { b.disabled = false; b.textContent = label; } }
  }
  // ---- print ALL the required forms of one kind (albumin on its own, meronem on its own) as ONE file, a page per patient ----
  function formValues(formId, key, p) {
    const st = savedOf(p, formId, true), d = defaults(formId, key, p);
    const eff = Object.assign({}, d, st.vals);
    FORMS[formId].fields.forEach(f => { if (f.auto) eff[f.k] = d[f.k]; });
    if (FORMS[formId].duration && !eff.duration && st.vals.durDays) eff.duration = durText(st.vals.durDays);
    return { eff, st };
  }
  let batchBusy = false;
  async function printAll(formId) {
    if (batchBusy) return;
    const form = FORMS[formId], btn = $("pfs-print-all");
    const rows = patients().filter(x => findMed(formId, x.p)).filter(x => { const s = dueInfo(formId, x.p).state; return s === "due" || s === "late"; });
    if (!rows.length) { flash("لا توجد استمارات مطلوبة"); return; }
    const pagesHtml = [], used = [];
    let skipped = 0, noCondition = 0;
    rows.forEach(x => {
      const st = savedOf(x.p, formId, true);
      if (form.duration) {                              // meronem: a valid period must be chosen (a single allowed one is taken)
        const allowed = allowedFor(x.p);
        let d = parseInt(st.vals.durDays, 10) || 0;
        if (allowed.length === 1 && allowed.indexOf(d) < 0) { d = allowed[0]; st.vals.durDays = String(d); st.vals.duration = durText(d); }
        if (!allowed.length || allowed.indexOf(d) < 0) { skipped++; return; }
      }
      const v = formValues(formId, x.key, x.p);
      if (!v.st.ticks.length) noCondition++;
      pagesHtml.push(pageHtml(form, v.eff, v.st));
      used.push(x);
    });
    if (!pagesHtml.length) { flash("لم تُحدَّد مدة الصرف لأي مريض — افتح كل استمارة واختر المدة أولًا"); return; }
    batchBusy = true;
    const label = btn ? btn.textContent : "";
    if (btn) btn.disabled = true;
    try {
      const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
      if (!JsPDF) throw new Error("مكتبة PDF غير محمّلة — تحقق من الاتصال بالإنترنت");
      const o = renderOpts(form);
      const pdf = new JsPDF({ unit: "pt", format: [o.w, o.h], orientation: o.w > o.h ? "landscape" : "portrait" });
      await PF().renderPages(pagesHtml, (canvas, i) => {
        if (i > 0) pdf.addPage([o.w, o.h]);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, o.w, o.h);
        if (btn) btn.textContent = "جارٍ التجهيز " + (i + 1) + " / " + pagesHtml.length;
      }, o);
      const blob = pdf.output("blob");
      const H = global.PharmacyHandover;
      const how = H && H.deliverPdf ? await H.deliverPdf(blob, "استمارات-" + form.short + "-" + todayISO() + ".pdf") : "downloaded";
      if (how === "cancelled") { flash("لم يُحفظ الملف — الاستمارات ما زالت مطلوبة"); return; }
      used.forEach(x => { savedOf(x.p, formId, true).pending = buildEntry(formId, x.p); if (App()) App().savePatient(x.key); });
      refreshAlert();
      if (V && V.view === "list") drawList();
      flash("حُفظ ملف " + used.length + " استمارة" + (skipped ? " — تُخطّي " + skipped + " لعدم تحديد مدة الصرف" : "") + (noCondition ? " — " + noCondition + " بلا حالة مختارة" : "") + ". اضغط «تم طباعة الكل» بعد الطباعة");
    } catch (err) {
      console.error("[patient-forms] batch", err);
      flash("تعذّر إنشاء الملف: " + (err && err.message || err));
    } finally {
      batchBusy = false;
      const b2 = $("pfs-print-all"); if (b2) { b2.disabled = false; if (b2.textContent.indexOf("جارٍ") === 0) b2.textContent = label; }
    }
  }
  // «تم طباعة الكل»: every file made today and waiting for the print is marked printed (one «تراجع» takes them all back)
  function printedAll(formId) {
    const done = [];
    patients().forEach(x => {
      if (!findMed(formId, x.p)) return;
      const st = savedOf(x.p, formId, false);
      if (!(st && st.pending && st.pending.date === todayISO())) return;
      const res = markPrinted(formId, x.p, false);
      if (res.ok) { done.push({ x, res }); if (App()) App().savePatient(x.key); }
    });
    if (!done.length) { flash("لا توجد استمارات بانتظار الطبع"); return; }
    refreshAlert();
    if (V && V.view === "list") drawList();
    undoToast("سُجّلت طباعة " + done.length + " استمارة", () => { done.forEach(d => { d.res.undo(); if (App()) App().savePatient(d.x.key); }); if (V && V.view === "list") drawList(); refreshAlert(); });
  }

  // the file was saved / shared: the form now WAITS for the print — «تم الطبع» is what takes it off the required list
  function makePending() {
    if (!V) return;
    V.st.pending = buildEntry(V.form, V.p);
    if (V.key && App()) App().savePatient(V.key);
    updateSum();
    refreshAlert();
    flash("حُفظ الملف — اضغط «تم الطبع» بعد الطباعة");
  }

  // ---- the header button waits for the pharmacist: a soft glow + a count while forms are due ----
  // (albumin: everyone on it who has no form today; meronem: first day, or the period's last day / late). It goes quiet by itself
  // when nothing is left to issue.
  function pendingForms() {
    let n = 0;
    patients().forEach(x => {
      Object.keys(FORMS).forEach(id => {
        if (!findMed(id, x.p)) return;
        const st = dueInfo(id, x.p).state;
        if (st === "due" || st === "late") n++;
      });
    });
    return n;
  }
  function refreshAlert() {
    const btn = $("forms-btn");
    if (!btn || !App() || !App().state) return;
    let n = 0;
    try { if (btn.offsetParent !== null) n = pendingForms(); } catch (e) { /* not ready yet */ }
    btn.classList.toggle("is-alert", n > 0);
    btn.title = n > 0 ? "استمارات المرضى — " + n + " مطلوبة" : "استمارات المرضى";
    let b = $("forms-badge");
    if (n > 0) {
      if (!b) { b = document.createElement("span"); b.id = "forms-badge"; b.className = "notif-badge"; btn.appendChild(b); }
      b.textContent = n > 99 ? "99+" : String(n);
      b.hidden = false;
    } else if (b) b.hidden = true;
  }

  function init() {
    const btn = $("forms-btn");
    if (btn) btn.addEventListener("click", openList);
    setTimeout(refreshAlert, 4000);
    setInterval(refreshAlert, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAlert(); });
  }

  global.PharmacyPatientForms = { open: openList, words, dueInfo, FORMS, refreshAlert, pendingForms, medRejectedToday, rejectedToday, _dbg: { pageHtml, cssText, spaced, tbox } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
