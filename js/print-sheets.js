/* ============================================================
   print-sheets.js  —  A4 patient sheets (single or all patients)
   ============================================================
   window.PharmacyPrintSheets.print(entries)
     entries: [{ patient, currentBed: { key, roomId, bed } }, ...]

   Opens a print window with one A4 page per patient:
     - Header: patient, attending doctor, room, date (+ allergies)
     - Right column (RTL): vitals + current labs + previous labs
     - Left column: medications, LTR, sorted by form (vials first),
       dose shown as the per-dose total from sumDose(), D# badge for
       antibiotics (per-med course day), form abbreviation box.
   The user picks "Save as PDF" in the print dialog for a PDF.

   window.PharmacyPrintSheets.preview(entries) shows the same pages in the
   app first (scaled to the screen), with "طباعة / PDF" → print(entries).
   ============================================================ */

(function (global) {
  "use strict";

  // Version marker printed faintly at the bottom of each page so the
  // running code version can be verified on paper. Bump on layout changes.
  const SHEET_VERSION = "v1.4-kufi";

  const FORM_ORDER_PRINT = [
    "vial", "ampule", "prefilled-syringe", "solution",
    "syrup-and-oral-drop", "suppository", "supplies", "effervescent", "tablet"
  ];

  const LAB_DEFS = [
    ["S. Creatinine", "creatinine"], ["S. Albumin", "albumin"], ["WBC", "wbc"],
    ["Hb", "hb"], ["PLT", "plt"], ["Na+", "na"], ["K+", "k"],
    ["Glucose", "glucose"], ["CRP", "crp"]
  ];

  function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatDateShortForPrint(dateStr) {
    try {
      return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } catch (e) { return dateStr; }
  }

  // ---- Right column: vitals (empty, filled by hand) + labs ----
  function buildLabsVitalsHtml(patient) {
    const labs = (patient && patient.labs) ? patient.labs : {};
    // labs._print = the labs chosen for the sheet (doctor / admin); none = all
    const chosen = Array.isArray(labs._print) && labs._print.length ? labs._print : null;
    const printed = (key) => !chosen || chosen.indexOf(key) >= 0;
    const labHistory = ((patient && patient.labHistory) ? patient.labHistory : []).filter(h => h && printed(h.key));
    const labRows = LAB_DEFS.filter(([, key]) => printed(key)).map(([label, key]) => {
      const val = labs[key];
      const shown = (val != null && String(val).trim() !== "") ? escapeHtml(String(val)) : "";   // empty: written by hand (no dash)
      return `<div class="ps-lab-row"><span class="ps-lab-val">${shown}</span><span class="ps-lab-label">${label}</span></div>`;
    }).join("");

    let historyRows = "";
    if (labHistory.length > 0) {
      const byDate = {};
      labHistory.forEach(h => { const d = h.date || "—"; (byDate[d] = byDate[d] || []).push(h); });
      Object.keys(byDate).sort().reverse().forEach(date => {
        const parts = byDate[date].map(e => `${e.label}: ${e.value}`).join("  ·  ");
        historyRows += `<div class="ps-lab-row ps-lab-history"><span class="ps-lab-val">${escapeHtml(parts)}</span><span class="ps-lab-label">${escapeHtml(formatDateShortForPrint(date))}</span></div>`;
      });
    }

    // Weight + Cockcroft-Gault CrCl when the weight is known
    const Clinical = global.PharmacyClinical;
    const crcl = Clinical ? Clinical.calculateCrCl(patient) : null;
    const weightRows = (labs.weight ? `<div class="ps-lab-row"><span class="ps-lab-val">${escapeHtml(labs.weight)} kg</span><span class="ps-lab-label">Weight</span></div>` : "")
      + (crcl ? `<div class="ps-lab-row"><span class="ps-lab-val">${crcl.crcl} mL/min</span><span class="ps-lab-label">CrCl (CG)</span></div>` : "");

    return `
      <div class="ps-labs-section">
        <div class="ps-labs-title">Vitals</div>
        <div class="ps-lab-row"><span class="ps-lab-val"></span><span class="ps-lab-label">BP</span></div>
        <div class="ps-lab-row"><span class="ps-lab-val"></span><span class="ps-lab-label">O₂ Sat</span></div>
        <div class="ps-lab-row"><span class="ps-lab-val"></span><span class="ps-lab-label">PR</span></div>
        <div class="ps-lab-row"><span class="ps-lab-val"></span><span class="ps-lab-label">UOP</span></div>
        <div class="ps-lab-row"><span class="ps-lab-val"></span><span class="ps-lab-label">Temp</span></div>
        ${weightRows}
        <div class="ps-labs-title" style="margin-top:10px;">Lab Results</div>
        ${labRows}
        ${historyRows ? `<div class="ps-labs-title" style="margin-top:10px;">Previous Results</div>${historyRows}` : ""}
      </div>`;
  }

  // ---- Left column: medication lines ----
  function buildMedsHtml(patient, medCatalog) {
    const Meds = global.PharmacyMedications || {};
    const Clinical = global.PharmacyClinical;
    const isMedDueToday = Meds.isMedDueToday || function () { return true; };
    const getFrequencyInterval = Meds.getFrequencyInterval || function () { return 0; };
    const FORM_ABBR = Meds.FORM_ABBR || {};
    const FLUID_IDS = Meds.FLUID_IDS || [];
    const catalogEntry = (id) => medCatalog.find(c => c && c.id === id) || {};
    const formOf = (m) => catalogEntry(m.id).form || m.form || "tablet";

    const meds = (Array.isArray(patient.medications) ? patient.medications : [])
      .filter(pm => pm && pm.id !== "syringe-5cc");
    if (meds.length === 0) return `<div class="ps-empty">No medications</div>`;

    const rank = (m) => { const i = FORM_ORDER_PRINT.indexOf(formOf(m)); return i === -1 ? 99 : i; };
    const sorted = meds.slice().sort((a, b) => rank(a) - rank(b));

    return sorted.map((m, i) => {
      // Fall back to the catalog defaults when the prescription has none
      const entry = catalogEntry(m.id);
      // the trade name (the one used on the ward), not the scientific one
      const name = entry.nameTrade || m.nameTrade || m.nameEn || m.nameAr || m.name || m.id || "—";
      let dose = m.dose || entry.defaultDose || "";
      const freq = Meds.medFrequency ? Meds.medFrequency(m, entry.defaultFrequency) : (m.frequency || entry.defaultFrequency || "");
      const mode = Meds.medMode ? Meds.medMode(m) : "";

      // Non-daily (every 2 days, weekly…): show the interval + due today?
      let freqStr = "";
      let dueNote = "";
      if (getFrequencyInterval(freq) > 0) {
        freqStr = freq;
        dueNote = isMedDueToday(freq, m.startDate || patient.firstMedDate || "")
          ? " ✓ مستحق اليوم" : " (غير مستحق اليوم)";
      } else {
        const m1 = freq.match(/×\s*(\d+)/);
        const m2 = freq.match(/^\s*(\d+)\s*$/);
        if (m1) freqStr = "x " + m1[1];
        else if (m2) freqStr = "x " + m2[1];
        else if (freq.trim()) freqStr = freq.trim();   // words: "Infusion 24h", "Bolus", "حسب الحاجة"
      }

      // Show the per-dose total ("500mg" + "2×1" → "1g"). sumDose only
      // returns "{value}{unit} ×{n}" when it could multiply; otherwise
      // the dose is shown unchanged.
      // Infusion 24h and Bolus are written as the total over the day
      // ("4mg" at 1×4 → "16mg Infusion 24h", "40mg" at 1×2 → "80mg Bolus"), without a frequency.
      const nm = Meds.parseFreq ? Meds.parseFreq(freq) : null;
      if ((mode === "Infusion 24h" || mode === "Bolus") && nm && typeof Meds.sumDose === "function") {
        const total = Meds.sumDose(dose, String(nm.n * nm.m) + "×1");
        if (total && total.indexOf(" ×") !== -1 && total.split(" ×")[0]) {
          dose = total.split(" ×")[0];
          freqStr = "";
        }
      } else if (typeof Meds.sumDose === "function") {
        const computed = Meds.sumDose(dose, freq);
        if (computed && computed.indexOf(" ×") !== -1) {
          const parts = computed.split(" ×");
          if (parts.length === 2 && parts[0]) dose = parts[0];
        }
      }

      const medDay = (Clinical && Clinical.isAntibiotic(m)) ? Clinical.abxDayLabel(m, patient) : "";
      const formAbbr = FLUID_IDS.indexOf(m.id) !== -1 ? "F" : (FORM_ABBR[formOf(m)] || "—");
      const text = [name, dose, freqStr, mode, dueNote].filter(Boolean).map(escapeHtml).join("&nbsp;&nbsp;");
      return `<div class="ps-med-line"><span class="ps-med-day">${medDay}</span><span class="ps-med-form">${formAbbr}</span><span class="ps-med-num">${i + 1}.</span> <span class="ps-med-name">${text}</span></div>`;
    }).join("");
  }

  function buildPage(patient, currentBed, medCatalog, dateStr) {
    const allergies = String(patient.allergies || "").trim();
    return `
      <div class="ps-page">
        <div class="ps-title">${escapeHtml((global.PharmacyWard.unitOf(currentBed.roomId) || {}).name || "الطابق السادس")}</div>
        <div class="ps-header">
          <div class="ps-header-row">
            <div class="ps-header-cell"><strong>المريض</strong>${escapeHtml(patient.name || "—")}</div>
            <div class="ps-header-cell"><strong>الطبيب المعالج</strong>${escapeHtml(patient.doctor || "—")}</div>
            <div class="ps-header-cell"><strong>الغرفة</strong>${escapeHtml(global.PharmacyWard.roomTitle(currentBed.roomId))}</div>
            <div class="ps-header-cell"><strong>التاريخ</strong>${dateStr}</div>
          </div>
          ${allergies ? `<div class="ps-allergy">⚠ الحساسية: ${escapeHtml(allergies)}</div>` : ""}
          ${global.PharmacyBoarders && global.PharmacyBoarders.isBoarder(patient)
            ? `<div class="ps-origin">مستضاف من: ${escapeHtml(global.PharmacyBoarders.label(patient))}</div>` : ""}
        </div>
        <div class="ps-body">
          <div class="ps-vs-col">${buildLabsVitalsHtml(patient)}</div>
          <div class="ps-meds-col">${buildMedsHtml(patient, medCatalog)}</div>
        </div>
        <div class="ps-version">${SHEET_VERSION}</div>
      </div>`;
  }

  const SHEET_CSS = [
    '@page { size: A4 portrait; margin: 0; }',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    // Same font as the app (Noto Kufi Arabic). It runs wider than the
    // old Tajawal, so the med lines are a point smaller to stay on one line.
    'body { font-family: "Noto Kufi Arabic", "Tajawal", Arial, sans-serif; color: #000; line-height: 1.5; }',
    '.ps-page { position: relative; padding: 12mm; page-break-after: always; }',
    '.ps-page:last-child { page-break-after: auto; }',
    '.ps-title { text-align: center; font-size: 18px; font-weight: 800; margin: 0 0 8px; }',
    '.ps-header { border: 2px solid #000; padding: 10px 14px; margin-bottom: 12px; }',
    '.ps-header-row { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; }',
    '.ps-header-cell { font-size: 13px; font-weight: 700; line-height: 1.6; }',
    '.ps-header-cell strong { display: block; font-size: 14px; font-weight: 800; margin-bottom: 2px; }',
    '.ps-allergy { margin-top: 8px; padding: 4px 8px; border: 2px solid #000; font-size: 14px; font-weight: 800; }',
    '.ps-origin { margin-top: 6px; font-size: 13px; font-weight: 700; }',
    // vitals + labs (right, RTL) narrower; medicines (left) take the rest
    '.ps-body { display: grid; grid-template-columns: minmax(0, 34%) minmax(0, 1fr); gap: 12px; min-height: 230mm; }',
    '.ps-vs-col { border: 1.5px solid #000; padding: 10px; }',
    '.ps-labs-section { font-size: 13px; line-height: 1.5; }',
    '.ps-labs-title { font-size: 13px; font-weight: 800; margin-bottom: 6px; text-decoration: underline; }',
    '.ps-lab-row { display: flex; justify-content: space-between; padding: 3px 0; }',
    '.ps-lab-label { font-weight: 700; }',
    // Values with units ("70 kg", "28.4 mL/min") read left-to-right
    '.ps-lab-val { font-weight: 800; direction: ltr; unicode-bidi: isolate; }',
    // Meds read left-to-right: "1. Meronem 1g x 2"
    '.ps-meds-col { border: 1.5px solid #000; padding: 10px 12px 10px 4px; direction: ltr; text-align: left; }',
    // Flex row: when a long name wraps, the second line stays aligned
    // after the D# / form boxes instead of sliding underneath them.
    '.ps-med-line { display: flex; align-items: baseline; font-size: 14px; font-weight: 700; padding: 5px 0; border-bottom: 1px dashed #ccc; }',
    '.ps-med-line > span { flex-shrink: 0; }',
    '.ps-med-line > .ps-med-name { flex: 1 1 auto; flex-shrink: 1; min-width: 0; margin-left: 4px; white-space: nowrap; overflow: hidden; }',
    '.ps-med-line:last-child { border-bottom: none; }',
    '.ps-med-day:empty { display: inline-block; width: 38px; margin-right: 4px; }',
    '.ps-med-day:not(:empty) { display: inline-block; width: 38px; text-align: center; font-size: 14px; font-weight: 800; background: #000; border: 1.5px solid #000; border-radius: 6px; padding: 2px 4px; margin-right: 4px; color: #fff; vertical-align: middle; }',
    '.ps-med-form { display: inline-block; width: 32px; text-align: center; font-size: 12px; font-weight: 800; border-radius: 6px; padding: 2px 4px; margin-right: 5px; vertical-align: middle; background: #fff; border: 1.5px solid #000; color: #000; }',
    '.ps-med-num, .ps-med-name { font-weight: 700; }',
    '.ps-empty { text-align: center; padding: 20px; color: #999; font-size: 12px; }',
    '.ps-version { position: absolute; bottom: 4mm; right: 6mm; font-size: 9px; color: #ccc; }',
    '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
  ].join("\n");

  function pagesHtml(entries) {
    const App = global.PharmacyApp;
    const medCatalog = (App && App.state && App.state.medications) || [];
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
    return entries.map(({ patient, currentBed }) => buildPage(patient, currentBed, medCatalog, dateStr)).join("");
  }

  // One line per medicine: a line wider than its column gets a smaller
  // font (down to 9px) instead of wrapping. Source text, run in the page.
  const FIT_MED_LINES = 'function fitMedLines(doc){doc.querySelectorAll(".ps-med-name").forEach(function(el){var fs=14;el.style.fontSize="";while(el.scrollWidth>el.clientWidth+1&&fs>9){fs-=0.5;el.style.fontSize=fs+"px";}});}';

  // Returns false when the browser blocked the print window.
  function print(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return true;
    const pages = pagesHtml(entries);

    const win = window.open("", "_blank");
    if (!win) return false;
    const doc = win.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      // Empty title: no "Patient Sheet" text in the browser's print footer
      '<title></title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;700;800&display=swap" rel="stylesheet">',
      '<style>', SHEET_CSS, '</style>',
      '</head>',
      '<body>',
      pages,
      '<script>',
      FIT_MED_LINES,
      // Give the web font time to load, fit the lines, then print and close
      'window.addEventListener("load", function () {',
      '  setTimeout(function () {',
      '    try { fitMedLines(document); } catch (e) {}',
      '    try { window.print(); } catch (e) {}',
      '    setTimeout(function () { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join("\n"));
    doc.close();
    return true;
  }

  // In-app preview of the sheets (same HTML, no print), then print.
  // Resolves { printed: true | false } — false when the window was blocked.
  // opts.viewOnly: just look at the sheet (pharmacist) — no print button
  function preview(entries, opts) {
    const viewOnly = !!(opts && opts.viewOnly);
    if (!Array.isArray(entries) || entries.length === 0) return Promise.resolve({ cancelled: true });
    return new Promise(resolve => {
      const old = document.getElementById("sheets-preview");
      if (old) old.remove();
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const overlay = el("div", "pills-preview-overlay");
      overlay.id = "sheets-preview";
      const box = el("div", "pills-preview-box sheets-preview-box");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const head = el("div", "pills-preview-head");
      head.appendChild(el("h3", null, entries.length === 1
        ? (viewOnly ? "ورقة العلاج — " : "معاينة ورقة المريض — ") + String(entries[0].patient.name || "").trim()
        : "معاينة أوراق المرضى (" + entries.length + ")"));
      const x = el("button", "pills-preview-x", "✕");
      x.type = "button";
      x.setAttribute("aria-label", "إغلاق");
      head.appendChild(x);
      box.appendChild(head);
      // Zoom: − / + around the "fit to width" size, "ملاءمة" goes back to it
      const zoomBar = el("div", "sheets-zoom");
      const zOut = el("button", "sheets-zoom-btn", "−");
      const zLabel = el("span", "sheets-zoom-label", "100%");
      const zIn = el("button", "sheets-zoom-btn", "+");
      const zFit = el("button", "sheets-zoom-fit", "ملاءمة");
      [zOut, zIn, zFit].forEach(b => { b.type = "button"; });
      zOut.setAttribute("aria-label", "تصغير");
      zIn.setAttribute("aria-label", "تكبير");
      zoomBar.appendChild(zOut); zoomBar.appendChild(zLabel); zoomBar.appendChild(zIn); zoomBar.appendChild(zFit);
      box.appendChild(zoomBar);
      if (!viewOnly) box.appendChild(el("p", "pills-preview-hint", "للتعديل: أغلق المعاينة، عدّل بطاقة المريض ثم افتحها من جديد."));
      const pagesBox = el("div", "pills-preview-pages sheets-preview-pages");
      const frameWrap = el("div", "sheets-preview-frame");
      const frame = el("iframe");
      frame.title = "معاينة الأوراق";
      frame.setAttribute("scrolling", "no");
      frame.srcdoc = [
        '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">',
        '<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;700;800&display=swap" rel="stylesheet">',
        '<style>', SHEET_CSS,
        // pages separated on screen like sheets of paper
        'html,body{margin:0;background:#E9E6DE}.ps-page{margin:0 auto 18px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15)}',
        '</style></head><body>', pagesHtml(entries), '</body></html>'
      ].join("");
      frameWrap.appendChild(frame);
      pagesBox.appendChild(frameWrap);
      box.appendChild(pagesBox);
      const foot = el("div", "pills-preview-foot");
      const go = el("button", "pills-preview-save", "طباعة / PDF");
      go.type = "button";
      const cancel = el("button", "pills-preview-cancel", "إغلاق");
      cancel.type = "button";
      if (!viewOnly) foot.appendChild(go);
      foot.appendChild(cancel);
      box.appendChild(foot);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // A4 is 794px wide at 96dpi: lay the pages out at that width, then
      // scale the frame down to the dialog's width.
      const A4 = 794;
      let zoom = 1;                       // × the fit-to-width size
      const fit = () => {
        const doc = frame.contentDocument;
        if (!doc || !doc.body) return;
        const h = doc.documentElement.scrollHeight;
        const avail = pagesBox.clientWidth - 32;            // the side padding
        const scale = Math.min(1, avail / A4) * zoom;
        frame.style.width = A4 + "px";
        frame.style.height = h + "px";
        frame.style.transform = "scale(" + scale + ")";
        frameWrap.style.width = Math.ceil(A4 * scale) + "px";
        frameWrap.style.height = Math.ceil(h * scale) + "px";
        zLabel.textContent = Math.round(zoom * 100) + "%";
        zOut.disabled = zoom <= 0.5;
        zIn.disabled = zoom >= 3;
      };
      const setZoom = (z) => { zoom = Math.max(0.5, Math.min(3, Math.round(z * 4) / 4)); fit(); };
      zOut.addEventListener("click", () => setZoom(zoom - 0.25));
      zIn.addEventListener("click", () => setZoom(zoom + 0.25));
      zFit.addEventListener("click", () => setZoom(1));
      const fitLines = () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        try { new Function("doc", FIT_MED_LINES + ";fitMedLines(doc);")(doc); } catch (e) { /* layout only */ }
      };
      frame.addEventListener("load", () => {
        fitLines(); fit();
        setTimeout(() => { fitLines(); fit(); }, 600);       // after the web font arrives
      });
      window.addEventListener("resize", fit);

      const close = (v) => { window.removeEventListener("resize", fit); overlay.remove(); resolve(v); };
      x.addEventListener("click", () => close({ cancelled: true }));
      cancel.addEventListener("click", () => close({ cancelled: true }));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close({ cancelled: true }); });
      go.addEventListener("click", () => close({ printed: print(entries) }));
    });
  }

  global.PharmacyPrintSheets = { print, preview, buildLabsVitalsHtml, LAB_DEFS };
})(window);
