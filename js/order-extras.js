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
   Everything is local to this device (localStorage) and visible to the supreme admin only (Auth.isSuperAdmin).
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

  // ---------- storage (this device) ----------
  const todayISO = () => (global.PharmacyChartSync && global.PharmacyChartSync.todayISO ? global.PharmacyChartSync.todayISO() : localISO(new Date().toISOString()));
  function loadDay(key, shape) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      if (v && v.day === todayISO()) return v;
    } catch (e) { /* blocked / bad json */ }
    return Object.assign({ day: todayISO() }, shape);
  }
  function saveDay(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* blocked */ } }

  const isChecked = (bedKey) => !!loadDay(CHECK_KEY, { keys: {} }).keys[bedKey];
  function setChecked(bedKey, on) {
    const v = loadDay(CHECK_KEY, { keys: {} });
    if (on) v.keys[bedKey] = new Date().toISOString(); else delete v.keys[bedKey];
    saveDay(CHECK_KEY, v);
  }

  // ---------- who sees it, and until when ----------
  // the chart app's extra chart closes at 2 pm: from then on the icons, the chip and the send are gone (back after the next morning send)
  const CLOSE_HOUR = 14;
  const open = () => new Date().getHours() < CLOSE_HOUR;
  function enabled() {
    const A = global.PharmacyAuth;
    return !!(A && A.isLoggedIn && A.isLoggedIn() && A.isSuperAdmin && A.isSuperAdmin() && open());
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
    const day = todayISO();
    const entries = Log.load();
    const over = loadDay(OVERLAY_KEY, { byPk: {} });
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
    return { day, beds, patients };
  }
  function get() { return cache || (cache = analyze()); }
  function refresh() { cache = null; return enabled() ? get() : null; }

  function bedState(key) {
    const a = enabled() ? get() : null;
    const b = a && a.beds[key];
    if (!b) return null;
    return { state: b.add.length ? "pending" : isChecked(key) ? "checked" : "clear", n: b.add.length };
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

  function openBed(key, roomId, bed) {
    const a = get();
    const b = a && a.beds[key];
    if (!b) return;
    const box = openOverlay(b.name, (b.plate ? "طبلة " + b.plate + " · " : "") + "الطلبية الصباحية الساعة " + fmtTime(b.at));

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
    const checked = isChecked(key);
    actions.appendChild(btn(checked ? "✓ مطابق — إلغاء" : "✓ مطابق", "oe-ok" + (checked ? " is-on" : ""), () => { setChecked(key, !checked); closePopup(); redraw(); }));
    actions.appendChild(btn("＋ إضافة دواء", "oe-add", () => {
      closePopup();
      if (global.PharmacyApp && global.PharmacyApp.addMedFor) global.PharmacyApp.addMedFor({ key, roomId, bed });
    }));
    if (a.patients) actions.appendChild(btn("كل الإضافات (" + a.patients + ")", "", () => openAll()));
    box.appendChild(actions);
  }

  // every addition of the day, per chart, with the send button
  function openAll() {
    const a = get();
    const box = openOverlay("إضافات بعد الطلبية", "تُرسل إلى الجارت الإضافي");
    const withAdd = a ? Object.keys(a.beds).map(k => a.beds[k]).filter(x => x.add.length) : [];
    if (!withAdd.length) { box.appendChild(el("div", "oe-empty", "لا توجد إضافات غير مرسلة")); return; }
    GROUPS.forEach(g => {
      const rows = withAdd.filter(x => x.group === g);
      if (!rows.length) return;
      const s = section(box, GROUP_NAME[g]);
      rows.forEach(r => {
        s.appendChild(el("div", "oe-patient", r.name));
        r.add.forEach(x => line(s, x.name, "+" + x.qty, "is-add"));
      });
    });
    box.appendChild(el("div", "oe-warn", "⚠ الإرسال يستبدل محتوى الجارت الإضافي الحالي بهذه الإضافات فقط."));
    const actions = el("div", "oe-actions");
    const send = btn("إرسال الإضافات", "oe-send", async () => {
      send.disabled = true;
      const r = await sendAll();
      send.disabled = false;
      if (r && r.ok) { closePopup(); redraw(); } else if (r && r.cancelled) { /* stay */ }
    });
    actions.appendChild(send);
    actions.appendChild(btn("إغلاق", "", closePopup));
    box.appendChild(actions);
  }

  // ---------- sending ----------
  function markSent(rows) {
    const over = loadDay(OVERLAY_KEY, { byPk: {} });
    rows.forEach(r => {
      const o = over.byPk[r.pk] || (over.byPk[r.pk] = {});
      r.add.forEach(x => { o[x.name] = x.total; });
    });
    saveDay(OVERLAY_KEY, over);
  }

  async function sendAll() {
    const Sync = global.PharmacyChartSync;
    const a = get();
    const withAdd = a ? Object.keys(a.beds).map(k => a.beds[k]).filter(x => x.add.length) : [];
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
        if (all) { e.stopPropagation(); e.preventDefault(); refresh(); openAll(); return; }
        const mk = e.target.closest("[data-extras-key]");
        if (!mk) return;
        e.stopPropagation(); e.preventDefault();
        refresh();
        openBed(mk.dataset.extrasKey, parseInt(mk.dataset.roomId, 10), parseInt(mk.dataset.bed, 10));
      }, true);
    }
    // 2 pm: take the icons away without waiting for the next redraw
    const left = new Date().setHours(CLOSE_HOUR, 0, 1, 0) - Date.now();
    if (left > 0) setTimeout(() => { closePopup(); cache = null; if (global.PharmacyApp && global.PharmacyApp.redrawRooms) global.PharmacyApp.redrawRooms(); }, left);
    // a morning send that just finished makes the icons appear / refresh at once
    const Log = global.PharmacyChartLog;
    if (Log && Log.setResult && !Log._oeWrapped) {
      const orig = Log.setResult;
      Log.setResult = function () {
        const r = orig.apply(this, arguments);
        if (enabled()) redraw();
        return r;
      };
      Log._oeWrapped = true;
    }
  }

  global.PharmacyOrderExtras = { init, enabled, refresh, bedState, pendingPatients, ICON };
})(typeof window !== "undefined" ? window : globalThis);
