/* ============================================================
   monthly-report.js  —  "التقرير الشهري"
   ============================================================
   Built from the cloud (features.sql), so it covers every device:
     - patient_events: admissions, med courses, boarder origin
     - patient_archive: discharges / deaths / transfers
   For the chosen month:
     - admissions; discharges, deaths, transfers to another ward
     - our patients: antibiotic courses started, days of therapy (DOT)
       per drug, patients who received an antibiotic, albumin days
     - boarders (مرضى مستضافون) by origin ward: stays, bed-days,
       antibiotic DOT — reported apart, because antibiotic use is
       attributed to the ward responsible for the patient
     - the 10 most-prescribed meds
   DOT = calendar days a drug was on a patient's list inside the month
   (from "added" to "stopped"/discharge; active courses count to today).
   Data exists only from the day features.sql was installed.
   ============================================================ */

(function (global) {
  "use strict";

  const DAY = 86400000;
  let lastReport = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function monthBounds(ym) {
    const [y, m] = ym.split("-").map(n => parseInt(n, 10));
    return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
  }
  function currentYM() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function originLabel(key) {
    const B = global.PharmacyBoarders;
    return B ? B.originOf({ originWard: key }).label : key;
  }

  function friendly(error, table) {
    const msg = (error && error.message) || "";
    if (/jwt/i.test(msg)) return new Error("انتهت الجلسة — سجّل الدخول من جديد");
    if (msg.indexOf(table) >= 0) return new Error("التقرير غير مُفعّل بعد — شغّل features.sql في Supabase");
    return error;
  }

  // PostgREST returns at most 1000 rows per request — page through.
  async function fetchAll(table, columns, timeCol, fromISO, toISO) {
    const client = global.PharmacySupabase.getClient();
    if (!client) throw new Error("غير متصل بالسحابة");
    const all = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 100000; offset += PAGE) {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .gte(timeCol, fromISO)
        .lt(timeCol, toISO)
        .order(timeCol, { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw friendly(error, table);
      all.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return all;
  }

  // Days of [start, end] (inclusive calendar days) that fall in the month
  function overlapDays(start, end, from, to) {
    const s = Math.max(dayStart(start).getTime(), from.getTime());
    const e = Math.min(dayStart(end).getTime(), to.getTime() - DAY);
    return e >= s ? Math.round((e - s) / DAY) + 1 : 0;
  }

  // events: patient_events rows (ascending); exits: patient_archive rows
  // inside the month (or null when the archive is unavailable).
  function build(events, from, to, exits) {
    const Clinical = global.PharmacyClinical;
    const now = new Date();
    const inMonth = (t) => t >= from && t < to;

    let admissions = 0, dischargeEvents = 0;
    const open = {};      // "bed|med" → course { start, name, bed, stay, isAbx, isAlb }
    const courses = [];
    const stayOfBed = {}; // bed → admission counter (separates patients in the same bed)
    const stays = {};     // stayId → { start, end, origin, admittedInMonth }
    const topCounts = {};

    const stayId = (bed) => bed + "#" + (stayOfBed[bed] || 0);
    const stay = (bed, t) => {
      const id = stayId(bed);
      return stays[id] || (stays[id] = { start: t, end: null, origin: "", admittedInMonth: false });
    };
    const closeBed = (bed, at) => {
      Object.keys(open).forEach(k => {
        if (open[k].bed === bed) { courses.push(Object.assign(open[k], { end: at })); delete open[k]; }
      });
      const s = stays[stayId(bed)];
      if (s && !s.end) s.end = at;
    };

    events.forEach(ev => {
      const t = new Date(ev.created_at);
      const bed = ev.bed_key;
      if (ev.event === "admitted") {
        closeBed(bed, t);
        stayOfBed[bed] = (stayOfBed[bed] || 0) + 1;
        stay(bed, t).admittedInMonth = inMonth(t);
        if (inMonth(t)) admissions++;
      } else if (ev.event === "discharged") {
        closeBed(bed, t);
        if (inMonth(t)) dischargeEvents++;
      } else if (ev.event === "origin") {
        stay(bed, t).origin = ev.detail || "";
      } else if (ev.event === "med_added") {
        stay(bed, t);
        const k = bed + "|" + ev.med_id;
        const med = { id: ev.med_id, nameEn: ev.med_name };
        if (!open[k]) {
          open[k] = {
            start: t, name: ev.med_name || ev.med_id, bed, stay: stayId(bed),
            isAbx: Clinical.isAntibiotic(med), isAlb: Clinical.isAlbumin(med)
          };
        }
        if (inMonth(t)) {
          const name = ev.med_name || ev.med_id;
          topCounts[name] = (topCounts[name] || 0) + 1;
        }
      } else if (ev.event === "med_removed") {
        const k = bed + "|" + ev.med_id;
        if (open[k]) { courses.push(Object.assign(open[k], { end: t })); delete open[k]; }
      }
    });
    Object.keys(open).forEach(k => courses.push(Object.assign(open[k], { end: now })));

    // ---- our patients' antibiotics / albumin ----
    const abx = {};
    const abxPatients = new Set();
    let abxStarts = 0, abxDot = 0, albCourses = 0, albDays = 0;
    // ---- boarders, per origin ward ----
    const boarders = {};
    const boarderRow = (origin) => boarders[origin] || (boarders[origin] = {
      origin, label: originLabel(origin), admitted: 0, bedDays: 0, abxDot: 0
    });

    courses.forEach(c => {
      const days = overlapDays(c.start, c.end, from, to);
      if (days === 0) return;
      const origin = (stays[c.stay] && stays[c.stay].origin) || "";
      if (origin) {
        if (c.isAbx) boarderRow(origin).abxDot += days;
        return;
      }
      const started = inMonth(c.start);
      if (c.isAbx) {
        const row = abx[c.name] || (abx[c.name] = { name: c.name, starts: 0, dot: 0, patients: new Set() });
        row.dot += days;
        row.patients.add(c.stay);
        if (started) { row.starts++; abxStarts++; }
        abxDot += days;
        abxPatients.add(c.stay);
      }
      if (c.isAlb) {
        albDays += days;
        if (started) albCourses++;
      }
    });

    Object.values(stays).forEach(s => {
      if (!s.origin) return;
      const row = boarderRow(s.origin);
      if (s.admittedInMonth) row.admitted++;
      row.bedDays += overlapDays(s.start, s.end || now, from, to);
    });

    const exitCounts = { discharged: 0, dead: 0, transferred: 0 };
    if (exits) exits.forEach(x => { if (x.kind in exitCounts) exitCounts[x.kind]++; });
    else exitCounts.discharged = dischargeEvents; // archive unavailable: best effort

    const abxRows = Object.values(abx)
      .map(r => ({ name: r.name, starts: r.starts, dot: r.dot, patients: r.patients.size }))
      .sort((a, b) => b.dot - a.dot);
    const boarderRows = Object.values(boarders)
      .filter(r => r.bedDays > 0 || r.admitted > 0)
      .sort((a, b) => b.bedDays - a.bedDays);
    const topMeds = Object.entries(topCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      admissions,
      discharges: exitCounts.discharged, deaths: exitCounts.dead, transfers: exitCounts.transferred,
      abxStarts, abxDot, abxPatients: abxPatients.size,
      albCourses, albDays, abxRows, boarderRows, topMeds,
      firstEvent: events.length ? new Date(events[0].created_at) : null
    };
  }

  function stat(num, label) {
    const card = el("div", "report-stat");
    card.appendChild(el("div", "report-stat-num", String(num)));
    card.appendChild(el("div", "report-stat-label", label));
    return card;
  }

  function table(headers, rows) {
    const t = el("table", "report-table");
    const tr = el("tr");
    headers.forEach(h => tr.appendChild(el("th", null, h)));
    const thead = el("thead"); thead.appendChild(tr); t.appendChild(thead);
    const tbody = el("tbody");
    rows.forEach(r => {
      const row = el("tr");
      r.forEach(v => row.appendChild(el("td", null, String(v))));
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  function render(rep, ym) {
    const body = document.getElementById("report-body");
    if (!body) return;
    body.innerHTML = "";
    const stats = el("div", "report-stats");
    stats.appendChild(stat(rep.admissions, "دخول"));
    stats.appendChild(stat(rep.discharges, "خروج"));
    stats.appendChild(stat(rep.deaths, "وفاة"));
    stats.appendChild(stat(rep.transfers, "رجوع إلى طوابقهم"));
    stats.appendChild(stat(rep.abxPatients, "مريض تلقى مضاداً"));
    stats.appendChild(stat(rep.abxDot, "أيام علاج بالمضادات (DOT)"));
    stats.appendChild(stat(rep.albDays, "أيام ألبومين"));
    body.appendChild(stats);

    body.appendChild(el("h3", "report-h", "المضادات الحيوية — مرضى الردهة"));
    if (rep.abxRows.length === 0) {
      body.appendChild(el("p", "report-empty", "لا توجد مضادات حيوية مسجّلة في هذا الشهر"));
    } else {
      body.appendChild(table(
        ["المضاد", "كورسات بدأت", "أيام العلاج (DOT)", "عدد المرضى"],
        rep.abxRows.map(r => [r.name, r.starts, r.dot, r.patients])
      ));
    }

    body.appendChild(el("h3", "report-h", "المرضى المستضافون من أقسام أخرى"));
    if (rep.boarderRows.length === 0) {
      body.appendChild(el("p", "report-empty", "لا يوجد مرضى مستضافون في هذا الشهر"));
    } else {
      body.appendChild(table(
        ["القسم الأصلي", "دخلوا هذا الشهر", "أيام إشغال الأسرّة", "أيام المضادات (DOT)"],
        rep.boarderRows.map(r => [r.label, r.admitted, r.bedDays, r.abxDot])
      ));
    }

    body.appendChild(el("h3", "report-h", "الأدوية الأكثر وصفاً"));
    if (rep.topMeds.length === 0) {
      body.appendChild(el("p", "report-empty", "لا توجد إضافات أدوية في هذا الشهر"));
    } else {
      body.appendChild(table(["الدواء", "مرات الإضافة"], rep.topMeds.map(r => [r.name, r.count])));
    }

    const note = rep.firstEvent
      ? "البيانات مسجّلة تلقائياً منذ " + rep.firstEvent.toLocaleDateString("ar", { dateStyle: "medium" }) + "."
      : "لا توجد بيانات لهذا الشهر — يبدأ التسجيل من يوم تشغيل features.sql.";
    body.appendChild(el("p", "report-note", note +
      " أيام العلاج = عدد الأيام التي كان فيها الدواء على قائمة المريض داخل الشهر." +
      " مضادات المرضى المستضافين تُحسب على قسمهم الأصلي، فهي خارج جدول مرضى الردهة."));
    lastReport = { rep, ym };
  }

  async function load(ym) {
    const body = document.getElementById("report-body");
    if (!body) return;
    body.innerHTML = "";
    body.appendChild(el("p", "report-empty", "جارٍ إعداد التقرير…"));
    lastReport = null;
    try {
      const { from, to } = monthBounds(ym);
      // Look back 120 days so courses / stays that began earlier still count
      const lookback = new Date(from.getTime() - 120 * DAY);
      const events = await fetchAll("patient_events",
        "bed_key, event, med_id, med_name, detail, created_at", "created_at",
        lookback.toISOString(), to.toISOString());
      let exits = null;
      try {
        exits = await fetchAll("patient_archive", "kind, event_at", "event_at", from.toISOString(), to.toISOString());
      } catch (e) { exits = null; }
      render(build(events, from, to, exits), ym);
    } catch (e) {
      body.innerHTML = "";
      body.appendChild(el("p", "report-empty", (e && e.message) ? e.message : String(e)));
    }
  }

  function exportExcel() {
    const App = global.PharmacyApp;
    if (!lastReport) { App.flashHint("لا يوجد تقرير لتصديره"); return; }
    if (!global.XLSX) { App.flashHint("مكتبة Excel غير محمّلة"); return; }
    const { rep, ym } = lastReport;
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["الشهر", ym],
      ["دخول", rep.admissions],
      ["خروج", rep.discharges],
      ["وفاة", rep.deaths],
      ["رجوع إلى طوابقهم", rep.transfers],
      ["مرضى تلقوا مضاداً (مرضى الردهة)", rep.abxPatients],
      ["كورسات مضاد بدأت", rep.abxStarts],
      ["أيام علاج بالمضادات (DOT)", rep.abxDot],
      ["كورسات ألبومين بدأت", rep.albCourses],
      ["أيام ألبومين", rep.albDays]
    ]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [["Antibiotic", "Courses started", "DOT", "Patients"]].concat(rep.abxRows.map(r => [r.name, r.starts, r.dot, r.patients]))
    ), "Antibiotics");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [["Origin ward", "Admitted", "Bed-days", "Antibiotic DOT"]].concat(rep.boarderRows.map(r => [r.label, r.admitted, r.bedDays, r.abxDot]))
    ), "Boarders");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [["Medication", "Times added"]].concat(rep.topMeds.map(r => [r.name, r.count]))
    ), "Top meds");
    XLSX.writeFile(wb, "6th-floor-report-" + ym + ".xlsx");
  }

  function open() {
    const Auth = global.PharmacyAuth;
    if (Auth && Auth.isDoctor() && !Auth.isAdmin()) return;   // hidden for doctors
    if (Auth && Auth.isPharmacist() && !Auth.isAdmin()) return;   // and for pharmacists (the user asked)
    const input = document.getElementById("report-month");
    if (input && !input.value) input.value = currentYM();
    global.PharmacyUI.showView("report");
    load(input ? input.value : currentYM());
  }

  function init() {
    const input = document.getElementById("report-month");
    if (input) {
      input.max = currentYM();
      input.addEventListener("change", () => { if (input.value) load(input.value); });
    }
    const exp = document.getElementById("report-export-btn");
    if (exp) exp.addEventListener("click", exportExcel);
    ["settings-report-btn", "admin-report-btn", "abx-report-btn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", open);
    });
    const back = document.getElementById("report-back-btn");
    if (back) back.addEventListener("click", () => {
      const Auth = global.PharmacyAuth;
      global.PharmacyUI.showView(Auth && Auth.isAdmin() ? "admin" : "settings");
    });
  }

  global.PharmacyMonthlyReport = { init, open, build };
})(window);
