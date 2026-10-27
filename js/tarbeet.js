/* ============================================================
   tarbeet.js  —  التربيت (the pharmacist's daily filing round)
   ============================================================
   After the medicines are distributed, each pharmacist writes what was
   done into the paper file of every patient in the rooms assigned to
   them — "التربيت". Here:
     - the admin assigns each room to a pharmacist ("التربيت — توزيع
       الغرف", table tarbeet_assignments) and, where needed, single beds
       to someone else (tarbeet_bed_assignments — a bed's pharmacist wins
       over its room's) and sees today's progress;
     - a pharmacist marks each bed in the "تربيتي" tab (table tarbeet_log,
       one row per bed per day, with who and when); the tab (bottom nav)
       shows their beds room by room, each with ✓ (done) and a crossed-out
       file (the file / patient is not there today — tarbeet_log.status
       'not_done', features.sql §14); pressing the lit one again clears it.
       Beds get the same mark on the rooms view (fileOffIcon).
   Daily: only today's rows count. 7th-floor hematology patients are not
   part of it (their medicines are not ordered / distributed by us).
   Pharmacists + admin only. Tables + RLS: features.sql §9.
   ============================================================ */

(function (global) {
  "use strict";

  const ROLE_OK = () => {
    const A = global.PharmacyAuth;
    return !!(A && (A.isAdmin() || A.isPharmacist()));
  };
  const App = () => global.PharmacyApp;
  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  };
  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const flash = (m) => App() && App().flashHint(m);
  const Ward_label = (r, b) => global.PharmacyWard.bedLabel(r, b);   // the ward-wide number 1-50
  // "الملف غير موجود": a crossed-out file (static markup, no user text)
  const FILE_OFF_SVG = '<svg class="ico-file-off" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M7 3h7l5 5v7"/><path d="M19 19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5"/><path d="M14 3v4a1 1 0 0 0 1 1h4"/></svg>';
  function fileOffIcon() {
    const s = document.createElement("span");
    s.className = "ico-wrap";
    s.innerHTML = FILE_OFF_SVG;
    return s;
  }
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });

  // ---------- data ----------
  let assignments = new Map();   // room_id → { id, name }
  let bedAssign = new Map();     // bed_key → { id, name }  (overrides the room)
  let done = new Map();          // bed_key → { by, byId, at, patient }  (today, ✓)
  let notDone = new Map();       // bed_key → same  (today, ✗)
  let day = today();
  let myId = null;
  let channel = null;
  let loadedOnce = false;

  async function myUserId() {
    if (myId) return myId;
    const c = client();
    try {
      const { data } = c ? await c.auth.getSession() : { data: null };
      myId = (data && data.session && data.session.user && data.session.user.id) || null;
    } catch (e) { /* offline */ }
    return myId;
  }

  async function load() {
    const c = client();
    if (!c || !ROLE_OK()) return;
    day = today();
    const [a, l, b] = await Promise.all([
      c.from("tarbeet_assignments").select("*"),
      c.from("tarbeet_log").select("*").eq("day", day),
      c.from("tarbeet_bed_assignments").select("*")
    ]);
    if (!a.error && Array.isArray(a.data)) {
      assignments = new Map(a.data.map(r => [r.room_id, { id: r.pharmacist_id, name: r.pharmacist_name }]));
    }
    if (!b.error && Array.isArray(b.data)) {
      bedAssign = new Map(b.data.map(r => [r.bed_key, { id: r.pharmacist_id, name: r.pharmacist_name }]));
    }
    if (!l.error && Array.isArray(l.data)) {
      const row = r => [r.bed_key, { by: r.pharmacist_name, byId: r.pharmacist_id, at: r.done_at, patient: r.patient_name }];
      // rows from before §14 have no status: they are ✓
      done = new Map(l.data.filter(r => r.status !== "not_done").map(row));
      notDone = new Map(l.data.filter(r => r.status === "not_done").map(row));
    }
    loadedOnce = true;
    refreshUi();
  }

  function subscribe() {
    const c = client();
    if (!c || channel) return;
    try {
      channel = c.channel("pharma-tarbeet")
        .on("postgres_changes", { event: "*", schema: "public", table: "tarbeet_assignments" }, () => load())
        .on("postgres_changes", { event: "*", schema: "public", table: "tarbeet_log" }, () => load())
        .on("postgres_changes", { event: "*", schema: "public", table: "tarbeet_bed_assignments" }, () => load())
        .subscribe();
    } catch (e) { /* realtime unavailable: manual refresh still works */ }
  }

  // Patients that need it: named, not 7th-floor hematology
  function countable(p) {
    const B = global.PharmacyBoarders;
    return !!(p && p.name && p.name.trim() && !(B && B.isNoOrder(p)));
  }
  function parseBed(key) {
    const m = String(key).match(/room-(\d+)-bed-(\d+)/);
    return m ? { roomId: +m[1], bed: +m[2] } : null;
  }
  // Who files this bed: the bed's own pharmacist, else the room's
  function ownerOf(bedKey) {
    const b = bedAssign.get(bedKey);
    if (b && b.id) return b;
    const w = parseBed(bedKey);
    return (w && assignments.get(w.roomId)) || null;
  }
  // Today's patients (needing it), with their owner
  function allPatients() {
    const st = App().state;
    return Object.keys(st.patients || {})
      .map(k => ({ key: k, where: parseBed(k), p: st.patients[k] }))
      .filter(x => x.where && countable(x.p))
      .map(x => Object.assign(x, { owner: ownerOf(x.key) }))
      .sort((a, b) => a.where.roomId - b.where.roomId || a.where.bed - b.where.bed);
  }
  function patientsOf(pharmacistId) {
    return allPatients().filter(x => x.owner && x.owner.id === pharmacistId);
  }
  // Beds of a pharmacist, as text: "غرفة 1 كاملة، غرفة 3 سرير 2"
  function bedsText(pharmacistId) {
    const Ward = global.PharmacyWard;
    const parts = [];
    (Ward.ROOMS || []).forEach(room => {
      const mine = room.beds.filter(b => { const o = ownerOf(Ward.bedKey(room.id, b.number)); return o && o.id === pharmacistId; })
        .map(b => Ward.bedLabel(room.id, b.number));
      if (!mine.length) return;
      parts.push(mine.length === room.beds.length ? global.PharmacyWard.roomTitle(room.id) + " كاملة" : global.PharmacyWard.roomTitle(room.id) + " سرير " + mine.join("، "));
    });
    return parts.join(" · ");
  }

  // The table missing → features.sql not run yet; anything else: say what it is
  function explain(err) {
    const m = (err && err.message) || "";
    if (/does not exist|schema cache|Could not find the table/i.test(m)) return "جداول التربيت غير موجودة — شغّل features.sql في Supabase";
    if (/row-level security|permission denied/i.test(m)) return "لا تملك صلاحية هذا الإجراء (" + m + ")";
    return "تعذّر الحفظ: " + m;
  }

  // ---------- marking ----------
  async function markDone(bedKey) { return setStatus(bedKey, "done"); }
  // status: "done" (✓) | "not_done" (✗) | "" (clear). One row per bed per
  // day: switching ✓ ↔ ✗ replaces the row.
  async function setStatus(bedKey, status) {
    const c = client();
    const st = App().state;
    const p = st.patients[bedKey];
    if (!c || !p || !ROLE_OK()) return;
    if (done.has(bedKey) || notDone.has(bedKey)) {
      const del = await c.from("tarbeet_log").delete().eq("day", today()).eq("bed_key", bedKey).select("id");
      if (del.error) { flash(explain(del.error)); return; }
      if (!del.data || !del.data.length) { flash("سجّل صيدلاني آخر هذا السرير اليوم — لا يمكنك تغييره"); await load(); return; }
    }
    if (status) {
      const A = global.PharmacyAuth;
      const user = A.getCurrentUser();
      const row = {
        day: today(), bed_key: bedKey, patient_name: (p.name || "").trim(),
        pharmacist_name: user ? (user.displayName || user.username) : ""
      };
      if (status === "not_done") row.status = "not_done";
      const { error } = await c.from("tarbeet_log").insert(row);
      const msg = (error && error.message) || "";
      if (error && /status/i.test(msg) && /column|schema/i.test(msg)) {
        flash("شغّل القسم 14 من features.sql في Supabase حتى يعمل زر «الملف غير موجود»");
        await load();
        return;
      }
      if (error && !/duplicate|unique/i.test(msg)) {
        flash(explain(error));
        await load();
        return;
      }
      flash((status === "done" ? "✓ تم التربيت — " : "الملف غير موجود — ") + (p.name || "").trim());
    }
    await load();
  }
  // ---------- "تربيتي" (bottom-nav tab) ----------
  // The pharmacist's beds room by room; each bed: ✓ / ✗ (the lit one
  // clears it when pressed again). Tapping the patient opens the card.
  async function renderMine() {
    const box = document.getElementById("tarbeet-mine");
    if (!box) return;
    const me = await myUserId();
    box.innerHTML = "";
    const where = bedsText(me);
    if (!where) {
      box.appendChild(el("div", "tasks-empty", loadedOnce ? "لم يُحدَّد لك أسرّة للتربيت — راجع المسؤول" : "جارٍ التحميل…"));
      return;
    }
    const list = patientsOf(me);
    const nDone = list.filter(x => done.has(x.key)).length;
    const nNot = list.filter(x => notDone.has(x.key)).length;
    const head = el("div", "tarbeet-progress");
    const counts = el("div", "tarbeet-progress-text");
    counts.appendChild(el("span", "tarbeet-count ok", "✓ " + nDone));
    const cNo = el("span", "tarbeet-count no", " " + nNot);
    cNo.prepend(fileOffIcon());
    cNo.title = "الملف غير موجود";
    counts.appendChild(cNo);
    counts.appendChild(el("span", "tarbeet-count left", "متبقٍّ " + (list.length - nDone - nNot)));
    counts.appendChild(el("span", "tarbeet-count total", "من " + list.length));
    head.appendChild(counts);
    head.appendChild(el("div", "tarbeet-progress-where", where));
    const barOut = el("div", "tarbeet-progress-bar");
    const barIn = el("div", "tarbeet-progress-fill");
    barIn.style.width = (list.length ? Math.round(100 * nDone / list.length) : 0) + "%";
    barOut.appendChild(barIn);
    head.appendChild(barOut);
    box.appendChild(head);
    if (!list.length) { box.appendChild(el("div", "tasks-empty", "لا يوجد مرضى في أسرّتك")); return; }
    const rooms = new Map();
    list.forEach(x => rooms.set(x.where.roomId, (rooms.get(x.where.roomId) || []).concat(x)));
    rooms.forEach((beds, roomId) => {
      const card = el("div", "tarbeet-room-card");
      card.appendChild(el("div", "tarbeet-room-title", global.PharmacyWard.roomTitle(roomId)));
      const grid = el("div", "tarbeet-bed-grid");
      beds.forEach(x => {
        const d = done.get(x.key), nd = notDone.get(x.key);
        const tile = el("div", "tarbeet-bed" + (d ? " is-done" : nd ? " is-not" : ""));
        const open = el("button", "tarbeet-bed-body");
        open.type = "button";
        open.appendChild(el("span", "tarbeet-bed-no", "سرير " + Ward_label(x.where.roomId, x.where.bed)));
        open.appendChild(el("strong", "tarbeet-bed-name", x.p.name.trim()));
        if (x.p.plateNumber) open.appendChild(el("span", "tarbeet-bed-plate", String(x.p.plateNumber)));
        const m = d || nd;
        open.appendChild(el("span", "tarbeet-bed-state", m ? (d ? "✓ " : "الملف غير موجود · ") + timeOf(m.at) + (m.by ? " · " + m.by : "") : "لم يُسجَّل بعد"));
        open.addEventListener("click", () => App().openPatient({ key: x.key, roomId: x.where.roomId, bed: x.where.bed }));
        tile.appendChild(open);
        const acts = el("div", "tarbeet-bed-acts");
        const ok = el("button", "tarbeet-mark ok" + (d ? " on" : ""), "✓");
        ok.type = "button";
        ok.setAttribute("aria-label", d ? "إلغاء ✓" : "تم التربيت");
        const no = el("button", "tarbeet-mark no" + (nd ? " on" : ""));
        no.appendChild(fileOffIcon());
        no.type = "button";
        no.setAttribute("aria-label", nd ? "إلغاء «الملف غير موجود»" : "الملف غير موجود");
        no.title = "الملف غير موجود";
        const busy = (fn) => async () => { ok.disabled = no.disabled = true; await fn(); };
        ok.addEventListener("click", busy(() => setStatus(x.key, d ? "" : "done")));
        no.addEventListener("click", busy(() => setStatus(x.key, nd ? "" : "not_done")));
        acts.appendChild(ok);
        acts.appendChild(no);
        tile.appendChild(acts);
        grid.appendChild(tile);
      });
      card.appendChild(grid);
      box.appendChild(card);
    });
  }

  // ---------- admin: rooms → pharmacists + progress ----------
  let pharmacists = [];
  async function renderAdmin() {
    const box = document.getElementById("tarbeet-admin");
    if (!box) return;
    const A = global.PharmacyAuth;
    if (!pharmacists.length) {
      const r = await A.listUsers();
      pharmacists = r.ok ? r.users.filter(u => u.active !== false && (u.role === "pharmacist" || u.role === "admin"))
        .map(u => ({ id: u.id, name: String(u.display_name || u.username).split("|")[0].trim() })) : [];
    }
    box.innerHTML = "";
    // today's progress per pharmacist (by who owns each bed)
    const prog = el("div", "tarbeet-admin-progress");
    const all = allPatients();
    const byPh = new Map();
    all.forEach(x => { if (x.owner && x.owner.id) byPh.set(x.owner.id, (byPh.get(x.owner.id) || []).concat(x)); });
    const owners = new Set(Array.from(assignments.values()).concat(Array.from(bedAssign.values())).map(v => v.id).filter(Boolean));
    if (!owners.size) prog.appendChild(el("div", "tasks-empty", "لم تُوزَّع الأسرّة بعد"));
    owners.forEach(id => {
      const list = byPh.get(id) || [];
      const n = list.filter(x => done.has(x.key)).length;
      const nn = list.filter(x => notDone.has(x.key)).length;
      const name = (pharmacists.find(p => p.id === id) || {}).name || "—";
      const card = el("div", "tarbeet-admin-card");
      card.appendChild(el("strong", null, name));
      card.appendChild(el("span", "tarbeet-row-bed", bedsText(id) || "—"));
      card.appendChild(el("span", "tarbeet-row-state" + (list.length && n === list.length ? " is-complete" : ""), "✓ " + n + " / " + list.length + (nn ? "  ·  غير موجود " + nn : "")));
      prog.appendChild(card);
    });
    const free = all.filter(x => !x.owner).length;
    if (free) prog.appendChild(el("div", "tarbeet-admin-free", free + " مريض بلا صيدلاني تربيت"));
    box.appendChild(el("h4", "tarbeet-admin-title", "إنجاز اليوم"));
    box.appendChild(prog);
    // assignments: a pharmacist per room, and per bed when needed
    box.appendChild(el("h4", "tarbeet-admin-title", "توزيع الغرف والأسرّة"));
    const Ward = global.PharmacyWard;
    const st = App().state;
    (Ward.ROOMS || []).forEach(room => {
      const wrap = el("div", "tarbeet-room");
      const row = el("div", "tarbeet-assign-row");
      row.appendChild(el("span", "tarbeet-assign-room", global.PharmacyWard.roomTitle(room.id)));
      const sel = el("select", "tarbeet-assign-select");
      sel.appendChild(new Option("— بدون —", ""));
      pharmacists.forEach(p => sel.appendChild(new Option(p.name, p.id)));
      const cur = assignments.get(room.id);
      sel.value = cur && cur.id ? cur.id : "";
      sel.addEventListener("change", () => assign(room.id, sel.value));
      row.appendChild(sel);
      const overrides = room.beds.filter(b => bedAssign.has(Ward.bedKey(room.id, b.number))).length;
      const tog = el("button", "tarbeet-beds-toggle" + (overrides ? " has-overrides" : ""), "الأسرّة" + (overrides ? " (" + overrides + ")" : "") + (openRooms.has(room.id) ? " ▴" : " ▾"));
      tog.type = "button";
      tog.addEventListener("click", () => { if (openRooms.has(room.id)) openRooms.delete(room.id); else openRooms.add(room.id); renderAdmin(); });
      row.appendChild(tog);
      wrap.appendChild(row);
      if (openRooms.has(room.id)) {
        const beds = el("div", "tarbeet-beds");
        room.beds.forEach(b => {
          const key = Ward.bedKey(room.id, b.number);
          const p = st.patients && st.patients[key];
          const br = el("div", "tarbeet-bed-row");
          br.appendChild(el("span", "tarbeet-bed-num", "سرير " + Ward_label(room.id, b.number)));
          br.appendChild(el("span", "tarbeet-bed-patient", p && p.name && p.name.trim() ? p.name.trim() : "فارغ"));
          const bs = el("select", "tarbeet-assign-select");
          bs.appendChild(new Option("مثل الغرفة" + (cur && cur.name ? " (" + cur.name + ")" : ""), ""));
          pharmacists.forEach(ph => bs.appendChild(new Option(ph.name, ph.id)));
          const bo = bedAssign.get(key);
          bs.value = bo && bo.id ? bo.id : "";
          bs.addEventListener("change", () => assignBed(key, room.id, b.number, bs.value));
          br.appendChild(bs);
          beds.appendChild(br);
        });
        wrap.appendChild(beds);
      }
      box.appendChild(wrap);
    });
  }
  const openRooms = new Set();   // rooms whose beds are shown
  async function assignBed(bedKey, roomId, bedNum, pharmacistId) {
    const c = client();
    if (!c) return;
    const p = pharmacists.find(x => x.id === pharmacistId);
    const res = pharmacistId
      ? await c.from("tarbeet_bed_assignments").upsert({ bed_key: bedKey, pharmacist_id: pharmacistId, pharmacist_name: p ? p.name : "", updated_at: new Date().toISOString() }, { onConflict: "bed_key" })
      : await c.from("tarbeet_bed_assignments").delete().eq("bed_key", bedKey);
    if (res.error) { flash(explain(res.error)); return; }
    flash("✓ غرفة " + roomId + " سرير " + Ward_label(roomId, bedNum) + (p ? " ← " + p.name : " ← مثل الغرفة"));
    await load();
  }
  async function assign(roomId, pharmacistId) {
    const c = client();
    if (!c) return;
    const p = pharmacists.find(x => x.id === pharmacistId);
    const res = pharmacistId
      ? await c.from("tarbeet_assignments").upsert({ room_id: roomId, pharmacist_id: pharmacistId, pharmacist_name: p ? p.name : "", updated_at: new Date().toISOString() }, { onConflict: "room_id" })
      : await c.from("tarbeet_assignments").delete().eq("room_id", roomId);
    if (res.error) { flash(explain(res.error)); return; }
    flash("✓ غرفة " + roomId + (p ? " ← " + p.name : " بدون صيدلاني"));
    await load();
  }

  // ---------- wiring ----------
  function refreshUi() {
    const mine = document.getElementById("view-tarbeet");
    if (mine && !mine.hidden) renderMine();
    const adm = document.getElementById("view-tarbeet-admin");
    if (adm && !adm.hidden) renderAdmin();
    if (App() && App().refresh) App().refresh();
  }
  function isDone(bedKey) { return day === today() && done.has(bedKey); }
  function isNotDone(bedKey) { return day === today() && notDone.has(bedKey); }
  function showMarks() { return ROLE_OK(); }

  function openMine() {
    if (!ROLE_OK()) return;
    global.PharmacyUI.showView("tarbeet");
    renderMine();
    load();
  }
  function openAdmin() {
    const A = global.PharmacyAuth;
    if (!(A && A.isAdmin())) return;
    global.PharmacyUI.showView("tarbeet-admin");
    renderAdmin();
    load();
  }

  function init() {
    const a = document.getElementById("admin-tarbeet-btn");
    if (a) a.addEventListener("click", openAdmin);
    const b1 = document.getElementById("tarbeet-back-btn");
    if (b1) b1.addEventListener("click", () => {
      const A = global.PharmacyAuth;
      global.PharmacyUI.showView(A && A.isAdmin() ? "admin" : "settings");
    });
    const b2 = document.getElementById("tarbeet-admin-back-btn");
    if (b2) b2.addEventListener("click", () => global.PharmacyUI.showView("admin"));
    // a new day: start over
    setInterval(() => { if (day !== today()) load(); }, 60000);
  }
  // after sign-in (app.js boot / login)
  function start() {
    if (!ROLE_OK()) return;
    myId = null;
    pharmacists = [];
    load();
    subscribe();
  }

  global.PharmacyTarbeet = { init, start, load, isDone, isNotDone, showMarks, markDone, setStatus, openMine, FILE_OFF_SVG };
})(window);
