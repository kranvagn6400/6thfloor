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
      hint: "تُصدر كل يوم لكل مريض على الألبومين",
      fields: [
        F("name", "اسم المريض", 628, 812, 129, "r", { dy: -4 }), F("plate", "رقم الطبلة", 430, 552, 129, "r", { num: true }),
        F("diag", "Diagnosis", 184, 425, 129, "l", { full: true }),
        F("ward", "الطابق والردهة", 560, 790, 170, "r"), F("alb", "Serum albumin", 226, 540, 170, "l"),
        F("count", "العدد المطلوب (رقمًا)", 560, 760, 211, "r", { num: true }), F("day", "Treatment day", 216, 540, 211, "l"),
        F("words", "كتابةً", 560, 846, 253, "r"), F("weight", "Weight", 156, 540, 253, "l"),
        F("creat", "S.creatinine", 204, 540, 296, "l")
      ]
    },
    meronem: {
      id: "meronem", title: "استمارة الميرونيم / الإيميبينيم", short: "الميرونيم", bg: "img/forms/meronem.jpg",
      px: [952, 1347], items: MER_ITEMS, culture: MER_CULTURE, duration: true, pdfName: "استمارة-ميرونيم",
      hint: "تُصدر في أول يوم، ثم في آخر يوم من مدة الصرف (اليوم 7 أو 14)",
      fields: [
        // auto = filled by the app, never typed (دائرة صحة and the hospital are fixed; the ward is the patient's unit; the rest comes from the card; no allergy)
        F("health", "دائرة صحة", 612, 774, 244, "r", { auto: true }), F("hospital", "مستشفى", 355, 540, 244, "r", { auto: true }), F("ward", "الردهة", 100, 296, 244, "r", { auto: true }),
        F("name", "اسم المريض", 612, 770, 278, "r", { auto: true, dy: -4 }), F("age", "العمر", 355, 555, 278, "r", { auto: true }), F("weight", "الوزن", 100, 298, 278, "r", { auto: true }),
        F("date", "التاريخ", 612, 800, 314, "r", { auto: true, dy: -4 }), F("scr", "S.cr", 355, 543, 314, "r", { auto: true }),
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

  // → { state: "done" | "due" | "late" | "soon" | "none", text }
  function dueInfo(formId, p) {
    const hit = findMed(formId, p);
    if (!hit) return { state: "none", text: "ليس على الدواء" };
    const s = savedOf(p, formId, false), hist = (s && s.hist) || [];
    const day = dayOf(hit, p);
    if (hist.some(h => h.date === todayISO())) return { state: "done", text: "صُرفت اليوم ✓", day };
    if (formId === "albumin") return { state: "due", text: "مطلوبة اليوم", day };
    const last = hist[hist.length - 1];
    if (!last) return { state: "due", text: "مطلوبة — لم تُصدر بعد", day };
    const next = (last.day || 1) + (last.dur || 7) - 1;
    if (day == null) return { state: "soon", text: "تُجدَّد في اليوم " + next, day };
    if (day > next) return { state: "late", text: "متأخرة (كان موعدها اليوم " + next + ")", day };
    if (day === next) return { state: "due", text: "مطلوبة اليوم — تجديد", day };
    return { state: "soon", text: "تُجدَّد في اليوم " + next + " (بعد " + (next - day) + " يوم)", day };
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
        ward: "السادس - " + unit, alb: labs.albumin || "", count: qty ? String(qty) : "", words: qty ? words(qty) : "",
        day: day ? String(day) : "", weight: labs.weight || "", creat: labs.creatinine || "" };
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
    return { health: "مدينة الطب", hospital: "مستشفى بغداد التعليمي", ward: unit, name: String(p.name || "").trim(), age: String(p.age || "").trim(),
      weight: labs.weight || "", date: todayISO(), scr: labs.creatinine || "", dose, duration: "" };
  }

  // ---------------- the paper (picture + the values on top) ----------------
  function cssText(S) {
    const f = (n) => new URL("fonts/" + n, location.href).href;
    return `
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Regular.ttf")}") format("truetype"); font-weight: 400; font-display: block; }
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Bold.ttf")}") format("truetype"); font-weight: 700; font-display: block; }
    ${S}, ${S} * { box-sizing: border-box; }
    ${S} { margin: 0; padding: 0; background: #fff; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #111; word-spacing: 0.25em; }
    ${S} .pg { position: relative; overflow: hidden; background: #fff; }
    ${S} .bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
    ${S} .t { position: absolute; display: flex; align-items: center; justify-content: flex-start; text-align: right; font-size: 11pt; font-weight: 700; line-height: 1.3; white-space: nowrap; color: #0b2a6b; }
    ${S} .t.c { justify-content: center; text-align: center; }
    ${S} .t.l { direction: ltr; justify-content: flex-start; text-align: left; }
    ${S} .t.k { justify-content: center; font-size: 17pt; font-weight: 700; color: #0b2a6b; }
    ${S} .ring { position: absolute; border: 2pt solid #0b2a6b; border-radius: 6pt; background: transparent; }
    ${S} .sp { display: inline-block; width: 0.5em; flex: none; }
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
  // the type size that fits the text in its box (about 0.55 em per character, never above 11 pt, never below 7)
  const sizeFor = (t, x0, x1) => Math.max(7, Math.min(9, ((x1 - x0) * K) / (Math.max(1, String(t).length) * 0.55)));

  // → the page's HTML (the picture + every value + the ticks)
  function pageHtml(form, vals, st) {
    const [w, h] = form.px;
    let o = '<div class="pg" style="width:' + pt(w) + ";height:" + pt(h) + '"><img class="bg" src="' + form.bg + '" alt="">';
    form.fields.forEach(f => {
      const v = String(vals[f.k] == null ? "" : vals[f.k]).trim();
      if (!v) return;
      const text = f.k === "date" ? slash(v) : v;
      // the typed text sits on the printed label's line: Arabic values a little higher than their box centre, English ones slightly
      o += tbox(f.center ? "c" : f.side === "l" ? "l" : "", f.x0, f.x1, f.cy + (f.dy != null ? f.dy : f.side === "l" ? -3.5 : -7), f.side === "l" ? esc(text) : (f.num ? '<span style="direction:ltr;unicode-bidi:isolate;display:inline-block">' + esc(text) + "</span>" : ltrWrap(text)), sizeFor(text, f.x0, f.x1));
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
  const renderOpts = (form) => ({ w: form.px[0] * K, h: form.px[1] * K, css: cssText("#pfs-root"), rootId: "pfs-root" });

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
      '<div class="pfe-top"><button type="button" class="pfe-x" id="pfs-close" aria-label="إغلاق">✕</button><div><h3>استمارات المرضى</h3><small>استمارات يطلبها المذخر قبل تجهيز الدواء</small></div></div>' +
      '<div class="pfe-scroll"><div class="pfe-wrap">' +
        '<div class="pfs-tabs">' + tabs + "</div>" +
        '<p class="pfe-hint" style="margin:0 2px 10px">' + esc(FORMS[V.form].hint) + "</p>" +
        '<div class="pfs-search"><input id="pfs-q" placeholder="ابحث باسم المريض أو رقم الطبلة" autocomplete="off" value="' + esc(V.q) + '"><button type="button" class="pfs-chip' + (V.all ? " is-on" : "") + '" id="pfs-all">كل المرضى</button></div>' +
        '<div id="pfs-list"></div>' +
      "</div></div>";
    fillList();
    $("pfs-close").addEventListener("click", close);
    el.querySelectorAll(".pfs-tab").forEach(b => b.addEventListener("click", () => { V.form = b.dataset.f; drawList(); }));
    $("pfs-q").addEventListener("input", (e) => { V.q = e.target.value; fillList(); });
    $("pfs-all").addEventListener("click", () => { V.all = !V.all; $("pfs-all").classList.toggle("is-on", V.all); fillList(); });
  }
  function fillList() {
    const q = V.q.trim().toLowerCase();
    const rows = patients().filter(x => {
      const on = !!findMed(V.form, x.p);
      if (!on && !V.all) return false;
      // the meronem form: only the patients who deserve one now (first day, or the period ended and no new form yet —
      // a late one keeps showing on day 15, 16… until the new form is made)
      if (V.form === "meronem" && !V.all) { const s = dueInfo("meronem", x.p).state; if (s !== "due" && s !== "late") return false; }
      if (!q) return true;
      return (String(x.p.name || "").toLowerCase().indexOf(q) >= 0) || (String(x.p.plateNumber || "").indexOf(q) >= 0);
    });
    $("pfs-list").innerHTML = rows.length ? rows.map(x => {
      const d = dueInfo(V.form, x.p);
      return '<button type="button" class="pfs-pt" data-key="' + esc(x.key) + '"><b>' + esc(x.p.name) + '</b><span class="m">' + esc(bedText(x.key)) + (x.p.plateNumber ? " · طبلة " + esc(x.p.plateNumber) : "") + (d.day ? " · اليوم " + d.day : "") + '</span><span class="pfs-st ' + d.state + '">' + esc(d.text) + "</span></button>";
    }).join("") : '<div class="pfe-empty">' + (V.form === "meronem" ? "لا يوجد مرضى يستحقون استمارة الميرونيم اليوم." : "لا يوجد مرضى على هذا الدواء حاليًا.") + "<br>اضغط «كل المرضى» لإصدار الاستمارة لمريض آخر.</div>";
    $("pfs-list").querySelectorAll(".pfs-pt").forEach(b => b.addEventListener("click", () => openForm(V.form, b.dataset.key)));
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
      const d = parseInt(V.st.vals.durDays, 10) || 0;
      dur = '<div class="pfe-card"><h4 class="pfe-h">تحديد مدة الصرف</h4><div class="pfs-chips" id="pfs-dur">' +
        [7, 14].map(n => '<button type="button" data-d="' + n + '" class="' + (d === n ? "is-on" : "") + '">' + n + " يومًا</button>").join("") +
        '</div><label class="pfe-f" style="margin-top:10px">أو اكتب عدد الأيام<input id="pfs-dcustom" type="number" inputmode="numeric" min="1" value="' + (d && d !== 7 && d !== 14 ? d : "") + '"></label>' +
        '<p class="pfe-hint">تُصدر الاستمارة التالية في اليوم الأخير من هذه المدة (اليوم 7 أو 14).</p></div>';
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
      V.st.vals.duration = n ? n + " أيام" : "";
      const chips = $("pfs-dur"); if (chips) chips.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", +x.dataset.d === n));
      saveSoon();
    };
    const dchips = $("pfs-dur");
    if (dchips) dchips.addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (!b) return; const c = $("pfs-dcustom"); if (c) c.value = ""; setDur(+b.dataset.d); });
    const dc = $("pfs-dcustom");
    if (dc) dc.addEventListener("input", () => { const n = parseInt(dc.value, 10); setDur(n > 0 ? n : 0); });
    $("pfs-pdf").addEventListener("click", () => savePdf($("pfs-pdf")));
    $("pfs-preview").addEventListener("click", () => preview($("pfs-preview")));
  }
  function updateSum() {
    const el = $("pfs-sum"); if (!el) return;
    const d = dueInfo(V.form, V.p);
    el.innerHTML = '<span class="pfs-st ' + d.state + '">' + esc(d.text) + "</span>";
  }

  // the page(s) to print with the values as they are now
  function pages() {
    const eff = effective();
    if (FORMS[V.form].duration && !eff.duration && V.st.vals.durDays) eff.duration = V.st.vals.durDays + " أيام";
    return [pageHtml(FORMS[V.form], eff, V.st)];
  }
  async function preview(b) {
    if (!V || b.disabled) return;
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
      if (H && H.deliverPdf) await H.deliverPdf(blob, name);
      issued();
    } catch (err) {
      console.error("[patient-forms] pdf", err);
      flash("تعذّر إنشاء الملف: " + (err && err.message || err));
    } finally { if (b) { b.disabled = false; b.textContent = label; } }
  }
  // the form is counted as issued today once its PDF was made (the next due day follows from the period)
  function issued() {
    if (!V) return;
    const day = dayOf(findMed(V.form, V.p), V.p) || 1;
    const dur = parseInt(V.st.vals.durDays, 10) || (V.form === "meronem" ? 7 : 1);
    V.st.hist = (V.st.hist || []).filter(h => h.date !== todayISO());
    V.st.hist.push({ date: todayISO(), day, dur });
    if (V.key && App()) App().savePatient(V.key);
    updateSum();
  }

  function init() {
    const btn = $("forms-btn");
    if (btn) btn.addEventListener("click", openList);
  }

  global.PharmacyPatientForms = { open: openList, words, dueInfo, FORMS, _dbg: { pageHtml, cssText, spaced, tbox } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
