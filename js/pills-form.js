// Pills form overlay generator (استمارة الحبوب)
// =========================================================
// Generates "استمارة اعطاء الحبوب" (Pill Dispensing Form) as PNG:
//
// 1. PharmacyPillsForm.generatePillsForm() — generates ONE blank form
//    (for reference / printing as a master copy)
//
// 2. PharmacyPillsForm.generateAllPatientPillsForms(state) — iterates
//    all patients, finds those with at least one medication from the
//    "tablet" form category, and generates a personalized form for
//    each. The form contains:
//      - Static header: مستشفى بغداد التعليمي / الصيدلية السريرية /
//        استمارة اعطاء الحبوب
//      - Row 1 of the table: patient name (col 1, rightmost) +
//        room number "غرفة N" (col 2)
//      - Row 2 of the table: column labels (العلاج / blank /
//        وقت الجرعة / طريقة الاستخدام) — static
//      - Rows 3-10: the patient's tablet-form medications
//        (med name in col 1, freq in col 3, dose in col 4)
//      - Footer: "الصيدلي السريري" + the name of the user printing it
//
// Layout (measured from the blank form, 1654×2339 px @ 300 DPI = A4):
//   - Page header area: y=130-310 (3 lines, 48px font)
//   - Table row 1 (patient info): y=322-388 (63px tall)
//   - Table row 2 (column labels): y=388-454 (63px tall)
//   - Table rows 3-10 (medication rows): y=454-1958 (185px each, 8 rows)
//   - Footer: y=2150 (left side)
//
// Vertical grid lines (X coords, left→right):
//   V_LINES = [133, 778, 981, 1206, 1529]
//   → Col 1 (rightmost, RTL first) = V_LINES[3..4] (x=1206-1529, w=323)
//   → Col 2                          = V_LINES[2..3] (x=981-1206,  w=225)
//   → Col 3                          = V_LINES[1..2] (x=778-981,   w=203)
//   → Col 4 (leftmost, RTL last)    = V_LINES[0..1] (x=133-778,   w=645)

