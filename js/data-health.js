/* ============================================================
   data-health.js  —  «سلامة البيانات» (everyone: a row in the settings page)
   ============================================================
   One list of what is missing or wrong in the current patients' data, each row a tap away from the patient's card:
     1. patients without plate number / age / weight (the CrCl needs the age and the weight; the plate number is the key of the chart);
     2. duplicate plate numbers;
     3. patients on meronem with no serum creatinine;
     4. patients on albumin with no serum albumin and / or no serum creatinine.
   Pure reading — nothing is changed here.
   (Ported from the 8th-floor app; the room line also names the unit: «غرفة 3 · الوحدة الأولى · سرير 5».)
   ============================================================ */

(function (global) {
  "use strict";

  const App = () => global.PharmacyApp;
  const blank = (v) => !String(v == null ? "" : v).trim();
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(",", ".")); return isFinite(n) ? n : null; };
  const MERONEM = /meropenem|meronem|ميروب|ميرون/i;

  // the occupied beds: [{ key, p, roomId, bed }]
  function occupied() {
    const st = App() && App().state;
    if (!st || !st.patients) return [];
    return Object.keys(st.patients).map(key => {
      const p = st.patients[key], m = /room-(\d+)-bed-(\d+)/.exec(key);
      return p && p.name && p.name.trim() && m ? { key, p, roomId: parseInt(m[1], 10), bed: parseInt(m[2], 10) } : null;
    }).filter(Boolean).sort((a, b) => a.roomId - b.roomId || a.bed - b.bed);
  }

  // → { missing: [{ x, what: ["رقم الطبلة", …] }], dupPlates: [{ plate, list: [x] }], meronemNoCreat: [x], albuminNoLabs: [{ x, what }] }
  function analyze() {
    const st = App().state, Clin = global.PharmacyClinical;
    const cat = {};
    (st.medications || []).forEach(m => { if (m && m.id) cat[m.id] = m; });
    const beds = occupied();
    const out = { total: beds.length, missing: [], dupPlates: [], meronemNoCreat: [], albuminNoLabs: [] };

    // 1) plate / age / weight
    beds.forEach(x => {
      const what = [];
      if (blank(x.p.plateNumber)) what.push("رقم الطبلة");
      const age = num(x.p.age);
      if (age == null || age <= 0 || age > 120) what.push("العمر");
      const w = num(x.p.labs && x.p.labs.weight);
      if (w == null || w < 2 || w > 400) what.push("الوزن");
      if (what.length) out.missing.push({ x, what });
    });

    // 2) duplicate plate numbers
    const byPlate = {};
    beds.forEach(x => { const pl = String(x.p.plateNumber || "").trim(); if (pl) (byPlate[pl] = byPlate[pl] || []).push(x); });
    Object.keys(byPlate).filter(pl => byPlate[pl].length > 1).forEach(pl => out.dupPlates.push({ plate: pl, list: byPlate[pl] }));

    // 3) meronem without serum creatinine, 4) albumin without serum albumin / creatinine
    beds.forEach(x => {
      let meronem = false, albumin = false;
      (x.p.medications || []).forEach(pm => {
        if (!pm) return;
        const c = pm.id && cat[pm.id] || {};
        const probe = Object.assign({}, pm, c);
        if (MERONEM.test([pm.id, c.nameTrade, c.nameEn, c.nameAr, pm.nameTrade, pm.nameEn, pm.nameAr].filter(Boolean).join(" "))) meronem = true;
        if (Clin && Clin.isAlbumin && Clin.isAlbumin(probe)) albumin = true;
      });
      const labs = x.p.labs || {};
      if (meronem && blank(labs.creatinine)) out.meronemNoCreat.push(x);
      if (albumin) {
        const what = [];
        if (blank(labs.albumin)) what.push("الألبومين");
        if (blank(labs.creatinine)) what.push("الكرياتينين");
        if (what.length) out.albuminNoLabs.push({ x, what });
      }
    });
    return out;
  }

  // ---------- the window ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function close() { const o = document.getElementById("dh-overlay"); if (o) o.remove(); }
  // «غرفة N · الوحدة · سرير M» (the room with its unit, then the unit's bed number)
  const where = (x) => {
    const W = global.PharmacyWard;
    try { return (W && W.roomTitle ? W.roomTitle(x.roomId) : "غرفة " + x.roomId) + (W && W.bedLabelOfKey ? " · سرير " + W.bedLabelOfKey(x.key) : ""); }
    catch (e) { return "غرفة " + x.roomId; }
  };

  function openPatient(x) {
    close();
    const A = App();
    if (A && A.openPatient) A.openPatient({ key: x.key, roomId: x.roomId, bed: x.bed });
  }
  function patientRow(parent, x, note) {
    const r = el("button", "dh-row");
    r.type = "button";
    r.appendChild(el("strong", null, x.p.name.trim()));
    r.appendChild(el("span", "dh-where", where(x)));
    if (note) r.appendChild(el("span", "dh-note", note));
    r.addEventListener("click", () => openPatient(x));
    parent.appendChild(r);
  }
  function section(box, title, count, hint) {
    const s = el("div", "dh-section" + (count ? " has-items" : " is-ok"));
    const h = el("div", "dh-head");
    h.appendChild(el("strong", null, title));
    h.appendChild(el("span", "dh-count", count ? String(count) : "✓"));
    s.appendChild(h);
    if (hint && count) s.appendChild(el("p", "dh-hint", hint));
    box.appendChild(s);
    return s;
  }

  function open() {
    const A = global.PharmacyAuth;
    if (!(A && A.isLoggedIn && A.isLoggedIn()) || !App()) return;
    close();
    const r = analyze();
    const ov = el("div", "fm-overlay"); ov.id = "dh-overlay";
    const box = el("div", "fm-box dh-box"); ov.appendChild(box);
    const head = el("div", "fm-head");
    head.appendChild(el("strong", null, "سلامة البيانات"));
    const x = el("button", "fm-x", "✕"); x.type = "button"; x.addEventListener("click", close);
    head.appendChild(x); box.appendChild(head);

    const issues = r.missing.length + r.dupPlates.length + r.meronemNoCreat.length + r.albuminNoLabs.length;
    box.appendChild(el("p", "dh-summary" + (issues ? "" : " is-ok"), r.total
      ? (issues ? "المرضى الحاليون: " + r.total + " — بنود تحتاج مراجعة: " + issues : "المرضى الحاليون: " + r.total + " — كل شيء سليم ✓")
      : "لا يوجد مرضى حاليون"));

    let s = section(box, "ينقصهم رقم الطبلة أو العمر أو الوزن", r.missing.length);
    r.missing.forEach(m => patientRow(s, m.x, "ينقص: " + m.what.join("، ")));

    s = section(box, "أرقام طبلة مكررة", r.dupPlates.length, "رقمان متطابقان لمريضين مختلفين.");
    r.dupPlates.forEach(d => {
      s.appendChild(el("div", "dh-sub", "الرقم " + d.plate));
      d.list.forEach(x => patientRow(s, x));
    });

    s = section(box, "ميرونيم بلا S.Creatinine", r.meronemNoCreat.length, "مريض على الميرونيم ولا توجد له نتيجة كرياتينين.");
    r.meronemNoCreat.forEach(x => patientRow(s, x));

    s = section(box, "ألبومين بلا S.Albumin أو S.Creatinine", r.albuminNoLabs.length, "مريض على الألبومين تنقصه نتيجة.");
    r.albuminNoLabs.forEach(a => patientRow(s, a.x, "ينقص: " + a.what.join("، ")));

    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  function init() {
    const b = document.getElementById("settings-data-health-btn");
    if (b) b.addEventListener("click", open);
  }

  global.PharmacyDataHealth = { init, open, analyze };
})(window);
