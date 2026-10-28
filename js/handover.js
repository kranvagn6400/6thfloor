/* ============================================================
   handover.js  —  تسليم واستلام (pharmacists + admin)
   ============================================================
   The ward's paper form «استمارة تسليم واستلام الخفر» in the app:
     1. the heading (date, the pharmacist handing over / receiving; the floor is
        always «السادس» — written on the form, no field) and a
        table of every patient on ALBUMIN — always included — with the amount due
        (what the monitor shows as «العدد المصروف») and a blank «وقت التسليم»;
     2. «متابعة العلاجات الأخرى»: the patients on the other critical medicines
        (Amphoter/Caspo, I.V.I.G, Aranesp/Eprex), each ticked IN or left out by
        the pharmacist, with the dissolving method («طريقة الحل») in its OWN field:
        printed as one wide row under the patient, from the patient-name column to the
        delivery-time column. Meronem never appears.
   Every patient also has a field for «وقت التسليم».
   What is ticked / typed is kept on this device for the day. «معاينة وطباعة»
   draws the ward's own form — the same columns, rows and borders, measured in
   points from the user's PDF — in one font (Cairo, fonts/) and fills it in.
   ============================================================ */

(function (global) {
  "use strict";

  const KEY = "pharma.handover.v1";
  const MIN_ROWS = 12;                         // the paper has about a dozen ruled rows in each table

  // Preparation methods written next to a chosen medicine (editable per row on the
  // page) — the ward's own protocol, as the user gave it. Aranesp, Eprex and I.V.I.G
  // need no preparation: their text stays empty.
  const PREP = [
    { words: ["amphotericin", "ambisome", "امفوترسين"],
      text: "تُحل كل فيال بـ 12 سي سي ماء مقطر. بعد حل جميع الفيالات تُجمع كمية الماء المقطر، ويُزاح من مغذي الـ G/W بنفس الكمية، ثم يُضاف الدواء إلى المغذي، بشرط وجود فلتر بين سرنجة الدواء والمغذي." },
    { words: ["caspofungin", "cancidas", "كاسبو"],
      text: "تُحل الفيال بـ 10.5 سي سي ماء مقطر، ويُسحب منها 10 سي سي فقط وتُضاف إلى 250ml NaCl." },
    { words: ["ivig", "immunoglobulin"], text: "" },
    { words: ["aranesp", "darbepoetin", "aransip"], text: "" },
    { words: ["eprex", "erythropoietin", "epoetin"], text: "" }
  ];

  const $ = (id) => document.getElementById(id);
  const App = () => global.PharmacyApp;
  const esc = (s) => (App() && App().escapeHtml ? App().escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s));
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function arabicDigits(s) { return String(s).replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[d]); }

  // ---- what is kept for the day ----
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.day === todayISO()) { v.alb = v.alb || {}; v.time = v.time || {}; return v; }
    } catch (e) { /* ignore */ }
    return { day: todayISO(), date: todayISO(), giver: "", receiver: "", include: {}, prep: {}, alb: {}, time: {} };
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* blocked */ } }

  function defaultPrep(medText) {
    const t = String(medText || "").toLowerCase();
    const r = PREP.find(p => p.words.some(w => t.indexOf(w) !== -1));
    return r ? r.text : "";
  }

  // ---- the patients ----
  // → { albumin: [{ key, name, room, bed, qty }], others: [{ id, key, name, room, bed, label, medName, dose, freq }] }
  function collect() {
    const app = App();
    const Ward = global.PharmacyWard, Clin = global.PharmacyClinical, Bridge = global.PharmacyChartBridge;
    const st = app.state;
    const patients = app.orderingState().patients;        // the patients we order for (no 7th-floor hematology)
    const catalog = {};
    (st.medications || []).forEach(m => { if (m && m.id) catalog[m.id] = m; });
    const out = { albumin: [], others: [] };
    Ward.ROOMS.forEach(room => room.beds.forEach(bed => {
      const key = Ward.bedKey(room.id, bed.number);
      const p = patients[key];
      if (!p || !p.name || !p.name.trim()) return;
      let albQty = 0, hasAlb = false;
      (p.medications || []).forEach(pm => {
        if (!pm || !pm.id) return;
        const cat = catalog[pm.id] || pm;
        const probe = Object.assign({}, pm, cat);
        if (Clin.isAlbumin(probe)) {
          hasAlb = true;
          const freq = pm.frequency || cat.defaultFrequency || "";
          const q = Bridge && Bridge.dailyQuantity ? Bridge.dailyQuantity(pm.id, freq, cat.form) : null;
          albQty += q || 0;
        }
        const kind = Clin.criticalKind(probe);
        if (kind) {
          const def = (Clin.CRITICAL_KINDS || []).find(c => c.kind === kind);
          out.others.push({
            id: key + "|" + pm.id, key, name: p.name.trim(), room: roomLabel(room), bed: bed.number,
            label: def ? def.label : kind,
            medName: cat.nameEn || cat.nameTrade || pm.id,
            dose: String(pm.dose || cat.defaultDose || "").trim(),
            freq: pm.frequency || cat.defaultFrequency || ""
          });
        }
      });
      if (hasAlb) out.albumin.push({ key, name: p.name.trim(), room: roomLabel(room), bed: bed.number, qty: albQty });
    }));
    return out;
  }

  // ---- the page ----
  function render() {
    const data = collect();
    const saved = load();
    $("hv-date").value = saved.date;
    $("hv-giver").value = saved.giver;
    $("hv-receiver").value = saved.receiver;
    $("hv-albumin").innerHTML = data.albumin.length
      ? data.albumin.map(r => {
          const st = saved.alb[r.key] || "";
          return '<div class="hv-row" data-key="' + esc(r.key) + '"><strong>' + esc(r.name) + "</strong><span>" + esc(r.room) + "</span>" +
            '<select class="hv-status" aria-label="استحقاق صرف الألبومين">' +
            '<option value=""' + (st === "" ? " selected" : "") + ">الكمية: " + (r.qty ? esc(r.qty) : "—") + "</option>" +
            '<option value="ni"' + (st === "ni" ? " selected" : "") + ">Not indicated</option>" +
            '<option value="ns"' + (st === "ns" ? " selected" : "") + ">لم يتوفر ختم أخصائي</option>" +
            '<option value="dr"' + (st === "dr" ? " selected" : "") + ">عند السحب</option>" +
            '<option value="np"' + (st === "np" ? " selected" : "") + ">لم يتواجد المريض صباحًا</option></select>" +
            '<input class="hv-time" type="text" inputmode="text" autocomplete="off" placeholder="وقت التسليم" aria-label="وقت التسليم" value="' + esc(saved.time[r.key] || "") + '"></div>';
        }).join("")
      : '<div class="ix-ok">لا يوجد مريض على الألبومين حاليًا</div>';
    $("hv-others").innerHTML = data.others.length
      ? data.others.map(r => {
          const on = !!saved.include[r.id];
          const prep = saved.prep[r.id] != null ? saved.prep[r.id] : defaultPrep(r.medName + " " + r.label);
          return '<div class="hv-item' + (on ? " is-on" : "") + '" data-id="' + esc(r.id) + '">' +
            '<label class="hv-pick"><input type="checkbox" class="hv-check"' + (on ? " checked" : "") + "> <strong>" + esc(r.name) + "</strong>" +
            "<span>" + esc(r.room) + "</span><span>" + esc(r.label) + "</span></label>" +
            '<div class="hv-meta" dir="ltr">' + esc([r.medName, r.dose, r.freq].filter(Boolean).join(" · ")) + "</div>" +
            '<label class="hv-lab hv-timelab">وقت التسليم <input class="hv-time" type="text" autocomplete="off" placeholder="مثال: 8 مساءً" value="' + esc(saved.time[r.id] || "") + '"></label>' +
            '<div class="hv-extra"' + (on ? "" : " hidden") + ">" +
              '<label class="hv-lab">طريقة الحل <textarea class="hv-prep" rows="3" placeholder="تُكتب تحت المريض بعرض الجدول (من اسم المريض إلى وقت التسليم)">' + esc(prep) + "</textarea></label></div></div>";
        }).join("")
      : '<div class="ix-hint">لا يوجد مريض على أدوية حرجة أخرى حاليًا</div>';
  }

  function readHeader() {
    const v = load();
    v.date = $("hv-date").value || todayISO();
    v.giver = $("hv-giver").value; v.receiver = $("hv-receiver").value;
    return v;
  }

  // ---- the printed paper: the ward's own form, DRAWN (not a picture) ----
  // The same grid as the paper form: measurements in points on the A4 page
  // (595.28 x 841.89) taken from the user's PDF. One font — Cairo, bundled in
  // fonts/ so it is the same on every device — 12 pt text, the title 14 pt bold.
  const PG = { w: 595.28, h: 841.89 };
  const COL = { name: [417.6, 537.6], room: [327.5, 417.6], mid: [177.8, 327.5], time: [58.7, 177.8] };
  const T1 = { top: 151.8, rows: 13 }, T2 = { top: 523.1, rows: 11 }, ROW_H = 22.74;
  const X0 = 57.7, X1 = 537.6;                     // the outer lines of every block
  const STATUS = { ni: "Not indicated", ns: "لم يتوفر ختم أخصائي", dr: "عند السحب", np: "لم يتواجد المريض صباحًا" };
  // S = "" for the preview frame (own document); "#hv-pdf-root " when the pages are drawn inside the app for the PDF
  const cssText = (S) => {
    S = S || "";
    const f = (n) => new URL("fonts/" + n, location.href).href;
    return `
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Regular.ttf")}") format("truetype"); font-weight: 400; font-display: block; }
    @font-face { font-family: "Cairo"; src: url("${f("Cairo-Bold.ttf")}") format("truetype"); font-weight: 700; font-display: block; }
    ${S ? "#hv-pdf-root, #hv-pdf-root * { box-sizing: border-box; } #hv-pdf-root { margin: 0; padding: 0; background: #fff; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #000; word-spacing: 0.25em; }" : `@page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; direction: rtl; color: #000; }`}
    ${S}.pg { position: relative; width: ${PG.w}pt; height: ${PG.h}pt; overflow: hidden; page-break-after: always; break-after: page; }
    ${S}.pg:last-child { page-break-after: auto; break-after: auto; }
    ${S}.t { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; padding: 0 3pt; font-weight: 400; font-size: 12pt; line-height: 1.15; }
    ${S}.t.s { justify-content: flex-start; text-align: right; }
    ${S}.t.b { font-weight: 700; }
    ${S}.t.w { line-height: 1.2; padding: 0 8pt; justify-content: flex-start; }
    ${S}.t.w .wp { width: 100%; text-align: right; white-space: pre-line; }
    ${S}.k { position: absolute; border: 2pt solid #000; }
    ${S}.l { position: absolute; background: #bdbdbd; }
    ${S}.d { position: absolute; background: #6b6b6b; }
  `;
  };
  const pt = (n) => n.toFixed(2) + "pt";
  function box(cls, x0, x1, top, h, html, fs) {
    return '<div class="t ' + cls + '" style="left:' + pt(x0) + ";width:" + pt(x1 - x0) + ";top:" + pt(top) + ";height:" + pt(h) + (fs ? ";font-size:" + fs + "pt" : "") + '">' + html + "</div>";
  }
  const thick = (y0, y1) => '<div class="k" style="left:' + pt(X0 - 1) + ";top:" + pt(y0 - 1) + ";width:" + pt(X1 - X0 + 2) + ";height:" + pt(y1 - y0 + 2) + '"></div>';
  const vline = (cls, x, y0, y1, w) => '<div class="' + cls + '" style="left:' + pt(x - (w || 0.75) / 2) + ";top:" + pt(y0) + ";width:" + pt(w || 0.75) + ";height:" + pt(y1 - y0) + '"></div>';
  const hseg = (x0, x1, y) => '<div class="l" style="left:' + pt(x0) + ";top:" + pt(y - 0.375) + ";width:" + pt(x1 - x0) + ';height:.75pt"></div>';
  // the room as written on the form: its number inside the unit (7), or «خاص 2» for a private room — not the floor-wide id
  function roomLabel(room) { return room.kind === "private" ? room.title : String(room.num); }
  const roomSize = (t) => (String(t).length > 12 ? 10 : 12);
  const fitSize = (txt, base) => (String(txt).length > 22 ? base - 3 : String(txt).length > 16 ? base - 1.5 : base);

  // the ruled body of a table. `wide[i]` = a block id when row i is ONE wide cell (the
  // dissolving method, from the patient-name column to the delivery-time column): no inner
  // vertical lines beside it, no horizontal line between two rows of the same block.
  function grid(top, rows, wide) {
    const xs = [X0, 177.7, 327.5, 417.6, X1];
    const isW = (i) => !!wide && wide[i] != null;
    let h = vline("l", X0, top, top + rows * ROW_H) + vline("l", X1, top, top + rows * ROW_H);
    for (let c = 1; c <= 3; c++) {
      let i = 0;
      while (i < rows) {
        if (isW(i)) { i++; continue; }
        let j = i;
        while (j < rows && !isW(j)) j++;
        h += vline("l", xs[c], top + i * ROW_H, top + j * ROW_H);
        i = j;
      }
    }
    for (let i = 1; i <= rows; i++) {
      if (isW(i - 1) && isW(i) && wide[i - 1] === wide[i]) continue;
      h += hseg(X0, X1, top + i * ROW_H);
    }
    return h;
  }

  // rows the dissolving method needs: one wide cell, 12 pt, about 58 characters a line
  function prepRows(prep) {
    let lines = 0;
    String(prep || "").split("\n").forEach(par => { if (par.trim()) lines += Math.max(1, Math.ceil(par.length / 58)); });
    return lines ? Math.max(1, Math.ceil((lines * 14.4 + 1) / ROW_H)) : 0;
  }
  // the medicine cell is one line: smaller type for a long name
  const medSize = (t) => (String(t).length <= 24 ? 12 : String(t).length <= 28 ? 10.5 : String(t).length <= 34 ? 9 : 7.5);

  function pageHtml(v, alb, oth) {
    let h = '<div class="pg">';
    // title, with the floor after «الطابق:»
    h += box("b", X0, X1, 3, 22, "استمارة تسليم واستلام الخفر", 14);
    h += box("b", X0, X1, 29, 22, "الطابق السادس", 14);     // the floor: centred, same font + size as the title
    h += '<div style="position:absolute;left:0;top:10pt;width:100%;height:100%">';     // everything below the title block sits 10 pt lower
    // header block: receiver | giver | date
    h += thick(57.7, 109.1) + vline("d", 177.9, 58.7, 108.1, 0.5) + vline("d", 370.9, 58.7, 108.1, 0.5);
    h += box("s", 371, 537, 64, 36, "الصيدلي المستلم<br>(الخفر):").replace('style="', 'style="line-height:17pt;align-items:flex-start;padding-right:5pt;');
    h += box("s", 178, 370.6, 64, 36, "الصيدلي المسلم<br>(الصباحي):").replace('style="', 'style="line-height:17pt;align-items:flex-start;padding-right:4.4pt;');
    h += box("s", 58.7, 177.7, 73, 20, "التاريخ:").replace('style="', 'style="padding-right:4pt;');
    const dateTxt = String(v.date).replace(/-/g, "/");
    h += box("", 60, 138, 73, 20, esc(dateTxt), 12);
    h += box("", 181, 309, 79, 21, esc(v.giver), fitSize(v.giver, 12));
    h += box("", 374, 492, 79, 21, esc(v.receiver), fitSize(v.receiver, 12));
    // table 1: albumin
    h += thick(113.1, 151.8) + [177.7, 327.5, 417.6].map(x => vline("l", x, 114.1, 150.8)).join("");
    [["name", "اسم المريض"], ["room", "رقم الغرفة"], ["mid", "استحقاق صرف الالبومين"], ["time", "وقت التسليم"]].forEach(([k, t]) => { h += box("", COL[k][0], COL[k][1], 113.1, 38.7, t); });
    h += grid(T1.top, T1.rows);
    alb.forEach((r, i) => {
      const top = T1.top + i * ROW_H;
      const mid = r.status ? STATUS[r.status] : (r.qty ? String(r.qty) : "");
      h += box("", COL.name[0] + 1, COL.name[1] - 1, top, ROW_H, esc(r.name), fitSize(r.name, 12));
      h += box("", COL.room[0] + 1, COL.room[1] - 1, top, ROW_H, esc(r.room), roomSize(r.room));
      h += box("", COL.mid[0] + 1, COL.mid[1] - 1, top, ROW_H, esc(mid), r.status === "np" ? 11 : 12);   // the longest status is a little smaller so it fits the cell
      if (r.time) h += box("", COL.time[0] + 1, COL.time[1] - 1, top, ROW_H, esc(r.time), fitSize(r.time, 12));
    });
    // the banner, then table 2: other critical medicines, the preparation under the medicine
    h += thick(450.6, 485) + box("s", 59.7, 532.5, 450.6, 34.4, "متابعة العلاجات الاخرى");
    h += thick(489, 523.1) + [177.7, 327.5, 417.6].map(x => vline("l", x, 490, 522.1)).join("");
    [["name", "اسم المريض"], ["room", "رقم الغرفة"], ["mid", "العلاج"], ["time", "وقت التسليم"]].forEach(([k, t]) => { h += box("", COL[k][0], COL[k][1], 489, 34.1, t); });
    const wide = {};
    let row = 0;
    oth.forEach((r, n) => { for (let j = 1; j <= r.p; j++) wide[row + j] = n; row += r.k; });
    h += grid(T2.top, T2.rows, wide);
    row = 0;
    oth.forEach(r => {
      const top = T2.top + row * ROW_H;
      h += box("", COL.name[0] + 1, COL.name[1] - 1, top, ROW_H, esc(r.name), fitSize(r.name, 12));
      h += box("", COL.room[0] + 1, COL.room[1] - 1, top, ROW_H, esc(r.room), roomSize(r.room));
      h += box("", COL.mid[0] + 1, COL.mid[1] - 1, top, ROW_H, esc(r.med), medSize(r.med));
      if (r.time) h += box("", COL.time[0] + 1, COL.time[1] - 1, top, ROW_H, esc(r.time), fitSize(r.time, 12));
      if (r.p) h += box("w", COL.time[0] + 1, COL.name[1] - 1, top + ROW_H, r.p * ROW_H, '<div class="wp">' + esc(r.prep) + "</div>", 12);
      row += r.k;
    });
    return h + "</div></div>";
  }

  // → { html, pages }
  function documentHtml(v, data) {
    const albRows = data.albumin.map(r => Object.assign({}, r, { status: v.alb[r.key] || "", time: String(v.time[r.key] || "").trim() }));
    const others = data.others.filter(r => v.include[r.id]).map(r => {
      const prep = String(v.prep[r.id] != null ? v.prep[r.id] : defaultPrep(r.medName + " " + r.label)).trim();
      const med = [r.medName, r.dose, r.freq].filter(Boolean).join(" ");
      const p = Math.min(T2.rows - 1, prepRows(prep));
      return { name: r.name, room: r.room, med, prep, p, k: 1 + p, time: String(v.time[r.id] || "").trim() };
    });
    // pages: 13 albumin rows and 11 medicine rows each; a medicine never splits across pages
    const pages = [];
    const need = Math.max(1, Math.ceil(albRows.length / T1.rows));
    let oi = 0;
    for (let pi = 0; pi < Math.max(need, 1) || oi < others.length; pi++) {
      const alb = albRows.slice(pi * T1.rows, (pi + 1) * T1.rows);
      const oth = []; let used = 0;
      while (oi < others.length && used + others[oi].k <= T2.rows) { oth.push(others[oi]); used += others[oi].k; oi++; }
      pages.push(pageHtml(v, alb, oth));
      if (pi > 50) break;
    }
    const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title> </title><style>' + cssText() + "</style></head><body>" + pages.join("") + "</body></html>";
    return { html, pages: pages.length, pagesHtml: pages };
  }

  // ---- PDF: each page is drawn in the app, photographed (html2pdf / html2canvas) and put on an A4 page of a PDF ----
  async function buildPdf(doc, name) {
    const H2P = global.html2pdf;
    const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!H2P || !JsPDF) throw new Error("مكتبة PDF غير محمّلة — تحقق من الاتصال بالإنترنت");
    const style = document.createElement("style");
    style.textContent = cssText("#hv-pdf-root ");
    document.head.appendChild(style);
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:" + PG.w + "pt;pointer-events:none;";
    document.body.appendChild(holder);
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.all([document.fonts.load("400 12pt Cairo"), document.fonts.load("700 12pt Cairo")]).catch(() => {});
        await document.fonts.ready;
      }
      const pdf = new JsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      for (let i = 0; i < doc.pagesHtml.length; i++) {
        const root = document.createElement("div");
        root.id = "hv-pdf-root";
        root.style.cssText = "width:" + PG.w + "pt;height:" + PG.h + "pt;";
        root.innerHTML = doc.pagesHtml[i];
        holder.innerHTML = "";
        holder.appendChild(root);
        const canvas = await H2P().set({ html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 } }).from(root).toCanvas().get("canvas");
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, PG.w, PG.h);
      }
      return pdf.output("blob");
    } finally {
      holder.remove();
      style.remove();
    }
  }

  // iPhone: the share sheet (save to Files / print / send); elsewhere: a download
  async function deliverPdf(blob, filename) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      }
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";   // the user closed the share sheet
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "downloaded";
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function preview() {
    const v = readHeader();
    save(v);
    const doc = documentHtml(v, collect());
    const html = doc.html;
    const old = $("handover-preview");
    if (old) old.remove();
    const overlay = el("div"); overlay.id = "handover-preview";
    overlay.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.72);display:flex;flex-direction:column;";
    const bar = el("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:10px 12px;background:#14211f;color:#fff;flex-wrap:wrap;";
    const title = el("strong", null, "تسليم واستلام — " + v.date);
    title.style.cssText = "flex:1;min-width:140px;font-size:14px;";
    const printBtn = el("button", null, "📄 حفظ PDF");
    const closeBtn = el("button", null, "إغلاق");
    [printBtn, closeBtn].forEach(b => { b.type = "button"; b.style.cssText = "padding:8px 14px;border-radius:10px;border:0;font:inherit;font-weight:800;cursor:pointer;background:#fff;color:#14211f;"; });
    printBtn.style.background = "#f5b301";
    bar.appendChild(title); bar.appendChild(printBtn); bar.appendChild(closeBtn);
    const stage = el("div"); stage.style.cssText = "flex:1;overflow:auto;padding:12px;display:flex;justify-content:center;";
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "معاينة التسليم والاستلام");
    const W = 794, H = 1123;                         // A4 portrait at 96 dpi
    const HT = H * doc.pages;
    frame.style.cssText = "border:0;background:#fff;width:" + W + "px;height:" + HT + "px;transform-origin:top center;flex:none;";
    const fit = () => {
      const s = Math.min(1, (window.innerWidth - 24) / W);
      frame.style.transform = "scale(" + s + ")";
      frame.style.marginBottom = (-HT * (1 - s)) + "px";
    };
    frame.srcdoc = html;
    stage.appendChild(frame);
    overlay.appendChild(bar); overlay.appendChild(stage);
    document.body.appendChild(overlay);
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    closeBtn.addEventListener("click", () => { window.removeEventListener("resize", onResize); overlay.remove(); });
    printBtn.addEventListener("click", async () => {
      if (printBtn.disabled) return;
      const label = printBtn.textContent;
      printBtn.disabled = true; printBtn.textContent = "جارٍ إنشاء الملف…";
      try {
        const blob = await buildPdf(doc, "handover");
        await deliverPdf(blob, "تسليم-واستلام-" + String(v.date).replace(/[^0-9-]/g, "") + ".pdf");
      } catch (e) {
        console.error("[handover] pdf", e);
        const A = global.PharmacyApp;
        if (A && A.flashHint) A.flashHint("تعذّر إنشاء الملف: " + (e && e.message || e)); else alert("تعذّر إنشاء الملف: " + (e && e.message || e));
      } finally { printBtn.disabled = false; printBtn.textContent = label; }
    });
  }

  function open() {
    const A = global.PharmacyAuth;
    if (!(A && (A.isAdmin() || (A.isPharmacist && A.isPharmacist())))) return;     // pharmacists + admin
    const UI = global.PharmacyUI;
    handover._from = (UI.showView._lastView && UI.showView._lastView !== "handover") ? UI.showView._lastView : "settings";
    render();
    UI.showView("handover");
  }

  function init() {
    ["settings-handover-btn", "admin-handover-btn"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", open); });
    const back = $("handover-back-btn");
    if (back) back.addEventListener("click", () => global.PharmacyUI.showView(handover._from || "settings"));
    const view = $("view-handover");
    if (!view) return;
    ["hv-date", "hv-giver", "hv-receiver"].forEach(id => $(id).addEventListener("input", () => save(readHeader())));
    view.addEventListener("change", (e) => {
      const item = e.target.closest && e.target.closest(".hv-item");
      if (!item || !e.target.classList.contains("hv-check")) return;
      const v = load();
      v.include[item.dataset.id] = e.target.checked;
      save(v);
      item.classList.toggle("is-on", e.target.checked);
      const ex = item.querySelector(".hv-extra");
      if (ex) ex.hidden = !e.target.checked;
    });
    view.addEventListener("change", (e) => {
      if (!e.target.classList || !e.target.classList.contains("hv-status")) return;
      const row = e.target.closest(".hv-row");
      const v = load();
      v.alb[row.dataset.key] = e.target.value;
      save(v);
    });
    view.addEventListener("input", (e) => {
      const c = e.target.classList;
      if (!c) return;
      if (c.contains("hv-time")) {
        const holder = e.target.closest(".hv-item, .hv-row");
        const id = holder && (holder.dataset.id || holder.dataset.key);
        if (!id) return;
        const v = load();
        v.time[id] = e.target.value;
        if (holder.classList.contains("hv-item") && e.target.value.trim() && !v.include[id]) {
          v.include[id] = true;
          const cb = holder.querySelector(".hv-check"); if (cb) cb.checked = true;
          holder.classList.add("is-on");
          const ex = holder.querySelector(".hv-extra"); if (ex) ex.hidden = false;
        }
        save(v);
        return;
      }
      if (!c.contains("hv-prep")) return;
      const item = e.target.closest(".hv-item");
      const v = load();
      v.prep[item.dataset.id] = e.target.value;
      save(v);
    });
    $("hv-print").addEventListener("click", preview);
  }

  const handover = { open, collect, documentHtml, buildPdf, load, PREP };
  global.PharmacyHandover = handover;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
