/* ============================================================
   private-form.js  —  استمارة خروج الخاص (pharmacists + admin)
   ============================================================
   The paper «قائمة الأدوية المصروفة» of the private ward (القطاع الخاص):
     1. Every send to the private chart («ردهة الخاص») records, for each private patient, what was sent that day —
        only the medicines that are AVAILABLE at that moment (an unavailable one is never received, so never charged).
        Kept inside the patient (labs._priv — no new column), so it travels with the patient and into the archive.
        A second send on the same day replaces that day.
     2. At discharge the pharmacist opens «استمارة خروج الخاص» from the patient card: the days, the totals (editable —
        sometimes the night pharmacist, who does not use the app, handed the medicine), the source (شراء / كيماديا),
        unit price, administrative fees; then the form is printed as a PDF (landscape A4, drawn like the paper form).
   labs._priv = { days: { "YYYY-MM-DD": { items: [{ k, n, q }] } }, extra: [{ k, n, q }], meta: { k: { src, price, fee } },
                  from, to }
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const App = () => global.PharmacyApp;
  const todayISO = () => (global.PharmacyChartSync && global.PharmacyChartSync.todayISO) ? global.PharmacyChartSync.todayISO() : new Date().toISOString().slice(0, 10);
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

  function roomOfKey(key) {
    const m = String(key || "").match(/room-(\d+)-bed-/);
    return m ? global.PharmacyWard.roomById(+m[1]) : null;
  }
  function isPrivateBed(key) { const r = roomOfKey(key); return !!(r && r.kind === "private"); }

  function priv(p, create) {
    if (!p) return null;
    if (create) {
      if (!p.labs || typeof p.labs !== "object") p.labs = {};
      if (!p.labs._priv || typeof p.labs._priv !== "object") p.labs._priv = {};
      const pr = p.labs._priv;
      if (!pr.days || typeof pr.days !== "object") pr.days = {};
      if (!Array.isArray(pr.extra)) pr.extra = [];
      if (!pr.meta || typeof pr.meta !== "object") pr.meta = {};
      return pr;
    }
    return p.labs && p.labs._priv ? p.labs._priv : null;
  }

  // ---- 1) recording (called by chart-bridge after a successful send to the private chart) ----
  // patients: chart-bridge collectPatientsFromApp rows ({ key, meds: [{ name, available, … }] })
  function record(patients, date) {
    const app = App(), Bridge = global.PharmacyChartBridge;
    if (!app || !Bridge || !Bridge.medQty) return;
    const day = isDay(date) ? date : todayISO();
    (patients || []).forEach(pt => {
      const p = pt.key && app.state.patients[pt.key];
      if (!p) return;
      const items = [];
      pt.meds.forEach(m => {
        if (m.available === false) return;                    // not available → not received → not charged
        const q = parseInt(Bridge.medQty(m), 10);
        items.push({ k: m.name, n: m.name, q: isNaN(q) || q < 1 ? 1 : q });
      });
      if (!items.length) return;
      priv(p, true).days[day] = { items };                     // the same day sent again replaces it
      app.savePatient(pt.key);
    });
  }

  // ---- 2) the numbers ----
  function dayList(pr) { return Object.keys((pr && pr.days) || {}).filter(isDay).sort(); }
  // from = the day the patient entered (the «admitted» event of the current stay), unless edited; to = today unless edited
  function range(pr, admitted, exit) {
    const days = dayList(pr);
    return { from: (pr && pr.from) || admitted || days[0] || todayISO(), to: (pr && pr.to) || exit || todayISO() };
  }
  const rng = () => range(S.pr, S.admitted, S.exit);
  // «شراء او كيماديا»: every medicine is كيماديا unless the pharmacist changed it (— = left empty)
  const srcOf = (meta) => (meta && meta.src != null ? meta.src : "كيماديا");
  const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-CA"); };
  // → [{ k, n, q }] totals over the chosen days (+ the manual rows)
  function rowsOf(pr, from, to) {
    const map = new Map();
    dayList(pr).forEach(d => {
      if (d < from || d > to) return;
      ((pr.days[d] || {}).items || []).forEach(it => {
        const cur = map.get(it.k) || { k: it.k, n: it.n || it.k, q: 0 };
        cur.q += Number(it.q) || 0;
        map.set(it.k, cur);
      });
    });
    const out = Array.from(map.values());
    ((pr && pr.extra) || []).forEach(x => out.push({ k: x.k, n: x.n, q: Number(x.q) || 0 }));
    return out;
  }
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/,/g, "")); return isNaN(n) ? null : n; };
  const fmt = (n) => n == null ? "" : (Math.round(n * 100) / 100).toLocaleString("en-US");
  // price / fee → المجموع and الإجمالي
  function money(row, meta) {
    const price = num(meta && meta.price), fee = num(meta && meta.fee);
    const sum = price != null ? price * row.q : null;
    const total = sum != null ? sum + (fee || 0) : (fee != null ? fee : null);
    return { price, sum, fee, total };
  }

  // ---- prices (سعر المفرد) ----
  // Sources in PRIORITY order. A medicine is priced by the FIRST source that has the same or a similar drug
  // (same substance + same strength); the sources after it are ignored for that medicine. Inside one source a
  // repeated drug takes the most suitable price = the lowest. More lists are added to PRICE_SOURCES later.
  const SITE_API = "https://script.google.com/macros/s/AKfycbydN-_OZWgNhkngoC6zoqNcbMZgXQKOYun721wJyF0YxMHeFSJESDRjqz_XPUjMYKOR/exec";   // pharmacist24.github.io/drugprice
  const PRICE_CACHE = "pharma.drugprice.site";
  const PRICE_TTL = 6 * 60 * 60 * 1000;
  async function loadSite() {
    try {
      const c = JSON.parse(localStorage.getItem(PRICE_CACHE) || "null");
      if (c && Date.now() - c.t < PRICE_TTL && Array.isArray(c.list)) return c.list;
    } catch (e) { /* blocked */ }
    const res = await fetch(SITE_API);
    const j = await res.json();
    const list = ((j && j.data) || []).map(d => ({ name: String(d.drugName || "").replace(/\s+/g, " ").trim(), price: Number(d.unitPrice) }))
      .filter(d => d.name && d.price > 0);
    try { localStorage.setItem(PRICE_CACHE, JSON.stringify({ t: Date.now(), list })); } catch (e) { /* blocked */ }
    return list;
  }
  const PRICE_SOURCES = [{ id: "site", load: loadSite }];

  const WORD_SKIP = new Set(["amp", "ampule", "ampoule", "vial", "tab", "tablet", "cap", "capsule", "syrup", "inj", "iv", "i.v", "inf", "infusion", "bottle", "oint", "cream", "supp", "drop", "drops", "human", "sodium", "the", "and", "for", "of", "with"]);
  function wordsOf(name) {
    return String(name || "").toLowerCase().replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .split(/[^a-z]+/).filter(w => w.length >= 4 && !WORD_SKIP.has(w));
  }
  function numsOf(name) {
    const t = String(name || "").toLowerCase().replace(/(\d)\s*(mg|mcg|g|ml|iu|unit|units|%)/g, "$1$2");
    return (t.match(/\d+(?:\.\d+)?(?:mg|mcg|g|ml|iu|units?|%)/g) || []).map(x => x.replace(/units?$/, "unit")).sort().join(" ");
  }
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const sameWord = (a, b) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= (a.length >= 9 ? 2 : 1));
  // the kind of preparation: injectable / oral solid / oral liquid / topical / suppository ("" = not stated)
  function formClass(text) {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z]+/g, " ") + " ";
    if (/ (tab|tabs|tablet|tablets|cap|caps|capsule|capsules|effervescent) /.test(t)) return "solid";
    if (/ (amp|amps|ampule|ampoule|vial|inj|injection|inf|infusion|bottle|syringe|pen|carpule) /.test(t)) return "inj";
    if (/ (syp|syrup|susp|suspension|drop|drops|solution) /.test(t)) return "liquid";
    if (/ (oint|ointment|cream|gel) /.test(t)) return "topical";
    if (/ (supp|suppository|suppositories) /.test(t)) return "supp";
    return "";
  }
  const FORM_CLASS_OF = { vial: "inj", ampule: "inj", "prefilled-syringe": "inj", tablet: "solid", effervescent: "solid", suppository: "supp" };
  // OUR medicine: the words of its chart name (all must be found) — else its other names (English generic, trade name,
  // generic key: any of them), its form class and its strength
  function ourSide(chartName) {
    const med = ((App() && App().state.medications) || []).find(m => m && String(m.nameChart || "").trim() === chartName);
    const C = global.PharmacyClinical;
    const alt = new Set();
    if (med) [med.nameEn, med.nameTrade, C && C.genericKey ? C.genericKey(med) : ""].forEach(t => wordsOf(t).forEach(w => alt.add(w)));
    return { all: wordsOf(chartName), alt: Array.from(alt), nums: numsOf(chartName), form: formClass(chartName) || (med && FORM_CLASS_OF[med.form]) || "" };
  }
  // → the lowest price of the first source with a matching drug, else null
  function pickPrice(chartName, lists) {
    const me = ourSide(chartName);
    if (!me.all.length && !me.alt.length) return null;
    for (const list of lists) {
      const fits = list.filter(e => {
        if (numsOf(e.name) !== me.nums) return false;                               // the strength must be identical
        const cls = formClass(e.name);
        if (cls && me.form && cls !== me.form) return false;                        // the same kind of preparation (a tablet is not a vial)
        return true;
      });
      const hit = (words, every) => fits.filter(e => {
        const theirs = wordsOf(e.name);
        const ok = (w) => theirs.some(x => sameWord(w, x));
        return words.length && (every ? words.every(ok) : words.some(ok));
      });
      let found = hit(me.all, true);
      if (!found.length) found = hit(me.alt, false);
      if (found.length) return found.reduce((m, e) => Math.min(m, e.price), Infinity);
    }
    return null;
  }
  async function fetchLists() {
    const lists = [];
    for (const src of PRICE_SOURCES) {
      try { lists.push(await src.load()); } catch (e) { console.warn("[private-form] prices", src.id, e); lists.push([]); }
    }
    return lists;
  }

  // ---- 3) the printed paper (landscape A4, drawn like the ward's form — px of the sample PDF → pt) ----
  const PG = { w: 841.89, h: 595.28 };
  const K = 0.625;
  const COLS = [1256, 1222, 990, 851, 713, 591, 460, 298, 91];       // table edges, right → left
  const HEAD = [["ت"], ["اسم المادة"], ["الكمية المصروفة"], ["شراء او كيماديا"], ["سعر المفرد"], ["المجموع"], ["فراض ادارية"], ["الإجمالي"]];
  const TOP = 188, HEAD_B = 235, ROW_H = 38, ROWS = 15;
  const pt = (n) => (n * K).toFixed(2) + "pt";
  // every space between words becomes a fixed-width gap (html2canvas draws the Arabic space too tight), only outside the tags
  const spaced = (html) => String(html).replace(/(^|>)([^<]*)/g, (m, a, b) => a + b.replace(/ /g, '<span class="sp"></span>'));
  // «label:» — the colon is its own element (html2canvas misplaces a colon that ends an Arabic word)
  // a Latin name (a medicine) keeps its own left-to-right word order inside the Arabic page
  const ltr = (t) => /[؀-ۿ]/.test(t) ? esc(t) : '<span style="direction:ltr;unicode-bidi:isolate;display:inline-block">' + esc(t) + "</span>";
  const lab = (t) => t.replace(/:$/, "") + "<span>:</span>";
  const box = (cls, x0, x1, y, h, html, fs) =>
    '<div class="t ' + cls + '" style="left:' + pt(x0) + ";width:" + pt(x1 - x0) + ";top:" + pt(y) + ";height:" + pt(h) + (fs ? ";font-size:" + fs + "pt" : "") + '">' + spaced(html) + "</div>";
  const vline = (x, y0, y1, c, w) => '<div class="g" style="left:' + pt(x) + ";top:" + pt(y0) + ";width:" + (w || 0.75) + "pt;height:" + pt(y1 - y0) + ";background:" + (c || "#b5b5b5") + '"></div>';
  const hline = (x0, x1, y, c, w) => '<div class="g" style="left:' + pt(x0) + ";top:" + pt(y) + ";width:" + pt(x1 - x0) + ";height:" + (w || 0.75) + "pt;background:" + (c || "#b5b5b5") + '"></div>';

  function cssText(S) {
    const f = (n) => new URL("fonts/" + n, location.href).href;
    return `
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Regular.ttf")}") format("truetype"); font-weight: 400; font-display: block; }
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Bold.ttf")}") format("truetype"); font-weight: 700; font-display: block; }
    ${S}, ${S} * { box-sizing: border-box; }
    ${S} { margin: 0; padding: 0; background: #fff; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #000; word-spacing: 0.25em; }
    ${S} .pg { position: relative; width: ${PG.w}pt; height: ${PG.h}pt; overflow: hidden; }
    ${S} .t { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; padding: 0 3pt; font-weight: 400; font-size: 11pt; line-height: 1.15; white-space: nowrap; }
    ${S} .t.s { justify-content: flex-start; text-align: right; }
    ${S} .t.b { font-weight: 700; word-spacing: 0.4em; }
    ${S} .t.v { overflow: visible; }
    ${S} .g { position: absolute; }
    ${S} .sp { display: inline-block; width: 0.32em; }
  `;
  }

  // form = { name, plate, from, to, rows: [{ n, q, src, price, sum, fee, total }] }
  function pagesOf(form) {
    const pages = [];
    const n = Math.max(1, Math.ceil(form.rows.length / ROWS));
    for (let pi = 0; pi < n; pi++) {
      let h = '<div class="pg">';
      h += box("s b v", 620, 1228, 25, 44, "<span>مستشفى بغداد التعليمي</span> <span>-</span> <span>وحدة الصيدلة السريرية</span>", 11);
      h += box("s b v", 91, 571, 25, 44, "القطاع الخاص للمرضى الراقدين في الجناح الخاص", 11);
      h += box("s b v", 900, 1220, 86, 44, lab("قائمة الادوية المصروفة من تاريخ:"), 11);
      h += box("v", 790, 940, 86, 44, esc(form.from), 11);     // centred between «من تاريخ:» and «لغاية:»
      h += box("s b v", 700, 780, 86, 44, lab("لغاية:"), 11);
      h += box("s v", 540, 728, 86, 44, esc(form.to), 11);      // right next to «لغاية:»
      h += box("s b v", 1085, 1218, 125, 44, lab("اسم المريض:"), 11);
      h += box("s v", 800, 1104, 125, 44, esc(form.name), 11);
      h += box("s b v", 680, 808, 125, 44, lab("رقم الطبلة:"), 11);
      h += box("s v", 520, 708, 125, 44, esc(form.plate), 11);
      // the ruled table: outer lines, the column lines, the header line (darker), a line under each row
      const bottom = HEAD_B + ROWS * ROW_H;
      h += hline(COLS[8], COLS[0], TOP, "#9a9a9a") + hline(COLS[8], COLS[0], bottom, "#9a9a9a");
      h += hline(COLS[8], COLS[0], HEAD_B, "#8a8a8a", 1.4);
      COLS.forEach(x => { h += vline(x, TOP, bottom, "#9a9a9a"); });
      for (let i = 1; i < ROWS; i++) h += hline(COLS[8], COLS[0], HEAD_B + i * ROW_H);
      HEAD.forEach(([t], i) => { h += box("b", COLS[i + 1], COLS[i], TOP, HEAD_B - TOP, t, 10); });
      form.rows.slice(pi * ROWS, (pi + 1) * ROWS).forEach((r, i) => {
        const y = HEAD_B + i * ROW_H;
        const cells = [String(pi * ROWS + i + 1), ltr(String(r.n)), r.q ? String(r.q) : "", esc(r.src), fmt(r.price), fmt(r.sum), fmt(r.fee), fmt(r.total)];
        cells.forEach((c, ci) => {
          const long = ci === 1 && String(r.n).length > 26;
          h += box(ci === 1 ? "s" : "", COLS[ci + 1], COLS[ci], y, ROW_H, c, long ? 8.5 : 11);
        });
      });
      h += box("b", 947, 1247, 828, 48, "الصيدلي السريري", 11);
      h += box("b", 555, 855, 828, 48, "محاسب الجناح الخاص", 11);
      h += box("b", 161, 461, 828, 48, "مدير الجناح الخاص", 11);
      pages.push(h + "</div>");
    }
    return pages;
  }

  // draws every page (html2canvas) and hands each canvas to each(canvas, index)
  // opts (optional): { w, h, css, rootId } — the page size in pt, its stylesheet and root id (default = the private form)
  async function renderPages(pages, each, opts) {
    opts = opts || {};
    const W = opts.w || PG.w, H = opts.h || PG.h, rootId = opts.rootId || "pf-pdf-root";
    const H2P = global.html2pdf;
    if (!H2P) throw new Error("مكتبة PDF غير محمّلة — تحقق من الاتصال بالإنترنت");
    const style = document.createElement("style");
    style.textContent = opts.css || cssText("#pf-pdf-root");
    document.head.appendChild(style);
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:" + W + "pt;pointer-events:none;";
    document.body.appendChild(holder);
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.all([document.fonts.load("400 12pt Cairo"), document.fonts.load("700 12pt Cairo")]).catch(() => {});
        await document.fonts.ready;
      }
      for (let i = 0; i < pages.length; i++) {
        const root = document.createElement("div");
        root.id = rootId;
        root.style.cssText = "width:" + W + "pt;height:" + H + "pt;";
        root.innerHTML = pages[i];
        holder.innerHTML = "";
        holder.appendChild(root);
        // a background picture must be decoded before the page is photographed
        await Promise.all(Array.from(root.querySelectorAll("img")).map(im => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
        const canvas = await H2P().set({ jsPDF: { unit: "pt", format: [W, H], orientation: W > H ? "landscape" : "portrait" }, html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 } }).from(root).toCanvas().get("canvas");
        each(canvas, i);
      }
    } finally {
      holder.remove();
      style.remove();
    }
  }

  async function buildPdf(pages) {
    const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!JsPDF) throw new Error("مكتبة PDF غير محمّلة — تحقق من الاتصال بالإنترنت");
    const pdf = new JsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    await renderPages(pages, (canvas, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, PG.w, PG.h);
    });
    return pdf.output("blob");
  }

  // ---- 4) the editor ----
  let S = null;            // { key, p, pr, name, plate }
  let saveTimer = null;

  // a message that shows ABOVE the editor / preview (the app's own toast is hidden behind them)
  function flash(msg) {
    let t = $("pfe-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "pfe-toast";
      t.style.cssText = "position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 14px);z-index:100000;background:#1f2937;color:#fff;padding:12px 16px;border-radius:14px;font:700 14px/1.6 inherit;font-family:inherit;text-align:center;direction:rtl;box-shadow:0 8px 24px rgba(0,0,0,.35);";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.hidden = true; }, 5000);
  }
  function saveSoon() {
    if (!S || !S.key) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { const a = App(); if (a && S && S.key) a.savePatient(S.key); }, 700);
  }

  function ensureStyle() {
    if ($("pfe-style")) return;
    const st = document.createElement("style");
    st.id = "pfe-style";
    st.textContent = `
    #pf-preview { position: fixed; inset: 0; z-index: 400; background: #4b5563; display: flex; flex-direction: column; direction: rtl; font-family: inherit; }
    #pf-preview .pfv-bar { flex: none; display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px; background: #14211f; color: #fff; }
    #pf-preview .pfv-bar strong { flex: 1; font-size: 14px; min-width: 0; }
    #pf-preview .pfv-bar button { height: 38px; border: 0; border-radius: 10px; font: inherit; font-weight: 800; cursor: pointer; background: #fff; color: #14211f; }
    #pf-preview .pfv-x { width: 38px; font-size: 16px; background: rgba(255,255,255,.2) !important; color: #fff !important; border-radius: 50% !important; }
    #pf-preview .pfv-z { width: 38px; font-size: 20px; line-height: 1; }
    #pf-preview .pfv-save { padding: 0 14px; background: #f5b301 !important; }
    #pf-preview .pfv-bar button:disabled { opacity: .6; }
    #pf-preview .pfv-body { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; padding: 12px; }
    #pf-preview .pfv-body img { display: block; width: 100%; height: auto; margin: 0 auto 12px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.35); }

    #pf-editor { position: fixed; inset: 0; z-index: 300; background: var(--bg, #f3f6f9); display: flex; flex-direction: column; direction: rtl; color: var(--text, #14211f); font-family: inherit; }
    #pf-editor * { box-sizing: border-box; }
    #pf-editor .pfe-top { flex: none; display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px; background: var(--fill, var(--primary, #1f6f9f)); color: #fff; }
    #pf-editor .pfe-top .pfe-x { width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(255,255,255,.2); color: #fff; font-size: 18px; cursor: pointer; flex: none; }
    #pf-editor .pfe-top h3 { margin: 0; font-size: 16px; font-weight: 800; line-height: 1.3; }
    #pf-editor .pfe-top small { display: block; font-size: 12px; opacity: .85; font-weight: 600; margin-top: 2px; }
    #pf-editor .pfe-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 14px 18px; }
    #pf-editor .pfe-wrap { max-width: 720px; margin: 0 auto; }
    #pf-editor .pfe-card { background: var(--surface, #fff); border: 1px solid var(--border, #dbe2e8); border-radius: 16px; padding: 14px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    #pf-editor .pfe-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 12px; font-size: 15px; font-weight: 800; }
    #pf-editor .pfe-badge { background: var(--bg, #eef2f6); color: var(--text-muted, #5c6b73); border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
    #pf-editor .pfe-who { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border, #dbe2e8); }
    #pf-editor .pfe-av { width: 46px; height: 46px; border-radius: 50%; background: var(--fill, var(--primary, #1f6f9f)); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; flex: none; }
    #pf-editor .pfe-who b { display: block; font-size: 16px; }
    #pf-editor .pfe-chip { display: inline-block; margin: 5px 0 0 6px; background: var(--bg, #eef2f6); border-radius: 8px; padding: 2px 9px; font-size: 12px; font-weight: 700; color: var(--text-muted, #5c6b73); }
    #pf-editor .pfe-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #pf-editor .pfe-fields .full { grid-column: 1 / -1; }
    #pf-editor label.pfe-f { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; color: var(--text-muted, #5c6b73); min-width: 0; }
    #pf-editor input, #pf-editor select { font: inherit; font-size: 15px; height: 42px; padding: 0 12px; border-radius: 12px; border: 1.5px solid var(--border, #dbe2e8); background: var(--surface, #fff); color: var(--text, #14211f); width: 100%; min-width: 0; }
    #pf-editor input:focus, #pf-editor select:focus { outline: none; border-color: var(--primary, #1f6f9f); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #1f6f9f) 18%, transparent); }
    #pf-editor .pfe-mat { border: 1px solid var(--border, #dbe2e8); border-radius: 14px; padding: 12px; margin-bottom: 10px; background: var(--surface, #fff); }
    #pf-editor .pfe-mat-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    #pf-editor .pfe-no { width: 26px; height: 26px; border-radius: 50%; background: var(--bg, #eef2f6); color: var(--text-muted, #5c6b73); font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: none; }
    #pf-editor .pfe-mat-name { flex: 1; min-width: 0; font-weight: 800; font-size: 14.5px; text-align: start; overflow-wrap: anywhere; }
    #pf-editor .pfe-qty { flex: none; background: var(--fill, var(--primary, #1f6f9f)); color: #fff; border-radius: 10px; padding: 4px 12px; font-weight: 800; font-size: 15px; }
    #pf-editor .pfe-mat-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #pf-editor .pfe-money { position: relative; display: block; }
    #pf-editor .pfe-money input { padding-inline-end: 44px; }
    #pf-editor .pfe-money em { position: absolute; inset-inline-end: 12px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 12px; color: var(--text-muted, #5c6b73); font-weight: 700; pointer-events: none; }
    #pf-editor .pfe-badge:empty { display: none; }
    #pf-editor .pfe-mat-fields { align-items: start; }
    #pf-editor .pfe-auto { font-size: 11px; color: var(--text-muted, #5c6b73); font-weight: 600; }
    #pf-editor .pfe-empty { text-align: center; color: var(--text-muted, #5c6b73); font-size: 13px; padding: 18px 8px; line-height: 1.7; }
    #pf-editor details.pfe-card > summary { cursor: pointer; font-size: 15px; font-weight: 800; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #pf-editor details.pfe-card > summary::-webkit-details-marker { display: none; }
    #pf-editor details.pfe-card > summary::after { content: "›"; transform: rotate(-90deg); font-size: 20px; color: var(--text-muted, #5c6b73); transition: transform .15s; }
    #pf-editor details.pfe-card[open] > summary::after { transform: rotate(90deg); }
    #pf-editor details.pfe-card > .pfe-in { margin-top: 12px; }
    #pf-editor .pfe-day { border-top: 1px dashed var(--border, #dbe2e8); padding-top: 10px; margin-top: 10px; }
    #pf-editor .pfe-day > b { font-size: 13px; color: var(--text-muted, #5c6b73); }
    #pf-editor .pfe-it { display: grid; grid-template-columns: 1fr 78px 38px; gap: 8px; align-items: center; margin-top: 8px; font-size: 13.5px; }
    #pf-editor .pfe-it span { overflow-wrap: anywhere; font-weight: 700; }
    #pf-editor .pfe-it input { height: 38px; text-align: center; }
    #pf-editor .pfe-it button { height: 38px; border: 0; border-radius: 10px; background: var(--bg, #eef2f6); color: var(--text, #14211f); font-size: 14px; cursor: pointer; }
    #pf-editor .pfe-addrow { display: grid; grid-template-columns: 1fr 78px; gap: 8px; margin-top: 10px; }
    #pf-editor .pfe-ac { position: relative; min-width: 0; }
    #pf-editor .pfe-sug { position: absolute; inset-inline: 0; top: calc(100% + 4px); z-index: 5; max-height: 240px; overflow-y: auto; background: var(--surface, #fff); border: 1px solid var(--border, #dbe2e8); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    #pf-editor .pfe-sug[hidden] { display: none; }
    #pf-editor .pfe-sug button { display: block; width: 100%; text-align: start; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border, #dbe2e8); background: transparent; color: var(--text, #14211f); font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
    #pf-editor .pfe-sug button:last-child { border-bottom: 0; }
    #pf-editor .pfe-sug button small { display: block; font-weight: 600; color: var(--text-muted, #5c6b73); font-size: 11.5px; }
    #pf-editor .pfe-sug .pfe-none { padding: 10px 12px; font-size: 12.5px; color: var(--text-muted, #5c6b73); }
    #pf-editor .pfe-addbtn { grid-column: 1 / -1; height: 42px; border: 0; border-radius: 12px; background: var(--bg, #eef2f6); color: var(--text, #14211f); font: inherit; font-weight: 800; cursor: pointer; }
    #pf-editor .pfe-hint { font-size: 12px; color: var(--text-muted, #5c6b73); margin: 8px 0 0; line-height: 1.7; }
    #pf-editor .pfe-bottom { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px); background: var(--surface, #fff); border-top: 1px solid var(--border, #dbe2e8); }
    #pf-editor .pfe-sum { flex: 1; font-size: 13px; font-weight: 700; color: var(--text-muted, #5c6b73); line-height: 1.5; }
    #pf-editor .pfe-sum b { color: var(--text, #14211f); font-size: 16px; }
    #pf-editor .pfe-pv { flex: none; height: 46px; padding: 0 16px; border: 1.5px solid var(--fill, var(--primary, #1f6f9f)); border-radius: 14px; background: var(--surface, #fff); color: var(--fill, var(--primary, #1f6f9f)); font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
    #pf-editor .pfe-pv:disabled { opacity: .6; }
    #pf-editor .pfe-go { flex: none; height: 46px; padding: 0 22px; border: 0; border-radius: 14px; background: var(--fill, var(--primary, #1f6f9f)); color: #fff; font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
    #pf-editor .pfe-go:disabled { opacity: .6; }
    `;
    document.head.appendChild(st);
  }

  function close() {
    const pv = $("pf-preview");
    if (pv) pv.remove();
    if (global.visualViewport) global.visualViewport.removeEventListener("resize", fitSuggestions);
    const e = $("pf-editor");
    if (e) e.remove();
    if (S && S.key) { clearTimeout(saveTimer); const a = App(); if (a) a.savePatient(S.key); }
    S = null;
  }

  function formData() {
    const r = rng();
    const rows = rowsOf(S.pr, r.from, r.to).map(x => {
      const meta = S.pr.meta[x.k] || {};
      // المجموع / فراض ادارية / الإجمالي are the accountant's: left blank on the paper
      return { n: x.n, k: x.k, q: x.q, src: srcOf(meta), price: num(meta.price), sum: null, fee: null, total: null };
    });
    return { name: S.name, plate: S.plate, from: r.from.replace(/-/g, "/"), to: r.to.replace(/-/g, "/"), rows };
  }

  const fmtDay = (d) => d.replace(/-/g, "/");

  function renderDays() {
    const pr = S.pr;
    const days = dayList(pr);
    $("pfe-days-count").textContent = days.length ? days.length + " يوم" : "—";
    const box = $("pfe-days");
    if (!days.length) { box.innerHTML = '<div class="pfe-empty">لم يُسجَّل بعد أي إرسال إلى جارت الخاص لهذا المريض.<br>أرسل الجارت أولاً، أو أضف الأدوية من قسم «أدوية أضافها الخفر».</div>'; return; }
    box.innerHTML = days.map(d => {
      const items = (pr.days[d] || {}).items || [];
      return '<div class="pfe-day" data-day="' + d + '"><b>' + fmtDay(d) + "</b>" +
        items.map((it, i) => '<div class="pfe-it" data-i="' + i + '"><span dir="auto">' + esc(it.n) + '</span><input type="number" min="0" inputmode="numeric" class="pfe-dq" value="' + esc(it.q) + '" aria-label="الكمية"><button type="button" class="pfe-dx" aria-label="حذف">✕</button></div>').join("") +
        "</div>";
    }).join("");
  }

  function renderExtra() {
    const ex = S.pr.extra;
    $("pfe-extra-count").textContent = ex.length ? ex.length + " مادة" : "";
    $("pfe-extra").innerHTML = ex.map((x, i) => '<div class="pfe-it" data-i="' + i + '"><span dir="auto">' + esc(x.n) + '</span><input type="number" min="0" inputmode="numeric" class="pfe-eq" value="' + esc(x.q) + '" aria-label="العدد"><button type="button" class="pfe-ex" aria-label="حذف">✕</button></div>').join("");
  }

  function renderTable() {
    const f = formData();
    const body = f.rows.map((r, i) => {
      const meta = S.pr.meta[r.k] || {};
      const src = srcOf(meta);
      return '<div class="pfe-mat" data-k="' + esc(r.k) + '">' +
        '<div class="pfe-mat-top"><span class="pfe-no">' + (i + 1) + '</span><span class="pfe-mat-name" dir="auto">' + esc(r.n) + '</span><span class="pfe-qty" dir="ltr">× ' + r.q + "</span></div>" +
        '<div class="pfe-mat-fields">' +
          '<label class="pfe-f">المصدر<select class="pfe-src"><option value="">—</option><option value="شراء"' + (src === "شراء" ? " selected" : "") + '>شراء</option><option value="كيماديا"' + (src === "كيماديا" ? " selected" : "") + ">كيماديا</option></select></label>" +
          '<label class="pfe-f">سعر المفرد' +
            '<span class="pfe-money"><input class="pfe-price" inputmode="decimal" placeholder="—" value="' + esc(meta.price || "") + '"><em>د.ع</em></span>' +
            (meta.auto && !meta.hand ? '<span class="pfe-auto">من موقع الأسعار</span>' : "") + "</label>" +
        "</div></div>";
    }).join("");
    $("pfe-tbody").innerHTML = body || '<div class="pfe-empty">لا توجد مواد في الفترة المختارة.<br>غيّر تاريخ الدخول أو الخروج، أو أضف دواءً من قسم «أدوية أضافها الخفر».</div>';
    $("pfe-count").textContent = f.rows.length ? f.rows.length + " مادة" : "—";
    const units = f.rows.reduce((a, r) => a + (Number(r.q) || 0), 0);
    $("pfe-sum").innerHTML = f.rows.length ? "<b>" + f.rows.length + "</b> مادة · <b>" + units + "</b> وحدة" : "لا توجد مواد";
  }

  function renderAll() { renderDays(); renderExtra(); renderTable(); }

  // catalogue suggestions for the typed text: every typed word must be in the medicine's names / dose
  function suggestions(q) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    ((App() && App().state.medications) || []).forEach(m => {
      if (!m || out.length >= 8) return;
      const hay = [m.nameTrade, m.nameEn, m.nameAr, m.nameChart, m.defaultDose, m.id].join(" ").toLowerCase();
      if (!words.every(w => hay.indexOf(w) >= 0)) return;
      const label = String(m.nameChart || "").trim() || [m.nameTrade || m.nameEn, m.defaultDose].filter(Boolean).join(" ");
      const sub = [m.nameAr, m.nameEn && m.nameEn !== m.nameTrade ? m.nameEn : "", m.available === false ? "غير متوفر" : ""].filter(Boolean).join(" · ");
      out.push({ label, sub });
    });
    return out;
  }
  // On a phone the keyboard covers the lower part of the screen: bring the field to the top of the visible area,
  // give the page room to scroll, and size the list to what is left above the keyboard.
  function fitSuggestions() {
    const box = $("pfe-sug"), xn = $("pfe-xn");
    const sc = document.querySelector("#pf-editor .pfe-scroll"), top = document.querySelector("#pf-editor .pfe-top");
    if (!box || !xn || !sc || !top || box.hidden) return;
    const vv = global.visualViewport;
    const visibleBottom = (vv ? vv.offsetTop + vv.height : global.innerHeight) - 8;
    sc.style.paddingBottom = "70vh";
    sc.scrollTop += xn.getBoundingClientRect().top - (top.getBoundingClientRect().bottom + 12);
    box.style.maxHeight = Math.max(110, Math.min(260, visibleBottom - xn.getBoundingClientRect().bottom - 8)) + "px";
  }
  function relaxScroll() { const sc = document.querySelector("#pf-editor .pfe-scroll"); if (sc) sc.style.paddingBottom = ""; }

  function showSuggestions() {
    const box = $("pfe-sug"), q = $("pfe-xn").value.trim();
    if (!box) return;
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const list = suggestions(q);
    box.innerHTML = list.length
      ? list.map((x, i) => '<button type="button" data-i="' + i + '"><span dir="auto">' + esc(x.label) + "</span>" + (x.sub ? "<small dir=\"auto\">" + esc(x.sub) + "</small>" : "") + "</button>").join("")
      : '<div class="pfe-none">لا يوجد في الكتالوج — يُضاف بالاسم كما كتبته</div>';
    box._list = list;
    box.hidden = false;
    fitSuggestions();
    setTimeout(fitSuggestions, 250);          // again once the keyboard has finished opening
  }

  // key = a bed in the ward; or key null + source = an archived record (المرضى السابقون) with opts { roomId, exit }
  function open(key, source, opts) {
    const A = global.PharmacyAuth;
    if (!(A && (A.isAdmin() || (A.isPharmacist && A.isPharmacist())))) return;
    const app = App();
    const p = source || (app && app.state.patients[key]);
    if (!p) return;
    ensureStyle();
    opts = opts || {};
    const r = key ? roomOfKey(key) : (opts.roomId ? global.PharmacyWard.roomById(opts.roomId) : null);
    const pr = priv(p, true);
    // الردهة is left empty (the unit is already known in the app); the pharmacist may type it
    const mine0 = S = { key: key || null, p, pr, admitted: "", exit: opts.exit || "", name: String(p.name || "").trim(), plate: String(p.plateNumber || "").trim() };
    const old = $("pf-editor");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "pf-editor";
    const rg = rng();
    const initial = (S.name || "؟").charAt(0);
    el.innerHTML =
      '<div class="pfe-top"><button type="button" class="pfe-x" id="pfe-close" aria-label="إغلاق">✕</button><div><h3>استمارة خروج الخاص</h3><small>' + esc(S.name) + "</small></div></div>" +
      '<div class="pfe-scroll"><div class="pfe-wrap">' +
        '<div class="pfe-card"><h4 class="pfe-h">بيانات المريض</h4>' +
          '<div class="pfe-who"><span class="pfe-av">' + esc(initial) + "</span><div><b>" + esc(S.name) + '</b><span class="pfe-chip">رقم الطبلة: ' + esc(S.plate || "—") + "</span></div></div>" +
          '<div class="pfe-fields">' +
            '<label class="pfe-f">تاريخ الدخول<input type="date" id="pfe-from" value="' + rg.from + '"></label>' +
            '<label class="pfe-f">تاريخ الخروج<input type="date" id="pfe-to" value="' + rg.to + '"></label>' +
          "</div>" + (S.key ? "" : '<p class="pfe-hint">هذا السجل من المرضى السابقين: يمكنك تعديل الأرقام والطباعة، لكن التعديلات لا تُحفظ.</p>') + "</div>" +
        '<div class="pfe-card"><h4 class="pfe-h">المواد المصروفة <span class="pfe-badge" id="pfe-count">—</span></h4><div id="pfe-tbody"></div>' +
          '<p class="pfe-hint">أعمدة المجموع والفراض الإدارية والإجمالي تُترك فارغة في الورقة (تخص المحاسب). سعر المفرد يُجلب من موقع الأسعار تلقائيًا ويمكنك تعديله.</p></div>' +
        '<details class="pfe-card"><summary>الإرسالات المسجّلة يوميًا <span class="pfe-badge" id="pfe-days-count">—</span></summary><div class="pfe-in"><div id="pfe-days"></div>' +
          '<p class="pfe-hint">يُسجَّل كل يوم ما أُرسل إلى جارت الخاص وكان <b>متوفرًا</b> وقت الإرسال. عدّل الكمية أو احذف المادة إن لم يستلمها المريض.</p></div></details>' +
        '<details class="pfe-card"' + (S.pr.extra.length ? " open" : "") + '><summary>أدوية أضافها الخفر <span class="pfe-badge" id="pfe-extra-count"></span></summary><div class="pfe-in">' +
          '<p class="pfe-hint" style="margin:0 0 6px">أدوية أضافها صيدلي الخفر ولم تُرسل من هنا. اكتب اسم الدواء فتظهر اقتراحات من الكتالوج.</p><div id="pfe-extra"></div>' +
          '<div class="pfe-addrow"><div class="pfe-ac"><input id="pfe-xn" placeholder="اسم الدواء" autocomplete="off" autocorrect="off" spellcheck="false"><div class="pfe-sug" id="pfe-sug" hidden></div></div><input id="pfe-xq" type="number" min="1" inputmode="numeric" placeholder="العدد"><button type="button" class="pfe-addbtn" id="pfe-xadd">+ إضافة الدواء</button></div></div></details>' +
      "</div></div>" +
      '<div class="pfe-bottom"><div class="pfe-sum" id="pfe-sum"></div><button type="button" class="pfe-pv" id="pfe-preview">معاينة</button><button type="button" class="pfe-go" id="pfe-pdf">📄 حفظ PDF</button></div>';
    document.body.appendChild(el);
    renderAll();
    // the entry date comes from the patient's log (the «admitted» event of this stay)
    const PH = global.PharmacyPatientHistory;
    if (S.key && !pr.from && PH && PH.fetchStay) {
      const mine = S;
      PH.fetchStay(S.key, S.name).then(events => {
        const adm = (events || []).find(e => e.event === "admitted");
        const day = adm ? localDay(adm.created_at) : "";
        if (S !== mine || !day || mine.pr.from) return;
        mine.admitted = day;
        const f = $("pfe-from");
        if (f) f.value = rng().from;
        renderTable();
      }).catch(() => { /* offline: the first sent day is used */ });
    }

    // unit prices from the price lists (the site first); a price typed by hand is never replaced
    fetchLists().then(lists => {
      if (S !== mine0) return;
      let any = false;
      rowsOf(S.pr, rng().from, rng().to).forEach(x => {
        const meta = (S.pr.meta[x.k] = S.pr.meta[x.k] || {});
        if (meta.price || meta.hand) return;
        const p = pickPrice(x.n, lists);
        if (p != null) { meta.price = String(p); meta.auto = true; any = true; }
      });
      if (any) { saveSoon(); renderTable(); }
    }).catch(() => {});

    $("pfe-close").addEventListener("click", close);
    $("pfe-xn").addEventListener("input", showSuggestions);
    $("pfe-xn").addEventListener("focus", showSuggestions);
    $("pfe-xn").addEventListener("blur", () => setTimeout(() => { const sg = $("pfe-sug"); if (sg) sg.hidden = true; relaxScroll(); }, 200));
    $("pfe-sug").addEventListener("mousedown", (e) => e.preventDefault());       // choosing a suggestion keeps the keyboard / field focus
    if (global.visualViewport) global.visualViewport.addEventListener("resize", fitSuggestions);
    $("pfe-sug").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const pick = $("pfe-sug")._list[+b.dataset.i];
      $("pfe-xn").value = pick.label;
      $("pfe-sug").hidden = true;
      $("pfe-xq").focus();
    });
    ["pfe-from", "pfe-to"].forEach(id => $(id).addEventListener("change", (e) => {
      if (!isDay(e.target.value)) return;
      S.pr[id === "pfe-from" ? "from" : "to"] = e.target.value;
      saveSoon(); renderTable();
    }));
    el.addEventListener("change", (e) => {
      const t = e.target, c = t.classList;
      if (c.contains("pfe-dq")) {
        const day = t.closest(".pfe-day").dataset.day, i = +t.closest(".pfe-it").dataset.i;
        const it = S.pr.days[day].items[i];
        const q = parseInt(t.value, 10);
        it.q = isNaN(q) || q < 0 ? 0 : q;
        saveSoon(); renderTable();
      } else if (c.contains("pfe-eq")) {
        const i = +t.closest(".pfe-it").dataset.i;
        const q = parseInt(t.value, 10);
        S.pr.extra[i].q = isNaN(q) || q < 0 ? 0 : q;
        saveSoon(); renderTable();
      } else if (c.contains("pfe-src")) {
        const k = t.closest("[data-k]").dataset.k;
        (S.pr.meta[k] = S.pr.meta[k] || {}).src = t.value;
        saveSoon();
      }
    });
    el.addEventListener("input", (e) => {
      const t = e.target, c = t.classList;
      if (!c.contains("pfe-price")) return;
      const k = t.closest("[data-k]").dataset.k;
      const meta = (S.pr.meta[k] = S.pr.meta[k] || {});
      meta.price = t.value; meta.hand = true;                 // typed by hand: never replaced by a list
      saveSoon();
    });
    el.addEventListener("click", (e) => {
      const t = e.target;
      if (!t.closest(".pfe-ac")) { const sg = $("pfe-sug"); if (sg) sg.hidden = true; }
      if (t.classList.contains("pfe-dx")) {
        const day = t.closest(".pfe-day").dataset.day, i = +t.closest(".pfe-it").dataset.i;
        S.pr.days[day].items.splice(i, 1);
        if (!S.pr.days[day].items.length) delete S.pr.days[day];
        saveSoon(); renderAll();
      } else if (t.classList.contains("pfe-ex")) {
        S.pr.extra.splice(+t.closest(".pfe-it").dataset.i, 1);
        saveSoon(); renderAll();
      } else if (t.id === "pfe-xadd") {
        const n = $("pfe-xn").value.trim(), q = parseInt($("pfe-xq").value, 10);
        if (!n || isNaN(q) || q < 1) { flash("اكتب اسم الدواء والعدد"); return; }
        S.pr.extra.push({ k: "x:" + Date.now(), n, q });
        $("pfe-xn").value = ""; $("pfe-xq").value = ""; $("pfe-sug").hidden = true;
        saveSoon(); renderAll();
      }
    });
    $("pfe-pdf").addEventListener("click", () => savePdf($("pfe-pdf")));
    $("pfe-preview").addEventListener("click", () => showPreview($("pfe-preview")));
  }

  async function savePdf(b) {
    if (!S || (b && b.disabled)) return;
    const label = b ? b.textContent : "";
    if (b) { b.disabled = true; b.textContent = "جارٍ إنشاء الملف…"; }
    try {
      const f = formData();
      if (!f.rows.length) { flash("لا توجد مواد في الفترة المختارة"); return; }
      const blob = await buildPdf(pagesOf(f));
      const H = global.PharmacyHandover;
      const name = "خروج-الخاص-" + String(S.name || "مريض").replace(/[\\/:*?"<>|\s]+/g, "-") + ".pdf";
      if (H && H.deliverPdf) await H.deliverPdf(blob, name);
    } catch (err) {
      console.error("[private-form] pdf", err);
      flash("تعذّر إنشاء الملف: " + (err && err.message || err));
    } finally { if (b) { b.disabled = false; b.textContent = label; } }
  }

  // «معاينة»: the pages exactly as they will print, in a viewer (zoom − / +, save from there too)
  // a full-screen viewer of the page pictures: zoom − / +, close, and a save button that calls saveFn
  function openViewer(urls, saveFn) {
    ensureStyle();
    const old = $("pf-preview");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "pf-preview";
    el.innerHTML =
      '<div class="pfv-bar"><button type="button" class="pfv-x" id="pfv-close" aria-label="إغلاق">✕</button><strong>معاينة الاستمارة' + (urls.length > 1 ? " (" + urls.length + " صفحات)" : "") + '</strong>' +
      '<button type="button" class="pfv-z" id="pfv-out" aria-label="تصغير">−</button><button type="button" class="pfv-z" id="pfv-in" aria-label="تكبير">+</button>' +
      '<button type="button" class="pfv-save" id="pfv-save">📄 حفظ PDF</button></div>' +
      '<div class="pfv-body" id="pfv-body">' + urls.map(u => '<img alt="" src="' + u + '">').join("") + "</div>";
    document.body.appendChild(el);
    let zoom = 100;
    const body = $("pfv-body");
    const apply = () => { body.querySelectorAll("img").forEach(i => { i.style.width = zoom + "%"; }); };
    $("pfv-in").addEventListener("click", () => { zoom = Math.min(300, zoom + 40); apply(); });
    $("pfv-out").addEventListener("click", () => { zoom = Math.max(100, zoom - 40); apply(); });
    const toast = $("pfe-toast"); if (toast) toast.hidden = true;
    $("pfv-close").addEventListener("click", () => el.remove());
    $("pfv-save").addEventListener("click", saveFn);
  }

  async function showPreview(b) {
    if (!S || b.disabled) return;
    const f = formData();
    if (!f.rows.length) { flash("لا توجد مواد في الفترة المختارة"); return; }
    const label = b.textContent;
    b.disabled = true; b.textContent = "جارٍ التجهيز…";
    flash("جارٍ تجهيز المعاينة… قد تستغرق بضع ثوانٍ");
    try {
      const canvases = [];
      await renderPages(pagesOf(f), (canvas) => canvases.push(canvas));
      const urls = [];
      for (const c of canvases) {
        // a blob URL is lighter than a giant data: URL (iPhone)
        const blob = await new Promise(res => { try { c.toBlob(res, "image/jpeg", 0.9); } catch (e) { res(null); } });
        urls.push(blob ? URL.createObjectURL(blob) : c.toDataURL("image/jpeg", 0.9));
      }
      openViewer(urls, () => savePdf($("pfv-save")));
    } catch (err) {
      console.error("[private-form] preview", err);
      flash("تعذّرت المعاينة: " + (err && err.message || err));
    } finally { b.disabled = false; b.textContent = label; }
  }

  function init() {
    const btn = $("private-form-btn");
    if (btn) btn.addEventListener("click", () => {
      const app = App();
      if (app && app.state.currentBed) open(app.state.currentBed.key);
    });
  }

  global.PharmacyPrivateForm = { record, open, isPrivateBed, isPrivateRoom: (id) => { const r = global.PharmacyWard.roomById(id); return !!(r && r.kind === "private"); }, localDay, rowsOf, pagesOf, buildPdf, money, pickPrice, renderPages, openViewer, ensureStyle, flash };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
