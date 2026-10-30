/* ============================================================
   med-availability.js  —  "توفر الأدوية" (admin + pharmacists)
   ============================================================
   Lists the medication catalog with an available / not-available
   switch per drug (med.available, column medications.available in
   features.sql). Changes save locally at once and are pushed to the
   cloud catalog shortly after (several quick toggles → one push). A push
   that fails is retried by itself, also after a reload. Other users' changes
   arrive by realtime and by a small read on every poll (refreshFromCloud).
   Unavailable drugs carry a "غير متوفر" tag in the add-medication
   picker (ui.js renderMedOptions) for everyone.
   ============================================================ */

(function (global) {
  "use strict";

  let filter = "all";
  let pushTimer = null;
  let retryTimer = null;
  // the toggled medicines not yet pushed, a push in flight, and when the last one ended: while any of these holds the
  // realtime «catalogue changed» pull is skipped (it would bring the OLD cloud copy and undo a toggle)
  const DIRTY_KEY = "pharma.avail.dirty.v1";
  const dirty = new Set(loadDirty());
  const sending = new Set();
  let warned = false;
  let inFlight = false;
  let lastPushEnd = 0;
  function loadDirty() { try { const a = JSON.parse(localStorage.getItem(DIRTY_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveDirty() { try { localStorage.setItem(DIRTY_KEY, JSON.stringify(Array.from(dirty))); } catch (e) { /* blocked */ } }
  const busy = () => !!pushTimer || inFlight || dirty.size > 0 || Date.now() - lastPushEnd < 4000;

  const App = () => global.PharmacyApp;
  const isAvailable = (m) => m.available !== false;
  const nameOf = (m) => m.nameTrade || m.nameEn || m.nameAr || m.id;
  // Dosage form label (Vial / Tablet / OSD…) — same labels as the picker tabs
  const formOf = (m) => {
    const labels = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    const f = m.form || "vial";
    return labels[f] || f;
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fold(s) {
    return String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
  }

  function render() {
    const list = document.getElementById("avail-list");
    const summary = document.getElementById("avail-summary");
    if (!list) return;
    const meds = (App().state.medications || []).filter(m => m && m.id);
    const unavailable = meds.filter(m => !isAvailable(m)).length;
    if (summary) {
      summary.innerHTML = "";
      [[meds.length - unavailable, "متوفر", "is-on"], [unavailable, "غير متوفر", "is-off"]].forEach(([n, label, cls]) => {
        const card = el("div", "avail-stat " + cls);
        card.appendChild(el("div", "avail-stat-num", String(n)));
        card.appendChild(el("div", "avail-stat-label", label));
        summary.appendChild(card);
      });
    }

    const q = fold((document.getElementById("avail-search") || {}).value);
    const shown = meds.filter(m => {
      if (filter === "available" && !isAvailable(m)) return false;
      if (filter === "unavailable" && isAvailable(m)) return false;
      return !q || fold([m.nameTrade, m.nameEn, m.nameAr, m.id, formOf(m)].join(" ")).indexOf(q) >= 0;
    });

    list.innerHTML = "";
    if (shown.length === 0) {
      list.appendChild(el("div", "avail-empty", "لا توجد أدوية مطابقة"));
      return;
    }
    shown.forEach(m => {
      const on = isAvailable(m);
      const row = el("button", "avail-row" + (on ? "" : " is-off"));
      row.type = "button";
      row.dataset.id = m.id;
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", on ? "true" : "false");
      const names = el("span", "avail-names");
      const top = el("span", "avail-name-line");
      top.appendChild(el("span", "avail-name", nameOf(m)));
      if (m.defaultDose) top.appendChild(el("span", "avail-dose", m.defaultDose));   // the strength / dose
      top.appendChild(el("span", "avail-form", formOf(m)));
      names.appendChild(top);
      if (m.nameEn && m.nameEn !== nameOf(m)) names.appendChild(el("span", "avail-name-en", m.nameEn));
      row.appendChild(names);
      row.appendChild(el("span", "avail-state", on ? "متوفر" : "غير متوفر"));
      row.appendChild(el("span", "avail-switch"));
      list.appendChild(row);
    });
  }

  // Several quick toggles → one push of just the toggled rows
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      const SBSync = global.PharmacySupabaseSync;
      if (!SBSync || !SBSync.pushMedicationRows) { dirty.clear(); saveDirty(); return; }
      const Auth = global.PharmacyAuth;
      if (!(Auth && Auth.isLoggedIn && Auth.isLoggedIn())) { retryLater(); return; }     // kept for after the sign-in
      const ids = Array.from(dirty);
      dirty.clear();
      ids.forEach(id => sending.add(id));
      inFlight = true;
      const res = await SBSync.pushMedicationRows(ids);
      inFlight = false;
      sending.clear();
      lastPushEnd = Date.now();
      if (res.ok) {
        // nothing newer was typed meanwhile → the local catalogue is in step with the cloud again
        const S = global.PharmacyStorage;
        if (!dirty.size && S && S.setLocalCatalogSyncedAt) S.setLocalCatalogSyncedAt(Date.now());
      } else {
        ids.forEach(id => dirty.add(id));              // kept: tried again by itself
        retryLater();
      }
      saveDirty();
      if (res.ok) warned = false;
      if (!res.ok && !warned) {
        warned = true;
        const why = /jwt/i.test(res.error || "") ? "انتهت الجلسة — سجّل الدخول من جديد"
          : /available/.test(res.error || "") ? "شغّل features.sql في Supabase"
          : "تحقق من الاتصال";
        App().flashHint("⚠ لم يُرسل التغيير بعد (" + why + ") — ستُعاد المحاولة تلقائيًا");
      }
    }, 800);
  }

  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (dirty.size) schedulePush(); }, 15000);
  }

  // Another user's change: rows = [{ id, available }]. A medicine this device is still sending keeps its own value.
  function applyCloud(rows) {
    const meds = App() && App().state && App().state.medications;
    if (!Array.isArray(meds)) return [];
    const changed = [];
    (rows || []).forEach(r => {
      if (!r || !r.id || dirty.has(r.id) || sending.has(r.id)) return;
      const m = meds.find(x => x && x.id === r.id);
      if (!m || isAvailable(m) === (r.available !== false)) return;
      m.available = r.available !== false;
      changed.push(r.id);
    });
    if (!changed.length) return changed;
    // stored without counting as an edit of this device (that would stop its catalogue pulls)
    const S = global.PharmacyStorage;
    const clean = !(S.hasUnsyncedLocalEdits && S.hasUnsyncedLocalEdits());
    S.saveMedications(meds);
    if (clean && S.setLocalCatalogSyncedAt) S.setLocalCatalogSyncedAt(Date.now());
    redraw();
    return changed;
  }
  // whatever is showing the availability right now
  function redraw() {
    const view = document.getElementById("view-availability");
    if (view && !view.hidden) render();
    if (App() && App().refreshMedSheet) App().refreshMedSheet();
  }
  // called on every poll (15 s), on return to the app and when the connection is back
  async function refreshFromCloud() {
    const SBSync = global.PharmacySupabaseSync;
    if (busy() || !SBSync || !SBSync.fetchAvailability) return;
    const res = await SBSync.fetchAvailability();
    if (res.ok && !busy()) applyCloud(res.rows);          // busy again: what was read may be older than this device's own change
  }

  function toggle(id) {
    const med = (App().state.medications || []).find(m => m && m.id === id);
    if (!med) return;
    med.available = !isAvailable(med);
    dirty.add(id);
    saveDirty();
    global.PharmacyStorage.saveMedications(App().state.medications);
    render();
    App().flashHint((nameOf(med)) + (med.available ? " — متوفر" : " — غير متوفر"));
    schedulePush();
  }

  function open() {
    const Auth = global.PharmacyAuth;
    if (!(Auth && (Auth.isAdmin() || Auth.isPharmacist()))) return;
    global.PharmacyUI.showView("availability");
    render();
  }

  function init() {
    if (dirty.size) setTimeout(schedulePush, 5000);        // left unsent by the last visit
    global.addEventListener("online", () => { if (dirty.size) schedulePush(); else refreshFromCloud(); });
    ["admin-availability-btn", "settings-availability-btn"].forEach(bid => {
      const btn = document.getElementById(bid);
      if (btn) btn.addEventListener("click", open);
    });
    const back = document.getElementById("availability-back-btn");
    if (back) back.addEventListener("click", () => {
      const Auth = global.PharmacyAuth;
      global.PharmacyUI.showView(Auth && Auth.isAdmin() ? "admin" : "settings");
    });
    const search = document.getElementById("avail-search");
    if (search) search.addEventListener("input", render);
    document.querySelectorAll(".avail-filter").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.filter;
      document.querySelectorAll(".avail-filter").forEach(x => x.classList.toggle("is-active", x === b));
      render();
    }));
    const list = document.getElementById("avail-list");
    if (list) list.addEventListener("click", (e) => {
      const row = e.target.closest(".avail-row");
      if (row) toggle(row.dataset.id);
    });
  }

  global.PharmacyMedAvailability = { init, open, render, busy, applyCloud, redraw, refreshFromCloud };
})(window);
