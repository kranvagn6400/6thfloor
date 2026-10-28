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

  function render(list, events) {
    list.innerHTML = "";
    if (events.length === 0) {
      list.appendChild(el("div", "patient-history-empty", "لا توجد تغييرات مسجّلة لهذا المريض بعد"));
      return;
    }
    events.forEach(ev => {
      const label = EVENT_LABELS[ev.event] || { icon: "•", text: ev.event };
      const row = el("div", "patient-history-row event-" + ev.event);
      row.appendChild(el("span", "patient-history-icon", label.icon));
      const body = el("div", "patient-history-body");
      const line = el("div", "patient-history-line");
      line.appendChild(el("strong", null, label.text));
      if (ev.med_name) line.appendChild(document.createTextNode(" " + ev.med_name));
      body.appendChild(line);
      const detail = detailText(ev);
      if (detail) body.appendChild(el("div", "patient-history-detail" + (ev.event === "origin" || ev.event === "moved" ? " is-text" : ""), detail));
      const when = new Date(ev.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
      body.appendChild(el("div", "patient-history-meta", when + (ev.username ? " · @" + ev.username : "")));
      row.appendChild(body);
      list.appendChild(row);
    });
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
      render(list, events);
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
