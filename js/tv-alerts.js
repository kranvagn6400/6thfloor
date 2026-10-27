/* ============================================================
   tv-alerts.js — the ward display (TV) as a notification board
   ------------------------------------------------------------
   While the display is on, a bed lights up for an hour after:
     - a new patient was admitted (patient_events admitted)    → green;
       writing that patient's medicines keeps it green (not orange)
     - a medicine was added / stopped / its dose or frequency changed
       of a patient already there
       (patient_events med_added | med_removed | med_changed) → orange
     - the patient was discharged (patient_archive kind discharged) → pink
       (a return to their floor — transferred — is not lit)
     - the patient died (patient_archive kind dead)             → black
   The newest event of a bed wins. Both tables are written by the
   server / app already; this only reads them (any signed-in role,
   the TV included) — Realtime on INSERT plus a 30 s poll.
   ============================================================ */
(function (global) {
  "use strict";

  const WINDOW_MS = 60 * 60 * 1000;      // a bed stays lit for an hour
  const POLL_MS = 30000;
  const MED_EVENTS = ["med_added", "med_removed", "med_changed"];

  let alerts = new Map();   // bed_key → { type: "new"|"med"|"out"|"dead", at, name, detail }
  let timer = null;
  let channel = null;
  let running = false;

  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  };

  // ---- pure: events + archive rows → alerts per bed (tested) ----
  function build(events, archive, now) {
    const since = (now || Date.now()) - WINDOW_MS;
    const out = new Map();
    const put = (key, a) => {
      if (!key || !(a.at >= since)) return;
      const cur = out.get(key);
      if (!cur || a.at > cur.at) out.set(key, a);
    };
    // admissions in the window: that stay's medicine events stay green
    const admittedAt = new Map();
    (events || []).forEach(e => {
      if (e.event !== "admitted") return;
      const at = Date.parse(e.created_at);
      if (at >= since && at > (admittedAt.get(e.bed_key) || 0)) admittedAt.set(e.bed_key, at);
    });
    admittedAt.forEach((at, key) => put(key, { type: "new", at, name: "", detail: "مريض جديد" }));
    (events || []).forEach(e => {
      if (MED_EVENTS.indexOf(e.event) === -1) return;
      const adm = admittedAt.get(e.bed_key);
      if (adm && Date.parse(e.created_at) >= adm) return;   // the new patient's medicines
      const verb = e.event === "med_added" ? "إضافة" : e.event === "med_removed" ? "إيقاف" : "تعديل";
      put(e.bed_key, { type: "med", at: Date.parse(e.created_at), name: e.patient_name || "", detail: verb + (e.med_name ? " " + e.med_name : "") });
    });
    (archive || []).forEach(r => {
      const rec = r.record || {};
      const key = rec.roomNumber && rec.bedNumber ? "room-" + rec.roomNumber + "-bed-" + rec.bedNumber : "";
      // a boarder returned to their floor is not lit (only discharge / death)
      const type = r.kind === "dead" ? "dead" : r.kind === "discharged" ? "out" : "";
      if (!type) return;
      put(key, { type, at: Date.parse(r.event_at || r.created_at), name: r.name || rec.name || "", detail: r.kind === "dead" ? "وفاة" : "خروج" });
    });
    return out;
  }

  async function load() {
    const c = client();
    if (!c || !running) return;
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    try {
      const [ev, ar] = await Promise.all([
        c.from("patient_events").select("bed_key, patient_name, event, med_name, created_at")
          .gte("created_at", since).in("event", MED_EVENTS.concat("admitted")),
        c.from("patient_archive").select("kind, name, record, event_at, created_at").gte("event_at", since)
      ]);
      const next = build(ev.error ? [] : ev.data, ar.error ? [] : ar.data, Date.now());
      const changed = JSON.stringify(Array.from(next)) !== JSON.stringify(Array.from(alerts));
      alerts = next;
      if (changed && global.PharmacyApp && global.PharmacyApp.refreshDisplay) global.PharmacyApp.refreshDisplay();
    } catch (e) { /* offline: keep what we have */ }
  }

  function start() {
    if (running) return;
    running = true;
    load();
    timer = setInterval(load, POLL_MS);
    const c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-tv-alerts")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "patient_events" }, () => load())
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "patient_archive" }, () => load())
          .subscribe();
      } catch (e) { /* the poll still works */ }
    }
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (channel) { try { channel.unsubscribe(); } catch (e) { /* ignore */ } channel = null; }
    alerts = new Map();
  }

  function alertFor(bedKey) {
    const a = alerts.get(bedKey);
    return a && a.at >= Date.now() - WINDOW_MS ? a : null;
  }
  function ago(at) {
    const m = Math.max(0, Math.round((Date.now() - at) / 60000));
    return m < 1 ? "الآن" : "منذ " + m + " د";
  }

  global.PharmacyTvAlerts = { start, stop, load, alertFor, ago, build, WINDOW_MS };
})(window);
