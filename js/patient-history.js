/* ============================================================
   patient-history.js  —  "سجل التغييرات" in the patient view
   ============================================================
   Reads public.patient_events (features.sql). The rows are written
   by a database trigger on every save, stamped with the signed-in
   user, so the history can't be edited from the browser.
   Shows the current stay only: events back to the latest admission,
   never past a previous patient's exit (discharge / death / return to
   their floor / delete all log "discharged") or another patient's name
   — so a new patient in the bed never sees the previous one's log.
   ============================================================ */

(function (global) {
  "use strict";

  const EVENT_LABELS = {
    admitted:    { icon: "🛏", text: "دخول المريض" },
    discharged:  { icon: "🚪", text: "خروج المريض" },
    med_added:   { icon: "➕", text: "إضافة" },
    med_removed: { icon: "✖",  text: "إيقاف" },
    med_changed: { icon: "✎",  text: "تعديل الجرعة" },
    allergies:   { icon: "⚠",  text: "تحديث الحساسية" },
    origin:      { icon: "🏷", text: "القسم الأصلي" },
    moved:       { icon: "↔",  text: "نقل سرير" }
  };

  // 'origin' events store the ward key — show its name
  function detailText(ev) {
    // a move is logged by the server with the in-room bed number ("من غرفة 1 سرير 3"):
    // show the ward-wide number instead
    if (ev.event === "moved" && ev.detail && global.PharmacyWard && global.PharmacyWard.bedLabel) {
      return String(ev.detail).replace(/غرفة (\d+) سرير (\d+)/, (m, r, b) => global.PharmacyWard.roomTitle(r) + " سرير " + global.PharmacyWard.bedLabel(+r, +b));
    }
    if (ev.event !== "origin") return ev.detail;
    const B = global.PharmacyBoarders;
    return ev.detail ? (B ? B.originOf({ originWard: ev.detail }).label : ev.detail) : "مريض الردهة";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const normName = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // Newest-first events → this stay only. Pure (tested in
  // scripts/test-history.js).
  function cutStay(events, currentName) {
    const name = normName(currentName);
    const stay = [];
    for (const ev of (events || [])) {
      if (ev.event === "discharged") break;                       // previous patient left
      if (name && ev.patient_name && normName(ev.patient_name) !== name) break; // someone else
      stay.push(ev);
      if (ev.event === "admitted") break;
    }
    return stay;
  }

  async function fetchStay(bedKey, currentName) {
    const SB = global.PharmacySupabase;
    const client = SB && SB.getClient ? SB.getClient() : null;
    if (!client) throw new Error("غير متصل بالسحابة");
    const { data, error } = await client
      .from("patient_events")
      .select("event, med_name, detail, username, patient_name, created_at")
      .eq("bed_key", bedKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (/jwt/i.test(error.message || "")) throw new Error("انتهت الجلسة — سجّل الدخول من جديد");
      if (/patient_events/.test(error.message || "")) {
        throw new Error("السجل غير مُفعّل بعد — شغّل features.sql في Supabase");
      }
      throw error;
    }
    return cutStay(data, currentName);
  }

  // ---- الخط الزمني: الأحداث (من السجل) + نتائج التحاليل المحلية، مجمّعة باليوم ----
  const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");
  function dayTitle(k) {
    const t = new Date().toLocaleDateString("en-CA");
    const y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");
    if (k === t) return "اليوم";
    if (k === y) return "أمس";
    return new Date(k + "T12:00:00").toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
  }
  const LAB_NAMES = { creatinine: "S. Creatinine", albumin: "S. Albumin", wbc: "WBC", hb: "Hb", plt: "PLT", na: "Na+", k: "K+", glucose: "Glucose", crp: "CRP" };
  function labItems(p) {
    const out = [];
    if (!p) return out;
    (p.labHistory || []).forEach(h => { if (h && h.date && /^\d{4}-\d{2}-\d{2}/.test(h.date)) out.push({ day: h.date.slice(0, 10), t: 0, kind: "lab", title: (h.label || LAB_NAMES[h.key] || h.key) + ": " + h.value }); });
    const L = p.labs || {}, D = L._dates || {};
    Object.keys(D).forEach(k => { if (L[k] && /^\d{4}-\d{2}-\d{2}/.test(D[k])) out.push({ day: D[k].slice(0, 10), t: 0, kind: "lab", title: (LAB_NAMES[k] || k) + ": " + L[k] }); });
    return out;
  }
  function render(list, events, patient) {
    list.innerHTML = "";
    const items = (events || []).map(ev => ({ day: dayKey(ev.created_at), t: new Date(ev.created_at).getTime(), kind: ev.event, ev }));
    labItems(patient).forEach(x => items.push(x));
    if (items.length === 0) {
      list.appendChild(el("div", "patient-history-empty", "لا توجد تغييرات مسجّلة لهذا المريض بعد"));
      return;
    }
    items.sort((a, b) => b.day.localeCompare(a.day) || b.t - a.t);
    const days = Array.from(new Set(items.map(x => x.day)));
    const meds = (events || []).filter(e => e.event === "med_added").length;
    const sum = el("div", "tl-sum");
    sum.appendChild(el("span", null, "الإقامة: " + Math.max(1, Math.round((Date.now() - new Date(days[days.length - 1] + "T00:00:00")) / 864e5) + 1) + " يوم"));
    sum.appendChild(el("span", null, items.length + " حدث"));
    if (meds) sum.appendChild(el("span", null, meds + " دواء أُضيف"));
    list.appendChild(sum);
    const tl = el("div", "tl");
    let lastDay = "";
    items.forEach(x => {
      if (x.day !== lastDay) { lastDay = x.day; tl.appendChild(el("div", "tl-day", dayTitle(x.day))); }
      const row = el("div", "tl-item k-" + x.kind);
      const body = el("div", "tl-body");
      if (x.ev) {
        const ev = x.ev, label = EVENT_LABELS[ev.event] || { icon: "•", text: ev.event };
        row.appendChild(el("span", "tl-dot", label.icon));
        const t = el("div", "tl-title"); t.appendChild(el("strong", null, label.text));
        if (ev.med_name) t.appendChild(document.createTextNode(" " + ev.med_name));
        body.appendChild(t);
        const detail = detailText(ev);
        if (detail) { const d = el("div", "tl-sub", detail); d.dir = "auto"; body.appendChild(d); }
        const meta = el("div", "tl-meta", new Date(ev.created_at).toLocaleTimeString("ar", { timeStyle: "short" }));
        if (ev.username) { meta.appendChild(document.createTextNode(" · ")); const u = el("span", null, "@" + ev.username); u.dir = "ltr"; meta.appendChild(u); }
        body.appendChild(meta);
      } else {
        row.appendChild(el("span", "tl-dot", "🧪"));
        const t = el("div", "tl-title"); t.appendChild(el("strong", null, "تحليل")); t.appendChild(document.createTextNode(" " + x.title));
        body.appendChild(t);
      }
      row.appendChild(body);
      tl.appendChild(row);
    });
    list.appendChild(tl);
    if (global.gsap && !(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      global.gsap.from(tl.querySelectorAll(".tl-item"), { opacity: 0, x: 16, duration: 0.3, stagger: 0.03, ease: "power2.out", clearProps: "opacity,transform" });
    }
  }

  async function load() {
    const App = global.PharmacyApp;
    const list = document.getElementById("patient-history-list");
    const bed = App && App.state.currentBed;
    if (!list || !bed) return;
    list.innerHTML = "";
    list.appendChild(el("div", "patient-history-empty", "جارٍ التحميل…"));
    try {
      const p = App.state.patients && App.state.patients[bed.key];
      const events = await fetchStay(bed.key, p && p.name);
      if (!App.state.currentBed || App.state.currentBed.key !== bed.key) return; // switched patient
      render(list, events, p);
    } catch (e) {
      list.innerHTML = "";
      list.appendChild(el("div", "patient-history-empty", (e && e.message) ? e.message : String(e)));
    }
  }

  function setOpen(open) {
    const toggle = document.getElementById("patient-history-toggle");
    const list = document.getElementById("patient-history-list");
    if (!toggle || !list) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    list.hidden = !open;
  }

  // Called when a different patient is opened: collapse + forget
  function reset() {
    setOpen(false);
    const list = document.getElementById("patient-history-list");
    if (list) list.innerHTML = "";
  }

  function init() {
    const toggle = document.getElementById("patient-history-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(open);
      // Reload every time it is opened — the log changes as people work
      if (open) load();
    });
  }

  global.PharmacyPatientHistory = { init, reset, load, cutStay, fetchStay };
})(window);
