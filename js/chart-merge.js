/* ============================================================
   chart-merge.js  —  merges our table into the chart app's chart
   ============================================================
   Pure logic, used by the server function api/chart-sync.js (Node)
   and by the tests (scripts/test-chart-merge.js).

   The chart app's data (GET /api/chart):
     chart.patients   [{ row_number, patient_name, patient_id }]   41 rows
     chart.columns    [{ column_number, medicine_name }]           51 columns
     chart.quantities [{ row_number, column_number, quantity }]
   and it saves (PUT /api/chart) the whole grid:
     { patients: [{rowNumber, name, patientId}], columns: [{columnNumber,
       medicineName}], quantities: [{rowNumber, columnNumber, quantity}] }

   Our table (chart-bridge buildChartTSV): first line "\t\t" + medicine
   names, then one line per patient: name \t plate number \t quantities.

   Merge rules (same as a person filling the grid by hand):
     - a medicine already in a column keeps that column; a new one takes
       the first empty column — and when none is left, a NEW column is
       added after the last one (what the «إضافة عمود» button does; the
       chart keeps columns above its 51 — tested live, 52 and 60 saved —
       up to MAX_COLS)
     - a patient already in a row (same plate number, or same name when
       there is no plate) keeps that row; a new one takes the first
       empty row
     - when the chart has no empty row left (41 rows, 50 beds), the patients
       that did not fit are returned as `overflow` — api/chart-sync.js sends
       them to the chart app's «الجارت الإضافي» (slot "extra"), which is a
       second chart with its own rows and columns
     - our quantities replace the cell; other cells are left untouched
     - non-numeric quantities (كل يومين…) are skipped and reported
     - the chart's server silently DROPS a column whose medicine name is
       not in its own medicine list (GET /api/medicines), quantities
       included — so every name is first matched to that list
       (matchCatalogue); a name with no safe match is reported, not sent
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PharmacyChartMerge = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ROWS = 41;
  const COLS = 51;
  // Columns added beyond the chart's own 51. Verified live up to 60; a send
  // that needs more reports the extra medicines instead of guessing.
  const MAX_COLS = 60;

  // Same normalisation as the chart app (Arabic-Indic digits → 0-9)
  function latinDigits(s) {
    return String(s == null ? "" : s)
      .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  }
  function norm(s) { return latinDigits(s).trim().replace(/\s+/g, " ").toLowerCase(); }
  function clean(s) { return String(s == null ? "" : s).trim().replace(/\s+/g, " "); }

  // ---------- matching our names to the chart's medicine list ----------
  // Same dosage-form word, different spelling → one token
  const FORM_WORDS = {
    tab: "tab", tabs: "tab", tablet: "tab", tablets: "tab",
    cap: "cap", caps: "cap", capsule: "cap", capsules: "cap",
    amp: "amp", amps: "amp", ampule: "amp", ampoule: "amp", ampul: "amp", ampules: "amp", ampoules: "amp",
    vial: "vial", vials: "vial", vail: "vial", inj: "vial", injection: "vial",
    syr: "syrup", syrup: "syrup", susp: "syrup", suspension: "syrup",
    supp: "supp", suppository: "supp", suppositories: "supp",
    drop: "drop", drops: "drop", oint: "oint", ointment: "oint", cream: "cream", gel: "gel",
    sachet: "sachet", sachets: "sachet", bag: "bag", bottle: "bottle", pfs: "pfs", syringe: "syringe"
  };
  function tokens(name) {
    return latinDigits(name).toLowerCase()
      .replace(/(\d)\s*(mg|mcg|g|ml|iu|unit|units|%)\b/g, "$1$2")     // "500 mg" → "500mg"
      .split(/[^a-z0-9%.]+/).filter(Boolean)
      .map(t => FORM_WORDS[t] || t);
  }
  function compact(name) { return latinDigits(name).toLowerCase().replace(/[^a-z0-9%]+/g, ""); }
  function numbersOf(toks) { return toks.filter(t => /\d/.test(t)).sort().join(" "); }
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // names → Map(name → chart medicine name | null). Exact (any case /
  // spacing) first, then the same words ignoring order and form
  // spelling, then a close spelling of the drug word — always with the
  // SAME strength numbers. Ambiguous → null.
  function matchCatalogue(names, catalogue) {
    const list = (catalogue || []).map(c => String(c || "")).filter(Boolean);
    const byNorm = new Map(list.map(c => [norm(c), c]));
    const byCompact = new Map();
    list.forEach(c => { const k = compact(c); byCompact.set(k, byCompact.has(k) && byCompact.get(k) !== c ? null : c); });
    const info = list.map(c => { const t = tokens(c); return { name: c, toks: t, nums: numbersOf(t), words: t.filter(x => !/\d/.test(x)) }; });
    const out = new Map();
    names.forEach(n => {
      if (byNorm.has(norm(n))) { out.set(n, byNorm.get(norm(n))); return; }
      const ck = compact(n);
      if (byCompact.get(ck)) { out.set(n, byCompact.get(ck)); return; }
      const t = tokens(n), nums = numbersOf(t), words = t.filter(x => !/\d/.test(x));
      if (!words.length) { out.set(n, null); return; }
      let best = null, bestScore = 0, tie = false;
      info.forEach(c => {
        if (c.nums !== nums || !c.words.length) return;           // strength must be identical
        const drugA = words[0], drugB = c.words[0];
        const drugOk = drugA === drugB || (drugA.length >= 5 && editDistance(drugA, drugB) <= (drugA.length >= 8 ? 2 : 1));
        if (!drugOk) return;
        const A = new Set(words), B = new Set(c.words);
        let inter = 0; A.forEach(w => { if (B.has(w) || (w !== drugA && [...B].some(x => x.length >= 5 && editDistance(w, x) <= 1))) inter++; });
        const score = (inter + (drugA === drugB ? 0 : 0.5)) / Math.max(A.size, B.size);
        if (score > bestScore + 1e-9) { best = c.name; bestScore = score; tie = false; }
        else if (Math.abs(score - bestScore) < 1e-9 && best !== c.name) tie = true;
      });
      out.set(n, best && !tie && bestScore >= 0.5 ? best : null);
    });
    return out;
  }

  function parseTsv(tsv) {
    const lines = String(tsv || "").replace(/\r/g, "").split("\n");
    const head = (lines.shift() || "").split("\t");
    if (head.length < 3 || head[0] !== "" || head[1] !== "") return null;
    return {
      meds: head.slice(2).map(clean),
      rows: lines.filter(l => l.trim()).map(l => {
        const c = l.split("\t");
        return { name: clean(c[0]), plate: clean(latinDigits(c[1])), qty: c.slice(2).map(v => clean(latinDigits(v))) };
      })
    };
  }

  // chart (from GET, may be null) + our parsed table → { body, summary }
  // catalogue (optional): the chart's medicine names — our names are
  // mapped onto it and unknown ones are reported instead of sent.
  // opts.collectOverflow: patients with no empty row are returned in `overflow`
  //   (instead of being reported as skipped)
  // opts.skipRow(row): a patient that is NOT in this chart but lives in the other
  //   one (the extra chart) — not added here, returned in `overflow`
  function merge(chart, data, catalogue, opts) {
    opts = opts || {};
    const overflow = [];
    const cols = chart ? Math.max(COLS, ...(chart.columns || []).map(c => c.column_number), ...(chart.quantities || []).map(q => q.column_number)) : COLS;
    const names = new Array(ROWS).fill(""), plates = new Array(ROWS).fill(""), meds = new Array(cols).fill("");
    const qty = new Map();                       // "row:col" → number (1-based)
    if (chart) {
      (chart.patients || []).forEach(p => {
        if (p.row_number >= 1 && p.row_number <= ROWS) {
          names[p.row_number - 1] = p.patient_name || "";
          plates[p.row_number - 1] = p.patient_id || "";
        }
      });
      (chart.columns || []).forEach(c => { if (c.column_number >= 1) meds[c.column_number - 1] = c.medicine_name || ""; });
      (chart.quantities || []).forEach(q => qty.set(q.row_number + ":" + q.column_number, Number(q.quantity)));
    }

    const summary = { patients: 0, newPatients: 0, meds: 0, newMeds: 0, addedColumns: 0, cells: 0, renamed: [], skipped: [] };
    const known = catalogue ? matchCatalogue(data.meds, catalogue) : null;

    // columns
    const colOf = data.meds.map(ours => {
      let m = ours;
      if (known) {
        m = known.get(ours);
        if (!m) { summary.skipped.push("«" + ours + "» غير موجود في قائمة أدوية الجارت — صحّح «اسم الجارت» لهذا الدواء"); return -1; }
        if (m !== ours) summary.renamed.push(ours + " ← " + m);
      }
      let i = meds.findIndex(x => norm(x) === norm(m));
      if (i < 0) {
        i = meds.findIndex(x => !clean(x));
        if (i < 0) {
          // no empty column left → add one, like «إضافة عمود» in the chart
          if (meds.length >= MAX_COLS) { summary.skipped.push("لا توجد أعمدة فارغة في الجارت لـ " + m + " (الحد " + MAX_COLS + " عموداً)"); return -1; }
          meds.push("");
          i = meds.length - 1;
          summary.addedColumns++;
        }
        meds[i] = m;
        summary.newMeds++;
      }
      summary.meds++;
      return i;
    });

    // rows + quantities
    const used = new Set();
    data.rows.forEach(r => {
      let i = names.findIndex((n, k) => !used.has(k) && clean(n) &&
        (r.plate ? norm(plates[k]) === norm(r.plate) : norm(n) === norm(r.name)));
      if (i < 0) {
        if (opts.skipRow && opts.skipRow(r)) { overflow.push(r); return; }
        i = names.findIndex((n, k) => !used.has(k) && !clean(n));
        if (i < 0) {
          if (opts.collectOverflow) overflow.push(r);
          else summary.skipped.push("لا توجد صفوف فارغة في الجارت للمريض " + r.name);
          return;
        }
        names[i] = r.name;
        plates[i] = r.plate;
        summary.newPatients++;
      } else if (!clean(plates[i]) && r.plate) {
        plates[i] = r.plate;
      }
      used.add(i);
      summary.patients++;
      r.qty.forEach((v, k) => {
        if (!v || colOf[k] < 0) return;
        if (!/^\d{1,4}$/.test(v)) { summary.skipped.push(r.name + " — " + data.meds[k] + ": " + v + " (أدخلها يدوياً)"); return; }
        qty.set((i + 1) + ":" + (colOf[k] + 1), Number(v));
        summary.cells++;
      });
    });

    const body = {
      patients: names.map((n, k) => ({ rowNumber: k + 1, name: n, patientId: plates[k] || "" })),
      columns: meds.map((m, k) => ({ columnNumber: k + 1, medicineName: m })),
      quantities: Array.from(qty.entries())
        .filter(([, v]) => v > 0)
        .map(([key, v]) => { const [r, c] = key.split(":").map(Number); return { rowNumber: r, columnNumber: c, quantity: v }; })
        .sort((a, b) => a.rowNumber - b.rowNumber || a.columnNumber - b.columnNumber)
    };
    return { body, summary, overflow };
  }

  // Is this patient (same plate number, or same name when there is no plate)
  // already in the chart read from the chart app?
  function hasPatient(chart, r) {
    if (!chart) return false;
    return (chart.patients || []).some(p => clean(p.patient_name) &&
      (r.plate ? norm(p.patient_id) === norm(r.plate) : norm(p.patient_name) === norm(r.name)));
  }

  // The same table reduced to some patients: only the medicines they have a
  // quantity for stay as columns (the extra chart has its own columns)
  function subset(data, rows) {
    const keep = data.meds.map((m, k) => rows.some(r => String(r.qty[k] || "").trim() !== ""));
    return {
      meds: data.meds.filter((m, k) => keep[k]),
      rows: rows.map(r => Object.assign({}, r, { qty: r.qty.filter((v, k) => keep[k]) }))
    };
  }

  // After saving: which of our medicines / patients / quantities are
  // NOT in the chart as read back (the server may drop things quietly)
  function verify(saved, body) {
    const c = saved || { patients: [], columns: [], quantities: [] };
    const cols = new Map((c.columns || []).map(x => [x.column_number, norm(x.medicine_name)]));
    const rows = new Map((c.patients || []).map(x => [x.row_number, norm(x.patient_name)]));
    const qty = new Map((c.quantities || []).map(x => [x.row_number + ":" + x.column_number, Number(x.quantity)]));
    const missing = { meds: [], patients: [], cells: 0 };
    body.columns.forEach(x => { if (x.medicineName && cols.get(x.columnNumber) !== norm(x.medicineName)) missing.meds.push(x.medicineName); });
    body.patients.forEach(x => { if (x.name && rows.get(x.rowNumber) !== norm(x.name)) missing.patients.push(x.name); });
    body.quantities.forEach(x => { if (qty.get(x.rowNumber + ":" + x.columnNumber) !== x.quantity) missing.cells++; });
    return missing;
  }

  return { ROWS, COLS, MAX_COLS, hasPatient, subset, parseTsv, merge, norm, matchCatalogue, verify, tokens, editDistance };
});
