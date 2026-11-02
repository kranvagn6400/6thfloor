/* ============================================================
   order-extras.js  —  «ما أُضيف بعد الطلبية» (مصطفى حسين فقط)
   ============================================================
   The chart goes out in the morning, the medicines are prepared and the cart is filled — meanwhile
   a doctor adds a medicine nobody here knows about. This module keeps the morning order as the
   reference and lets the pharmacist compare it with the ward:
     - the reference = the table of the last SUCCESSFUL send of each chart today (chart-send-log.js keeps it);
     - every occupied bed gets a small icon (rooms view) → a popup with the morning medicines, a
       «مطابق ✓» button and «إضافة دواء» (the normal medicine sheet);
     - what is in the app now but not in the morning order (a new medicine, or a bigger daily quantity —
       only the difference) is an «إضافة»; stopped / lowered ones are ignored;
     - «إرسال الإضافات» REPLACES the chart app's «الجارت الإضافي» of that ward with the additions only
       (api/chart-sync.js action "extra"); what was sent is remembered on this device so it is not sent twice.
   Everything is local to this device (localStorage) and visible to the admin and the pharmacists (until 2 PM).
   ============================================================ */

(function (global) {
  "use strict";

  const OVERLAY_KEY = "pharma.order-extras.v1";   // { day, byPk: { pk: { medName: totalQtySentAsExtra } } }
  const CHECK_KEY = "pharma.order-checks.v1";     // { day, keys: { bedKey: iso } }
  const GROUPS = ["1", "3", "p"];                 // the three charts: الوحدة الأولى / الثالثة / ردهة الخاص
  const GROUP_NAME = { "1": "الوحدة الأولى", "3": "الوحدة الثالثة", "p": "ردهة الخاص" };
  const ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5h6"/><path d="M9 13l2.2 2.2L15.5 11"/></svg>';

  // ---------- pure helpers (also used by the Node test) ----------
  const latin = (s) => String(s == null ? "" : s)
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  const clean = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
  const isNum = (v) => /^\d+$/.test(String(v));
  const pad = (n) => String(n).padStart(2, "0");
  function localISO(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // a patient is the same patient by plate number, else by name (same rule as the chart merge)
  function pkOf(name, plate) {
    const p = clean(latin(plate));
    return p ? "p:" + p : "n:" + clean(name).toLowerCase();
  }

  // the table that was sent → rows with { name, plate, meds: { medName: qty } }
  function parseTable(tsv) {
    const lines = String(tsv || "").replace(/\r/g, "").split("\n");
    const head = (lines.shift() || "").split("\t");
    const meds = head.slice(2).map(clean);
    return lines.filter(l => l.trim()).map(l => {
      const c = l.split("\t");
      const m = {};
      meds.forEach((name, i) => { const q = clean(latin(c[i + 2])); if (name && q) m[name] = q; });
      return { name: clean(c[0]), plate: clean(latin(c[1])), meds: m };
    });
  }

  // log entries (newest first, as chart-send-log.js load() returns them) → the morning order of ONE chart for a day:
  // { ready, at, byPk: { pk: { name, at, meds } } } — a later successful send of a patient replaces the earlier one
  function baselineFor(entries, group, day) {
    const ok = (entries || []).filter(e => e && e.result && e.result.ok && (e.unit || "1") === group &&
      (e.date || localISO(e.at)) === day);
    ok.sort((a, b) => new Date(a.result.at || a.at) - new Date(b.result.at || b.at));
    const byPk = {};
    let at = "";
    ok.forEach(e => {
      const when = e.result.at || e.at;
      at = when;
      parseTable(e.tsv).forEach(r => { byPk[pkOf(r.name, r.plate)] = { name: r.name, at: when, meds: r.meds }; });
    });
    return { ready: ok.length > 0, at, byPk };
  }

  // one patient: what he has now (cur) against the morning order (base) and what was already sent as extras (over)
  //   add    — new medicine / bigger quantity, only the difference
  //   manual — a non-numeric quantity (every 2 days…) that is new: shown, never sent
  //   sent   — extras already sent (the difference between the extra total and the morning quantity)
  function diffPatient(cur, base, over) {
    const add = [], manual = [], sent = [];
    Object.keys(cur).forEach(med => {
      const q = cur[med];
      const ov = over ? over[med] : undefined;
      const b0 = base ? base[med] : undefined;
      const ref = ov !== undefined ? ov : b0;
      if (isNum(q)) {
        const n = +q, b = isNum(ref) ? +ref : 0;
        if (n > b) add.push({ name: med, qty: n - b, total: n, isNew: !isNum(b0) || +b0 === 0 });
      } else if (ref === undefined) {
        manual.push({ name: med, qty: q });
      }
    });
    Object.keys(over || {}).forEach(med => {
      const o = +over[med], b = base && isNum(base[med]) ? +base[med] : 0;
      if (o > b) sent.push({ name: med, qty: o - b });
    });
    return { add, manual, sent };
  }

  // rows [{ name, plate, add: [{name, qty}] }] → the table the chart merge reads (first line "\t\t" + medicines)
  function buildTable(rows) {
    const meds = [];
    rows.forEach(r => r.add.forEach(a => { if (meds.indexOf(a.name) < 0) meds.push(a.name); }));
    const lines = [["", ""].concat(meds).join("\t")];
    rows.forEach(r => {
      const q = meds.map(m => { const a = r.add.find(x => x.name === m); return a ? String(a.qty) : ""; });
      lines.push([r.name, r.plate || ""].concat(q).join("\t"));
    });
    return lines.join("\n");
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { latin, pkOf, parseTable, baselineFor, diffPatient, buildTable };
  }
  if (typeof window === "undefined") return;

  // ---------- the day's state shared by every device (Supabase table order_sync, features.sql §30) ----------
  // rows (day, kind, k): kind "order" k = the chart (1 / 3 / p) → { date, sends: [{ tsv, at }] } — the morning order that was sent;
  //                      kind "extra" k = a patient → { meds: { name: total sent as extra } };
  //                      kind "check" k = a bed → { at } (the «مطابق» ticks).
  // Without the table (the SQL not run yet) everything stays on this device, as before.
  let shared = { orders: [], extras: {}, checks: {}, at: 0, sig: "", day: "" };
  let activeDayV = "";                 // TESTING only: the chart day being worked on (the newest morning send's day, even when it is not today)
  let sharedOff = false, sharedBusy = false, sharedClean = false;
  const sbClient = () => { const SB = global.PharmacySupabase; return SB && SB.isConfigured && SB.isConfigured() ? SB.getClient() : null; };
  const tableMissing = (err) => !!err && /order_sync|does not exist|schema cache|relation/i.test(String(err.message || ""));
  async function fetchShared(force) {
    const c = sbClient();
    if (!c || sharedOff || sharedBusy) return;
    if (!force && Date.now() - shared.at < 45000) return;
    sharedBusy = true;
    try {
      const today = todayISO();
      // normal: today's rows. TESTING: the rows of every day from today on, and the day of the newest morning send is the one used
      let q = c.from("order_sync").select("day,kind,k,data");
      q = TEST_ALWAYS_OPEN ? q.gte("day", today) : q.eq("day", today);
      const r = await q;
      if (r.error) { if (tableMissing(r.error)) sharedOff = true; return; }
      let rows = r.data || [], day = today;
      if (TEST_ALWAYS_OPEN) {
        let best = "";
        rows.forEach(row => { if (row.kind === "order") ((row.data || {}).sends || []).forEach(s0 => { if (s0 && s0.at > best) { best = s0.at; day = row.day; } }); });
        rows = rows.filter(row => row.day === day);
      }
      const next = { orders: [], extras: {}, checks: {}, at: Date.now(), sig: "", day };
      rows.forEach(row => {
        const d = row.data || {};
        if (row.kind === "order") (d.sends || []).forEach(s => next.orders.push({ tsv: s.tsv, unit: row.k, date: d.date || day, at: s.at, result: { ok: true, at: s.at } }));
        else if (row.kind === "extra") next.extras[row.k] = d.meds || {};
        else if (row.kind === "check") next.checks[row.k] = d.at || "1";
      });
      next.sig = JSON.stringify([day, next.orders.map(o => o.unit + o.at), next.extras, next.checks]);
      const changed = next.sig !== shared.sig;
      shared = next;
      if (changed) redraw();
      if (!sharedClean) {            // once a session: drop the rows of old days
        sharedClean = true;
        const old = new Date(Date.now() - 7 * 864e5);
        const cut = old.getFullYear() + "-" + pad(old.getMonth() + 1) + "-" + pad(old.getDate());
        c.from("order_sync").delete().lt("day", cut).then(() => {}, () => {});
      }
    } catch (e) { /* offline: keep what we have */ }
    finally { sharedBusy = false; }
  }
  async function putShared(kind, k, data, day) {
    const c = sbClient();
    if (!c || sharedOff) return;
    try {
      const r = await c.from("order_sync").upsert({ day: day || dayNow(), kind, k, data, updated_at: new Date().toISOString() }, { onConflict: "day,kind,k" });
      if (r.error && tableMissing(r.error)) sharedOff = true;
      else shared.at = 0;            // the next redraw reads it back
    } catch (e) { /* stays on this device */ }
  }
  async function delShared(kind, k) {
    const c = sbClient();
    if (!c || sharedOff) return;
    try { await c.from("order_sync").delete().eq("day", dayNow()).eq("kind", kind).eq("k", k); shared.at = 0; } catch (e) { /* ignore */ }
  }
  // a chart send that succeeded → its table is added to the shared morning order of that chart
  async function shareOrder(entry) {
    const c = sbClient();
    if (!c || sharedOff || !entry || !entry.result || !entry.result.ok) return;
    const day = entry.date || localISO(entry.at);
    const unit = entry.unit || "1";
    try {
      const r0 = await c.from("order_sync").select("data").eq("day", day).eq("kind", "order").eq("k", unit).maybeSingle();
      if (r0.error && tableMissing(r0.error)) { sharedOff = true; return; }
      const when = entry.result.at || entry.at;
      const sends = ((r0.data && r0.data.data && r0.data.data.sends) || []).filter(s => s && s.at !== when);
      sends.push({ tsv: entry.tsv, at: when });
      await putShared("order", unit, { date: day, sends: sends.slice(-6) }, day);
    } catch (e) { /* stays on this device */ }
  }

  // ---------- storage (this device) ----------
  const todayISO = () => (global.PharmacyChartSync && global.PharmacyChartSync.todayISO ? global.PharmacyChartSync.todayISO() : localISO(new Date().toISOString()));
  // the day the comparison is about: today — while TESTING, the day of the newest morning send (e.g. a chart sent for the 4th)
  const dayNow = () => (TEST_ALWAYS_OPEN && activeDayV ? activeDayV : todayISO());
  function loadDay(key, shape) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      if (v && v.day === dayNow()) return v;
    } catch (e) { /* blocked / bad json */ }
    return Object.assign({ day: dayNow() }, shape);
  }
  function saveDay(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* blocked */ } }

  const isChecked = (bedKey) => !!loadDay(CHECK_KEY, { keys: {} }).keys[bedKey] || (!shared.day || shared.day === dayNow()) && !!shared.checks[bedKey];
  function setChecked(bedKey, on) {
    const v = loadDay(CHECK_KEY, { keys: {} });
    if (on) v.keys[bedKey] = new Date().toISOString(); else delete v.keys[bedKey];
    saveDay(CHECK_KEY, v);
    if (on) putShared("check", bedKey, { at: v.keys[bedKey] }); else { delete shared.checks[bedKey]; delShared("check", bedKey); }
  }

  // ---------- who sees it, and until when ----------
  // the chart app's extra chart closes at 2 pm: from then on the icons, the chip and the send are gone (back after the next morning send)
  const OPEN_HOUR = 8, CLOSE_HOUR = 14;               // the button / icons / send show from 8 am to 2 pm
  const TEST_ALWAYS_OPEN = true;                      // TESTING: always open — set to false to bring the hours back
  const open = () => TEST_ALWAYS_OPEN || (new Date().getHours() >= OPEN_HOUR && new Date().getHours() < CLOSE_HOUR);
  function enabled() {
    const A = global.PharmacyAuth;
    return !!(A && A.isLoggedIn && A.isLoggedIn() && (A.isAdmin() || (A.isPharmacist && A.isPharmacist())) && open());
  }

  // ---------- the analysis (every occupied bed that is in an order) ----------
  let cache = null;
  function currentRows(st) {
    const Bridge = global.PharmacyChartBridge;
    const out = [];
    GROUPS.forEach(g => {
      Bridge.collectPatientsFromApp(st, null, g).forEach(p => {
        const meds = {};
        p.meds.forEach(m => { meds[m.name] = Bridge.medQty(m); });
        out.push({ group: g, key: p.key, name: p.name, plate: p.id || "", meds });
      });
    });
    return out;
  }

  function analyze() {
    const Log = global.PharmacyChartLog, Bridge = global.PharmacyChartBridge, App = global.PharmacyApp;
    if (!Log || !Bridge || !App || !App.orderingState) return null;
    if (TEST_ALWAYS_OPEN) {                                    // TESTING: work on the day of the newest successful morning send
      let best = "";
      Log.load().concat(shared.orders).forEach(e => {
        const at = e && e.result && e.result.ok ? (e.result.at || e.at || "") : "";
        if (at > best) { best = at; activeDayV = e.date || localISO(e.at); }
      });
    }
    const day = dayNow();
    const sh = shared.day === day || !shared.day ? shared : { orders: [], extras: {}, checks: {} };      // rows of another day are not used
    const entries = Log.load().concat(sh.orders);            // this device's send log + the sends of the other devices
    const over0 = loadDay(OVERLAY_KEY, { byPk: {} });
    const over = { byPk: {} };                                 // what was sent as extras: this device + the others (the larger total wins)
    [over0.byPk, sh.extras].forEach(src => Object.keys(src || {}).forEach(pk => {
      const o = over.byPk[pk] || (over.byPk[pk] = {});
      Object.keys(src[pk] || {}).forEach(m => { if (!(+o[m] >= +src[pk][m])) o[m] = src[pk][m]; });
    }));
    const base = {};
    GROUPS.forEach(g => { base[g] = baselineFor(entries, g, day); });
    const beds = {};
    let patients = 0;
    currentRows(App.orderingState()).forEach(c => {
      if (!base[c.group].ready) return;                 // nothing was sent to this chart today: no reference
      const pk = pkOf(c.name, c.plate);
      const b = base[c.group].byPk[pk] || null;
      const d = diffPatient(c.meds, b && b.meds, over.byPk[pk]);
      beds[c.key] = { group: c.group, pk, name: c.name, plate: c.plate, morning: b ? b.meds : null, at: b ? b.at : base[c.group].at, add: d.add, manual: d.manual, sent: d.sent, cur: c.meds };
      if (d.add.length) patients++;
    });
    const ready = {};
    GROUPS.forEach(g => { ready[g] = !!base[g].ready; });
    return { day, beds, patients, ready };
  }
  function get() { return cache || (cache = analyze()); }
  function refresh() { cache = null; if (!enabled()) return null; fetchShared(); return get(); }

  function bedState(key) {
    const a = enabled() ? get() : null;
    const b = a && a.beds[key];
    if (!b) return null;
    return b.add.length ? { state: "pending", n: b.add.length } : null;       // only the pending additions show (no «compared» state)
  }
  const pendingPatients = () => { const a = enabled() ? get() : null; return a ? a.patients : 0; };

  // ---------- popup ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const flash = (m) => global.PharmacyApp && global.PharmacyApp.flashHint(m);
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
  function closePopup() { const o = document.getElementById("oe-overlay"); if (o) o.remove(); }
  function redraw() { cache = null; if (global.PharmacyApp && global.PharmacyApp.redrawRooms) global.PharmacyApp.redrawRooms(); }

  function openOverlay(title, sub) {
    closePopup();
    const overlay = el("div", "oe-overlay");
    overlay.id = "oe-overlay";
    const box = el("div", "oe-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const head = el("div", "oe-head");
    const titles = el("div", "oe-titles");
    titles.appendChild(el("strong", "oe-title", title));
    if (sub) titles.appendChild(el("span", "oe-sub", sub));
    const x = el("button", "oe-x", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "إغلاق");
    x.addEventListener("click", closePopup);
    head.appendChild(titles); head.appendChild(x);
    box.appendChild(head);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closePopup(); });
    document.body.appendChild(overlay);
    return box;
  }
  function section(box, title, cls) {
    const s = el("div", "oe-section" + (cls ? " " + cls : ""));
    s.appendChild(el("div", "oe-section-title", title));
    box.appendChild(s);
    return s;
  }
  function line(parent, name, qty, cls, note) {
    const r = el("div", "oe-line" + (cls ? " " + cls : ""));
    const n = el("span", "oe-name", name);
    if (note) n.appendChild(el("small", "oe-note", note));
    r.appendChild(n);
    r.appendChild(el("span", "oe-qty", qty));
    parent.appendChild(r);
  }
  function btn(text, cls, fn) {
    const b = el("button", "oe-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // what the comparison stands on: the day and which morning charts were found (helps to see why nothing shows)
  function basisLine(a) {
    return el("div", "oe-sub oe-basis", "يوم المقارنة: " + a.day + " — " + GROUPS.map(g => GROUP_NAME[g] + (a.ready && a.ready[g] ? " ✓" : " ✗")).join(" · ") + " (✓ = وُجد جارت صباح مرسَل)");
  }

  function openBed(key, roomId, bed) {
    const a = get();
    const b = a && a.beds[key];
    if (!b) return;
    const box = openOverlay(b.name, (b.plate ? "طبلة " + b.plate + " · " : "") + "الطلبية الصباحية الساعة " + fmtTime(b.at));
    box.appendChild(basisLine(a));

    const morning = section(box, "الطلبية الصباحية");
    const names = b.morning ? Object.keys(b.morning) : [];
    if (!b.morning) morning.appendChild(el("div", "oe-empty", "لم يكن هذا المريض في الطلبية الصباحية"));
    else if (!names.length) morning.appendChild(el("div", "oe-empty", "لا أدوية في الطلبية"));
    else names.forEach(n => line(morning, n, b.morning[n]));

    if (b.add.length || b.manual.length) {
      const add = section(box, "أُضيف بعد الطلبية", "is-add");
      b.add.forEach(x => line(add, x.name, "+" + x.qty, "is-add", x.isNew ? "" : "من " + (x.total - x.qty) + " إلى " + x.total));
      b.manual.forEach(x => line(add, x.name, x.qty, "is-manual", "تُدخل يدويًا"));
    }
    if (b.sent.length) {
      const sent = section(box, "أُرسلت إلى الجارت الإضافي", "is-sent");
      b.sent.forEach(x => line(sent, x.name, "+" + x.qty, "is-sent"));
    }

    const actions = el("div", "oe-actions");
    actions.appendChild(btn("＋ إضافة دواء", "oe-add", () => {
      closePopup();
      if (global.PharmacyApp && global.PharmacyApp.addMedFor) global.PharmacyApp.addMedFor({ key, roomId, bed });
    }));
    if (a.patients) actions.appendChild(btn("كل الإضافات (" + a.patients + ")", "", () => openAll()));
    box.appendChild(actions);
  }

  // «الجارت الإضافي»: every addition of the day per chart, EDITABLE before it is sent (quantity − / + / typed, ✕ to leave one out,
  // ↺ to bring it back); what was already sent today; the send button; a link to the chart app
  let edits = {};                                   // "pk|medicine" → the quantity the user chose (0 = left out)
  const editKey = (pk, med) => pk + "|" + med;
  function effAdd(r) {
    return r.add.map(x => {
      const k = editKey(r.pk, x.name);
      const q = k in edits ? edits[k] : x.qty;
      return { name: x.name, qty: q, total: (x.total - x.qty) + q };
    }).filter(x => x.qty > 0);
  }
  function openAll() {
    const box = openOverlay("الجارت الإضافي", "راجع الإضافات وعدّلها قبل الإرسال");
    const body = el("div", "oe-body");
    box.appendChild(body);
    const draw = () => {
      body.innerHTML = "";
      const a = get();
      const rowsAll = a ? Object.keys(a.beds).map(k => a.beds[k]).filter(x => x.add.length) : [];
      const anyReady = a && a.ready && GROUPS.some(g => a.ready[g]);
      // what the comparison stands on: the day and which morning charts were found (helps to see why nothing shows)
      if (a) body.appendChild(basisLine(a));
      if (!anyReady) body.appendChild(el("div", "oe-empty", "لم يُرسل جارت الصباح اليوم بعد — لا توجد طلبية للمقارنة."));
      else if (!rowsAll.length) body.appendChild(el("div", "oe-empty", "لا توجد إضافات غير مرسلة"));
      GROUPS.forEach(g => {
        const rows = rowsAll.filter(x => x.group === g);
        if (!rows.length) return;
        const s = section(body, GROUP_NAME[g]);
        rows.forEach(r => {
          s.appendChild(el("div", "oe-patient", r.name));
          r.add.forEach(x => {
            const k = editKey(r.pk, x.name);
            const q = k in edits ? edits[k] : x.qty;
            const row = el("div", "oe-line oe-edit is-add" + (q > 0 ? "" : " is-off"));
            const n = el("span", "oe-name", x.name);
            if (!x.isNew) n.appendChild(el("small", "oe-note", "من " + (x.total - x.qty) + " إلى " + x.total));
            row.appendChild(n);
            const ctl = el("span", "oe-ctl");
            const set = (v) => { edits[k] = Math.max(0, Math.min(99, v | 0)); draw(); };
            const minus = btn("−", "oe-step", () => set(q - 1));
            const plus = btn("+", "oe-step", () => set(q + 1));
            const num = document.createElement("input");
            num.type = "number"; num.min = "0"; num.max = "99"; num.inputMode = "numeric"; num.className = "oe-num"; num.value = String(q);
            num.addEventListener("change", () => set(parseInt(num.value, 10) || 0));
            ctl.appendChild(minus); ctl.appendChild(num); ctl.appendChild(plus);
            ctl.appendChild(q > 0 ? btn("✕", "oe-step oe-drop", () => set(0)) : btn("↺", "oe-step", () => { delete edits[k]; draw(); }));
            row.appendChild(ctl);
            s.appendChild(row);
          });
        });
      });
      // what was already sent today
      const sentRows = a ? Object.keys(a.beds).map(k => a.beds[k]).filter(x => x.sent.length) : [];
      if (sentRows.length) {
        const s = section(body, "أُرسلت اليوم إلى الجارت الإضافي", "is-sent");
        sentRows.forEach(r => {
          s.appendChild(el("div", "oe-patient", r.name + " · " + GROUP_NAME[r.group]));
          r.sent.forEach(x => line(s, x.name, "+" + x.qty, "is-sent"));
        });
      }
      const sendable = rowsAll.some(r => effAdd(r).length);
      body.appendChild(el("div", "oe-warn", "⚠ الإرسال يستبدل محتوى الجارت الإضافي الحالي بهذه الإضافات فقط."));
      const actions = el("div", "oe-actions");
      const send = btn("إرسال الإضافات", "oe-send", async () => {
        send.disabled = true;
        const r = await sendAll();
        send.disabled = false;
        if (r && r.ok) { edits = {}; closePopup(); redraw(); } else if (r && r.cancelled) { /* stay */ }
      });
      send.disabled = !sendable;
      actions.appendChild(send);
      actions.appendChild(btn("فتح الجارت الإضافي", "", () => { const B = global.PharmacyChartBridge; if (B && B.openChart) B.openChart(); }));
      actions.appendChild(btn("إغلاق", "", closePopup));
      body.appendChild(actions);
    };
    draw();
  }

  // ---------- sending ----------
  function markSent(rows) {
    const over = loadDay(OVERLAY_KEY, { byPk: {} });
    rows.forEach(r => {
      const o = over.byPk[r.pk] || (over.byPk[r.pk] = {});
      r.add.forEach(x => { o[x.name] = x.total; });
    });
    saveDay(OVERLAY_KEY, over);
    rows.forEach(r => {                    // shared: the other devices must not send the same addition again
      const merged = Object.assign({}, shared.extras[r.pk] || {}, over.byPk[r.pk] || {});
      shared.extras[r.pk] = merged;
      putShared("extra", r.pk, { meds: merged });
    });
  }

  async function sendAll() {
    const Sync = global.PharmacyChartSync;
    const a = get();
    // the additions as the user edited them (quantities changed, some left out)
    const withAdd = a ? Object.keys(a.beds).map(k => a.beds[k]).filter(x => x.add.length).map(x => Object.assign({}, x, { add: effAdd(x) })).filter(x => x.add.length) : [];
    if (!Sync || !Sync.sendExtra || !withAdd.length) return { ok: false, message: "لا توجد إضافات" };
    const groups = GROUPS.filter(g => withAdd.some(x => x.group === g));
    if (!confirm("سيُستبدل الجارت الإضافي (" + groups.map(g => GROUP_NAME[g]).join("، ") + ") بالإضافات فقط، ويُحذف ما فيه الآن.\nمتابعة؟")) return { ok: false, cancelled: true };
    const Fx = global.PharmacyFx;
    let sentAny = false;
    for (const g of groups) {
      const rows = withAdd.filter(x => x.group === g);
      if (Fx && Fx.progress) Fx.progress.start();
      const r = await Sync.sendExtra(buildTable(rows), flash, a.day, g);
      if (Fx && Fx.progress) Fx.progress.done(r.cancelled ? null : !!r.ok);
      if (r.cancelled) return { ok: false, cancelled: true };
      if (!r.ok) { flash("الجارت الإضافي لـ " + GROUP_NAME[g] + ": " + r.message); return { ok: false, message: r.message }; }
      if (r.complete !== false) { markSent(rows); sentAny = true; }
      flash(Sync.describe(r).replace("في الجارت", "في الجارت الإضافي (" + GROUP_NAME[g] + ")"));
    }
    return { ok: sentAny };
  }

  // ---------- wiring ----------
  function init() {
    const grid = document.getElementById("rooms-grid");
    if (grid) {
      // capture: the icon sits inside the bed button, its tap must not open the patient card
      grid.addEventListener("click", (e) => {
        if (!enabled()) return;
        const all = e.target.closest("[data-extras-all]");
        if (all) { e.stopPropagation(); e.preventDefault(); fetchShared(true); refresh(); openAll(); return; }
        const mk = e.target.closest("[data-extras-key]");
        if (!mk) return;
        e.stopPropagation(); e.preventDefault();
        fetchShared(true);
        refresh();
        openBed(mk.dataset.extrasKey, parseInt(mk.dataset.roomId, 10), parseInt(mk.dataset.bed, 10));
      }, true);
    }
    // coming back to the page / the first draw: read what the other devices did
    document.addEventListener("visibilitychange", () => { if (!document.hidden && enabled()) fetchShared(true); });
    if (enabled()) fetchShared(true);
    // 2 pm: take the icons away without waiting for the next redraw
    const left = new Date().setHours(CLOSE_HOUR, 0, 1, 0) - Date.now();
    const toOpen = new Date().setHours(OPEN_HOUR, 0, 1, 0) - Date.now();      // and at 8 am they come back by themselves
    if (toOpen > 0) setTimeout(() => { cache = null; if (global.PharmacyApp && global.PharmacyApp.redrawRooms) global.PharmacyApp.redrawRooms(); }, toOpen);
    if (left > 0) setTimeout(() => { closePopup(); cache = null; if (global.PharmacyApp && global.PharmacyApp.redrawRooms) global.PharmacyApp.redrawRooms(); }, left);
    // a morning send that just finished makes the icons appear / refresh at once
    const Log = global.PharmacyChartLog;
    if (Log && Log.setResult && !Log._oeWrapped) {
      const orig = Log.setResult;
      Log.setResult = function (id) {
        const r = orig.apply(this, arguments);
        try { const e = Log.load().find(x => x.id === id); if (e && e.result && e.result.ok) shareOrder(e); } catch (err) { /* local only */ }
        if (enabled()) redraw();
        return r;
      };
      Log._oeWrapped = true;
    }
  }

  global.PharmacyOrderExtras = { init, enabled, refresh, bedState, pendingPatients, ICON };
})(typeof window !== "undefined" ? window : globalThis);