(function (global) {
  "use strict";

  const TEMPLATE_URL = "img/pills-form-template.png";

  // Grid geometry — measured from the uploaded blank form (1654×2339px)
  const G = {
    IMG_W: 1654, IMG_H: 2339,
    V_LINES: [133, 778, 981, 1206, 1529],
    H_LINES: [322, 388, 454, 642, 830, 1018, 1206, 1394, 1582, 1770, 1958]
  };

  // Number of medication rows available (rows 3-10, 8 rows × 185px each)
  const MAX_MED_ROWS = 8;

  // ---- Helpers ----
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Draw Arabic text centered on (cx, cy)
  function drawArabicLine(ctx, text, cx, cy, fontPx, bold = true, maxWidth = 0) {
    ctx.font = `${bold ? "bold " : ""}${fontPx}px Tajawal, Cairo, Arial, sans-serif`;
    // a long text in a narrow column gets a smaller font instead of crossing the lines
    if (maxWidth > 0) {
      let px = fontPx;
      while (px > 16 && ctx.measureText(text).width > maxWidth) {
        px -= 1;
        ctx.font = `${bold ? "bold " : ""}${px}px Tajawal, Cairo, Arial, sans-serif`;
      }
    }
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // Alphabetic baseline + Y offset = (fontSize × 0.35) for proper
    // glyph vertical centering (matches the chart-image.js approach).
    ctx.fillText(text, cx, cy + fontPx * 0.35);
  }

  // Draw Arabic text left-aligned at (x, y)
  function drawArabicLeft(ctx, text, x, y, fontPx, bold = true) {
    ctx.font = `${bold ? "bold " : ""}${fontPx}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + fontPx * 0.35);
  }

  // Get the best display name for a med — for the pills form, the
  // user wants the Arabic name shown (not the English trade name).
  // Order of preference:
  //   1. nameAr (Arabic generic name) — preferred for the pills form
  //   2. nameTrade (English trade name) — fallback if no Arabic name
  //   3. nameEn (English generic name) — last resort
  //   4. name / id — never shown to users, but as last-resort fallback
  // Note: this is DIFFERENT from the rest of the app (which prefers
  // nameTrade first). The pills form is meant to be readable by the
  // patient in their own language (Arabic).
  function primaryName(m) {
    if (!m) return "";
    // the Arabic name (الاسم بالعربي in the catalogue); without one, the trade name
    return (m.nameAr && m.nameAr.trim()) || m.nameTrade || m.nameEn || m.name || m.id || "";
  }

  // ---- Section drawing helpers ----

  function drawPageHeader(ctx, unitName) {
    const page_cx = G.IMG_W / 2;
    const lines = [
      "مستشفى بغداد التعليمي",
      "الصيدلية السريرية",
      "استمارة اعطاء الحبوب"
    ];
    if (unitName) lines.push(unitName);
    const fontPx = 48;
    const line_h = unitName ? 52 : 60;     // four lines must stay above the table (y=322)
    const top_y = unitName ? 105 : 130;
    lines.forEach((line, i) => {
      drawArabicLine(ctx, line, page_cx, top_y + i * line_h, fontPx);
    });
  }

  function drawColumnLabels(ctx) {
    // Row 2 of the table (y=388-454)
    const row_top = G.H_LINES[1];  // 388
    const row_bot = G.H_LINES[2];  // 454
    const row_cy = (row_top + row_bot) / 2;  // 421
    const fontPx = 36;

    // Col 1 (rightmost, V_LINES[3..4]): BLANK (per user request —
    // العلاج moved from col 1 to col 2)

    // Col 2 (V_LINES[2..3]): "العلاج" (was blank, moved here per user)
    const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
    drawArabicLine(ctx, "العلاج", col2_cx, row_cy, fontPx);

    // Col 3 (V_LINES[1..2]): "وقت الجرعة"
    const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
    drawArabicLine(ctx, "وقت الجرعة", col3_cx, row_cy, fontPx);

    // Col 4 (leftmost, V_LINES[0..1]): "طريقة الاستخدام"
    const col4_cx = (G.V_LINES[0] + G.V_LINES[1]) / 2;
    drawArabicLine(ctx, "طريقة الاستخدام", col4_cx, row_cy, fontPx);
  }

  function drawFooter(ctx) {
    // "الصيدلي السريري" at bottom-left of the page
    const text = "الصيدلي السريري";
    const fontPx = 36;
    drawArabicLeft(ctx, text, 200, 2150, fontPx);
    // …and under it the name of whoever prints the form (the signed-in user)
    const Auth = global.PharmacyAuth;
    const u = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const who = u ? String(u.displayName || u.username || "").trim() : "";
    if (who) {
      ctx.font = "bold " + fontPx + "px Tajawal, Cairo, Arial, sans-serif";
      const cx = 200 + ctx.measureText(text).width / 2;   // centred under the title
      const namePx = fontPx;   // the same font and size as the title
      ctx.font = "bold " + namePx + "px Tajawal, Cairo, Arial, sans-serif";
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(who, cx, 2150 + 56 + namePx * 0.35);
    }
  }

  // Draw patient info in row 1 of the table (y=322-388, 63px tall)
  //   Col 1 (rightmost): patient name
  //   Col 2: room number like "غرفة 3"
  //   Col 3: bed number like "سرير 7" (ward-wide)
  function drawPatientInfo(ctx, patientName, roomNumber, bedLabel) {
    const row_top = G.H_LINES[0];  // 322
    const row_bot = G.H_LINES[1];  // 388
    const row_cy = (row_top + row_bot) / 2;  // 355
    const fontPx = 33;  // shrinks to fit its column if needed

    // Col 1 (rightmost, V_LINES[3..4]): patient name
    const col1_cx = (G.V_LINES[3] + G.V_LINES[4]) / 2;
    drawArabicLine(ctx, patientName, col1_cx, row_cy, fontPx, true, colWidth(3));

    // Col 2 (V_LINES[2..3]): room number "غرفة N"
    const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
    drawArabicLine(ctx, global.PharmacyWard.roomTitle(roomNumber), col2_cx, row_cy, fontPx, true, colWidth(2));

    // Col 3 (V_LINES[1..2]), left of the room: the bed — ward-wide number 1-50
    if (bedLabel) {
      const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
      drawArabicLine(ctx, "سرير " + bedLabel, col3_cx, row_cy, fontPx, true, colWidth(1));
    }
  }

  // Convert a frequency string like "1×2" or "×3" or "2" to a
  // human-readable Arabic time interval. Math: hours = 24 / N where N
  // is the daily frequency. Arabic plural rules: 3-10 use "ساعات",
  // others (1, 2, 11+) use "ساعة".
  //   "1×1" → "كل 24 ساعة"
  //   "1×2" → "كل 12 ساعة"
  //   "1×3" → "كل 8 ساعات"
  //   "1×4" → "كل 6 ساعات"
  //   "1×6" → "كل 4 ساعات"
  // Non-parseable frequencies (e.g. "حسب القياس") return as-is.
  function freqToTimeInterval(freq) {
    if (!freq) return "";
    // Try to extract N from "×N" or "1×N" or just "N"
    let n = null;
    const m = freq.match(/×\s*(\d+)/);
    if (m) {
      n = parseInt(m[1], 10);
    } else {
      const plainNum = parseInt(freq, 10);
      if (!isNaN(plainNum) && plainNum > 0) n = plainNum;
    }
    if (n === null || n === 0) return freq;  // can't parse, return raw

    const hours = 24 / n;
    let hoursStr;
    if (Number.isInteger(hours)) {
      hoursStr = String(hours);
    } else {
      hoursStr = hours.toFixed(1);
    }
    // Arabic plural: 3-10 use "ساعات", others use "ساعة".
    // For non-integer hours (like 4.8), use "ساعة".
    let unit;
    if (Number.isInteger(hours) && hours >= 3 && hours <= 10) {
      unit = "ساعات";
    } else {
      unit = "ساعة";
    }
    return `كل ${hoursStr} ${unit}`;
  }

  // Draw two Arabic lines stacked vertically in the same column.
  // topText appears in the upper half, bottomText in the lower half.
  // Used for the medication column where the dose is written below the
  // medication name.
  function drawArabicLineStacked(ctx, topText, bottomText, cx, cellTop, cellBot, topFontPx, bottomFontPx, maxWidth) {
    const cellCy = (cellTop + cellBot) / 2;
    // top line above the centre, bottom line below it (fits the 185px row)
    const topY = cellCy - 22;
    const botY = cellCy + 22;
    drawArabicLine(ctx, topText, cx, topY, topFontPx, true, maxWidth || 0);
    drawArabicLine(ctx, bottomText, cx, botY, bottomFontPx, true, maxWidth || 0);
  }
  const colWidth = (i) => G.V_LINES[i + 1] - G.V_LINES[i] - 20;

  // How each tablet is taken (the pills form's «طريقة الاستخدام» column).
  // Matched by substance / trade name against the catalogue entry (id + names),
  // first rule wins — so every catalogue name of a drug gets the same text.
  // Standard labelling; the pharmacist can still override per patient on the
  // pills page (med.usage). Keep the phrases short: the cell shrinks long text.
  const PPI_TIMING = "قبل الطعام بساعة أو بعده بساعتين";
  const USAGE_RULES = [
    // ---- before food / empty stomach ----
    { words: ["omeprazole", "pantaprazole", "pantoprazole", "esomeprazole", "lansoprazole"], usage: PPI_TIMING },
    { words: ["nimodipine"],                         usage: PPI_TIMING },
    { words: ["captopril", "capoten"],               usage: "قبل الطعام بساعة" },
    { words: ["voriconazole"],                       usage: "قبل الطعام بساعة أو بعده بساعة" },
    { words: ["levothyroxine", "thyroxine"],         usage: "على معدة فارغة قبل الإفطار بـ 30 دقيقة" },
    { words: ["metoclopramide", "plasil"],           usage: "قبل الطعام بـ 30 دقيقة" },
    { words: ["mebeverine", "dusptalin"],            usage: "قبل الطعام بـ 20 دقيقة" },
    { words: ["diltiazem"],                          usage: "قبل الطعام" },
    { words: ["ferrofolic"],                         usage: "على معدة فارغة" },
    { words: ["glimepiride", "amaryl"],              usage: "مع الفطور" },
    { words: ["glibenclamide", "daonil"],            usage: "مع الفطور" },
    // ---- with food ----
    { words: ["metformin", "glucophage"],            usage: "مع الطعام" },
    { words: ["ibuprofen", "brufen"],                usage: "مع الطعام" },
    { words: ["meloxicam", "mobic"],                 usage: "مع الطعام" },
    { words: ["diclofenac", "voltarin", "voltaren"], usage: "بعد الطعام" },
    { words: ["aspirin"],                            usage: "بعد الطعام" },
    { words: ["cinnarizine", "stugeron"],            usage: "بعد الطعام" },
    { words: ["augmentin", "amoxclav", "clavulan"],  usage: "مع الطعام" },
    { words: ["metronidazole", "flagyl"],            usage: "مع الطعام" },
    { words: ["methoprim", "trimethoprim", "co-trimoxazole", "cotrimoxazole"], usage: "مع الطعام" },
    { words: ["doxycycline", "doxydar"],             usage: "مع الطعام ومع كوب ماء كامل" },
    { words: ["prednisolone"],                       usage: "مع الطعام" },
    { words: ["carvedilol"],                         usage: "مع الطعام" },
    { words: ["metoprolol"],                         usage: "مع الطعام" },
    { words: ["propranolol", "inderal"],             usage: "مع الطعام" },
    { words: ["amiodarone", "cordarone"],            usage: "مع الطعام" },
    { words: ["spironolactone", "aldactone"],        usage: "مع الطعام" },
    { words: ["carbamazepine", "tegretol"],          usage: "مع الطعام" },
    { words: ["valpro", "depakine"],                 usage: "مع الطعام" },
    { words: ["levodopa", "sinemet"],                usage: "مع الطعام" },
    { words: ["ursodeoxycholic", "urso"],            usage: "مع الطعام" },
    { words: ["trimetazidine", "vastarel"],          usage: "مع الطعام" },
    { words: ["sevelamer"],                          usage: "مع الوجبات" },
    { words: ["calcium"],                            usage: "مع الطعام" },
    // ---- under the tongue ----
    { words: ["glyceryl trinitrate", "angesid"],     usage: "تحت اللسان" },
    // ---- any time, with or without food (kept explicit so the rule is visible) ----
    { words: ["furosemide", "lasix"],                usage: "صباحاً، مع أو بدون طعام" },
    { words: ["bisoprolol", "concor"],               usage: "صباحاً، مع أو بدون طعام" },
    { words: ["empagliflozin", "empadil", "dapagliflozin", "forxiga"], usage: "صباحاً، مع أو بدون طعام" },
    { words: ["fluoxetine"],                         usage: "صباحاً، مع أو بدون طعام" },
    { words: ["amitriptyline"],                      usage: "قبل النوم، مع أو بدون طعام" },
    { words: ["ciprofloxacin", "ciprodar", "moxifloxacin"], usage: "مع أو بدون طعام، بعيداً عن الحليب والكالسيوم والحديد" },
    { words: ["digoxin"],                            usage: "مع أو بدون طعام، بعيداً عن مضادات الحموضة" }
  ];

  // Usage text for a med: the catalogue's own `usage` if set, else the first
  // matching rule, else «مع أو بدون طعام» (most tablets can be taken either
  // way).
  function getMedUsage(catalog) {
    if (!catalog) return "مع أو بدون طعام";
    if (catalog.usage) return catalog.usage;
    const text = [catalog.id, catalog.nameTrade, catalog.nameEn, catalog.nameAr].join(" ").toLowerCase();
    const rule = USAGE_RULES.find(r => r.words.some(w => text.indexOf(w) >= 0));
    return rule ? rule.usage : "مع أو بدون طعام";
  }

  // Tablets per dose in words: ½ → "نصف حبة", 2 → "حبتان"
  function tabletsText(n) {
    if (n === 0.5) return "نصف حبة";
    if (n === 1) return "حبة واحدة";
    if (n === 1.5) return "حبة ونصف";
    if (n === 2) return "حبتان";
    if (n === 2.5) return "حبتان ونصف";
    if (Number.isInteger(n) && n >= 3 && n <= 10) return n + " حبات";
    return n + " حبة";
  }

  // Draw medications in rows 3-10 (y=454-1958, 185px each, max 8 rows).
  // For each med (per user request):
  //   Col 1 (rightmost): BLANK
  //   Col 2 (العلاج):    med name (top) + dose (below) — stacked
  //   Col 3 (وقت الجرعة):  human-readable time interval (e.g. "كل 12 ساعة")
  //   Col 4 (طريقة الاستخدام): usage instructions (e.g. "مع الطعام",
  //                            "قبل الطعام بـ 60 دقيقة")
  function drawMedications(ctx, tabletMeds) {
    const nameFontPx = 34;
    const doseFontPx = 27;  // slightly smaller than name
    const timeFontPx = 33;
    const usageFontPx = 31;
    const maxRows = Math.min(MAX_MED_ROWS, tabletMeds.length);

    for (let i = 0; i < maxRows; i++) {
      const entry = tabletMeds[i];
      const pm = entry.pm;
      const catalog = entry.catalog;

      // Row i (0-indexed) maps to table row 3+i.
      const row_top = G.H_LINES[2 + i];
      const row_bot = G.H_LINES[2 + i + 1];
      const row_cy = (row_top + row_bot) / 2;

      // Col 1 (rightmost, V_LINES[3..4]): BLANK

      // Col 2 (V_LINES[2..3]): med name (top) + dose (below) — stacked
      const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
      const medName = primaryName(catalog);
      const dose = pm.dose || catalog.defaultDose || "";
      drawArabicLineStacked(ctx, medName, dose, col2_cx, row_top, row_bot,
                            nameFontPx, doseFontPx, colWidth(2));
      // How many tablets each time (½ / 1 / 1½ / 2 …) from the N of "N×M" —
      // written in the usage column: "نصف حبة مع أو بدون طعام"
      const pf = global.PharmacyMedications && global.PharmacyMedications.parseFreq
        ? global.PharmacyMedications.parseFreq(pm.frequency || catalog.defaultFrequency || "") : null;

      // Col 3 (V_LINES[1..2]): time interval (converted from frequency)
      const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
      const freq = pm.frequency || catalog.defaultFrequency || "";
      const timeText = (pm.time && String(pm.time).trim()) || freqToTimeInterval(freq);   // «الحبوب» page may set it
      drawArabicLine(ctx, timeText, col3_cx, row_cy, timeFontPx, true, colWidth(1));

      // Col 4 (leftmost, V_LINES[0..1]): usage instructions
      // (e.g. "مع الطعام", "قبل الطعام بـ 60 دقيقة")
      const col4_cx = (G.V_LINES[0] + G.V_LINES[1]) / 2;
      const usage = (pm.usage && String(pm.usage).trim()) || getMedUsage(catalog);
      const usageText = [pf ? tabletsText(pf.n) : "", usage].filter(Boolean).join(" ");
      drawArabicLine(ctx, usageText, col4_cx, row_cy, usageFontPx, true, colWidth(0));
    }
  }

  // ---- Build a complete pills form canvas (used by both blank and
  //      per-patient variants) ----
  async function buildPillsFormCanvas(templateImg, patient, tabletMeds) {
    const canvas = document.createElement("canvas");
    canvas.width = G.IMG_W;
    canvas.height = G.IMG_H;
    const ctx = canvas.getContext("2d");

    // 1. Draw the template (grid lines + outer border)
    ctx.drawImage(templateImg, 0, 0, G.IMG_W, G.IMG_H);

    // 2. Static page header (hospital / dept / title)
    const unit = patient && global.PharmacyWard ? global.PharmacyWard.unitOf(patient.roomNumber) : null;
    drawPageHeader(ctx, unit ? unit.name : "");

    // 3. Patient info in row 1 (only if patient data is provided)
    if (patient) {
      const W = global.PharmacyWard;
      drawPatientInfo(ctx, patient.name, patient.roomNumber, patient.bedKey && W && W.bedLabelOfKey ? W.bedLabelOfKey(patient.bedKey) : "");
    }

    // 4. Static column labels in row 2
    drawColumnLabels(ctx);

    // 5. Medications in rows 3+ (only if tabletMeds is provided)
    if (tabletMeds && tabletMeds.length > 0) {
      drawMedications(ctx, tabletMeds);
    }

    // 6. Static footer
    drawFooter(ctx);

    return canvas;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  // Generate a BLANK pills form (no patient data, just the static
  // template). Useful as a master copy or for manual filling.
  async function generatePillsForm() {
    const templateImg = await loadImage(TEMPLATE_URL);
    const canvas = await buildPillsFormCanvas(templateImg, null, null);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `pills-form-${stamp}.png`;
    downloadBlob(blob, filename);
    return { blob, filename };
  }

  // Generate ONE pills form for a specific patient (returns the Blob,
  // does NOT auto-download — caller handles downloading).
  async function generatePatientPillsForm(patient, tabletMeds) {
    const templateImg = await loadImage(TEMPLATE_URL);
    const canvas = await buildPillsFormCanvas(templateImg, patient, tabletMeds);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return blob;
  }

  // Generate pills forms for ALL patients who have at least one tablet-
  // form medication. Auto-downloads each as a separate PNG.
  // @param state — { patients: bedKey→patient, medications: catalog[] }
  //   NOTE: the state field name is `medications` (not `meds`) to
  //   match the rest of the app's state shape.
  // options.bedKey → only that patient (the per-patient button)
  // Collect the patients with tablet medicines and draw their forms
  // (in memory). options.bedKey → only that patient.
  async function buildPillsForms(state, options) {
    const onlyKey = options && options.bedKey;
    if (!state || !state.patients || !state.medications) {
      return { error: "لا توجد بيانات" };
    }

    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS) {
      return { error: "تعذّر الوصول إلى بيانات الغرف" };
    }

    // Find all patients with at least one tablet-form medication
    const tabletPatients = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        if (onlyKey && key !== onlyKey) return;
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        // Filter patient's meds to tablet-form only
        const tabletMeds = (Array.isArray(p.medications) ? p.medications : [])
          .filter(pm => pm && pm.id)
          .map(pm => {
            const catalog = (state.medications || []).find(m => m && m.id === pm.id);
            if (!catalog || catalog.form !== "tablet") return null;
            return { pm: pm, catalog: catalog };
          })
          .filter(x => x !== null);

        if (tabletMeds.length === 0) return;

        tabletPatients.push({
          bedKey: key,
          name: p.name.trim(),
          roomNumber: room.id,
          tabletMeds: tabletMeds
        });
      });
    });

    if (tabletPatients.length === 0) {
      return { error: onlyKey ? "لا توجد حبوب (Tablet) لهذا المريض" : "لا يوجد مرضى لديهم أدوية من قسم الحبوب (tablets)" };
    }

    // Load template once (reused for all patient forms)
    const templateImg = await loadImage(TEMPLATE_URL);

    // Generate a canvas for each patient (in memory — NOT downloaded
    // individually). All canvases are kept in memory so we can merge
    // them into a single multi-page PDF below.
    const canvases = [];
    for (let i = 0; i < tabletPatients.length; i++) {
      const patient = tabletPatients[i];
      const canvas = await buildPillsFormCanvas(
        templateImg, patient, patient.tabletMeds
      );
      canvases.push(canvas);
    }

    return { tabletPatients: tabletPatients, canvases: canvases, onlyKey: onlyKey };
  }

  // Merge the drawn forms into one A4 PDF (PNG files as fallback)
  async function savePillsPdf(built) {
    const tabletPatients = built.tabletPatients, canvases = built.canvases, onlyKey = built.onlyKey;
    // ---- Merge all canvases into a single multi-page PDF ----
    // The form template is 1654×2339 px (aspect ratio ≈ 0.707 ≈ A4's
    // 210/297 = 0.707). So the form fits PERFECTLY on A4 with minimal
    // margins — just a small white border around the form image.
    //
    // We use A4 portrait orientation. To make the form fill almost
    // the entire A4 page, we use small margins:
    //   - 10mm horizontal margin (left + right)
    //   - 10mm vertical margin (top + bottom)
    // Result: form occupies 190×277mm on a 210×297mm A4 page — about
    // 90% of the page area, vs. the previous ~45% (140×198mm centered).
    const PDF_PAGE_W = 210;  // A4 width in mm
    const PDF_PAGE_H = 297;  // A4 height in mm
    const MARGIN_MM = 10;    // small white border around the form
    const IMG_W_MM = PDF_PAGE_W - 2 * MARGIN_MM;  // 190mm
    const IMG_H_MM = PDF_PAGE_H - 2 * MARGIN_MM;  // 277mm
    // Center the form image on the A4 page (= margin on all sides)
    const IMG_X = MARGIN_MM;
    const IMG_Y = MARGIN_MM;

    // Try to access jsPDF from various globals:
    //   - jspdf@2.x UMD: window.jspdf.jsPDF
    //   - jsPDF legacy global: window.jsPDF
    //   - html2pdf bundle may also expose jsPDF internally
    const JsPDF =
      (global.jspdf && global.jspdf.jsPDF) ||
      global.jsPDF ||
      (global.jspdf && typeof global.jspdf === "function" ? global.jspdf : null);

    if (!JsPDF) {
      console.warn("[pills-form] jsPDF not available — falling back to separate PNGs");
      // Fallback: download each canvas as a separate PNG.
      const stamp = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < canvases.length; i++) {
        const blob = await new Promise(resolve => canvases[i].toBlob(resolve, "image/png"));
        const safeName = tabletPatients[i].name.replace(/[\\/:*?"<>|]/g, "_");
        const filename = `pills-form-${safeName}-${stamp}.png`;
        setTimeout(() => downloadBlob(blob, filename), i * 300);
      }
      return { count: canvases.length, mode: "png-fallback" };
    }

    try {
      const pdf = new JsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i];
        // Convert canvas to JPEG data URL (smaller file size than PNG
        // for the same visual quality when the image is mostly white
        // background + black text).
        const dataURL = canvas.toDataURL("image/jpeg", 0.85);
        if (i > 0) pdf.addPage();
        pdf.addImage(dataURL, "JPEG", IMG_X, IMG_Y, IMG_W_MM, IMG_H_MM);
      }

      // Save the merged PDF
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = onlyKey
        ? `pills-form-${tabletPatients[0].name.replace(/[\\/:*?"<>|]/g, "_")}-${stamp}.pdf`
        : `pills-forms-${stamp}.pdf`;
      pdf.save(filename);
      return { count: canvases.length, mode: "pdf", filename: filename };
    } catch (pdfErr) {
      console.error("[pills-form] jsPDF error:", pdfErr);
      // Fallback: separate PNG downloads
      const stamp = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < canvases.length; i++) {
        const blob = await new Promise(resolve => canvases[i].toBlob(resolve, "image/png"));
        const safeName = tabletPatients[i].name.replace(/[\\/:*?"<>|]/g, "_");
        const filename = `pills-form-${safeName}-${stamp}.png`;
        setTimeout(() => downloadBlob(blob, filename), i * 300);
      }
      return { count: canvases.length, mode: "png-fallback", error: pdfErr.message };
    }
  }


  async function generateAllPatientPillsForms(state, options) {
    const built = await buildPillsForms(state, options);
    if (built.error) return built;
    return savePillsPdf(built);
  }

  // Preview before the PDF: every form as an image, then "تنزيل PDF".
  // → resolves { cancelled } or the save result.
  async function previewPillsForms(state, options) {
    const built = await buildPillsForms(state, options);
    if (built.error) return built;
    return new Promise(resolve => {
      const old = document.getElementById("pills-preview");
      if (old) old.remove();
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const overlay = el("div", "pills-preview-overlay");
      overlay.id = "pills-preview";
      const box = el("div", "pills-preview-box");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const head = el("div", "pills-preview-head");
      head.appendChild(el("h3", null, "معاينة استمارات الحبوب (" + built.canvases.length + ")"));
      const x = el("button", "pills-preview-x", "✕");
      x.type = "button";
      x.setAttribute("aria-label", "إغلاق");
      head.appendChild(x);
      box.appendChild(head);
      // Zoom: − / + around the dialog width, "ملاءمة" goes back to it
      // (same controls as the patient-sheet preview)
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
      box.appendChild(el("p", "pills-preview-hint", "للتعديل: أغلق المعاينة، عدّل التكرار في بطاقة المريض ثم افتحها من جديد."));
      const pages = el("div", "pills-preview-pages pills-zoomable");
      built.canvases.forEach((canvas, i) => {
        const fig = el("figure", "pills-preview-page");
        const img = el("img");
        img.src = canvas.toDataURL("image/jpeg", 0.8);
        img.alt = "استمارة الحبوب — " + built.tabletPatients[i].name;
        fig.appendChild(img);
        fig.appendChild(el("figcaption", null, built.tabletPatients[i].name + " · غرفة " + built.tabletPatients[i].roomNumber));
        pages.appendChild(fig);
      });
      box.appendChild(pages);
      let zoom = 1;
      const setZoom = (z) => {
        zoom = Math.max(0.5, Math.min(3, Math.round(z * 4) / 4));
        pages.querySelectorAll(".pills-preview-page").forEach(f => { f.style.width = (zoom * 100) + "%"; });
        zLabel.textContent = Math.round(zoom * 100) + "%";
        zOut.disabled = zoom <= 0.5;
        zIn.disabled = zoom >= 3;
      };
      zOut.addEventListener("click", () => setZoom(zoom - 0.25));
      zIn.addEventListener("click", () => setZoom(zoom + 0.25));
      zFit.addEventListener("click", () => setZoom(1));
      const foot = el("div", "pills-preview-foot");
      const dl = el("button", "pills-preview-save", "تنزيل PDF");
      dl.type = "button";
      const cancel = el("button", "pills-preview-cancel", "إغلاق");
      cancel.type = "button";
      foot.appendChild(dl);
      foot.appendChild(cancel);
      box.appendChild(foot);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const close = (v) => { overlay.remove(); resolve(v); };
      x.addEventListener("click", () => close({ cancelled: true }));
      cancel.addEventListener("click", () => close({ cancelled: true }));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close({ cancelled: true }); });
      dl.addEventListener("click", async () => {
        dl.disabled = true;
        const r = await savePillsPdf(built);
        close(r);
      });
    });
  }

  // ---- Exports ----
  global.PharmacyPillsForm = {
    freqToTimeInterval,
    getMedUsage,
    tabletsText,
    generatePillsForm,
    generatePatientPillsForm,
    generateAllPatientPillsForms,
    previewPillsForms
  };

})(window);
