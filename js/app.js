/* ============================================================
   app.js
   Application controller: holds in-memory state, wires UI
   events, manages the medication selection flow, and persists
   changes via PharmacyStorage.
   ============================================================ */

(function (global) {
  "use strict";

  // -------- In-memory state (mirror of storage for fast renders) --------
  const state = {
    patients: {},          // bedKey -> patient
    medications: [],       // catalog
    currentBed: null,      // { key, roomId, bed }
    // bottom-sheet selection state
    sheet: {
      open: false,
      activeTab: "vial",         // "vial" (default) | "tablet" — which form is shown
      selected: new Set(),        // med ids
      selectedList: [],          // [{ id, nameTrade, nameAr, nameEn, form, dose, frequency }]
      filter: ""
    },
    // admin editor state
    admin: {
      editingId: null,         // med id being edited; null = new
      isNew: false,
      selectedId: null         // row highlight
    }
  };

  // -------- Shortcuts --------
  const Storage = global.PharmacyStorage;
  const Ward    = global.PharmacyWard;
  const Meds    = global.PharmacyMedications;
  const UI      = global.PharmacyUI;
  const SB      = global.PharmacySupabase;          // may be undefined on very old browsers
  const SBSync  = global.PharmacySupabaseSync;      // may be undefined
  const Auth    = global.PharmacyAuth;             // auth module
  const Clinical = global.PharmacyClinical;        // clinical decision support
  const $ = (id) => document.getElementById(id);

  // The header "print chart" button (chart-image.js) is not used for
  // now. true = show it again, for the admin only.
  const CHART_PRINT_ENABLED = false;

  // -------- Shared context for the feature modules --------
  // print-sheets / patient-search / patient-history / monthly-report
  // read state and call back into the app through this object.
  global.PharmacyApp = {
    get state() { return state; },
    openPatient: (bedRef) => openPatient(bedRef),
    moveBed: (fromKey, toKey) => moveBed(fromKey, toKey),
    swapBeds: (aKey, bKey) => swapBeds(aKey, bKey),
    flashHint: (msg) => flashHint(msg),
    escapeHtml: (t) => escapeHtml(t),
    refresh: () => refreshStatsAndRooms(),
    // someone who came first holds this bed (presence.js): this device steps out of its card
    leaveBedLocked: (who) => {
      if (!state.currentBed) return;
      flushPendingPatientChanges();
      state.currentBed = null;
      UI.showView("home");
      flashHint("دخل " + (who || "شخص آخر") + " هذا السرير قبلك — خرجتَ منه");
    },
    refreshDisplay: () => { if (_displayModeActive) renderDisplayMode(); },
    savePatient: (bedKey) => persistPatient(bedKey),
    // the patients we order for (no 7th-floor hematology), as a state copy
    orderingState: () => orderingState(),
    // a realtime patients change, as the Supabase channel delivers it (tests)
    applyRemoteChange: (payload) => handlePatientRealtimeChange(payload),
    // a notifications row, as realtime delivers it (tests)
    applyRemoteNotification: (row) => receiveCloudNotification(row, true)
  };

  // -------- Init --------
  function init() {
    hydrate();
    bindAuthEvents();
    bindEvents();
    bindPwaInstall();
    applyRoleVisibility();
    initDarkMode();
    initDisplayMode();
    global.PharmacyPatientSearch.init();
    global.PharmacyPatientHistory.init();
    global.PharmacyMonthlyReport.init();
    global.PharmacyBedDrag.init();
    global.PharmacyMedAvailability.init();
    global.PharmacyChartLog.init();
    global.PharmacyTarbeet.init();
    // Show login overlay if not logged in, otherwise show the app
    if (Auth && Auth.isLoggedIn()) {
      showApp();
      refreshAll();
      UI.showView("home");
      pullCatalogOnBoot();
      initRealtime();
      // Start periodic polling as a backup for Realtime. Realtime
      // should deliver changes within 100-500ms, but it can fail
      // silently (channel timeouts, network blips, mobile sleep).
      // The poller pulls every 30s + refreshes local state — so
      // even if Realtime drops, the user sees fresh data within
      // 30s. This is the safety net that catches the doctor-to-
      // pharmacist sync when Realtime is unreliable.
      startPolling();
      // The local session only drives the UI — confirm the Supabase
      // Auth session is still valid (and the account still active).
      if (Auth.verifySession) {
        Auth.verifySession().then((ok) => {
          if (ok) { applyRoleVisibility(); return; }
          forceLogout("انتهت الجلسة — سجّل الدخول من جديد");
        });
      }
    } else {
      showLogin();
    }
  }

  function forceLogout(message) {
    if (realtimeChannel) {
      try { realtimeChannel.unsubscribe(); } catch (e) { /* ignore */ }
      realtimeChannel = null;
    }
    stopPolling();
    if (Auth) Auth.logout();
    try { applyRoleVisibility(); }
    finally {
      showLogin();
      if (message) flashHint(message);
    }
  }

  // User-initiated logout (header + settings buttons). Pushes pending
  // patient edits, then wipes the cloud-backed patient data from this
  // device so the next person using a shared ward device can't read it.
  // (A forced logout on an expired session keeps the data: its unsynced
  // edits upload after the next login.)
  // Resolve to `fallback` if `promise` takes longer than `ms` (slow ward
  // network) or fails, so logout can never hang on a request.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
  }

  // In-app yes/no box (the browser's confirm() is blocked in embedded browsers, so logout did nothing there)
  function askConfirm(message, yes, no) {
    return new Promise(resolve => {
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,40,70,.45);display:flex;align-items:center;justify-content:center;padding:20px";
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.dir = "rtl";
      box.style.cssText = "background:var(--surface,#fff);color:var(--text,#12304a);border-radius:18px;padding:22px 20px 16px;max-width:340px;width:100%;box-shadow:0 20px 50px -12px rgba(0,0,0,.4);font:inherit";
      const p = document.createElement("p");
      p.style.cssText = "margin:0 0 16px;font-weight:700;line-height:1.7;white-space:pre-line";
      p.textContent = message;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;justify-content:flex-start";
      const done = v => { ov.remove(); resolve(v); };
      const mk = (label, primary, v) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = "flex:1;padding:11px 8px;border-radius:12px;font:inherit;font-weight:800;cursor:pointer;border:1px solid var(--border,#cbd5e1);" +
          (primary ? "background:var(--primary,#1f6fa8);color:#fff;border-color:transparent" : "background:var(--surface,#fff);color:var(--text,#12304a)");
        b.addEventListener("click", () => done(v));
        return b;
      };
      row.appendChild(mk(yes || "نعم", true, true));
      row.appendChild(mk(no || "إلغاء", false, false));
      box.appendChild(p); box.appendChild(row); ov.appendChild(box);
      ov.addEventListener("click", e => { if (e.target === ov) done(false); });
      document.body.appendChild(ov);
    });
  }

  // In-app choice box: options = [[value, label], …] → the chosen value, or null when dismissed
  function askChoice(message, options) {
    return new Promise(resolve => {
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,40,70,.45);display:flex;align-items:center;justify-content:center;padding:20px";
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.dir = "rtl";
      box.style.cssText = "background:var(--surface,#fff);color:var(--text,#12304a);border-radius:18px;padding:22px 20px 16px;max-width:340px;width:100%;box-shadow:0 20px 50px -12px rgba(0,0,0,.4);font:inherit";
      const p = document.createElement("p");
      p.style.cssText = "margin:0 0 14px;font-weight:700;line-height:1.7";
      p.textContent = message;
      box.appendChild(p);
      const done = v => { ov.remove(); resolve(v); };
      options.forEach(([v, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = "display:block;width:100%;margin:0 0 8px;padding:12px 8px;border-radius:12px;font:inherit;font-weight:800;cursor:pointer;border:1px solid var(--border,#cbd5e1);background:var(--primary,#1f6fa8);color:#fff";
        b.addEventListener("click", () => done(v));
        box.appendChild(b);
      });
      const c = document.createElement("button");
      c.type = "button";
      c.textContent = "إلغاء";
      c.style.cssText = "display:block;width:100%;padding:11px 8px;border-radius:12px;font:inherit;font-weight:800;cursor:pointer;border:1px solid var(--border,#cbd5e1);background:var(--surface,#fff);color:var(--text,#12304a)";
      c.addEventListener("click", () => done(null));
      box.appendChild(c);
      ov.addEventListener("click", e => { if (e.target === ov) done(null); });
      ov.appendChild(box);
      document.body.appendChild(ov);
    });
  }

  async function userLogout() {
    if (!(await askConfirm("هل تريد تسجيل الخروج؟", "تسجيل الخروج", "إلغاء"))) return;
    flushPendingPatientChanges();
    flashHint("جارٍ حفظ التعديلات…");
    let synced = true;
    if (SBSync && SBSync.pushPatients) {
      const r = await withTimeout(SBSync.pushPatients(), 8000, { ok: false });
      synced = !!(r && r.ok);
    }
    if (!synced && !(await askConfirm(
      "⚠ تعذّر رفع آخر التعديلات إلى السحابة (لا يوجد اتصال؟).\n\n" +
      "إذا خرجت الآن ستُحذف من هذا الجهاز.\nاضغط «إلغاء» للبقاء والمحاولة لاحقاً.", "خروج", "إلغاء"))) {
      return;
    }
    // Discharged / dead records: wiped only once every one is in the cloud
    // (they would otherwise be lost for good).
    const Archive = global.PharmacyArchive;
    await withTimeout(Archive.sync(), 8000, { ok: false });
    const archivesUploaded = Archive.pendingCount() === 0;
    Storage.wipeCloudBackedPatientData({ archives: archivesUploaded });
    // Chart account + send log (patient names) stay on this device only
    if (global.PharmacyChartSync) global.PharmacyChartSync.clearAccount();
    if (global.PharmacyChartLog) global.PharmacyChartLog.clear();
    state.patients = {};
    state.currentBed = null;
    // Once confirmed, the user is logged out even if a UI refresh fails
    try {
      refreshAll();
      updateNotifBadge();
    } finally {
      forceLogout("تم تسجيل الخروج ومسح بيانات المرضى من هذا الجهاز");
    }
  }

  // -------- Periodic polling fallback --------
  // Pulls patients + catalog from Supabase every POLL_INTERVAL_MS
  // (30s). This is the safety net for when Realtime fails to deliver
  // a change (which happens more often than expected on mobile +
  // flaky networks + when the Supabase project goes to sleep).
  //
  // The poller is cheap: pullPatients only fetches the deltas (via
  // the merge function that compares updatedAt), so it doesn't
  // transfer the full table every time.
  //
  // The poller is also triggered immediately when the page becomes
  // visible again (after the user switches back to the app tab).
  const POLL_INTERVAL_MS = 15000;
  let _pollTimer = null;
  function startPolling() {
    stopPolling();
    _pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    // Also poll when the tab becomes visible again (user switches
    // back to the app). This catches changes that arrived while
    // the tab was hidden (mobile browsers throttle/suspend timers
    // in background tabs, so the interval might have been paused).
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  function onVisibilityChange() {
    if (!document.hidden) {
      // Tab became visible — poll immediately for fresh data, and
      // re-open Realtime if the phone dropped it while asleep.
      if (!realtimeAlive()) scheduleRealtimeRetry();
      pollOnce();
    }
  }
  async function pollOnce() {
    if (!SB || !SBSync || !SB.isConfigured()) return;
    try {
      // Only pull patients if we're NOT currently viewing a patient.
      // Pulling while viewing would overwrite local edits (like med
      // deletes) with a potentially stale cloud version (the push
      // may still be in flight). The patient view is always saved
      // on blur + on back-button, so the local state is always
      // fresher than the cloud while the patient view is open.
      {
        // While a patient is open, the other beds still update; the open
        // bed keeps its local copy (it is saved on blur / back, and
        // Realtime merges cloud edits into it safely).
        const pres = await SBSync.pullPatients(state.currentBed ? { keepBed: state.currentBed.key } : undefined);
        if (pres && pres.ok) {
          const openKey = state.currentBed && state.currentBed.key;
          const openObj = openKey && state.patients[openKey];
          const before = JSON.stringify(state.patients);
          state.patients = Storage.loadPatients();
          if (openObj) state.patients[openKey] = openObj;   // the card on screen is untouched
          // Redraw only when something changed (no blinking every poll)
          if (JSON.stringify(state.patients) !== before) refreshStatsAndRooms();
        }
      }
      // Retry discharged / dead records saved while offline
      if (global.PharmacyArchive.pendingCount() > 0) global.PharmacyArchive.sync();
      // Also pull med requests from Supabase (so the admin sees new
      // doctor requests even if Realtime failed to deliver them).
      // This is the safety net for the med-request workflow.
      const client = SB.getClient();
      if (client) {
        const { data: medReqData, error: medReqErr } = await client
          .from("med_requests")
          .select("*")
          .order("requested_at", { ascending: false });
        if (!medReqErr && Array.isArray(medReqData)) {
          // Convert Supabase rows → local format + save
          const localRequests = medReqData.map(r => ({
            id: r.id, nameTrade: r.name_trade || "", nameEn: r.name_en || "",
            nameAr: r.name_ar || "", dose: r.dose || "", form: r.form || "tablet",
            frequency: r.frequency || "1×1", notes: r.notes || "",
            requestedBy: r.requested_by || "", requestedAt: r.requested_at || "",
            status: r.status || "pending", reviewedBy: r.reviewed_by || "",
            reviewedAt: r.reviewed_at || "", approvedMedId: r.approved_med_id || ""
          }));
          // Only update if something changed (compare count to avoid
          // unnecessary re-renders on every poll)
          const oldCount = Storage.loadMedRequests().length;
          Storage.saveMedRequests(localRequests);
          if (localRequests.length !== oldCount) {
            console.log("[Poll] med requests changed:", oldCount, "→", localRequests.length);
            // Re-render the admin med requests list if open
            const adminView = document.getElementById("view-admin");
            if (adminView && !adminView.hidden) {
              renderMedRequests();
            }
            // Update the settings row badge count
            if (Auth && Auth.isAdmin && Auth.isAdmin()) {
              const pendingCount = Storage.getPendingMedRequestsCount();
              const valEl = $("settings-med-request-value");
              if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Poll] pull failed:", e);
    }
  }

  // -------- Pull med requests from Supabase --------
  // Called on boot (onLoginSuccess) + on openAdminView + every 30s
  // via pollOnce. Pulls all med_requests from Supabase, saves them
  // locally, and pushes a notification for any NEW pending requests
  // that the admin hasn't seen yet.
  async function pullMedRequestsFromCloud() {
    if (!SB || !SB.isConfigured || !SB.isConfigured()) return;
    const client = SB.getClient();
    if (!client) return;
    try {
      const { data, error } = await client
        .from("med_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error || !Array.isArray(data)) return;
      // Convert Supabase rows → local format
      const localRequests = data.map(r => ({
        id: r.id, nameTrade: r.name_trade || "", nameEn: r.name_en || "",
        nameAr: r.name_ar || "", dose: r.dose || "", form: r.form || "tablet",
        frequency: r.frequency || "1×1", notes: r.notes || "",
        requestedBy: r.requested_by || "", requestedAt: r.requested_at || "",
        status: r.status || "pending", reviewedBy: r.reviewed_by || "",
        reviewedAt: r.reviewed_at || "", approvedMedId: r.approved_med_id || ""
      }));
      // Detect NEW pending requests that we didn't have locally
      const oldRequests = Storage.loadMedRequests();
      const oldIds = new Set(oldRequests.map(r => r.id));
      const newPending = localRequests.filter(r =>
        r.status === "pending" && !oldIds.has(r.id)
      );
      // Save to localStorage
      Storage.saveMedRequests(localRequests);
      // For each NEW pending request, push a notification + play sound
      // (so the admin actually hears/sees the alert)
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      newPending.forEach(r => {
        // Don't notify about our own requests
        if (r.requestedBy !== (user ? user.username : "")) {
          pushNotification("med_request",
            `طلب دواء جديد: ${r.nameTrade} — من ${displayNameOf(r.requestedBy)}`,
            r.nameTrade, "");
        }
      });
      // Re-render admin list if open
      const adminView = document.getElementById("view-admin");
      if (adminView && !adminView.hidden) {
        renderMedRequests();
      }
      // Update settings badge
      if (Auth && Auth.isAdmin && Auth.isAdmin()) {
        const pendingCount = Storage.getPendingMedRequestsCount();
        const valEl = $("settings-med-request-value");
        if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
      }
    } catch (e) {
      console.warn("[Pull] med requests failed:", e);
    }
  }

  function hydrate() {
    const data = Storage.loadAll();
    state.patients    = data.patients || {};
    state.medications = data.medications && data.medications.length
      ? data.medications
      : Meds.DEFAULT_MEDICATIONS.slice();
  }

  // -------- Dark mode --------
  function initDarkMode() {
    // Restore saved preference
    try {
      const saved = localStorage.getItem("pharma.darkmode");
      if (saved === "true") {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) { /* ignore */ }
    const btn = $("darkmode-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const html = document.documentElement;
      const isDark = html.getAttribute("data-theme") === "dark";
      if (isDark) {
        html.removeAttribute("data-theme");
        try { localStorage.setItem("pharma.darkmode", "false"); } catch (e) {}
      } else {
        html.setAttribute("data-theme", "dark");
        try { localStorage.setItem("pharma.darkmode", "true"); } catch (e) {}
      }
    });
  }

  // -------- Display Mode (TV / large screen, view-only) --------
  // Detects large screens (>= 1280px) or TV user agents, and offers
  // a full-screen display mode showing the ward map for monitoring.
  let _displayModeActive = false;
  let _displayClockTimer = null;

  // -------- Last supply distribution memory --------
  // When the user generates the chart via the supply-order modal, the
  // supplyDistribution is saved here. Later, if the user opens the
  // med summary modal via the red button (without re-running through
  // the supply-order flow), this saved distribution is used so the
  // Supplies category reflects what was last distributed.
  let _lastSupplyDistribution = null;

  // The supplies of the last SUCCESSFUL send to the chart (kept on this device)
  // — «الطلبية» lists them next to the medicines.
  const SENT_SUPPLIES_KEY = "pharma.lastSentSupplies.v1";
  function saveSentSupplies(dist, day, unit) {
    try { localStorage.setItem(SENT_SUPPLIES_KEY + "." + (unit || "1"), JSON.stringify({ at: Date.now(), day: day || "", dist: dist || {} })); } catch (e) { /* ignore */ }
  }
  function loadSentSupplies(unit) {
    try {
      const v = JSON.parse(localStorage.getItem(SENT_SUPPLIES_KEY + "." + (unit || "1")) || "null");
      return v && typeof v === "object" && v.dist ? v : null;
    } catch (e) { return null; }
  }

  function initDisplayMode() {
    const btn = $("display-mode-exit");
    if (btn) {
      // the TV account cannot leave the display: its button signs out
      btn.addEventListener("click", () => {
        if (Auth && Auth.isTv && Auth.isTv()) { userLogout(); return; }
        exitDisplayMode();
      });
    }
    // Check if we should auto-enter display mode
    // (after login, not on first load — user might want normal mode)
    // We add a button in the header for manual toggle, and auto-enter
    // only if the screen is very large AND user agent suggests a TV.
  }

  function shouldOfferDisplayMode() {
    const isLargeScreen = window.innerWidth >= 1280;
    const ua = (navigator.userAgent || "").toLowerCase();
    const isTV = ua.indexOf("tv") >= 0 || ua.indexOf("smarttv") >= 0 ||
                 ua.indexOf("webos") >= 0 || ua.indexOf("tizen") >= 0;
    return isLargeScreen || isTV;
  }

  function enterDisplayMode() {
    const dm = $("display-mode");
    if (!dm) return;
    _displayModeActive = true;
    dm.hidden = false;
    // Try to enter browser fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      }
    } catch (e) { /* may fail if not user-initiated */ }
    renderDisplayMode();
    // Beds light up after medicine changes / discharge / death (tv-alerts.js)
    if (global.PharmacyTvAlerts) global.PharmacyTvAlerts.start();
    // The admin's choice of saying (daily-quotes.js)
    if (global.PharmacyDailyQuotes) global.PharmacyDailyQuotes.start();
    // Start clock
    updateDisplayClock();
    _displayClockTimer = setInterval(updateDisplayClock, 1000);
  }

  function exitDisplayMode() {
    const dm = $("display-mode");
    if (!dm) return;
    _displayModeActive = false;
    dm.hidden = true;
    if (global.PharmacyTvAlerts) global.PharmacyTvAlerts.stop();
    if (_displayClockTimer) {
      clearInterval(_displayClockTimer);
      _displayClockTimer = null;
    }
    // Exit fullscreen if active
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      }
    } catch (e) { /* ignore */ }
  }

  function updateDisplayClock() {
    const el = $("display-mode-time");
    if (!el) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    el.textContent = dateStr + " · " + timeStr;
    // today's saying (changes after midnight); a verse shows its two halves
    const q = $("display-mode-quote");
    const Q = global.PharmacyDailyQuotes;
    if (q && Q) {
      if (now.getSeconds() === 0 && now.getMinutes() % 5 === 0) Q.load();   // backup for Realtime
      const text = Q.current(now);
      if (q.dataset.text !== text) {
        q.dataset.text = text;
        Q.renderInto(q, text);          // a verse = two lines, smaller font if needed
      } else if (now.getSeconds() % 10 === 0) {
        Q.fit(q);                       // the screen size may have changed
      }
    }
  }

  function renderDisplayMode() {
    const container = $("display-mode-rooms");
    if (!container) return;
    container.innerHTML = "";
    const TvA = global.PharmacyTvAlerts;
    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS) return;

    // Local copy of bedSpecialFlags to avoid dependency on UI export
    const dmBedFlags = (patient) => {
      if (UI.bedSpecialFlags) return UI.bedSpecialFlags(patient);
      const flags = { hasAlbumin: false, hasMeronem: false };
      if (!patient || !Array.isArray(patient.medications)) return flags;
      for (const pm of patient.medications) {
        if (!pm) continue;
        const id = (pm.id || "").toLowerCase();
        const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
        if (id.indexOf("albumin") >= 0 || name.indexOf("albumin") >= 0 || name.indexOf("ألبومين") >= 0) flags.hasAlbumin = true;
        if (id.indexOf("meronem") >= 0 || id.indexOf("meropenem") >= 0 || name.indexOf("meronem") >= 0 || name.indexOf("meropenem") >= 0 || name.indexOf("ميرونيم") >= 0 || name.indexOf("ميروبينيم") >= 0) flags.hasMeronem = true;
      }
      return flags;
    };

    Ward.ROOMS.forEach(room => {
      const occupied = room.beds.filter(b => {
        const key = Ward.bedKey(room.id, b.number);
        const p = state.patients[key];
        return p && p.name && p.name.trim();
      }).length;
      const roomCard = document.createElement("div");
      roomCard.className = "dm-room dm-room-" + room.bedCount;   // 6-bed / 4-bed grids
      roomCard.innerHTML = `
        <div class="dm-room-head">
          <div class="dm-room-num">${global.PharmacyWard.roomTitle(room.id)}</div>
          <div class="dm-room-occ">${occupied} / ${room.bedCount} مشغول</div>
        </div>
        <div class="dm-beds"></div>
      `;
      const bedsGrid = roomCard.querySelector(".dm-beds");
      // laid out like the ward (and the rooms view): row by row top → bottom,
      // in each row the right bed then the left one (2 columns, RTL)
      const sides = room.bedCount === 6 ? ["top", "middle", "bottom"] : ["top", "bottom"];
      const placed = [];
      sides.forEach(side => room.beds.filter(b => b.side === side)
        .sort((a, b) => (a.column === "left" ? 1 : 0) - (b.column === "left" ? 1 : 0))
        .forEach(b => placed.push(b)));
      placed.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key] || null;
        const hasName = p && p.name && p.name.trim();
        const hasMeds = hasName && Array.isArray(p.medications) && p.medications.length > 0;
        const flags = hasName ? dmBedFlags(p) : { hasAlbumin: false, hasMeronem: false };
        let cls = "dm-bed-empty";
        let nameText = "فارغ";
        let flagHtml = "";
        if (hasName) {
          // albumin / meronem: only the dots — the bed keeps its normal colour
          cls = hasMeds ? "dm-bed-meds" : "dm-bed-occupied";
          // albumin green, meronem red, I.V.I.G orange
          const dots = (flags.hasAlbumin ? "🟢" : "") + (flags.hasMeronem ? "🔴" : "") + (flags.hasIvig ? "🟠" : "");
          if (dots) flagHtml = '<span class="dm-bed-flag">' + dots + '</span>';
          nameText = p.name.trim();
        }
        const bedEl = document.createElement("div");
        const alert = TvA ? TvA.alertFor(key) : null;
        bedEl.className = "dm-bed " + cls + (alert ? " dm-alert dm-alert-" + alert.type : "");
        // an emptied bed shows who left / died while it is lit
        const shownName = alert && alert.type !== "med" && !hasName ? alert.name : nameText;
        bedEl.innerHTML = `
          <div class="dm-bed-num">سرير ${global.PharmacyWard.bedLabel(room.id, bed.number)}</div>
          <div class="dm-bed-name">${escapeHtml(shownName)}</div>
          ${flagHtml}
          ${alert ? '<div class="dm-alert-text">' + (alert.type === "med" ? "" : escapeHtml(alert.detail) + ' · ') + escapeHtml(TvA.ago(alert.at)) + '</div>' : ""}
        `;
        bedsGrid.appendChild(bedEl);
      });
      container.appendChild(roomCard);
    });
  }
  // We toggle the `is-authed` / `is-unauthed` class on <html> so the
  // pre-paint CSS gate (in <head>) stays in sync with runtime auth
  // state. The HTML default has `#app` visible and `#login-screen`
  // hidden, but the CSS in <head> overrides that based on the class
  // on <html>, so we must update the class whenever auth state changes
  // (login, logout, session expiry, etc.).
  function setAuthClass(loggedIn) {
    const html = document.documentElement;
    html.classList.toggle("is-authed",   !!loggedIn);
    html.classList.toggle("is-unauthed", !loggedIn);
  }

  function showLogin() {
    setAuthClass(false);
    $("login-screen").hidden = false;
    // Reset any previous form state
    $("login-username").value = "";
    $("login-password").value = "";
    $("login-error").hidden = true;
    // Focus the username field for fast typing on phones
    setTimeout(() => { try { $("login-username").focus(); } catch (e) {} }, 100);
  }

  function showApp() {
    setAuthClass(true);
    $("login-screen").hidden = true;
  }

  // Apply role-based visibility — controls which buttons appear on the
  // header for each role.
  //
  // Role permissions matrix:
  //   Button               | admin | pharmacist | doctor
  //   -------------------- | ----- | ---------- | ------
  //   ⚙ settings/admin     |  ✅   |  ✅        | ✅ (settings view)
  //   ⚫ chart (print)      |  ✅   |  ✅        | ❌ (doctors don't print)
  //   🔴 med summary        |  ✅   |  ✅        | ❌
  //   🟣 pills form        |  ✅   |  ✅        | ❌
  //   🔵 Excel export       |  ✅   |  ✅        | ❌
  //   🌙 dark mode         |  ✅   |  ❌ (in settings) | ❌ (in settings)
  //   📺 TV display        |  ✅   |  ❌ (in settings) | ❌ (in settings)
  //   🚪 logout (header)   |  ✅   |  ❌ (in settings) | ❌ (in settings)
  function applyRoleVisibility() {
    if (!Auth) return;
    const isAdmin = Auth.isAdmin();
    const isDoctor = Auth.isDoctor && Auth.isDoctor();

    // Patient-header wording per role: pharmacists record the specialist;
    // the plate number is mandatory for pharmacists + admin, not doctors.
    const doctorField = $("patient-doctor-input");
    if (doctorField) doctorField.placeholder = isAdmin ? "الطبيب المعالج (اختياري)" : "اسم الأخصائي (اختياري)";
    const plateField = $("patient-plate-input");
    if (plateField) plateField.placeholder = (isDoctor || isAdmin) ? "رقم الطبلة (6 أرقام — اختياري)" : "رقم الطبلة (6 أرقام) *";

    // Update the role class on <html> so the pre-paint CSS gate
    // shows the correct header buttons. The pre-paint script in
    // <head> sets this class synchronously on page load, but we
    // re-apply it here so live role changes (login / logout /
    // switching user) also update the buttons.
    const root = document.documentElement;
    root.classList.remove('role-admin', 'role-doctor', 'role-pharmacist', 'role-tv', 'limited-admin');
    const isTv = !!(Auth.isTv && Auth.isTv());
    if (isAdmin) {
      root.classList.add('role-admin');
      if (Auth.isLimitedAdmin && Auth.isLimitedAdmin()) root.classList.add('limited-admin');
    } else if (isDoctor) {
      root.classList.add('role-doctor');
    } else if (isTv) {
      root.classList.add('role-tv');
    } else {
      root.classList.add('role-pharmacist');
    }
    // TV account: straight into the ward display, nothing else
    if (isTv && !_displayModeActive) enterDisplayMode();
    if (!isTv && _displayModeActive && !isAdmin) exitDisplayMode();

    // Gear button (settings/admin): always visible for ALL roles.
    // For admin → opens full admin view (med catalog + users + audit).
    // For pharmacist/doctor → opens simple settings view (dark mode +
    // TV + logout).
    const adminBtn = $("open-admin");
    if (adminBtn) adminBtn.hidden = false;
    const adminToolsBtn = $("admin-tools-btn");
    if (adminToolsBtn) adminToolsBtn.hidden = !isAdmin;

    // Chart + summary + pills-form + Excel buttons: pharmacist & admin only.
    // Hidden for doctors (doctors don't do chart printing or supply
    // distribution — that's the pharmacist's job).
    // NOTE: The CSS pre-paint gate handles the visual display via the
    // role class. We still set the `hidden` attribute here for
    // accessibility (screen readers honor `hidden`) and to ensure
    // the buttons aren't clickable when they shouldn't be.
    // Printing the chart: not used for now, hidden for every role.
    // (Handler + chart-image.js kept; set CHART_PRINT_ENABLED to bring it back for the admin.)
    const chartBtn = $("print-chart-btn");
    if (chartBtn) chartBtn.hidden = !(CHART_PRINT_ENABLED && isAdmin);
    // Note: med-summary-btn was removed from the header (its modal
    // is still opened programmatically by the distribute-send-btn
    // workflow). No need to set its hidden attribute.
    // Pills form + "send patient data to the chart": pharmacist + admin
    // (the ordering roles). Hidden for doctors.
    const isOrderingRole = isAdmin || !isDoctor;
    const pillsBtn = $("print-pills-form-btn");
    if (pillsBtn) pillsBtn.hidden = !isOrderingRole;
    const distributeSendBtn = $("distribute-send-btn");
    if (distributeSendBtn) distributeSendBtn.hidden = !isOrderingRole;
    const orderListBtn = $("order-list-btn");
    if (orderListBtn) orderListBtn.hidden = !isOrderingRole;
    // Medication availability list: editable by pharmacists + admin
    const availBtn = $("settings-availability-btn");
    if (availBtn) availBtn.hidden = !isOrderingRole;
    const sendlogBtn = $("settings-sendlog-btn");
    if (sendlogBtn) sendlogBtn.hidden = !isOrderingRole;

    // Print ALL patient sheets button: admin + doctor only.
    // The pharmacist prints individual sheets from the patient view.
    const isPrintAllRole = isAdmin || isDoctor;
    const allSheetsBtn = $("print-all-sheets-btn");
    if (allSheetsBtn) allSheetsBtn.hidden = !isPrintAllRole;

    // Discharged list now in settings — no header button needed

    // Dark mode + TV + logout: only visible to admins (non-admins
    // access them via the Settings view instead).
    const darkBtn = $("darkmode-toggle");
    if (darkBtn) darkBtn.hidden = !isAdmin;
    const displayBtn = $("display-mode-btn");
    if (displayBtn) displayBtn.hidden = !isAdmin;
    const logoutBtn = $("logout-btn");
    if (logoutBtn) logoutBtn.hidden = !isAdmin;

    // Bottom tabs (الوحدتان، حبوب الوحدتين، المرضى): pharmacists + admin
    const pharmacyTabs = isAdmin || (Auth && Auth.isPharmacist && Auth.isPharmacist());
    ["unit3", "pills1", "pills3"].forEach(nav => {
      const tab = document.querySelector('.nav-item[data-nav="' + nav + '"]');
      if (tab) tab.style.display = pharmacyTabs ? "" : "none";
    });
  }

  // Bind login form + quick buttons + logout
  function bindAuthEvents() {
    if (!Auth) return;

    // Login form submit
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("login-username").value;
      const password = $("login-password").value;
      // Show a loading state on the submit button so the user knows
      // the auth check is happening (especially with cloud login which
      // can take 1-2 seconds).
      const submitBtn = e.target.querySelector("button[type=submit]");
      const origText = submitBtn.textContent;
      submitBtn.textContent = "جارٍ التحقق…";
      submitBtn.disabled = true;
      try {
        const res = await Auth.login(username, password);
        if (res.ok) {
          onLoginSuccess();
        } else {
          const errEl = $("login-error");
          errEl.textContent = res.error;
          errEl.hidden = false;
        }
      } catch (err) {
        const errEl = $("login-error");
        errEl.textContent = (err && err.message) ? err.message : String(err);
        errEl.hidden = false;
      } finally {
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
      }
    });

    // (Quick pharmacist login button was removed from the login
    // screen — all users must use the login form with username +
    // password now.)

    // Logout button in header
    $("logout-btn").addEventListener("click", userLogout);
  }

  function onLoginSuccess() {
    $("login-error").hidden = true;
    applyRoleVisibility();
    showApp();
    refreshAll();
    // All roles (admin / pharmacist / doctor) use the SAME app view —
    // the home view (rooms grid). Role-based permissions (which buttons
    // are visible / which actions are allowed) are applied in
    // applyRoleVisibility() and the action handlers.
    UI.showView("home");
    pullCatalogOnBoot();
    initRealtime();
    startPolling();
    // Also pull med requests immediately on login (so the admin sees
    // pending requests without waiting 30s for the first poll)
    pullMedRequestsFromCloud();
    updateNotifBadge();
    const user = Auth.getCurrentUser();
    // Personalized welcome: "أهلاً دكتور [name]" or "أهلاً دكتورة [name]"
    // depending on the user's gender (stored in the session).
    if (user) {
      const title = user.gender === "female" ? "دكتورة" : "دكتور";
      // Use only the first name (first word) for a warmer greeting
      // e.g. "عبدالله رائد" → "عبدالله", "زينب جمال" → "زينب"
      const firstName = (user.displayName || "").split(" ")[0] || user.displayName;
      flashHint(`أهلاً ${title} ${firstName}`);
    }
  }

  // -------- Supabase: pull catalog on boot --------
  // If Supabase is configured and reachable, replace the local catalog
  // with the cloud version — UNLESS the last push failed recently,
  // in which case the local catalog is fresher and we skip the pull
  // to avoid blowing away local edits that never made it to the cloud.
  // "اسم الدواء في الجارت": fill it from the chart's medicine list for
  // every medicine that lacks a valid one (chart-names.js), then save the
  // catalogue for every device. Pharmacists + admin (they may write the
  // catalogue); runs only when something changes.
  function fillChartNames() {
    const Names = global.PharmacyChartNames;
    const canWrite = Auth && (Auth.isAdmin() || Auth.isPharmacist());
    if (!Names || !canWrite || !Array.isArray(state.medications) || !state.medications.length) return;
    const changes = Names.autoFill(state.medications);
    if (!changes.length) return;
    Storage.saveMedications(state.medications);
    console.log("[chart-names] filled", changes.length, "chart names");
    if (SBSync && SBSync.pushCatalog) {
      SBSync.pushCatalog().then(r => {
        if (r.ok && (r.stripped || []).includes("name_chart")) {
          // The cloud has no name_chart column: names stay on this device
          // only and would be filled again on every start — say why, once.
          let told = false;
          try { told = sessionStorage.getItem("pharma.name-chart-missing") === "1"; sessionStorage.setItem("pharma.name-chart-missing", "1"); } catch (e) { /* blocked */ }
          if (!told) flashHint("⚠ أسماء الجارت لم تُحفظ في السحابة — شغّل features.sql في Supabase (عمود name_chart ناقص)");
        } else if (r.ok) {
          // filled silently (no notice at sign-in)
        } else {
          console.warn("[chart-names] catalog push failed:", r.error);
        }
      });
    }
  }

  async function pullCatalogOnBoot() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      updateSupabaseStatusUI("غير مربوط");
      return;
    }
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");

    // Built-in defaults, used only to seed a completely empty cloud
    // catalog. (An empty default list never wipes the cloud.)
    const def = (Meds && Meds.DEFAULT_MEDICATIONS) || [];

    // Cloud is the source of truth: pullCatalog() overwrites the
    // local cache with the cloud version. No merge, no push-back
    // needed — the cloud is what every device reads from.
    const res = await SBSync.pullCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      fillChartNames();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      // ONE-TIME CLOUD SEED: ONLY seed the cloud if it's COMPLETELY
      // EMPTY (0 meds). Don't seed if it has fewer than DEFAULT —
      // the admin may have intentionally deleted meds, and re-seeding
      // would undo their deletions. This was the root cause of the
      // "deleted meds reappear" bug.
      if (Array.isArray(state.medications) && def.length > 0 &&
          state.medications.length === 0) {
        console.log("[Sync] cloud is empty (0 meds) — seeding with defaults");
        state.medications = def.slice();
        Storage.saveMedications(def);
        UI.renderAdminMedList(def, null);
        updateSupabaseStatusUI(`مربوط · جارٍ رفع ${def.length} دواء للسحابة…`, "loading");
        SBSync.pushCatalog().then(r => {
          if (r.ok) updateSupabaseStatusUI(`مربوط · ${r.count} دواء`, "connected");
          else updateSupabaseStatusUI("فشل رفع الكتالوج: " + r.error, "error");
        });
      }
    } else if (res.skipped) {
      updateSupabaseStatusUI("يعمل محليًا · السحب متأخر", "error");
    } else {
      updateSupabaseStatusUI("خطأ: " + res.error, "error");
    }
    // Pull patients too
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
    }
    // Discharged / dead archive: upload this device's records, then
    // mirror the shared cloud lists (used by the previous-admission banner)
    global.PharmacyArchive.sync().then(res => {
      if (!res.ok) console.warn("[Archive] sync:", res.error);
    });
  }

  // -------- Supabase Realtime --------
  // Subscribes to changes on the `patients` and `medications` tables.
  // When another device inserts/updates/deletes a patient or med,
  // the local state is updated in real-time without needing to press
  // the sync button.
  let realtimeChannel = null;
  function initRealtime() {
    if (!SB || !SB.isConfigured()) return;
    const client = SB.getClient();
    if (!client) return;
    _myUserId = null;                 // re-read for the signed-in user
    pullCloudNotifications();
    if (!global._notifPoll) {
      global._notifPoll = setInterval(pullCloudNotifications, 30000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) pullCloudNotifications(); });
    }
    global.PharmacyTarbeet.start();
    if (global.PharmacyOrnaments) global.PharmacyOrnaments.start();
    if (global.PharmacySpecialistsAdmin) global.PharmacySpecialistsAdmin.start();   // the admin's specialists list, for every device
    if (global.PharmacyGreetings) global.PharmacyGreetings.start();   // a welcome-back / birthday card for a named colleague
    if (global.PharmacyPresence) global.PharmacyPresence.start();       // a scanning line on a bed someone else has open
    if (global.PharmacyOccasions) global.PharmacyOccasions.start();   // the admin's theme choice, for every device
    if (global.PharmacyDutyRoster) global.PharmacyDutyRoster.start(); // the duty roster, for every device
    // Don't subscribe twice
    if (realtimeChannel) {
      try { realtimeChannel.unsubscribe(); } catch (e) { /* ignore */ }
      realtimeChannel = null;
    }
    try {
      realtimeChannel = client
        .channel("pharma-realtime")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "patients" },
          (payload) => {
            handlePatientRealtimeChange(payload);
          }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "medications" },
          (payload) => {
            handleMedicationRealtimeChange(payload);
          }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "med_requests" },
          (payload) => {
            handleMedRequestRealtimeChange(payload);
          }
        )
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          (payload) => { receiveCloudNotification(payload.new, false); }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[Realtime] connected");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.warn("[Realtime]", status, "— reconnecting");
            scheduleRealtimeRetry();
          }
        });
    } catch (e) {
      console.warn("[Realtime] init failed:", e);
    }
  }

  let _rtRetry = null;
  function scheduleRealtimeRetry() {
    if (_rtRetry || !(Auth && Auth.isLoggedIn())) return;
    _rtRetry = setTimeout(() => {
      _rtRetry = null;
      if (Auth && Auth.isLoggedIn()) initRealtime();
    }, 5000);
  }
  function realtimeAlive() {
    return !!(realtimeChannel && realtimeChannel.state === "joined");
  }

  function handlePatientRealtimeChange(payload) {
    // payload: { eventType: 'INSERT'|'UPDATE'|'DELETE', old: {...}, new: {...} }
    const bedKey = payload.new?.bed_key || payload.old?.bed_key;
    if (!bedKey) return;
    // What the open card shows now — it is redrawn only if THIS changes
    // (a change on another bed, or our own save echoing back, must not
    // redraw the medicines: they blink)
    const _openKey = state.currentBed && state.currentBed.key;
    const _openView = (p) => JSON.stringify(p && global.PharmacyPatientMerge ? global.PharmacyPatientMerge.snapshot(p) : (p || null));
    const _openBefore = _openKey ? _openView(state.patients[_openKey]) : null;
    // Bed move (app_move_patient): the row's key changed — drop the old bed
    const oldKey = payload.old?.bed_key;
    if (payload.eventType === "UPDATE" && oldKey && oldKey !== bedKey) {
      // Only if the copy there is the patient who moved — a NEW patient may
      // already sit in the old bed (their name / pid differ)
      const there = state.patients[oldKey];
      const row0 = payload.new || {};
      const movedOne = !there || (there.pid && row0.pid ? there.pid === row0.pid
        : (there.name || "").trim() === (row0.name || "").trim());
      if (movedOne) {
        delete state.patients[oldKey];
        Storage.deletePatient(oldKey);
        if (state.currentBed && state.currentBed.key === oldKey) {
          state.currentBed = null;
          UI.showView("home");
        }
      }
    }
    // Track whether this is a NEW patient (INSERT) or an UPDATE/
    // DELETE — used to play the right notification sound.
    let isInsert = false;
    let isDelete = false;
    if (payload.eventType === "DELETE") {
      // Another device deleted this patient
      isDelete = true;
      delete state.patients[bedKey];
      Storage.deletePatient(bedKey);
      Storage.saveLocalDeletion(bedKey);
    } else {
      // INSERT or UPDATE — sync this patient from the cloud
      // We do a lightweight local update rather than a full pull
      const row = payload.new;
      if (row && isPendingExit(bedKey)) return;   // emptied here, waiting for «تراجع»
      if (row) {
        // Detect INSERT (new patient) vs UPDATE (existing patient with
        // changed meds/info). If we don't have this bedKey locally, it's
        // an INSERT from another device.
        if (!state.patients[bedKey] || !state.patients[bedKey].name) {
          isInsert = true;
        }
        // Our own save coming back, or an older copy → nothing to do
        const curP = state.patients[bedKey];
        // a different patient in this bed (the key was reused) → versions don't compare
        const samePatient = !(curP && curP.pid && row.pid && curP.pid !== row.pid);
        if (samePatient && curP && Number.isInteger(curP.version) && Number.isInteger(row.version) && row.version <= curP.version) {
          if (!curP.pid && row.pid) { curP.pid = row.pid; Storage.putPatient(bedKey, curP); }
          return;
        }
        let meds = [];
        try {
          meds = typeof row.medications === "string"
            ? JSON.parse(row.medications)
            : (row.medications || []);
        } catch (e) { meds = []; }
        const _legacyIncoming = {
          name:        row.name || "",
          plateNumber: row.plate_number || "",
          doctor:      row.doctor || "",
          diagnosis:   row.diagnosis || "",
          age:         row.age || "",
          gender:      row.gender || "",
          firstMedDate: row.first_med_date || "",
          allergies:   row.allergies || "",
          originWard:  row.origin_ward || "",
          originNote:  row.origin_note || "",
          labs:      row.labs ? (typeof row.labs === "string" ? JSON.parse(row.labs) : (row.labs || {})) : {},
          labHistory:  row.lab_history ? (typeof row.lab_history === "string" ? JSON.parse(row.lab_history) : (row.lab_history || [])) : [],
          medications: Array.isArray(meds) ? meds : [],
          updatedAt:   Date.parse(row.updated_at) || Date.now()
        };
        const incoming = SBSync && SBSync.cloudPatient ? SBSync.cloudPatient(row) : _legacyIncoming;
        const PM = global.PharmacyPatientMerge;
        if (samePatient && curP && curP._dirty && PM && Number.isInteger(incoming.version)) {
          // Unsent edits here + a newer copy from someone else → merge
          const r = PM.merge3(curP._base, curP, incoming);
          state.patients[bedKey] = Object.assign({}, incoming, r.merged, {
            version: incoming.version, _base: incoming._base, _dirty: true, updatedAt: Date.now()
          });
          Storage.putPatient(bedKey, state.patients[bedKey]);
          if (SBSync.pushPatient) SBSync.pushPatient(bedKey);
        } else {
          state.patients[bedKey] = incoming;
          Storage.putPatient(bedKey, incoming);
        }
      }
    }
    refreshStatsAndRooms();
    // If display mode is active, refresh it too
    if (_displayModeActive) renderDisplayMode();
    // If the patient view is open, refresh it (after the user finishes
    // typing if a field is focused)
    if (state.currentBed && (state.currentBed.key !== _openKey || _openView(state.patients[_openKey]) !== _openBefore)) {
      renderCurrentPatientSafely();
    }
  }

  function handleMedicationRealtimeChange(payload) {
    if (!SBSync || !SBSync.pullCatalog) return;
    // Don't re-pull the catalog if the admin view is currently open
    // and we just made an edit (delete/add). The push may still be
    // in flight to Supabase, and pulling now would get the OLD cloud
    // version (without our edit) and overwrite the local version
    // (with our edit). The admin view always saves on edit, so
    // the local state is fresher while the admin view is open.
    // A toggle on the availability page is being pushed (or just was): the cloud copy may still be the old one,
    // pulling now would undo it. One catch-up pull follows when it is quiet.
    const MA = global.PharmacyMedAvailability;
    if (MA && MA.busy && MA.busy()) {
      if (!global._medPullLater) {
        global._medPullLater = setTimeout(() => { global._medPullLater = null; handleMedicationRealtimeChange(); }, 4500);
      }
      return;
    }
    const adminView = document.getElementById("view-admin");
    if (adminView && !adminView.hidden) {
      // Skip this Realtime echo — our own edit just triggered it
      console.log("[Realtime] skipping catalog pull (admin view open, likely our own edit)");
      return;
    }
    SBSync.pullCatalog().then(res => {
      if (res.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
      }
    });
  }

  // Handles Realtime changes to the 'med_requests' table from OTHER
  // devices. When a doctor submits a med request, it's pushed to
  // Supabase. This handler fires on the admin's device → adds the
  // request to the local list + plays a notification sound + pushes
  // a local notification so the admin sees the badge update.
  function handleMedRequestRealtimeChange(payload) {
    if (!SB || !SB.isConfigured()) return;
    const row = payload.new || payload.old;
    if (!row || !row.id) return;
    // Pull all med requests from Supabase + merge with local
    const client = SB.getClient();
    if (!client) return;
    client.from("med_requests").select("*").order("requested_at", { ascending: false }).then(({ data, error }) => {
      if (error || !Array.isArray(data)) return;
      // Convert Supabase rows → local format + save
      const localRequests = data.map(r => ({
        id: r.id,
        nameTrade: r.name_trade || "",
        nameEn: r.name_en || "",
        nameAr: r.name_ar || "",
        dose: r.dose || "",
        form: r.form || "tablet",
        frequency: r.frequency || "1×1",
        notes: r.notes || "",
        requestedBy: r.requested_by || "",
        requestedAt: r.requested_at || "",
        status: r.status || "pending",
        reviewedBy: r.reviewed_by || "",
        reviewedAt: r.reviewed_at || "",
        approvedMedId: r.approved_med_id || ""
      }));
      Storage.saveMedRequests(localRequests);
      // Re-render the med requests list if the admin view is open
      const adminView = document.getElementById("view-admin");
      if (adminView && !adminView.hidden) {
        renderMedRequests();
      }
      // If this is a NEW request (INSERT) from another device, play
      // the notification sound + push a local notification
      if (payload.eventType === "INSERT") {
        const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
        // Don't echo back to the sender
        if (row.requested_by !== (user ? user.username : "")) {
          pushNotification("med_request",
            `طلب دواء جديد: ${row.name_trade || "—"} — من ${displayNameOf(row.requested_by)}`,
            row.name_trade || "", "");
        }
      }
      // Update the settings row badge count (for admin)
      if (Auth && Auth.isAdmin && Auth.isAdmin()) {
        const pendingCount = Storage.getPendingMedRequestsCount();
        const valEl = $("settings-med-request-value");
        if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
      }
    });
  }
  // Push the local catalog to Supabase (called after every admin save).
  // If the push fails, the user is shown a clear warning so they know
  // their edits are local-only and won't appear on other devices until
  // the next successful push.
  async function pushCatalogAfterEdit(onRevert) {
    if (!SB || !SBSync || !SB.isConfigured()) {
      // Cloud not configured — nothing to sync. Skip silently (this
      // happens before Supabase setup; the local cache is the only
      // source then).
      return { ok: true, syncSkipped: true };
    }
    // Cloud is the source of truth: push the edit, and revert the
    // local cache if the push fails (so local reflects cloud truth).
    // `onRevert` (optional) is called when we revert, so the caller
    // can restore its in-memory state.medications to the pre-edit
    // version (re-read from storage after the revert).
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      return { ok: true };
    }
    updateSupabaseStatusUI("خطأ في الرفع: " + res.error, "error");
    flashHint("⚠ فشل رفع التعديل — تم إلغاؤه. تحقق من الشبكة وحاول مرة أخرى.");
    console.warn("[Supabase] push failed:", res.error);
    // Cloud is the source of truth — reload from local cache (which
    // we need to reset to the cloud's current state). But we don't
    // have the cloud's current state since push failed; the safest
    // is to refresh state.medications from storage (which still
    // holds the edited version). The caller's onRevert callback is
    // responsible for undoing its in-memory edit.
    if (typeof onRevert === "function") {
      try { onRevert(); } catch (e) { /* ignore */ }
    }
    return { ok: false, error: res.error };
  }

  // Manual "push now" — used by the manual push button in advanced settings
  async function pushCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    updateSupabaseStatusUI("جارٍ الرفع…", "loading");
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم رفع ${res.count} دواء للسحابة`);
    } else {
      updateSupabaseStatusUI("فشل الرفع: " + res.error, "error");
      flashHint("فشل الرفع للسحابة: " + res.error);
    }
  }

  // Manual "pull now" — used by the manual pull button in advanced settings
  async function pullCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    if (!confirm("سحب الكتالوج من السحابة سيستبدل نسختك المحلية.\nملاحظة: بيانات المرضى لن تُستبدل بل ستُدمج (الأحدث يفوز).\nهل تريد المتابعة؟")) return;
    updateSupabaseStatusUI("جارٍ السحب…", "loading");
    const res = await SBSync.pullCatalog(true);  // force = true
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم سحب ${res.count} دواء من السحابة`);
    } else {
      updateSupabaseStatusUI("فشل السحب: " + res.error, "error");
      flashHint("فشل السحب من السحابة: " + res.error);
    }
    // Also merge-pull patients (non-destructive)
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
      flashHint(`تم دمج ${pres.count} مريض من السحابة`);
    }
  }

  // -------- Manual sync from the header button --------
  // Single tap → pulls catalog (force) + merge-pulls patients, with
  // a simple success message ("تمت المزامنة بنجاح") or a detailed
  // error message. Disables the button + spins the icon while the
  // sync is running so the user can't double-trigger it.
  let _syncInFlight = false;
  async function syncNow() {
    if (_syncInFlight) return; // prevent double-tap
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ — افتح الإعدادات لربط الحساب");
      return;
    }

    const btn = $("sync-now-btn");
    const wasDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-syncing");
    }
    _syncInFlight = true;
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");

    let okCount = 0;
    let failCount = 0;
    let firstError = "";

    try {
      // 1) Pull catalog (force = true to bypass the "unsynced local
      //    edits" guard, since the user explicitly asked for a sync).
      //    Cloud is the source of truth — pullCatalog() overwrites
      //    the local cache.
      const cres = await SBSync.pullCatalog(true);
      if (cres.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        okCount++;
      } else if (cres.skipped) {
        // skipped is not really a failure — local catalog is fresher
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("الكتالوج: " + cres.error);
      }

      // 2) Merge-pull patients (non-destructive, last-write-wins)
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("المرضى: " + pres.error);
      }

      // 3) Report result
      if (failCount === 0) {
        updateSupabaseStatusUI(
          `مربوط · ${state.medications.length} دواء · ${Object.keys(state.patients).length} مريض`,
          "connected"
        );
        flashHint("تمت المزامنة بنجاح");
      } else if (okCount === 0) {
        updateSupabaseStatusUI("فشلت المزامنة: " + firstError, "error");
        flashHint("فشلت المزامنة: " + firstError);
      } else {
        // partial: one part failed, the other succeeded
        updateSupabaseStatusUI("مزامنة جزئية — فشل: " + firstError, "error");
        flashHint("مزامنة جزئية — فشل: " + firstError);
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      updateSupabaseStatusUI("فشلت المزامنة: " + msg, "error");
      flashHint("فشلت المزامنة: " + msg);
    } finally {
      _syncInFlight = false;
      if (btn) {
        btn.classList.remove("is-syncing");
        btn.disabled = wasDisabled;
      }
    }
  }

  // -------- iOS PWA print workaround --------
  // window.print() doesn't work in iOS Safari's standalone mode
  // (when the app is added to the home screen). The workaround: open
  // a NEW Safari tab containing only the chart + the print CSS, then
  // call window.print() inside that new tab. Safari proper has full
  // AirPrint support, so the print dialog opens normally.
  //
  // Returns true if the new window was opened successfully, false
  // otherwise (popup blocked, no permission, etc.).
  function printChartInNewWindow() {
    const chartRoot = document.getElementById("chart-print-root");
    if (!chartRoot) return false;

    // Get the chart HTML (already built by UI.buildChartReport)
    const chartHTML = chartRoot.innerHTML;

    // Open a new tab. _blank + no features so iOS Safari opens a
    // full Safari tab (not a PWA child window).
    const printWindow = window.open("", "_blank");
    if (!printWindow) return false; // popup blocked

    // Self-contained HTML doc with:
    // - Google Fonts (Tajawal, Cairo) for proper Arabic rendering
    // - The chart print CSS (extracted from styles.css, no @media
    //   print wrapper needed since the whole document is the print
    //   content)
    // - The chart HTML
    // - An inline script that triggers print() after the fonts
    //   have had a chance to load, then closes the tab.
    const doc = printWindow.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>طباعة التشارت</title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">',
      '<style>',
      '@page { size: A4 landscape; margin: 3mm; }',
      'body { background: #fff; margin: 0; padding: 0; color: #000; font-family: "Tajawal", "Cairo", "Arial", sans-serif; }',
      '.chart-print-root { display: table; width: 100%; height: 100%; }',
      '.chart-page { display: table-cell; vertical-align: middle; }',
      '.chart-matrix { width: calc(100% - 8px); margin: 4px; border-collapse: collapse; font-size: 7px; table-layout: fixed; border: 2px solid #000; box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px #000; }',
      '.chart-patient-col-header { background: #fff; color: #000; font-weight: 800; padding: 1px 2px; border: 1.5px solid #000; text-align: center; font-size: 9px; width: 60px; min-width: 60px; vertical-align: middle; line-height: 1.3; }',
      '.chart-med-col-header { background: #fff; color: #000; border: 1.5px solid #000; padding: 1px 0; text-align: center; vertical-align: middle; height: 70px; width: 16px; min-width: 16px; }',
      '.chart-med-label { writing-mode: vertical-rl; text-orientation: mixed; font-size: 10px; font-weight: 700; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-height: 65px; margin: auto 0; display: block; }',
      '.chart-patient-cell { background: #fff; font-weight: 700; padding: 0 3px; border: 1.5px solid #000; text-align: center; vertical-align: middle; width: 60px; min-width: 60px; height: 16px; font-size: 8px; color: #000; line-height: 16px; }',
      '.chart-cell { border: 1.5px solid #000; text-align: center !important; vertical-align: middle; padding: 0; font-size: 11px; font-weight: 800; color: #000; width: 16px; min-width: 16px; height: 16px; line-height: 16px; background: #fff; box-sizing: border-box; display: table-cell; }',
      '.chart-matrix tr { height: 16px; }',
      '.chart-cell-custom { font-size: 11px; font-weight: 700; line-height: 1; }',
      '.chart-page-break { page-break-before: always; }',
      '.chart-matrix th, .chart-matrix td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      '/* iOS smaller cells */',
      'html.is-ios .chart-cell { height: 14px; line-height: 14px; font-size: 10px; }',
      'html.is-ios .chart-patient-cell { height: 14px; line-height: 14px; font-size: 7px; }',
      'html.is-ios .chart-matrix tr { height: 14px; }',
      'html.is-ios .chart-cell-custom { font-size: 10px; }',
      'html.is-ios .chart-med-col-header { height: 60px; }',
      'html.is-ios .chart-med-label { max-height: 55px; }',
      '</style>',
      '<script>document.documentElement.className += " is-ios";</script>',
      '</head>',
      '<body>',
      '<div class="chart-print-root">',
      chartHTML,
      '</div>',
      '<script>',
      // Wait for fonts to load before printing. We try a few
      // strategies: (1) wait for window.load (fonts cached), then
      // (2) wait a short delay to ensure layout has settled.
      'window.addEventListener("load", function() {',
      // 800ms gives the fonts time to load even on slow networks.
      // The chart is already rendered visually; print is just
      // snapshotting what's on screen.
      '  setTimeout(function() {',
      '    try { window.print(); } catch (e) {}',
      // Try to close the tab after printing. iOS Safari may block
      // window.close() for tabs the user opened (vs. those opened
      // by script), but since we opened this via window.open(), it
      // should be closeable. Wrap in try/catch in case it isn't.
      '    setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join('\n'));
    doc.close();
    return true;
  }

  // Update the small status badge in the Supabase settings panel.
  function updateSupabaseStatusUI(text, kind) {
    const el = $("sb-status");
    if (!el) return;
    el.textContent = "الحالة: " + text;
    el.classList.remove("is-connected", "is-error", "is-loading");
    if (kind === "connected") el.classList.add("is-connected");
    else if (kind === "error") el.classList.add("is-error");
    else if (kind === "loading") el.classList.add("is-loading");
  }

  // Pre-fill the Supabase settings inputs if already configured.
  function refreshSupabaseInputs() {
    if (!SB) return;
    const cfg = SB.loadConfig();
    if (cfg) {
      $("sb-url").value = cfg.url || "";
      $("sb-key").value = cfg.anonKey || "";
    }
  }

  // -------- Render refresh --------
  function refreshAll() {
    UI.renderStats(state.patients);
    UI.renderRooms(state.patients);
    UI.renderPatientsList(state.patients);
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key] || null;
      UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
    }
  }

  function refreshPatientViewOnly() {
    if (!state.currentBed) return;
    const p = state.patients[state.currentBed.key] || null;
    UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
  }

  function refreshStatsAndRooms() {
    // Save scroll position before re-rendering rooms (renderRooms
    // clears innerHTML which resets scroll to top).
    const scrollY = UI.getScrollY();
    UI.renderStats(state.patients);
    const ghost = _pendingExit && _pendingExit.ghost && _pendingExit.snapshot;
    UI.renderRooms(ghost ? Object.assign({}, state.patients, { [_pendingExit.bedKey]: _pendingExit.snapshot }) : state.patients);
    UI.renderPatientsList(state.patients);
    if (global.PharmacyPillsPage) global.PharmacyPillsPage.refreshIfOpen();
    if (_displayModeActive) renderDisplayMode();   // the TV / display shows changes too
    // Restore scroll position if we were on the home view
    // (so the user doesn't lose their place in the rooms grid).
    const homeView = document.getElementById("view-home");
    if (homeView && !homeView.hidden && scrollY > 0) {
      UI.setScrollY(scrollY);
    }
  }

  // -------- Ordering scope --------
  // Patients whose meds the ward pharmacy orders: everyone except
  // boarders from wards we never order for (7th-floor hematology —
  // see boarders.js). Used by every ordering path: supply distribution,
  // med summary, chart image, pills form, chart bridge.
  function orderedPatientsMap() {
    return global.PharmacyBoarders.orderedPatients(state.patients);
  }
  function orderingState() {
    return Object.assign({}, state, { patients: orderedPatientsMap() });
  }
  // «الطلبية» and the chart send work on ONE unit: the unit page the user is on. On any other page
  // (pills, patients…) they ask to choose a unit first.
  let _flowUnit = null, _flowKind = "general";
  function pickFlowUnit() {
    if (!(UI.currentView && UI.currentView() === "home")) { flashHint("اختر الوحدة أولاً"); return false; }
    // «خاص» mode = the private rooms of BOTH units together (one chart, one order); «عام» = this unit only
    _flowKind = UI.getKind();
    _flowUnit = _flowKind === "private" ? "p" : UI.getUnit();
    return true;
  }
  function flowUnitName() {
    const u = global.PharmacyWard.UNITS.find(x => x.id === _flowUnit);
    return _flowUnit === "p" ? "ردهة الخاص (الوحدتان)" : (u ? u.name + " — العام" : "");
  }
  // storage key part: the sent supplies are kept per unit and kind
  function flowKey() { return _flowUnit; }
  function flowPatientsMap() {
    const all = orderedPatientsMap();
    if (!_flowUnit) return all;
    const out = {};
    global.PharmacyWard.ROOMS.filter(r => _flowUnit === "p" ? r.kind === "private" : (r.unit === _flowUnit && r.kind === "general")).forEach(room => room.beds.forEach(b => {
      const k = global.PharmacyWard.bedKey(room.id, b.number);
      if (all[k]) out[k] = all[k];
    }));
    return out;
  }
  function occupiedCount(map) {
    return Object.values(map || {}).filter(p => p && p.name && p.name.trim()).length;
  }

  // -------- Patient helpers --------
  // Free a bed after discharge / death / transfer: local + cloud, then home.
  // A copy of the labs / lab history kept with the archived record
  function clinicalCopy(v, empty) {
    try { return v ? JSON.parse(JSON.stringify(v)) : empty; } catch (e) { return empty; }
  }

  // ---- Undo for delete / discharge / death ----
  // The bed is emptied on this device at once, but nothing reaches the
  // cloud (archive record, notification, cloud delete) for UNDO_MS: «تراجع»
  // puts the patient back as if nothing happened. Leaving the page, or a
  // second such action, sends the pending one at once.
  const UNDO_MS = 8000;
  let _pendingExit = null;   // { bedKey, snapshot, commit, timer, tick }
  function deferExit(bedKey, message, commit, opts) {
    commitPendingExit();
    const p = state.patients[bedKey];
    const snapshot = p ? JSON.parse(JSON.stringify(p)) : null;
    Storage.deletePatient(bedKey);
    Storage.saveLocalDeletion(bedKey);
    delete state.patients[bedKey];
    state.currentBed = null;
    // a deleted bed keeps showing the patient (name + info, glitching) until the undo window ends
    const ghost = !!(opts && opts.glitch && snapshot && global.PharmacyFx && global.PharmacyFx.allowed());
    _pendingExit = { bedKey, snapshot, commit, ghost };
    refreshStatsAndRooms();
    UI.showView("home");
    _pendingExit.timer = setTimeout(commitPendingExit, UNDO_MS);
    showUndoToast(message);
    // a deleted bed glitches (cyan / pink) until the undo window ends
    if (opts && opts.glitch && global.PharmacyFx) global.PharmacyFx.glitchBed(bedKey, UNDO_MS + 1500);
  }
  function commitPendingExit() {
    const x = _pendingExit;
    if (!x) return;
    _pendingExit = null;
    clearTimeout(x.timer);
    hideUndoToast();
    if (global.PharmacyFx) global.PharmacyFx.glitchEnd();
    if (x.ghost) refreshStatsAndRooms();            // the ghost bed empties now
    try { if (x.commit) x.commit(); } catch (e) { console.warn("[Undo] commit failed:", e); }
    if (SBSync && SBSync.pushPatientDelete) {
      SBSync.pushPatientDelete(x.bedKey, x.snapshot && x.snapshot.pid).then(r => {
        if (!r.ok) console.warn("[Supabase] bed delete push failed:", r.error);
      });
    }
  }
  function undoPendingExit() {
    const x = _pendingExit;
    if (!x) return;
    _pendingExit = null;
    clearTimeout(x.timer);
    hideUndoToast();
    if (global.PharmacyFx) global.PharmacyFx.glitchEnd();
    Storage.clearLocalDeletion(x.bedKey);
    const occupant = state.patients[x.bedKey];
    if (x.snapshot && !(occupant && occupant.name && occupant.name.trim())) {
      state.patients[x.bedKey] = x.snapshot;
      Storage.putPatient(x.bedKey, x.snapshot);
      if (x.snapshot._dirty && SBSync && SBSync.pushPatient) SBSync.pushPatient(x.bedKey);
    }
    refreshStatsAndRooms();
    flashHint("تم التراجع — المريض في سريره");
  }
  function isPendingExit(bedKey) { return !!(_pendingExit && _pendingExit.bedKey === bedKey); }
  function showUndoToast(message) {
    hideUndoToast();
    const t = document.createElement("div");
    t.id = "undo-toast";
    t.className = "undo-toast";
    t.setAttribute("role", "status");
    const msg = document.createElement("span");
    msg.className = "undo-toast-msg";
    msg.textContent = message;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "undo-toast-btn";
    btn.textContent = "تراجع";
    btn.addEventListener("click", undoPendingExit);
    const bar = document.createElement("span");
    bar.className = "undo-toast-bar";
    bar.style.animationDuration = UNDO_MS + "ms";
    t.appendChild(msg); t.appendChild(btn); t.appendChild(bar);
    document.body.appendChild(t);
  }
  function hideUndoToast() {
    const t = document.getElementById("undo-toast");
    if (t) t.remove();
  }
  // Leaving / hiding the app sends the pending action now
  window.addEventListener("pagehide", commitPendingExit);
  document.addEventListener("visibilitychange", () => { if (document.hidden) commitPendingExit(); });

  function vacateBed(bedKey) {
    Storage.deletePatient(bedKey);
    Storage.saveLocalDeletion(bedKey);
    delete state.patients[bedKey];
    state.currentBed = null;
    refreshStatsAndRooms();
    UI.showView("home");
    if (SBSync && SBSync.pushPatientDelete) {
      SBSync.pushPatientDelete(bedKey).then(r => {
        if (!r.ok) console.warn("[Supabase] bed delete push failed:", r.error);
      });
    }
  }

  // Move a patient to an empty bed in this ward (drag & drop on the
  // rooms view — bed-drag.js, no confirmation). Done on the server in one step
  // (app_move_patient in features.sql): the row and this stay's change
  // history move to the new bed. Returns true on success.
  async function moveBed(fromKey, toKey) {
    const Ward = global.PharmacyWard;
    const parse = (k) => { const m = k.match(/room-(\d+)-bed-(\d+)/); return m ? { roomId: +m[1], bed: +m[2] } : null; };
    const from = parse(fromKey);
    const to = parse(toKey);
    const p = state.patients[fromKey];
    if (!from || !to || fromKey === toKey || !p || !p.name || !p.name.trim()) return false;
    if (blockedByLock(fromKey) || blockedByLock(toKey)) return false;
    const target = state.patients[toKey];
    if (target && target.name && target.name.trim()) {
      flashHint(`السرير مشغول بالمريض "${target.name.trim()}"`);
      return false;
    }
    if (!Ward.ROOMS.some(r => r.id === to.roomId && r.beds.some(b => b.number === to.bed))) return false;
    // No confirmation dialog: the drop itself is the confirmation.

    const client = SB && SB.getClient ? SB.getClient() : null;
    if (!client) { flashHint("النقل يحتاج اتصالاً بالسحابة"); return false; }
    flashHint("جارٍ النقل…");
    // The server moves the cloud row, so it must hold the latest copy
    if (SBSync && SBSync.pushPatients) await SBSync.pushPatients();
    const { error } = await client.rpc("app_move_patient", { p_from: fromKey, p_to: toKey });
    if (error) {
      const msg = error.message || "";
      flashHint(/target_occupied/.test(msg) ? "السرير أصبح مشغولاً — حدّث الصفحة"
        : /app_move_patient/.test(msg) ? "النقل غير مُفعّل بعد — شغّل features.sql في Supabase"
        : /source_empty/.test(msg) ? "لم تُحفظ بيانات المريض في السحابة بعد — أعد المحاولة"
        : /jwt/i.test(msg) ? "انتهت الجلسة — سجّل الدخول من جديد"
        : "تعذّر النقل: " + msg);
      return false;
    }
    state.patients[toKey] = p;
    delete state.patients[fromKey];
    Storage.upsertPatient(toKey, p);
    Storage.deletePatient(fromKey);
    Storage.saveLocalDeletion(fromKey);
    if (Auth && Auth.auditLog) {
      Auth.auditLog("patient_moved",
        `نقل المريض "${p.name}" من ${global.PharmacyWard.roomTitle(from.roomId)} سرير ${global.PharmacyWard.bedLabel(from.roomId, from.bed)} إلى ${global.PharmacyWard.roomTitle(to.roomId)} سرير ${global.PharmacyWard.bedLabel(to.roomId, to.bed)}`);
    }
    refreshStatsAndRooms();
    flashHint(`تم نقل ${p.name.trim()} إلى ${global.PharmacyWard.roomTitle(to.roomId)} سرير ${global.PharmacyWard.bedLabel(to.roomId, to.bed)}`);
    return true;
  }

  // رقم الطبلة: exactly 6 digits
  function toPlateDigits(v) {
    return String(v || "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "").slice(0, 6);
  }
  function isValidPlate(v) { return /^\d{6}$/.test(String(v || "").trim()); }

  // Other patients in the ward with the same plate number (→ [{ key, name }])
  function plateDuplicates(bedKey, plate) {
    plate = String(plate || "").trim();
    if (!plate) return [];
    return Object.keys(state.patients).filter(k => {
      const o = state.patients[k];
      return k !== bedKey && o && o.name && o.name.trim() && String(o.plateNumber || "").trim() === plate;
    }).map(k => ({ key: k, name: state.patients[k].name.trim() }));
  }
  // Warning under the plate field when another patient has the same number
  function updatePlateDupWarning(flash) {
    const box = $("plate-dup-warn");
    if (!box) return;
    const cur = state.currentBed && state.patients[state.currentBed.key];
    const dups = cur ? plateDuplicates(state.currentBed.key, cur.plateNumber) : [];
    if (!dups.length) { box.hidden = true; box.textContent = ""; return; }
    const W = global.PharmacyWard;
    const msg = "⚠ رقم الطبلة مكرر — نفس الرقم للمريض: " +
      dups.map(d => d.name + " (" + W.bedText(d.key) + ")").join("، ");
    box.textContent = msg;
    box.hidden = false;
    if (flash) flashHint(msg);
  }

  // Two patients exchange beds (drag one onto the other) — one server call
  // (app_move… §18 app_swap_patients); each one's history follows them.
  async function swapBeds(aKey, bKey) {
    const W = global.PharmacyWard;
    const a = state.patients[aKey], b = state.patients[bKey];
    if (aKey === bKey || !a || !b || !(a.name || "").trim() || !(b.name || "").trim()) return false;
    if (blockedByLock(aKey) || blockedByLock(bKey)) return false;
    if (!confirm("تبديل السريرين؟\n" + a.name.trim() + " ← " + W.bedText(bKey) + "\n" + b.name.trim() + " ← " + W.bedText(aKey))) return false;
    const client = SB && SB.getClient ? SB.getClient() : null;
    if (!client) { flashHint("التبديل يحتاج اتصالاً بالسحابة"); return false; }
    flashHint("جارٍ التبديل…");
    // The server swaps the cloud rows, so they must hold the latest copies
    if (SBSync && SBSync.pushPatients) await SBSync.pushPatients();
    const { error } = await client.rpc("app_swap_patients", { p_a: aKey, p_b: bKey });
    if (error) {
      const msg = error.message || "";
      flashHint(/app_swap_patients|function/i.test(msg) && /not find|does not exist|schema cache/i.test(msg)
        ? "التبديل غير مُفعّل بعد — شغّل القسم 18 من features.sql في Supabase"
        : /not_two_patients/.test(msg) ? "أحد السريرين لم يعد فيه مريض — حدّث الصفحة"
        : /jwt/i.test(msg) ? "انتهت الجلسة — سجّل الدخول من جديد"
        : "تعذّر التبديل: " + msg);
      return false;
    }
    state.patients[aKey] = b;
    state.patients[bKey] = a;
    Storage.putPatient(aKey, b);
    Storage.putPatient(bKey, a);
    if (Auth && Auth.auditLog) {
      Auth.auditLog("patient_moved", `تبديل سريري "${a.name.trim()}" (${W.bedText(aKey)}) و"${b.name.trim()}" (${W.bedText(bKey)})`);
    }
    refreshStatsAndRooms();
    flashHint(`تم التبديل: ${a.name.trim()} ← ${W.bedText(bKey)} · ${b.name.trim()} ← ${W.bedText(aKey)}`);
    return true;
  }

  // Record lab results typed in the given fields: the previous result of
  // each lab moves to «النتائج السابقة» (with its own date), the new one
  // becomes the current result, dated today.
  function recordLabs(inputs) {
    if (!state.currentBed) return 0;
    const p = ensurePatient(state.currentBed.key);
    if (!p.labs) p.labs = {};
    if (!p.labs._dates || typeof p.labs._dates !== "object") p.labs._dates = {};
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    (inputs || []).forEach(inp => {
      if (!inp || inp.disabled) return;
      const v = String(inp.value || "").trim();
      const key = inp.dataset.labKey, label = inp.dataset.labLabel || key;
      if (!v || !key) return;
      const prev = p.labs[key] ? String(p.labs[key]).trim() : "";
      if (prev) {
        if (!Array.isArray(p.labHistory)) p.labHistory = [];
        p.labHistory.push({ date: p.labs._dates[key] || today, key, label, value: prev });
      }
      p.labs[key] = v;
      p.labs._dates[key] = today;
      inp.value = "";
      n++;
    });
    if (!n) { flashHint("اكتب النتيجة أولاً ثم اضغط ✓"); return 0; }
    persistPatient(state.currentBed.key);
    UI.renderPatientView(state.patients[state.currentBed.key] || null, state.currentBed.roomId, state.currentBed.bed);
    renderGFRCard();
    flashHint(n === 1 ? "✓ سُجّلت النتيجة" : "✓ سُجّلت " + n + " نتائج");
    return n;
  }

  // «تحاليل الورقة»: a checkbox per lab — only the ticked ones are printed
  // on the patient sheet (labs._print; all ticked = everything, the default)
  function renderLabsPrintPanel() {
    const panel = $("labs-print-panel"), btn = $("labs-print-btn");
    if (!panel || !state.currentBed) return;
    const defs = (global.PharmacyPrintSheets && global.PharmacyPrintSheets.LAB_DEFS) || [];
    const p = state.patients[state.currentBed.key] || {};
    const chosen = p.labs && Array.isArray(p.labs._print) && p.labs._print.length ? p.labs._print : null;
    panel.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "labs-print-hint";
    hint.textContent = "التحاليل التي تظهر في ورقة المريض:";
    panel.appendChild(hint);
    const list = document.createElement("div");
    list.className = "labs-print-list";
    const add = (value, label, checked) => {
      const l = document.createElement("label");
      l.className = "labs-print-item" + (value === "__all" ? " is-all" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = value; cb.checked = checked;
      const sp = document.createElement("span");
      sp.textContent = label;
      l.appendChild(cb); l.appendChild(sp);
      list.appendChild(l);
    };
    add("__all", "الكل", !chosen);
    defs.forEach(([label, key]) => add(key, label, !chosen || chosen.indexOf(key) >= 0));
    panel.appendChild(list);
    panel.hidden = false;
    if (btn) { btn.setAttribute("aria-expanded", "true"); btn.classList.add("is-new"); }
  }
  function closeLabsPrintPanel() {
    const panel = $("labs-print-panel"), btn = $("labs-print-btn");
    if (panel) { panel.hidden = true; panel.innerHTML = ""; }
    if (btn) { btn.setAttribute("aria-expanded", "false"); btn.classList.remove("is-new"); }
  }

  // Doctors: the labs (cells + previous results) fold under «عرض التحاليل»
  function setLabsOpen(open) {
    const hdr = $("patient-header"), btn = $("labs-toggle-btn");
    if (hdr) hdr.classList.toggle("labs-open", !!open);
    if (btn) {
      btn.textContent = open ? "إخفاء التحاليل" : "عرض التحاليل";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("is-new", !!open);
    }
  }

  function ensurePatient(bedKey) {
    if (!state.patients[bedKey]) state.patients[bedKey] = { name: "", plateNumber: "", medications: [] };
    if (!Array.isArray(state.patients[bedKey].medications)) {
      state.patients[bedKey].medications = [];
    }
    // Backfill plateNumber for patients created before this field
    // existed (legacy patient objects don't have the property).
    if (!("plateNumber" in state.patients[bedKey])) {
      state.patients[bedKey].plateNumber = "";
    }
    // Backfill age + gender for patients created before these fields
    // existed. Both are optional but should always be defined as a
    // string (never undefined) so the UI can render them safely.
    if (!("age" in state.patients[bedKey])) {
      state.patients[bedKey].age = "";
    }
    if (!("gender" in state.patients[bedKey])) {
      state.patients[bedKey].gender = "";  // "" | "male" | "female"
    }
    // Unit 1 (rooms 1-12) is women's, unit 3 (rooms 13-24) men's:
    // an unset gender comes from the room
    if (!state.patients[bedKey].gender) {
      const m = String(bedKey).match(/room-(\d+)-bed-/);
      const g = m && global.PharmacyWard.roomGender ? global.PharmacyWard.roomGender(m[1]) : "";
      if (g) state.patients[bedKey].gender = g;
    }
    return state.patients[bedKey];
  }
  function persistPatient(bedKey) {
    Storage.upsertPatient(bedKey, state.patients[bedKey]);
    refreshStatsAndRooms();
    // Save THIS patient only (never the whole ward from this device's
    // copy). If someone else saved it meanwhile the two edits are merged.
    if (SBSync && SBSync.pushPatient) {
      const done = (r) => {
        if (r && r.ok && SBSync.adoptSavedVersion) SBSync.adoptSavedVersion(bedKey, state.patients[bedKey]);   // the next edit builds on the saved version
        if (r && r.ok && r.merged) {
          const fresh = Storage.loadPatients()[bedKey];
          if (fresh) state.patients[bedKey] = fresh;
          refreshStatsAndRooms();
          if (state.currentBed && state.currentBed.key === bedKey) renderCurrentPatientSafely();
          flashHint("عدّل شخص آخر هذا المريض للتو — تم دمج التغييرات");
        }
      };
      SBSync.pushPatient(bedKey).then(r => {
        if (r.ok) { done(r); return; }
        console.warn("[Supabase] patient push failed, retrying once:", r.error);
        setTimeout(() => {
          SBSync.pushPatient(bedKey).then(r2 => {
            if (r2.ok) done(r2);
            else console.warn("[Supabase] patient push retry failed:", r2.error);
          });
        }, 2000);
      });
    }
  }

  // ---- Change own password (settings) ----
  function openPasswordDialog() {
    const old = $("password-modal");
    if (old) old.remove();
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const overlay = el("div", "chart-acc-overlay");
    overlay.id = "password-modal";
    const box = el("div", "chart-acc-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.appendChild(el("h3", "chart-acc-title", "تغيير كلمة المرور"));
    const field = (ph) => { const i = el("input", "chart-acc-input"); i.type = "password"; i.placeholder = ph; i.autocomplete = "new-password"; i.dir = "ltr"; return i; };
    const cur = field("كلمة المرور الحالية"); cur.autocomplete = "current-password";
    const nw = field("كلمة المرور الجديدة (" + Auth.MIN_PASSWORD + " أحرف على الأقل)");
    const nw2 = field("أعد كتابة كلمة المرور الجديدة");
    const msg = el("div", "chart-acc-msg");
    const row = el("div", "chart-acc-actions");
    const save = el("button", "sendlog-btn sendlog-resend", "حفظ");
    const cancel = el("button", "sendlog-btn", "إلغاء");
    save.type = "button"; cancel.type = "button";
    row.appendChild(save); row.appendChild(cancel);
    [cur, nw, nw2, msg, row].forEach(x => box.appendChild(x));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(() => cur.focus(), 50);
    const close = () => overlay.remove();
    const show = (t, bad) => { msg.textContent = t; msg.classList.toggle("is-bad", !!bad); };
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    save.addEventListener("click", async () => {
      if (nw.value !== nw2.value) { show("كلمتا المرور الجديدتان غير متطابقتين", true); return; }
      save.disabled = true;
      show("جارٍ الحفظ…");
      const r = await Auth.changeOwnPassword(cur.value, nw.value);
      save.disabled = false;
      if (!r.ok) { show(r.error, true); return; }
      close();
      flashHint("✓ تم تغيير كلمة المرور");
    });
  }

  // ---- Don't redraw the patient card under someone's fingers ----
  // A change from another device arriving while a field of the open
  // patient is focused is applied to the data at once, but the card is
  // redrawn only when the focus leaves the field.
  let _renderDeferred = false;
  function isTypingInPatientView() {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#view-patient") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function renderCurrentPatientSafely() {
    if (!state.currentBed) return;
    if (!isTypingInPatientView()) {
      UI.renderPatientView(state.patients[state.currentBed.key] || null, state.currentBed.roomId, state.currentBed.bed);
      return;
    }
    if (_renderDeferred) return;
    _renderDeferred = true;
    const view = $("view-patient");
    let timer = null;
    const finish = () => {
      if (isTypingInPatientView()) return;      // still in a field (or moved to another)
      view.removeEventListener("focusout", onOut);
      clearInterval(timer);
      _renderDeferred = false;
      if (state.currentBed) {
        UI.renderPatientView(state.patients[state.currentBed.key] || null, state.currentBed.roomId, state.currentBed.bed);
      }
    };
    const onOut = () => setTimeout(finish, 0);
    view.addEventListener("focusout", onOut);
    timer = setInterval(finish, 1000);          // backup when no focusout arrives
  }

  // Flush any pending patient changes to Storage + Supabase. Called
  // when the user navigates away from the patient page (back button,
  // room grid tap, etc.) to ensure click-based changes (gender
  // toggle, lab values) — which don't fire blur events — are still
  // persisted before the current bed is cleared.
  // Did this patient change since the last copy the cloud confirmed? A card that was only opened and left
  // must NOT be saved: a stale copy (the bed was reused meanwhile) would be written over the new patient.
  function hasUnsavedEdits(p) {
    const PM = global.PharmacyPatientMerge;
    if (!p) return false;
    if (!p._base || !PM) return true;                    // never synced: a new patient — save it
    return JSON.stringify(PM.snapshot(p)) !== JSON.stringify(p._base);
  }
  function flushPendingPatientChanges() {
    if (!state.currentBed) return;
    const bedKey = state.currentBed.key;
    const p = state.patients[bedKey];
    if (!p) return;
    if (!hasUnsavedEdits(p)) return;
    persistPatient(bedKey);
  }

  // -------- GFR (eGFR) card --------
  // The CKD-EPI 2021 calculation lives in clinical.js.
  function calculateGFR(patient) {
    return Clinical.calculateGFR(patient);
  }

  // Renders the GFR card based on the current patient (if any).
  // Hides the card when the calculation can't be performed.
  function renderGFRCard() {
    const card = document.getElementById("gfr-card");
    const valueEl = document.getElementById("gfr-value");
    const stageEl = document.getElementById("gfr-stage");
    const formulaEl = document.getElementById("gfr-formula");
    if (!card) return;

    let result = null;
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key];
      result = calculateGFR(p);
      // Renal dose alerts depend on eGFR — keep the med cards in step.
      if (p && UI.renderMedsSection) UI.renderMedsSection(p);
    }
    if (!result) {
      card.hidden = true;
      // Clean up any stage classes so the card starts fresh next time
      ["g1","g2","g3a","g3b","g4","g5"].forEach(s => card.classList.remove("stage-" + s));
      if (valueEl) valueEl.textContent = "—";
      if (stageEl) stageEl.textContent = "";
      return;
    }
    card.hidden = false;
    if (valueEl) valueEl.textContent = String(result.gfr);
    if (stageEl) stageEl.textContent = result.stageLabel;
    if (formulaEl) formulaEl.textContent = "CKD-EPI 2021";
    // Apply stage color class (remove all, then add the right one)
    ["g1","g2","g3a","g3b","g4","g5"].forEach(s => card.classList.remove("stage-" + s));
    card.classList.add("stage-" + result.stage);

    // Cockcroft-Gault CrCl (needs weight) — what the dose alerts use
    const crclEl = $("gfr-crcl");
    if (crclEl) {
      const p = state.currentBed ? state.patients[state.currentBed.key] : null;
      const c = Clinical.calculateCrCl(p);
      crclEl.textContent = "";
      crclEl.classList.toggle("is-hint", !c);
      if (c) {
        const value = document.createElement("div");
        value.className = "gfr-crcl-value";
        value.dir = "ltr";
        value.textContent = `CrCl ${c.crcl} mL/min · Cockcroft-Gault`;
        const basis = document.createElement("div");
        basis.className = "gfr-crcl-basis";
        basis.textContent = `على ${c.basisLabel} (${c.weightUsed} kg) — تُستخدم لتنبيهات الجرعات`;
        crclEl.append(value, basis);
      } else {
        crclEl.textContent = "أضف الوزن لحساب CrCl (أدق لجرعات الأدوية من eGFR)";
      }
    }
  }

  // Expose so other event handlers in this IIFE can trigger a recompute.
  // (Also exposed to ui.js renderPatientView so the card refreshes when
  // a patient is loaded/switched.)
  global._renderGFRCard = renderGFRCard;

  // -------- Previous admission banner --------
  // When the patient view is opened, we look up the discharged list for
  // a record whose name matches this patient's name (case-insensitive,
  // trimmed). If found, we render a small yellow banner inside the
  // patient header showing the most recent final diagnosis + date so
  // the doctor can see prior history at a glance.
  //
  // Matching uses name only (not plate number) because plate numbers
  // are optional and patients may forget them between admissions. We
  // sort discharged records by dischargedAt desc so the banner shows
  // the LATEST final diagnosis if the patient has been admitted multiple
  // times before.
  function renderPreviousAdmissionBanner(patient) {
    // Always remove any previously inserted banner first.
    const patientHeader = document.querySelector(".patient-header");
    if (patientHeader) {
      const existing = patientHeader.querySelector(".previous-admission-banner");
      if (existing) existing.remove();
    }
    if (!patient || !patient.name || !patient.name.trim()) return;
    const name = patient.name.trim().toLowerCase();
    const discharged = Storage.loadDischarged();
    if (!Array.isArray(discharged) || discharged.length === 0) return;
    // Find all discharged records with the same name (case-insensitive)
    const matches = discharged.filter(r =>
      r && r.name && r.name.trim().toLowerCase() === name
    );
    if (matches.length === 0) return;
    // discharged is stored newest-first (unshift), so the first match
    // is the latest discharge. But to be safe, sort by dischargedAt.
    matches.sort((a, b) => {
      const aT = a.dischargedAt ? new Date(a.dischargedAt).getTime() : 0;
      const bT = b.dischargedAt ? new Date(b.dischargedAt).getTime() : 0;
      return bT - aT;
    });
    const latest = matches[0];
    const finalDx = (latest.finalDiagnosis && String(latest.finalDiagnosis).trim())
      ? String(latest.finalDiagnosis).trim()
      : "";
    if (!finalDx) return;  // no final diagnosis recorded — skip banner
    const dateStr = latest.dischargedAt
      ? new Date(latest.dischargedAt).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
      : "";

    // Clone the template + fill it in
    const template = document.getElementById("previous-admission-template");
    if (!template || !template.content) return;
    const banner = template.content.cloneNode(true);
    const valueEl = banner.querySelector(".previous-admission-value");
    const dateEl = banner.querySelector(".previous-admission-date");
    if (valueEl) valueEl.textContent = finalDx;
    if (dateEl) dateEl.textContent = dateStr ? `· تاريخ الخروج: ${dateStr}` : "";
    if (patientHeader) {
      patientHeader.appendChild(banner);
    }
  }
  global._renderPreviousAdmissionBanner = renderPreviousAdmissionBanner;

  // -------- Clinical alerts after adding meds --------
  // Interactions, renal dosing, allergies, duplicates and antibiotic
  // duration all come from clinical.js. Shows one combined dialog for
  // the alerts that concern the newly added meds (+ any interaction).
  function showClinicalAlertsForNewMeds(patient, firstNewIndex) {
    const res = Clinical.medAlerts(patient);
    const lines = [];
    res.interactions.forEach(a => lines.push((a.severity === "danger" ? "🔴 " : "🟡 ") + a.msg));
    res.byMed.forEach((list, i) => {
      if (i < firstNewIndex) return;
      const m = patient.medications[i];
      const name = (m && (m.nameEn || m.nameTrade || m.id)) || "";
      list.forEach(a => lines.push((a.level === "danger" ? "🔴 " : "🟡 ") + name + " — " + a.msg));
    });
    if (lines.length === 0) return;
    alert("⚠ تنبيهات سريرية (للتحقق — لا تمنع الإضافة):\n\n" + lines.join("\n"));
  }

  // -------- PWA install button (Android Chrome / Edge / etc.) --------
  // The browser fires `beforeinstallprompt` when it considers the
  // site installable (manifest + SW + served over HTTPS). We capture
  // the event, show the install button, and on click call prompt().
  // On iOS Safari there's no `beforeinstallprompt` — the user must
  // tap Share → Add to Home Screen manually. We detect iOS and show
  // a one-time hint explaining how to do it.
  let deferredInstallPrompt = null;

  function bindPwaInstall() {
    const btn = $("install-app-btn");
    if (!btn) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    // If already installed/running as standalone, hide the button.
    if (isStandalone) {
      btn.hidden = true;
      return;
    }

    // Always show the install button on the login screen (not just
    // when the browser fires beforeinstallprompt — Chrome on desktop
    // sometimes never fires it even when the app is technically
    // installable, and we want the user to always have a way to
    // install via the button).
    btn.hidden = false;

    // Capture the event when it does fire so we can use the native
    // prompt (better UX than instructions).
    window.addEventListener("beforeinstallprompt", (e) => {
      // Prevent the mini-infobar from showing on Android Chrome
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    btn.addEventListener("click", async () => {
      // iOS Safari → show instructions (no native prompt available)
      if (isIOS && !deferredInstallPrompt) {
        showIosInstallHint();
        return;
      }
      // Android/Chrome with native prompt → use it
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") {
          flashHint("تم تثبيت التطبيق على جهازك");
        }
        deferredInstallPrompt = null;
        btn.hidden = true;
        return;
      }
      // No native prompt available (desktop Chrome without
      // engagement, Firefox, etc.) → show generic browser-menu
      // instructions.
      showGenericInstallHint();
    });

    // Once installed, hide the button for good.
    window.addEventListener("appinstalled", () => {
      btn.hidden = true;
      flashHint("تم تثبيت التطبيق بنجاح");
    });
  }

  function showGenericInstallHint() {
    // Generic instructions for browsers without a native prompt.
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
    const isEdge   = /Edg/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);

    let browserName = "متصفحك";
    let steps = "";
    if (isChrome) {
      browserName = "Google Chrome";
      steps = "1) افتح قائمة Chrome (⋮ في أعلى اليمين)\n2) اختر \"تثبيت التطبيق\" أو \"Install app\"\n3) اضغط \"تثبيت\"";
    } else if (isEdge) {
      browserName = "Microsoft Edge";
      steps = "1) افتح قائمة Edge (⋯ في أعلى اليمين)\n2) اختر \"التطبيقات\" → \"تثبيت هذا الموقع كتطبيق\"\n3) اضغط \"تثبيت\"";
    } else if (isFirefox) {
      browserName = "Firefox";
      steps = "1) لا يدعم Firefox تثبيت PWA رسميًا\n2) يمكنك إضافة اختصار للصفحة الرئيسية بدلاً من ذلك";
    } else {
      steps = "ابحث في قائمة المتصفح عن خيار \"تثبيت التطبيق\" أو \"Install app\"";
    }
    alert(
      "لتثبيت التطبيق عبر " + browserName + ":\n\n" + steps + "\n\n" +
      "ملاحظة: يجب فتح الموقع عبر HTTPS حتى يتوفر خيار التثبيت."
    );
  }

  function showIosInstallHint() {
    // Lightweight instructions for iOS Safari (no native prompt).
    confirm(
      "لتثبيت التطبيق على iPhone/iPad:\n\n" +
      "1) افتح هذا الرابط في متصفح Safari\n" +
      "2) اضغط زر المشاركة (المربع مع السهم لأعلى)\n" +
      "3) اختر \"إضافة إلى الشاشة الرئيسية\"\n" +
      "4) اضغط \"إضافة\"\n\n" +
      "هل تريد إغلاق هذه الرسالة؟"
    );
  }

  // -------- Event wiring --------
  function bindEvents() {
    // Room/bed tap (event delegation on rooms grid)
    $("rooms-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".bed-btn");
      if (!btn) return;
      openPatient({
        key:    btn.dataset.key,
        roomId: parseInt(btn.dataset.roomId, 10),
        bed:    parseInt(btn.dataset.bed, 10)
      });
    });

    // Patients list tap
    $("patients-list").addEventListener("click", (e) => {
      const row = e.target.closest(".patient-row");
      if (!row) return;
      openPatient({
        key:    row.dataset.key,
        roomId: parseInt(row.dataset.roomId, 10),
        bed:    parseInt(row.dataset.bed, 10)
      });
    });

    // Patient name input — save on blur, debounced
    // Patient name input — save ONLY on blur (not debounced during typing).
    // The user specifically requested: "do not sync the patient name +
    // info until the user leaves the patient page." This means:
    //   - While typing the name → update local state.patients[key].name
    //     only (no Storage save, no Supabase push)
    //   - On blur → save to Storage + push to Supabase (this is the
    //     existing blur handler below which also fires pushNotification)
    let nameTimer = null;
    $("patient-name-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.name = e.target.value;
      // NOTE: We intentionally do NOT call persistPatient() here.
      // The name + info sync happens only on blur (when the user
      // leaves the patient page). This prevents the app from
      // pushing half-typed names to Supabase every 400ms, which
      // was causing cross-device sync noise + triggering
      // unnecessary Realtime updates on the pharmacist's device.
      // Live-update the previous-admission banner as the user types a
      // name. This way if they're entering a returning patient, the
      // banner appears immediately (without waiting for blur).
      renderPreviousAdmissionBanner(p);
    });

    // Plate number input (optional) — save ONLY on blur (not debounced
    // during typing). Same reasoning as the name input: don't sync
    // patient info to Supabase until the user leaves the field/page.
    let plateTimer = null;
    $("patient-plate-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      // 6 digits only (Arabic-Indic digits become 0-9)
      const digits = toPlateDigits(e.target.value);
      if (digits !== e.target.value) e.target.value = digits;
      const p = ensurePatient(state.currentBed.key);
      p.plateNumber = digits;
      if (isValidPlate(digits)) e.target.classList.remove("is-required-missing");
      updatePlateDupWarning(false);
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-plate-input").addEventListener("blur", (e) => {
      if (!state.currentBed) return;
      clearTimeout(plateTimer);
      if (e.target.value && !isValidPlate(e.target.value)) {
        e.target.classList.add("is-required-missing");
        flashHint("رقم الطبلة يتكون من 6 أرقام");
      } else {
        updatePlateDupWarning(true);
      }
      persistPatient(state.currentBed.key);
    });

    // Age (العمر) — numeric input. Saved ONLY on blur. Validated to
    // digits-only and capped at 3 chars (oldest human age possible).
    let ageTimer = null;
    $("patient-age-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      // Strip non-digits — keeps the field clean even if the user
      // pastes a value like "45 years".
      const cleaned = (e.target.value || "").replace(/\D/g, "").slice(0, 3);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      p.age = cleaned;
      // NOTE: No persistPatient() on input — only on blur.
      // Recompute GFR immediately for instant visual feedback (no
      // Supabase push, just local UI update).
      renderGFRCard();
    });
    $("patient-age-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(ageTimer);
      persistPatient(state.currentBed.key);
      renderGFRCard();
    });

    // Weight / height (kg / cm) → CrCl. Stored inside labs so they sync
    // with the existing column; editable by every role, like age.
    [["patient-weight-input", "weight"], ["patient-height-input", "height"]].forEach(([id, key]) => {
      $(id).addEventListener("input", (e) => {
        if (!state.currentBed) return;
        const cleaned = (e.target.value || "").replace(/[^\d.]/g, "").slice(0, 5);
        if (e.target.value !== cleaned) e.target.value = cleaned;
        const p = ensurePatient(state.currentBed.key);
        p.labs = p.labs || {};
        if (cleaned) p.labs[key] = cleaned; else delete p.labs[key];
        renderGFRCard();
      });
      $(id).addEventListener("blur", () => {
        if (!state.currentBed) return;
        persistPatient(state.currentBed.key);
      });
    });

    // Gender (الجنس) — segmented toggle with two buttons (ذكر / أنثى).
    // Clicking a button sets patient.gender to that value; clicking the
    // already-active button deselects it (sets gender to "" — unknown).
    // The CSS uses .is-active to render the selected state.
    const maleBtn = $("patient-gender-male");
    const femaleBtn = $("patient-gender-female");
    function setGenderState(p, btn) {
      const isMale = btn === maleBtn;
      const value = isMale ? "male" : "female";
      if (!p) return;
      if (p.gender === value) {
        // Toggle off — clicking the active button clears the selection.
        p.gender = "";
      } else {
        p.gender = value;
      }
      // NOTE: We intentionally do NOT call persistPatient() here.
      // The gender is saved to Supabase only when the user leaves
      // the patient page (via the blur handlers on the other
      // patient-info fields, OR when the user navigates away from
      // the patient view). This matches the user's request: "do
      // not sync patient info until the user leaves the page."
      //
      // We DO update the local UI immediately so the toggle visual
      // + GFR card reflect the new gender.
      syncGenderButtons(p.gender);
      // Recompute GFR (gender is one of the three required inputs).
      renderGFRCard();
    }
    function syncGenderButtons(gender) {
      if (maleBtn) {
        maleBtn.classList.toggle("is-active", gender === "male");
        maleBtn.setAttribute("aria-pressed", gender === "male" ? "true" : "false");
      }
      if (femaleBtn) {
        femaleBtn.classList.toggle("is-active", gender === "female");
        femaleBtn.setAttribute("aria-pressed", gender === "female" ? "true" : "false");
      }
    }
    if (maleBtn) maleBtn.addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      setGenderState(p, maleBtn);
    });
    if (femaleBtn) femaleBtn.addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      setGenderState(p, femaleBtn);
    });
    // Expose so renderPatientView in ui.js can sync the buttons when
    // a patient is loaded (the function is called from ui.js).
    global._syncGenderButtons = syncGenderButtons;

    // Doctor (الطبيب المعالج) — free-text field. Each patient has ONE
    // attending physician (the specialist who manages the patient's
    // care — not the doctor using the app, who may be a resident
    // covering the ward). The attending physician is shown on the bed
    // buttons in the rooms grid + on the printed patient sheet.
    // Saved ONLY on blur (not debounced during typing) — same as the
    // other patient info fields.
    let doctorTimer = null;
    $("patient-doctor-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.doctor = e.target.value;
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-doctor-input").addEventListener("focus", refreshSpecialistsList);
    $("patient-doctor-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(doctorTimer);
      unifySpecialistName(state.currentBed.key);
      persistPatient(state.currentBed.key);
    });

    // Diagnosis (التشخيص) — free-text field, editable by doctors +
    // admins only. Pharmacists can see it (display-only). Stored on
    // the patient record and shown on bed buttons + patient sheets +
    // the ABX monitoring table.
    // Saved ONLY on blur — same as the other patient info fields.
    let diagnosisTimer = null;
    $("patient-diagnosis-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.diagnosis = e.target.value;
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-diagnosis-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(diagnosisTimer);
      persistPatient(state.currentBed.key);
    });

    // Drug allergies — a button that opens / closes the allergy list
    $("allergy-toggle").addEventListener("click", () => {
      const panel = $("allergy-panel");
      const open = panel.hidden;
      panel.hidden = !open;
      $("allergy-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    });
    // "Other" field: only the allergies that aren't in the list; saved
    // on blur (alerts refresh then).
    $("patient-allergies-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.allergies = Clinical.joinAllergies(Clinical.splitAllergies(p.allergies).known, e.target.value);
      const summary = $("allergy-summary");
      if (summary) summary.textContent = p.allergies || "لا يوجد";
    });
    $("patient-allergies-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });
    // List rows tick / untick an allergy class
    $("allergy-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".allergy-chip");
      if (!chip || !state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      const parts = Clinical.splitAllergies(p.allergies);
      const label = chip.dataset.allergy;
      const at = parts.known.indexOf(label);
      if (at >= 0) parts.known.splice(at, 1); else parts.known.push(label);
      p.allergies = Clinical.joinAllergies(parts.known, parts.other.join("، "));
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });

    // Lab values — 9 fields. Each field has an input + a "+" button.
    // The input stores the current (latest) value in p.labs[key].
    // The "+" button archives the current value into p.labHistory
    // (array of {date, key, label, value}) and clears the input for
    // a new entry. Editable by doctors + admins only (like diagnosis).
    const LAB_KEYS = ["creatinine","albumin","wbc","hb","plt","na","k","glucose","crp"];
    const LAB_LABELS = {
      creatinine:"S. Creatinine", albumin:"S. Albumin", wbc:"WBC",
      hb:"Hb", plt:"PLT", na:"Na+", k:"K+", glucose:"Glucose", crp:"CRP"
    };
    let labTimer = null;

    // Delegated click handler for "+" buttons
    document.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".lab-add-btn");
      if (!addBtn || !state.currentBed) return;
      const input = addBtn.parentElement && addBtn.parentElement.querySelector(".lab-input");
      recordLabs([input]);
    });

    // «تحاليل الورقة» (doctor + admin): which labs the patient sheet prints
    const labsPrintBtn = $("labs-print-btn");
    if (labsPrintBtn) labsPrintBtn.addEventListener("click", () => {
      const panel = $("labs-print-panel");
      if (panel && panel.hidden) renderLabsPrintPanel(); else closeLabsPrintPanel();
    });
    const labsPrintPanel = $("labs-print-panel");
    if (labsPrintPanel) labsPrintPanel.addEventListener("change", (e) => {
      const cb = e.target;
      if (!cb || cb.type !== "checkbox" || !state.currentBed) return;
      const defs = (global.PharmacyPrintSheets && global.PharmacyPrintSheets.LAB_DEFS) || [];
      const all = defs.map(d => d[1]);
      const p = ensurePatient(state.currentBed.key);
      if (!p.labs || typeof p.labs !== "object") p.labs = {};
      let sel = Array.isArray(p.labs._print) && p.labs._print.length ? p.labs._print.slice() : all.slice();
      if (cb.value === "__all") sel = all.slice();
      else if (cb.checked) { if (sel.indexOf(cb.value) < 0) sel.push(cb.value); }
      else sel = sel.filter(k => k !== cb.value);
      if (!sel.length) { flashHint("اختر تحليلاً واحداً على الأقل"); renderLabsPrintPanel(); return; }
      if (sel.length >= all.length) delete p.labs._print;
      else p.labs._print = all.filter(k => sel.indexOf(k) >= 0);
      persistPatient(state.currentBed.key);
      renderLabsPrintPanel();
    });

    // Doctors' labs section: hidden until «عرض التحاليل» is pressed
    const labsToggle = $("labs-toggle-btn");
    if (labsToggle) labsToggle.addEventListener("click", () => setLabsOpen(!$("patient-header").classList.contains("labs-open")));
    // Enter in a lab field records it
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (e.key !== "Enter" || !t || !t.classList || !t.classList.contains("lab-input")) return;
      e.preventDefault();
      recordLabs([t]);
    });

    // (Typing in a lab field doesn't change the recorded result — only ✓ /
    // Enter / «تسجيل التحاليل» do: recordLabs.)

    $("patient-name-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(nameTimer);
      const p = state.patients[state.currentBed.key];
      // Erasing the name of a saved patient would delete them — only the
      // admin may delete a patient, so everyone else gets the name back.
      const saved = Storage.loadPatients()[state.currentBed.key];
      if (p && (!p.name || !p.name.trim()) && saved && saved.name && saved.name.trim() &&
          !(Auth && ((Auth.isPharmacist && Auth.isPharmacist()) || (Auth.canExitPatients && Auth.canExitPatients())))) {
        p.name = saved.name;
        $("patient-name-input").value = saved.name;
        flashHint("لا يمكن حذف المريض");
        return;
      }
      // collapse empty-name patient (no name and no meds)
      if (p && (!p.name || !p.name.trim()) && (!p.medications || p.medications.length === 0)) {
        const bedKey = state.currentBed.key;
        Storage.deletePatient(bedKey);
        Storage.saveLocalDeletion(bedKey);
        delete state.patients[bedKey];
        if (SBSync && SBSync.pushPatientDelete) {
          SBSync.pushPatientDelete(bedKey).then(r => {
            if (!r.ok) console.warn("[Supabase] auto-collapse delete failed:", r.error);
          });
        }
      } else {
        persistPatient(state.currentBed.key);
        // Notify pharmacist if a doctor just named/added a new patient
        if (p && p.name && p.name.trim()) {
          const roomStr = `${global.PharmacyWard.roomTitle(state.currentBed.roomId)}`;
          pushNotification("patient_added",
            `إضافة مريض: ${p.name.trim()} — ${roomStr}`,
            p.name.trim(), roomStr);
        }
      }
      refreshStatsAndRooms();
    });

    // Back button — flush any pending patient info changes (e.g.
    // gender toggle, GFR, lab values) to Storage + Supabase BEFORE
    // leaving the patient page. This ensures changes made via
    // click-based controls (gender buttons) — which don't fire blur
    // events — are still persisted when the user navigates away.
    $("back-btn").addEventListener("click", () => {
      flushPendingPatientChanges();
      state.currentBed = null;
      UI.showView("home");
    });

    // Open sheet (in patient view) — single binding
    $("open-med-sheet").addEventListener("click", openSheetFromPatientView);

    // Print patient sheet (A4) — opens a new window with a printable
    // patient sheet: doctor name + patient name + room + date at the
    // top, medications list on the left, vital signs grid on the right.
    // Designed for doctors to print and put at the patient's bedside.
    // Pills form for THIS patient (doctor sets ½ / 2 tablets when
    // prescribing, then prints straight away)
    $("print-patient-pills-btn").addEventListener("click", async () => {
      if (!state.currentBed || (Auth && Auth.isDoctor() && !Auth.isAdmin())) return;
      const p = state.patients[state.currentBed.key] || null;
      if (!p || !p.name || !p.name.trim()) { flashHint("أضف اسم المريض أولاً"); return; }
      flushPendingPatientChanges();
      flashHint("يتم تجهيز معاينة استمارة الحبوب…");
      try {
        const r = await global.PharmacyPillsForm.previewPillsForms(state, { bedKey: state.currentBed.key });
        if (r && r.cancelled) return;
        flashHint(r && r.error ? r.error : "تم تنزيل استمارة الحبوب لـ " + p.name.trim());
      } catch (err) {
        flashHint("تعذّر توليد الاستمارة: " + (err.message || err));
      }
    });

    // Pharmacists: look at the patient's sheet (to check it against the
    // doctor's printed one) — view only, with zoom
    $("view-patient-sheet-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key] || null;
      if (!p || !p.name || !p.name.trim()) { flashHint("أضف اسم المريض أولاً"); return; }
      global.PharmacyPrintSheets.preview([{ patient: p, currentBed: state.currentBed }], { viewOnly: true });
    });

    $("print-patient-sheet-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key] || null;
      if (!p || !p.name || !p.name.trim()) {
        flashHint("أضف اسم المريض أولاً");
        return;
      }
      printPatientSheet(p, state.currentBed);
    });

    // Meds list — delete & edit (event delegation)
    $("meds-list").addEventListener("click", (e) => {
      // Antibiotic day chip → correct the course day
      const dayBtn = e.target.closest('[data-action="abx-day"]');
      if (dayBtn && state.currentBed) {
        const p = state.patients[state.currentBed.key];
        const med = p && p.medications && p.medications[parseInt(dayBtn.dataset.medIndex, 10)];
        if (!med) return;
        const cur = Clinical.abxDay(med, p);
        const answer = prompt(`اليوم الحالي لهذا المضاد؟ (1 = بدأ اليوم)`, cur ? String(cur) : "1");
        if (answer === null) return;
        if (!Clinical.setAbxDay(med, answer)) { flashHint("أدخل رقماً بين 1 و 365"); return; }
        persistPatient(state.currentBed.key);
        refreshPatientViewOnly();
        return;
      }
      const del = e.target.closest('[data-action="delete-med"]');
      if (!del || !state.currentBed) return;
      const idx = parseInt(del.dataset.medIndex, 10);
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const removedMed = p.medications[idx];
      const removedName = removedMed && (removedMed.nameTrade || removedMed.nameAr || removedMed.id) || "(دواء)";
      p.medications.splice(idx, 1);
      // Audit log — record the med-delete action
      if (Auth && Auth.auditLog) {
        const roomBed = global.PharmacyWard.bedText(state.currentBed.key);
        Auth.auditLog("med_deleted",
          `حذف دواء "${removedName}" من المريض "${p.name || "(بدون اسم)"}" في ${roomBed}`);
      }
      // Note: the 5cc Syringe is now injected at print-time only
      // (in ui.js buildChartReport), not stored on the patient. So
      // we don't need to recompute anything when a med is deleted.
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
      pushNotification("med_changed",
        `حذف دواء "${removedName}" من ${p.name || "(بدون اسم)"} — ${global.PharmacyWard.roomTitle(state.currentBed.roomId)}`,
        p.name || "", `${global.PharmacyWard.roomTitle(state.currentBed.roomId)}`);
    });
    $("meds-list").addEventListener("input", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex) return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      if (t.dataset.field === "dose") {
        p.medications[idx].dose = t.value;
      } else if (t.dataset.field === "frequency") {
        p.medications[idx].frequency = t.value;
      }
      clearTimeout(p._saveTimer);
      p._saveTimer = setTimeout(() => {
        // Note: the 5cc Syringe is now print-time only, so we don't
        // recompute anything when the user edits a med.
        persistPatient(state.currentBed.key);
        refreshPatientViewOnly();
      }, 400);
    });
    $("meds-list").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex || (t.dataset.field !== "frequency" && t.dataset.field !== "mode")) return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      const med = p.medications[idx];
      // a legacy "Infusion 24h"/"Bolus" frequency becomes mode + 1×1 on first edit
      if (Meds.isLegacyModeFreq && Meds.isLegacyModeFreq(med.frequency)) {
        if (!med.mode) med.mode = med.frequency.trim();
        med.frequency = "1×1";
      }
      if (t.dataset.field === "mode") {
        if (t.value) med.mode = t.value; else delete med.mode;
      } else {
        med.frequency = t.value;
      }
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });

    // Delete patient
    $("delete-patient").addEventListener("click", () => {
      if (!state.currentBed) return;
      // Deleting a patient: the admin and the pharmacists (they have no discharge)
      if (!(Auth && ((Auth.isPharmacist && Auth.isPharmacist()) || (Auth.canExitPatients && Auth.canExitPatients())))) { flashHint("حذف المريض غير متاح"); return; }
      const p = state.patients[state.currentBed.key];
      const name = p && p.name ? p.name : "";
      const msg = name
        ? `هل تريد تفريغ السرير وحذف المريض "${name}"؟`
        : "هل تريد تفريغ هذا السرير؟";
      if (!confirm(msg)) return;
      const bedKey = state.currentBed.key;
      // The cloud delete (single bed, never bulk) + audit log wait for «تراجع»
      deferExit(bedKey, name ? `تم حذف المريض "${name.trim()}"` : "تم تفريغ السرير", () => {
        if (Auth && Auth.auditLog) {
          const roomBed = global.PharmacyWard.bedText(bedKey);
          Auth.auditLog("patient_deleted",
            `حذف المريض "${name}" من ${roomBed}`);
        }
        // the others (the admin first) hear about it — a pharmacist's only way to take a patient off the ward
        pushNotification("patient_deleted",
          name ? `حذف المريض: ${name.trim()} — ${global.PharmacyWard.bedText(bedKey)}` : `تفريغ سرير — ${global.PharmacyWard.bedText(bedKey)}`,
          name ? name.trim() : "", global.PharmacyWard.bedText(bedKey));
      }, { glitch: true });
    });

    // ----- Discharge patient (خروج) -----
    // Opens a modal that REQUIRES the user to enter a final diagnosis
    // before the patient can be discharged. The final diagnosis is
    // stored on the discharged record (Storage.addDischarged) so it
    // can be retrieved if the patient is readmitted later.
    //
    // Old behavior used a plain confirm() dialog. We now use a custom
    // modal because:
    //   1. The final diagnosis is required (can't skip)
    //   2. We want to show the patient's existing diagnosis (if any)
    //      as a reference so the doctor can compare / copy it
    //   3. A modal gives more space for the textarea input
    let _dischargePending = null;  // holds {bedKey, patient, record}
    // Pharmacists do NOT discharge / record death (they delete the bed instead) unless
    // the admin granted them canExitPatients.
    function exitAllowed(p) {
      const isPharm = Auth && Auth.isPharmacist && Auth.isPharmacist();
      return !isPharm || !!(Auth.canExitPatients && Auth.canExitPatients());
    }

    function openDischargeModal() {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !p.name || !p.name.trim()) return;
      if (!exitAllowed(p)) { flashHint("الخروج لمرضى الردهة من صلاحية الطبيب"); return; }

      _dischargePending = {
        bedKey: state.currentBed.key,
        patient: p,
        roomId: state.currentBed.roomId,
        bed: state.currentBed.bed
      };

      // Show the modal
      const overlay = $("discharge-overlay");
      const modal = $("discharge-modal");
      if (overlay) overlay.hidden = false;
      if (modal) modal.hidden = false;

      // Fill in the patient name + diagnosis-at-admission reference
      const nameEl = $("discharge-patient-name");
      if (nameEl) nameEl.textContent = p.name.trim();

      const prevEl = $("discharge-previous-diagnosis");
      const prevValEl = $("discharge-previous-value");
      if (p.diagnosis && String(p.diagnosis).trim()) {
        if (prevValEl) prevValEl.textContent = String(p.diagnosis);
        if (prevEl) prevEl.hidden = false;
      } else {
        if (prevEl) prevEl.hidden = true;
      }

      // Clear the textarea + error
      const inputEl = $("discharge-final-diagnosis");
      if (inputEl) {
        inputEl.value = "";
        // Pre-fill with the admission diagnosis as a starting point
        // so the doctor can just append "resolved" or similar.
        // The user can clear it if they want.
        if (p.diagnosis && String(p.diagnosis).trim()) {
          inputEl.value = String(p.diagnosis);
          inputEl.select();
        }
        setTimeout(() => inputEl && inputEl.focus(), 50);
      }
      const errEl = $("discharge-error");
      if (errEl) errEl.hidden = true;
    }

    function closeDischargeModal() {
      const overlay = $("discharge-overlay");
      const modal = $("discharge-modal");
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
      _dischargePending = null;
    }

    function confirmDischarge() {
      if (!_dischargePending) return;
      const inputEl = $("discharge-final-diagnosis");
      const errEl = $("discharge-error");
      const finalDiagnosis = (inputEl && inputEl.value || "").trim();
      if (!finalDiagnosis) {
        if (errEl) errEl.hidden = false;
        if (inputEl) inputEl.focus();
        return;
      }
      const { bedKey, patient: p, roomId, bed } = _dischargePending;
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      const record = {
        name:            p.name.trim(),
        plateNumber:     p.plateNumber || "",
        doctor:          p.doctor || "",
        age:             p.age || "",
        gender:          p.gender || "",
        diagnosis:       p.diagnosis || "",           // diagnosis at admission
        finalDiagnosis:  finalDiagnosis,             // diagnosis at discharge (NEW — required)
        medications:     clinicalCopy(p.medications, []),
        labs:        clinicalCopy(p.labs, {}),
        labHistory:  clinicalCopy(p.labHistory, []),
        allergies:   p.allergies || "",
        roomNumber:      roomId,
        bedNumber:       bed,
        originWard:      p.originWard || "",
        originLabel:     global.PharmacyBoarders.label(p),
        dischargedAt:    new Date().toISOString(),
        dischargedBy:    user ? user.username : "—"
      };
      closeDischargeModal();
      // Archive + audit + notification wait for «تراجع» (deferExit)
      deferExit(bedKey, "تم تسجيل خروج المريض — بياناته في قائمة «خرجوا»", () => {
        global.PharmacyArchive.add("discharged", record);
        if (Auth && Auth.auditLog) {
          Auth.auditLog("patient_discharged",
            `خروج المريض "${p.name}" من ${global.PharmacyWard.roomTitle(roomId)} سرير ${global.PharmacyWard.bedLabel(roomId, bed)} — تشخيص نهائي: ${finalDiagnosis}`);
        }
        pushNotification("patient_discharged",
          `خروج المريض: ${p.name.trim()} — ${global.PharmacyWard.roomTitle(roomId)}`,
          p.name.trim(), `${global.PharmacyWard.roomTitle(roomId)}`);
      });
    }

    // Discharge button → open modal (instead of confirm)
    $("discharge-patient-btn").addEventListener("click", openDischargeModal);
    // Modal close buttons
    $("discharge-close").addEventListener("click", closeDischargeModal);
    $("discharge-cancel").addEventListener("click", closeDischargeModal);
    $("discharge-overlay").addEventListener("click", closeDischargeModal);
    $("discharge-confirm").addEventListener("click", confirmDischarge);
    // Allow Enter (without Shift) inside the textarea to confirm
    $("discharge-final-diagnosis").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        confirmDischarge();
      }
    });

    // ----- Died patient (وفاة) -----
    // Moves the patient to the "dead" list (preserving their data +
    // death timestamp) then frees the bed.
    $("died-patient-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !p.name || !p.name.trim()) return;
      if (!exitAllowed(p)) { flashHint("تسجيل الوفاة لمرضى الردهة من صلاحية الطبيب"); return; }
      if (!confirm(`هل تريد تسجيل وفاة المريض "${p.name}"؟\nستُحفظ بياناته في قائمة "وفيات".`)) return;
      const { key: bedKey, roomId, bed } = state.currentBed;
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      const record = {
        name:        p.name.trim(),
        plateNumber: p.plateNumber || "",
        doctor:      p.doctor || "",
        age:         p.age || "",
        gender:      p.gender || "",
        diagnosis:   p.diagnosis || "",
        medications: clinicalCopy(p.medications, []),
        labs:        clinicalCopy(p.labs, {}),
        labHistory:  clinicalCopy(p.labHistory, []),
        allergies:   p.allergies || "",
        roomNumber:  roomId,
        bedNumber:   bed,
        originWard:  p.originWard || "",
        originLabel: global.PharmacyBoarders.label(p),
        diedAt:      new Date().toISOString(),
        recordedBy:  user ? user.username : "—"
      };
      deferExit(bedKey, "تم تسجيل الوفاة — بيانات المريض في قائمة «وفيات»", () => {
        global.PharmacyArchive.add("dead", record);
        if (Auth && Auth.auditLog) {
          Auth.auditLog("patient_died", `وفاة المريض "${p.name}" من ${global.PharmacyWard.roomTitle(roomId)} سرير ${global.PharmacyWard.bedLabel(roomId, bed)}`);
        }
        pushNotification("patient_died",
          `وفاة المريض: ${p.name.trim()} — ${global.PharmacyWard.roomTitle(roomId)}`,
          p.name.trim(), `${global.PharmacyWard.roomTitle(roomId)}`);
      });
    });

    // ----- Boarder returns to their own floor (رجوع المريض إلى طابقه) -----
    // Boarders only; pharmacists + admin only. Like a discharge, but kept
    // in its own "عادوا لطوابقهم" list and not counted as a discharge in
    // the monthly report. The destination is the patient's origin floor.
    $("transfer-ward-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !p.name || !p.name.trim()) return;
      const B = global.PharmacyBoarders;
      if (!B.isBoarder(p) || (Auth && Auth.isDoctor && Auth.isDoctor())) return;
      const dest = B.label(p);
      if (!confirm(`رجوع المريض "${p.name.trim()}" إلى طابقه (${dest})؟\nسيُفرَّغ السرير.`)) return;
      const { key: bedKey, roomId, bed } = state.currentBed;
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      global.PharmacyArchive.add("transferred", {
        name:          p.name.trim(),
        plateNumber:   p.plateNumber || "",
        doctor:        p.doctor || "",
        age:           p.age || "",
        gender:        p.gender || "",
        diagnosis:     p.diagnosis || "",
        medications:   clinicalCopy(p.medications, []),
        labs:          clinicalCopy(p.labs, {}),
        labHistory:    clinicalCopy(p.labHistory, []),
        roomNumber:    roomId,
        bedNumber:     bed,
        originWard:    p.originWard || "",
        originLabel:   B.label(p),
        transferredTo: dest,
        transferredAt: new Date().toISOString(),
        transferredBy: user ? user.username : "—"
      });
      if (Auth && Auth.auditLog) {
        Auth.auditLog("patient_transferred",
          `رجوع المريض "${p.name}" من ${global.PharmacyWard.roomTitle(roomId)} سرير ${global.PharmacyWard.bedLabel(roomId, bed)} إلى طابقه (${dest})`);
      }
      vacateBed(bedKey);
      flashHint("تم رجوع المريض إلى طابقه — سجله في «عادوا لطوابقهم»");
      pushNotification("patient_transferred",
        `رجوع المريض: ${p.name.trim()} إلى ${dest} — ${global.PharmacyWard.roomTitle(roomId)}`,
        p.name.trim(), `${global.PharmacyWard.roomTitle(roomId)}`);
    });

    // ----- Origin ward (مريض مستضاف) -----
    const originSelect = $("patient-origin-select");
    global.PharmacyBoarders.ORIGINS.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.legacy ? o.label : o.option;
      // Old values stay displayable but are no longer offered
      if (o.legacy) opt.hidden = true;
      originSelect.appendChild(opt);
    });
    originSelect.addEventListener("change", () => {
      if (!state.currentBed) return;
      const Auth = global.PharmacyAuth;
      if (Auth && Auth.isDoctor() && !Auth.isAdmin()) return;   // field hidden for doctors
      const p = ensurePatient(state.currentBed.key);
      p.originWard = originSelect.value;
      p.originNote = "";   // the floor comes with the choice (ط10 / ط9 / ط8 / ط7)
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });

    // ----- Discharged list (now in settings) -----
    // Show the cached lists at once, then refresh them from the cloud.
    function openDischargedView() {
      renderDischargedView();
      UI.showView("discharged");
      global.PharmacyArchive.sync().then(res => {
        if (!$("view-discharged") || $("view-discharged").hidden) return;
        renderDischargedView();
        if (!res.ok) flashHint("تعذّر تحديث القائمة من السحابة: " + res.error);
      });
    }
    $("settings-discharged-btn").addEventListener("click", openDischargedView);
    // Admin also has a 'view discharged' button in the admin view
    // (admins don't see the settings view because the gear routes
    // them to openAdminView instead).
    const adminDischargedBtn = $("admin-discharged-btn");
    if (adminDischargedBtn) adminDischargedBtn.addEventListener("click", openDischargedView);

    // ----- Discharged view back button -----
    $("discharged-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });

    // ----- Discharged view tabs -----
    document.querySelectorAll(".discharged-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".discharged-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        _dischargedTab = tab.dataset.tab;
        renderDischargedView();
      });
    });

    // Admin-only: clear ALL records in the active tab
    $("discharged-clear-all-btn").addEventListener("click", () => {
      const kind = archiveKind(_dischargedTab);
      const what = { discharged: "المرضى الخارجين", dead: "الوفيات", transferred: "المرضى العائدين لطوابقهم" }[kind];
      if (!confirm(`هل تريد حذف جميع سجلات ${what}؟ لا يمكن التراجع.`)) return;
      global.PharmacyArchive.clearAll(kind).then(res => {
        renderDischargedView();
        flashHint(res.ok ? "تم مسح القائمة بالكامل" : "فشل المسح: " + res.error);
      });
    });

    // ----- ABX back button (abx-monitor-btn now in settings) -----
    $("view-abx").addEventListener("click", (e) => {
      const f = e.target.closest('[data-action="abx-focus"]');
      const pendingNote = $("crit-note");
      if (pendingNote && (f || e.target.closest('[data-action="abx-row"]'))) { clearTimeout(_critNoteTimer); saveCritNote(pendingNote); }
      if (f) {
        state.abxFocus = state.abxFocus === f.dataset.focus ? null : f.dataset.focus;
        state.abxOpenKey = null;
        renderAbxMonitor();
        return;
      }
      const diag = e.target.closest('[data-action="crit-diag"]');
      if (diag) {
        state.abxDiagKey = state.abxDiagKey === diag.dataset.key ? null : diag.dataset.key;
        renderAbxMonitor();
        const ta = $("crit-note");
        if (ta) ta.focus();
        return;
      }
      const sv = e.target.closest('[data-action="crit-save"]');
      if (sv) {
        const wrap = sv.closest(".crit-lab-new");
        const val = wrap && wrap.querySelector("[data-lab-input]").value;
        const day = wrap && wrap.querySelector("[data-lab-date]").value;
        if (saveCritLab(sv.dataset.key, sv.dataset.lab, val, day)) renderAbxMonitor();
        return;
      }
      const row = e.target.closest('[data-action="abx-row"]');
      if (row) {
        state.abxDiagKey = null;
        state.abxOpenKey = state.abxOpenKey === row.dataset.key ? null : row.dataset.key;
        renderAbxMonitor();
        // no auto-focus: on phones the keyboard would pop up at once and cover
        // the labs + note. The keyboard opens when the user taps the note.
      }
    });
    // Tapping the note: make room below it and bring it to the top, above the
    // on-screen keyboard (the page scrolls inside <body>, so scrollIntoView)
    const revealCritNote = () => {
      const ta = $("crit-note");
      if (ta && document.activeElement === ta) ta.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    $("view-abx").addEventListener("focusin", (e) => {
      if (e.target && e.target.id === "crit-note") {
        $("view-abx").classList.add("note-editing");
        setTimeout(revealCritNote, 350);          // after the keyboard has slid up
      }
    });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", () => {
      if ($("view-abx").classList.contains("note-editing")) revealCritNote();
    });
    $("view-abx").addEventListener("input", (e) => {
      if (e.target && e.target.id === "crit-note") {
        clearTimeout(_critNoteTimer);
        const ta = e.target;
        _critNoteTimer = setTimeout(() => saveCritNote(ta), 800);
      }
    });
    $("view-abx").addEventListener("focusout", (e) => {
      if (e.target && e.target.id === "crit-note") {
        clearTimeout(_critNoteTimer); saveCritNote(e.target);
        $("view-abx").classList.remove("note-editing");
      }
    });
    $("abx-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });

    // ----- Notifications -----
    $("notifications-btn").addEventListener("click", () => {
      renderNotifications();
      UI.showView("notifications");
    });
    $("notifications-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });
    $("notif-mark-all-btn").addEventListener("click", () => {
      Storage.markAllNotificationsRead();
      renderNotifications();
      updateNotifBadge();
      flashHint("تم تعليم الكل كمقروء");
    });
    // Admin-only: clear ALL notifications
    $("notif-clear-all-btn").addEventListener("click", () => {
      if (!confirm("هل تريد حذف جميع الإشعارات؟")) return;
      Storage.clearNotifications();
      renderNotifications();
      updateNotifBadge();
      flashHint("تم حذف جميع الإشعارات");
    });

    // ----- عام / خاص switch on the unit page -----
    $("rooms-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".kind-btn");
      if (!b) return;
      UI.setKind(b.dataset.kind);
      UI.renderRooms(state.patients);
    });

    // ----- Bottom navigation -----
    $("bottom-nav").addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (!item) return;
      const nav = item.dataset.nav;
      if (nav === "home" || nav === "unit3") {
        state.currentBed = null;
        UI.setUnit(nav === "unit3" ? "3" : "1");
        UI.renderRooms(state.patients);
        UI.showView("home");
        UI.markNav();
      } else if (nav === "patients") {
        UI.showView("patients");
        UI.renderPatientsList(state.patients);
      } else if (nav === "pills1" || nav === "pills3") {
        state.currentBed = null;
        global.PharmacyPillsPage.open(nav === "pills3" ? "3" : "1");
      }
    });

    // ----- Bottom sheet -----
    $("sheet-close").addEventListener("click", closeSheet);
    $("sheet-cancel").addEventListener("click", closeSheet);
    $("sheet-overlay").addEventListener("click", closeSheet);

    // Search in sheet
    let searchTimer = null;
    $("med-search").addEventListener("input", (e) => {
      state.sheet.filter = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
      }, 100);
    });

    // Tab clicks — switch the active form, keep the search query.
    // Tab keys are now any of: vial, ampule, prefilled-syringe, tablet, supplies.
    $("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".sheet-tab");
      if (!tab) return;
      const newTab = tab.dataset.tab;
      if (state.sheet.activeTab === newTab) return; // no change
      state.sheet.activeTab = newTab;
      UI.setActiveTabUI(newTab);
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, newTab);
      bindMedOptionCheckboxes();
    });

    // "بديل متوفر" chips under an unavailable med → select the alternative
    $("med-options").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-alt-id]");
      if (!chip) return;
      const id = chip.dataset.altId;
      const m = state.medications.find(x => x.id === id);
      if (!m) return;
      if (state.sheet.selected.has(id)) { flashHint("البديل مختار مسبقاً"); return; }
      addToSelected(id);
      if (state.sheet.filter) { state.sheet.filter = ""; $("med-search").value = ""; }
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
      bindMedOptionCheckboxes();
      syncSelectedUI();
      flashHint("أُضيف البديل: " + (m.nameTrade || m.nameEn || id));
    });

    // Med option checkboxes (delegated)
    $("med-options").addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const id = cb.dataset.medId;
      if (cb.checked) addToSelected(id);
      else removeFromSelected(id);
      if (cb.checked && state.sheet.filter) {        // picked from a search → empty the field for the next search
        state.sheet.filter = "";
        $("med-search").value = "";
      }
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
      bindMedOptionCheckboxes();
      syncSelectedUI();
    });

    // Selected list interactions (delegated)
    // - ✕ button (delete-selected) → removes the med from the selected list
    // - "+" button (freq-increment) → freq increases by 1 (max 12)
    // - "−" button (freq-decrement) → freq decreases by 1 (min 1)
    // For custom freqs ("حسب القياس"), tapping + or - switches to numeric:
    //   "+" → 1×1, "−" → 1×1 (can't be 1×0).
    // Dose stays unchanged; only the frequency changes.
    $("selected-list").addEventListener("click", (e) => {
      const del = e.target.closest('[data-action="del-selected"]');
      if (del) {
        const idx = parseInt(del.dataset.selIndex, 10);
        const item = state.sheet.selectedList[idx];
        if (!item) return;
        state.sheet.selected.delete(item.id);
        state.sheet.selectedList.splice(idx, 1);
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
        syncSelectedUI();
        return;
      }

      const incBtn = e.target.closest('[data-action="freq-increment"]');
      const decBtn = e.target.closest('[data-action="freq-decrement"]');
      if (!incBtn && !decBtn) return;

      const selItem = (incBtn || decBtn).closest(".sel-item");
      if (!selItem) return;
      const idx = parseInt(selItem.dataset.selIndex, 10);
      const item = state.sheet.selectedList[idx];
      if (!item) return;

      const MAX = 12;
      const MIN = 1;
      let currentCount = (function () {
        const m = (item.frequency || "").match(/×\s*(\d+)/);
        return m ? parseInt(m[1], 10) : -1; // -1 = custom/non-numeric
      })();
      // Extract the dose multiplier (the N in "N×M", may be ½ / 1½)
      let currentMult = (function () {
        const pf = Meds && Meds.parseFreq ? Meds.parseFreq(item.frequency) : null;
        return pf ? pf.n : 1; // default 1
      })();
      const MULTS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];

      let newCount;
      if (currentCount === -1) {
        // Was custom: switching to numeric starts at 1×1
        newCount = 1;
        currentMult = 1;
      } else if (incBtn) {
        // Shift+click increments the multiplier (1→2→3)
        if (e.shiftKey) {
          currentMult = MULTS.find(x => x > currentMult) || 6;
        } else {
          newCount = Math.min(MAX, currentCount + 1);
        }
      } else {
        // Shift+click decrements the multiplier (3→2→1)
        if (e.shiftKey) {
          currentMult = MULTS.slice().reverse().find(x => x < currentMult) || 0.5;
        } else {
          newCount = Math.max(MIN, currentCount - 1);
        }
      }
      if (newCount === undefined) newCount = currentCount;
      item.frequency = `${Meds && Meds.formatN ? Meds.formatN(currentMult) : currentMult}×${newCount}`;
      syncSelectedUI();
    });

    // Add selected to patient
    $("sheet-add").addEventListener("click", () => {
      if (!state.currentBed) return;
      if (state.sheet.selectedList.length === 0) return;
      const p = ensurePatient(state.currentBed.key);
      const wasNew = !p.name || !p.name.trim();

      // 0) Allergy check BEFORE adding — the user confirms explicitly.
      const allergyHits = [];
      state.sheet.selectedList.forEach(s => {
        Clinical.allergyConflicts(p.allergies, s).forEach(a => {
          allergyHits.push((a.level === "danger" ? "🔴 " : "🟡 ") + (s.nameEn || s.nameTrade || s.id) + " — " + a.msg);
        });
      });
      if (allergyHits.length > 0 &&
          !confirm("⚠ تعارض مع حساسية المريض:\n\n" + allergyHits.join("\n") + "\n\nهل تريد الإضافة رغم ذلك؟")) {
        return;
      }

      // 1) Add the user-selected meds to the patient. startDate drives
      //    the per-antibiotic day counter (D1, D2, ...).
      const firstNewIndex = p.medications.length;
      const today = Clinical.todayISO();
      state.sheet.selectedList.forEach(s => {
        p.medications.push({
          id:        s.id,
          nameTrade: s.nameTrade,
          nameAr:    s.nameAr,
          nameEn:    s.nameEn,
          form:      s.form || "vial",
          dose:      s.dose,
          frequency: s.frequency,
          startDate: today
        });
      });
      const userAddedCount = state.sheet.selectedList.length;

      // Audit log — record the med-add action
      if (Auth && Auth.auditLog) {
        const medNames = state.sheet.selectedList.map(s => s.nameTrade || s.nameAr || s.id).join("، ");
        const roomBed = global.PharmacyWard.bedText(state.currentBed.key);
        Auth.auditLog("med_added",
          `إضافة ${userAddedCount} دواء (${medNames}) للمريض "${p.name || "(بدون اسم)"}" في ${roomBed}`);
      }

      // 2) Note: the 5cc Syringe is now injected at print-time only
      //    (in ui.js buildChartReport), not stored on the patient.
      //    No recompute needed here.

      persistPatient(state.currentBed.key);
      if (global.PharmacyFx) global.PharmacyFx.markBed(state.currentBed.key);   // the bed gets a spinning border
      closeSheet();
      flashHint("تمت إضافة " + userAddedCount + " علاج");
      // Notify pharmacist of new prescription by doctor
      const medNames = state.sheet.selectedList.map(s => s.nameTrade || s.nameAr || s.id).join("، ");
      pushNotification("med_changed",
        `إضافة ${userAddedCount} دواء (${medNames}) لـ ${p.name || "(بدون اسم)"} — ${global.PharmacyWard.roomTitle(state.currentBed.roomId)}`,
        p.name || "", `${global.PharmacyWard.roomTitle(state.currentBed.roomId)}`);
      // Renal / allergy / duplicate / interaction alerts for the new meds
      showClinicalAlertsForNewMeds(p, firstNewIndex);
      // Return to rooms view immediately so the pharmacist can move to
      // the next patient without an extra tap on the back button.
      state.currentBed = null;
      UI.showView("home");
    });

    // ----- Settings/Admin: open via header gear -----
    // The gear ⚙ button opens a different view depending on the user's
    // role:
    //   - admin  → full admin view (med catalog + users + audit log)
    //   - pharmacist → simple settings view (dark mode + TV + logout)
    // ⚙ opens the settings for everyone — the admin too (print all sheets, the ward
    // display, dark / light and logout live there). The admin's OWN settings (users,
    // catalogue, theme, audit…) are behind his second button.
    $("open-admin").addEventListener("click", () => openSettingsView());
    $("admin-tools-btn").addEventListener("click", () => { if (Auth && Auth.isAdmin()) openAdminView(); });
    // the admin's tools (his settings page): the ward display, printing every patient's sheet and
    // requesting a new medicine — they use the existing handlers
    $("admin-tv-btn").addEventListener("click", () => { if (Auth && Auth.isAdmin()) $("settings-tv-btn").click(); });
    $("admin-print-sheets-btn").addEventListener("click", () => { if (Auth && Auth.isAdmin()) $("print-all-sheets-btn").click(); });
    $("admin-med-request-btn").addEventListener("click", () => { if (Auth && Auth.isAdmin()) $("settings-med-request-btn").click(); });

    // ----- Print Chart (التشارت) -----
    // Instead of printing directly, we first open the Supply Order
    // modal where the user enters the total quantity for each supply.
    // On "submit", the supplies are distributed across patients and
    // the chart is built + printed.
    // NOTE: The actual handler is defined later in this file (after
    // the supply-order-submit handler) because it shares the modal
    // with the new "distribute-send-btn" workflow. The handler there
    // sets the modal title + submit button label + opens the modal.

    // ----- Print All Patient Sheets (طباعة كل أوراق المرضى) -----
    // Generates a multi-page PDF containing one patient sheet per
    // occupied bed (same layout as printPatientSheet, but for ALL
    // patients in one download). Available to admin + doctor only —
    // the pharmacist prints individual sheets from the patient view.
    $("print-all-sheets-btn").addEventListener("click", async () => {
      const occPatients = [];
      const Ward = global.PharmacyWard;
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = state.patients[key];
          // Boarders' sheets are printed by their own ward's doctors
          if (p && p.name && p.name.trim() && !global.PharmacyBoarders.isBoarder(p)) {
            occPatients.push({ patient: p, currentBed: { key, roomId: room.id, bed: bed.number } });
          }
        });
      });
      if (occPatients.length === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return;
      }
      flashHint(`يتم توليد ${occPatients.length} ورقة... انتظر قليلاً`);
      setTimeout(async () => {
        try {
          await printAllPatientSheets(occPatients);
          flashHint(`تم تنزيل ${occPatients.length} ورقة في ملف PDF موحّد`);
        } catch (err) {
          console.error("[print-all-sheets] error:", err);
          flashHint("تعذّر توليد الأوراق: " + (err.message || err));
        }
      }, 50);
    });

    // ----- Pills Form Download (تنزيل استمارة الحبوب) -----
    // Generates a downloadable PDF of pill dispensing forms for every
    // patient who has at least one medication from the "tablet" form
    // category. All patient forms are merged into a single PDF (one
    // page per patient).
    // (the header button was removed at the user's request — the pills forms are
    // printed per patient or from the «الحبوب» tab)
    if ($("print-pills-form-btn")) $("print-pills-form-btn").addEventListener("click", async () => {
      if (!global.PharmacyPillsForm) {
        flashHint("تعذّر تحميل وحدة استمارة الحبوب");
        return;
      }
      flashHint("يتم توليد استمارات الحبوب... انتظر قليلاً");
      // Defer so flashHint renders before the heavy canvas work
      setTimeout(async () => {
        try {
          const result = await global.PharmacyPillsForm.previewPillsForms(orderingState());
          if (result && result.cancelled) return;
          if (result && result.error) {
            flashHint(result.error);
            return;
          }
          if (result && result.count) {
            if (result.mode === "pdf") {
              flashHint(`تم تنزيل ملف PDF موحّد لـ ${result.count} مريض — تحقق من التنزيلات`);
            } else {
              flashHint(`تم تنزيل ${result.count} استمارة حبوب — تحقق من التنزيلات`);
            }
          } else {
            flashHint("لم يتم توليد أي استمارة");
          }
        } catch (err) {
          console.error("[pills-form] error:", err);
          flashHint("تعذّر توليد الاستمارة: " + (err.message || err));
        }
      }, 50);
    });

    // ----- Med Summary Modal (إحصاء الأدوية — shown after chart) -----
    // After the chart is generated, show a modal list of all meds +
    // supplies with their total daily count across all patients.
    // This gives the pharmacist an at-a-glance view of what was
    // distributed, including the supplies just assigned in the
    // supply-order modal.

    function closeMedSummary() {
      const overlay = $("med-summary-overlay");
      const modal = $("med-summary-modal");
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
    }

    // Build and show the med summary modal. Includes BOTH:
    //   - Patient-prescribed meds (from patient.medications[])
    //   - Auto-injected supplies (from supplyDistribution)
    // chartOnly: the send review — only what is sent (medicines with a chart name)
    // opts.order: the «الطلبية» view — chart names, a title and a note about
    // the supplies' send date
    function showMedSummaryList(supplyDistribution, chartOnly, opts) {
      opts = opts || {};
      const body = $("med-summary-body");
      const footer = $("med-summary-footer");
      const overlay = $("med-summary-overlay");
      const modal = $("med-summary-modal");
      if (!body || !overlay || !modal) return;

      const Meds = global.PharmacyMedications || {};
      const FORM_LABELS = Meds.FORM_LABELS || {};
      const FORM_ORDER = Meds.FORM_ORDER ||
        ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

      // Daily quantity — exactly what the chart receives ("1×3" → 3,
      // "2×2" → 4, quantity exceptions like heparin → 1); 0 = non-daily
      function parseFreq(freq, medId) {
        const q = global.PharmacyChartBridge.dailyQuantity(medId, freq);
        return q == null ? 0 : q;
      }

      // Helper: get display label (Arabic preferred). The order view shows the
      // name as written in the chart, so it can be copied by hand.
      function getLabel(m) {
        if (!m) return "";
        if (opts.order) {
          const SN = (global.PharmacyChartBridge && global.PharmacyChartBridge.SUPPLY_CHART_NAMES) || {};
          return m.nameChart || SN[m.id] || m.nameTrade || m.nameEn || m.nameAr || m.name || m.id || "";
        }
        return m.nameAr || m.nameTrade || m.nameEn || m.name || m.id || "";
      }
      const titleEl = document.querySelector("#med-summary-modal .med-summary-head h3");
      // «الطلبية» on a Thursday: every number is doubled (the order covers Friday too)
      // (except the medicines the chart app does not double: opts.noDouble, a Set of names)
      const mult = opts.order && new Date().getDay() === 4 ? 2 : 1;
      const skipsDouble = (cat) => mult === 2 && opts.noDouble && opts.noDouble.has(getLabel(cat).toLowerCase().replace(/\s+/g, " ").trim());
      const factorOf = (t) => skipsDouble(t.catalog) ? 1 : mult;
      if (titleEl) titleEl.textContent = (opts.title || "إحصاء الأدوية والمستلزمات") + (mult === 2 ? " — الخميس ×2" : "");

      // Build med-by-id lookup
      const medById = {};
      (state.medications || []).forEach(m => {
        if (m && m.id) medById[m.id] = m;
      });

      // Tally counts across all occupied patients
      const tally = {};
      const occupiedPatients = Object.values(flowPatientsMap())
        .filter(p => p && p.name && p.name.trim());

      occupiedPatients.forEach(p => {
        const seen = new Set();
        (p.medications || []).forEach(pm => {
          if (!pm || !pm.id) return;
          const catalog = medById[pm.id];
          if (!catalog) return;
          if (chartOnly && catalog.form !== "supplies" && !String(catalog.nameChart || "").trim()) return;   // not sent
          if (!tally[pm.id]) {
            tally[pm.id] = {
              catalog: catalog,
              total: 0,
              custom: false
            };
          }
          const freq = pm.frequency || catalog.defaultFrequency || "";
          const n = parseFreq(freq, pm.id);
          if (n === 0 && freq) tally[pm.id].custom = true;
          tally[pm.id].total += n;
          if (!seen.has(pm.id)) {
            seen.add(pm.id);
          }
        });
      });

      // Inject auto-distributed supplies as additional "patients" of
      // the supplies category. supplyDistribution maps supplyId →
      // { bedKey: freq }. Sum the frequencies across all bedKeys.
      if (supplyDistribution && typeof supplyDistribution === "object") {
        Object.keys(supplyDistribution).forEach(supplyId => {
          const dist = supplyDistribution[supplyId];
          if (!dist || typeof dist !== "object") return;
          let total = 0;
          Object.values(dist).forEach(freq => { total += (freq || 0); });
          if (total === 0) return;  // supply wasn't distributed to anyone

          const catalog = medById[supplyId] || { id: supplyId, form: "supplies", nameTrade: supplyId };
          tally[supplyId] = {
            catalog: catalog,
            total: total,
            custom: false
          };
        });
      }

      // Group like the chart's columns: antibiotics (any form) ← tablets, syrups,
      // ointments, suppositories, solutions ← prefilled syringes ← ampoules and
      // vials ← supplies (chart-bridge ORDER_GROUPS)
      const Bridge = global.PharmacyChartBridge;
      const GROUPS = Bridge.ORDER_GROUPS;
      const groups = {};
      GROUPS.forEach(g => { groups[g.key] = []; });
      Object.values(tally).forEach(t => {
        const r = Bridge.orderRank(t.catalog);
        t.rank = r.rank;
        groups[GROUPS[r.group].key].push(t);
      });
      // inside a group: by form, then by name
      Object.values(groups).forEach(arr => {
        arr.sort((a, b) => (a.rank - b.rank) || getLabel(a.catalog).localeCompare(getLabel(b.catalog)));
      });

      // Render HTML
      let html = "";
      let firstGroup = true;
      GROUPS.forEach(g => {
        const form = g.key;
        const arr = groups[form] || [];
        if (arr.length === 0) return;
        if (!firstGroup) html += "";
        firstGroup = false;
        const formLabel = g.label;
        html += `<div class="med-summary-group">`;
        html += `<div class="med-summary-group-title">`;
        html += `<span>${formLabel}</span>`;
        html += `<span class="med-summary-group-count">${arr.length} دواء</span>`;
        html += `</div>`;
        arr.forEach(t => {
          const name = getLabel(t.catalog);
          const countText = t.custom ? "—" : String(t.total * factorOf(t));
          const countClass = t.custom ? "med-summary-row-count custom" : "med-summary-row-count";
          html += `<div class="med-summary-row">`;
          html += `<span class="med-summary-row-name">${name}${skipsDouble(t.catalog) ? ' <small style="font-weight:600;color:var(--text-muted)">(لا يُضاعف)</small>' : ""}</span>`;
          html += `<span class="${countClass}">${countText}</span>`;
          html += `</div>`;
        });
        html += `</div>`;
      });

      if (firstGroup) {
        // No groups at all — no patient has any medication
        html = `<div style="text-align:center;padding:40px;color:var(--text-muted);">لا يوجد أدوية موصوفة</div>`;
      }

      body.innerHTML = html;

      // Footer with totals
      const totalCount = Object.values(tally).reduce((s, t) => s + (t.custom ? 0 : t.total * factorOf(t)), 0);
      const totalMeds = Object.keys(tally).length;
      const totalPatients = occupiedPatients.length;
      footer.innerHTML = `
        <div>إجمالي التكرارات اليومية: ${totalCount}</div>
        <div>عدد الأدوية والمستلزمات: ${totalMeds}  ·  عدد المرضى: ${totalPatients}</div>
        ${mult === 2 ? "<div>" + (opts.noDouble ? "يوم الخميس: الأعداد مضاعفة (×2) عدا ما لا يُضاعف في الجارت" : "يوم الخميس: كل الأعداد مضاعفة (×2)" + (opts.noDoubleError ? " — تعذّرت قراءة المستثنى من الجارت" : "")) + "</div>" : ""}
        ${opts.note ? `<div>${escapeHtml(opts.note)}</div>` : ""}
      `;

      // Show modal
      overlay.hidden = false;
      modal.hidden = false;
    }

    // Close handlers for med summary modal
    $("med-summary-close").addEventListener("click", closeMedSummary);
    $("med-summary-overlay").addEventListener("click", closeMedSummary);

    // Note: The med-summary-btn (red bar-chart icon) was removed from
    // the header. The med-summary MODAL still exists in the HTML +
    // is opened programmatically by the distribute-send-btn workflow
    // (showMedSummaryList is called inside the supply-order submit
    // handler in distribute+send mode). The close handlers above
    // remain so the user can close the modal that the distribute-send
    // workflow opened.

    // ----- Display Mode (TV / large screen) -----
    $("display-mode-btn").addEventListener("click", () => { if (Auth && Auth.isAdmin && Auth.isAdmin()) enterDisplayMode(); });

    // ----- Supply Order Modal -----
    // SUPPLY_RULES: one entry per supply that can be distributed.
    // Each has: id (catalog id), label (display), short (abbrev),
    // minFreq, maxFreq (the frequency range per patient).
    const SUPPLY_RULES = [
      { id: "dextrose-saline",  label: "G/S — Glucose Saline (ديكستروز سالين)", short: "G/S", minFreq: 2, maxFreq: 5 },
      { id: "ringers-lactate",   label: "R/L — Ringer Lactate (رينجر لاكتات)", short: "R/L", minFreq: 2, maxFreq: 5 },
      { id: "glucose-5",         label: "G/W — Glucose 5% (مغذي سكري 5%)", short: "G/W", minFreq: 2, maxFreq: 5 },
      { id: "sodium-chloride-09", label: "N/S — Normal Saline 500ml (مغذي ملح 500مل)", short: "N/S", minFreq: 2, maxFreq: 5 },
      { id: "nacl-100ml",         label: "N/S 100ml — مغذي ملح 100مل", short: "N/S 100", minFreq: 3, maxFreq: 7 },
      { id: "iv-set",             label: "I.V. Set — خط الإعطاء", short: "IV Set", minFreq: 1, maxFreq: 2 },
      { id: "blood-iv-set",       label: "Blood I.V. Set — خط إعطاء دم", short: "Blood IV", minFreq: 1, maxFreq: 2 },
      { id: "cannula",            label: "Cannula — كانيولا", short: "Cannula", minFreq: 1, maxFreq: 2 },
      { id: "syringe-5cc",        label: "5cc Syringe — سرنجة 5 سي سي", short: "5cc", minFreq: 3, maxFreq: 8 },
      { id: "syringe-1cc",        label: "1cc Syringe — سرنجة 1 سي سي", short: "1cc", minFreq: 3, maxFreq: 8 },
      { id: "syringe-10cc",       label: "10cc Syringe — سرنجة 10 سي سي", short: "10cc", minFreq: 1, maxFreq: 3 },
      { id: "syringe-20cc",       label: "20cc Syringe — سرنجة 20 سي سي", short: "20cc", minFreq: 1, maxFreq: 3 },
      { id: "syringe-50cc",       label: "50cc Syringe — سرنجة 50 سي سي", short: "50cc", minFreq: 1, maxFreq: 3 },
      { id: "urine-bag",          label: "Urine Bag — كيس إدرار", short: "Urine", minFreq: 1, maxFreq: 2 },
      { id: "ng-tube-14",         label: "NG Tube 14 — أنبوب تغذية 14", short: "NG14", minFreq: 1, maxFreq: 1 },
      { id: "floy-14",            label: "Foley 14 — قسطرة فولي 14", short: "Foley14", minFreq: 1, maxFreq: 1 }
    ];

    // The supply's trade name only: "G/S — Glucose Saline (ديكستروز سالين)" → "G/S",
    // "N/S 100ml — مغذي ملح 100مل" → "N/S 100ml", "5cc Syringe — …" → "5cc Syringe"
    function supplyEnglishName(label) {
      return String(label || "").split(" — ")[0].replace(/\s*\([^)]*\)/g, "").trim();
    }

    function openSupplyOrderModal(patientCount) {
      const overlay = $("supply-order-overlay");
      const modal = $("supply-order-modal");
      const list = $("supply-order-list");
      if (!overlay || !modal || !list) return;

      // Build the supply rows
      list.innerHTML = "";
      SUPPLY_RULES.forEach(rule => {
        const row = document.createElement("div");
        row.className = "supply-order-row";
        row.innerHTML = `
          <div class="supply-order-row-label">
            <div class="supply-order-row-name">${escapeHtml(supplyEnglishName(rule.label))}</div>
          </div>
          <input type="number" min="0" inputmode="numeric" placeholder="0" data-supply-id="${rule.id}" />
        `;
        list.appendChild(row);
      });

      overlay.hidden = false;
      modal.hidden = false;
    }

    function closeSupplyOrderModal() {
      $("supply-order-overlay").hidden = true;
      $("supply-order-modal").hidden = true;
    }

    $("supply-order-close").addEventListener("click", closeSupplyOrderModal);
    $("supply-order-overlay").addEventListener("click", closeSupplyOrderModal);

    // Submit: read quantities, distribute across patients, build chart, print
    // The supply-order modal is reused by BOTH:
    //   - The original "print-chart-btn" button (generates the chart
    //     image as a PNG)
    //   - The new "distribute-send-btn" button (sends patient + supply
    //     data to جارت الجارت)
    // We use the supply-order-submit button's text to decide which
    // action to take after the modal closes:
    //   - default text  → generate chart image
    //   - 'توزيع وإرسال' → send to جارت الجارت
    let _supplyOrderMode = "chart";  // "chart" or "send"

    // Reusable: collects quantities from the supply-order modal,
    // validates them, builds the supply distribution map, and closes
    // the modal. Returns the distribution map (or null on error).
    function collectAndDistributeSupplies() {
      // Collect the quantities from the modal inputs
      const quantities = {};
      document.querySelectorAll("#supply-order-list input[data-supply-id]").forEach(inp => {
        const id = inp.dataset.supplyId;
        const val = parseInt(inp.value, 10);
        quantities[id] = (isNaN(val) || val < 0) ? 0 : val;
      });

      // Count occupied patients we order for (supplies go to them only)
      const occupiedKeys = [];
      const Ward = global.PharmacyWard;
      const ordered = flowPatientsMap();
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = ordered[key];
          if (p && p.name && p.name.trim()) occupiedKeys.push(key);
        });
      });
      const patientCount = occupiedKeys.length;
      if (patientCount === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return null;
      }

      // Build the supply distribution map: supplyId → { bedKey: freq }
      // This will be passed to buildChartReport.
      const supplyDistribution = {};
      SUPPLY_RULES.forEach(rule => {
        const totalQty = quantities[rule.id] || 0;
        if (totalQty === 0) return; // skip this supply

        // Distribute `totalQty` across `patientCount` patients,
        // each getting a frequency between rule.minFreq and rule.maxFreq.
        // Algorithm:
        //   1. Each patient gets at least minFreq. If totalQty <
        //      patientCount × minFreq, some patients get 0 (randomly
        //      chosen). If totalQty >= patientCount × minFreq, all
        //      get at least minFreq and the remainder is distributed
        //      randomly (each patient gets up to maxFreq).
        //   2. The remainder is distributed so the sum = totalQty
        //      exactly. We give +1 to random patients (up to maxFreq)
        //      until the remainder is exhausted.
        const shuffled = occupiedKeys.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const dist = {};
        // Phase 1: decide how many patients get at least minFreq
        const minTotal = patientCount * rule.minFreq;
        let perPatient; // array of freqs, aligned with shuffled[]
        if (totalQty >= minTotal) {
          // All patients get minFreq, remainder distributed
          perPatient = new Array(patientCount).fill(rule.minFreq);
          let remainder = totalQty - minTotal;
          // Distribute remainder: go through patients in random order,
          // give +1 each until remainder is 0 or everyone is at maxFreq
          let idx = 0;
          while (remainder > 0) {
            if (perPatient[idx] < rule.maxFreq) {
              perPatient[idx]++;
              remainder--;
            }
            idx = (idx + 1) % patientCount;
            // Safety: if we've gone around without distributing
            // anything (all at maxFreq), break.
            if (idx === 0 && remainder > 0) {
              let canDistribute = false;
              for (let k = 0; k < patientCount; k++) {
                if (perPatient[k] < rule.maxFreq) { canDistribute = true; break; }
              }
              if (!canDistribute) break;
            }
          }
        } else {
          // totalQty < minTotal: some patients get minFreq, rest get 0
          // How many patients can get minFreq?
          const numFull = Math.floor(totalQty / rule.minFreq);
          const leftover = totalQty - (numFull * rule.minFreq);
          perPatient = new Array(patientCount).fill(0);
          for (let i = 0; i < numFull; i++) perPatient[i] = rule.minFreq;
          // Distribute leftover (less than minFreq) to one more patient
          if (leftover > 0 && numFull < patientCount) {
            perPatient[numFull] = leftover;
          }
        }

        // Assign to bedKeys
        for (let i = 0; i < patientCount; i++) {
          if (perPatient[i] > 0) {
            dist[shuffled[i]] = perPatient[i];
          }
        }
        supplyDistribution[rule.id] = dist;
      });

      closeSupplyOrderModal();
      // Save this distribution as the "last" — used by the med-summary
      // button (red button) to display the same supplies without
      // requiring the user to re-distribute via the supply-order modal.
      _lastSupplyDistribution = supplyDistribution;
      return supplyDistribution;
    }

    $("supply-order-submit").addEventListener("click", () => {
      const supplyDistribution = collectAndDistributeSupplies();
      if (!supplyDistribution) return;

      // Branch based on which button opened the modal:
      if (_supplyOrderMode === "send") {
        // ----- Distribute + Send mode (new "distribute-send-btn") -----
        // Show the med-summary modal first so the user can review the
        // final tally (meds + distributed supplies) before sending.
        // The user then clicks "إرسال إلى جارت الجارت" inside that
        // modal to actually send the data.
        showMedSummaryList(supplyDistribution, true, { title: "مراجعة الإرسال — " + flowUnitName() });
        // Replace the med-summary footer with a "send to جارت الجارت"
        // button so the user can review the summary, then click to send.
        const footer = $("med-summary-footer");
        if (footer) {
          footer.innerHTML = "";
          // The day of the chart to fill (the chart app's own date) — today
          // by default; another day when sending for it
          const dateWrap = document.createElement("label");
          dateWrap.className = "med-summary-date";
          const dateLbl = document.createElement("span");
          dateLbl.textContent = "تاريخ الجارت";
          const dateInput = document.createElement("input");
          dateInput.type = "date";
          dateInput.value = global.PharmacyChartSync.todayISO();
          dateWrap.appendChild(dateLbl);
          dateWrap.appendChild(dateInput);
          footer.appendChild(dateWrap);
          // (the target is the unit page it was opened from: its chart, private rooms to ردهة الخاص)
          const sendBtn = document.createElement("button");
          sendBtn.type = "button";
          sendBtn.className = "med-summary-send-btn";
          sendBtn.textContent = "📤 إرسال بيانات المرضى إلى الجارت";
          sendBtn.addEventListener("click", async () => {
            if (!global.PharmacyChartBridge) {
              flashHint("تعذّر تحميل وحدة جسر الجارت");
              return;
            }
            sendBtn.disabled = true;
            try {
              const day = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : global.PharmacyChartSync.todayISO();
              if (day !== global.PharmacyChartSync.todayISO() && !confirm("الإرسال إلى جارت يوم " + day + " (ليس اليوم)؟")) return;
              const r = await global.PharmacyChartBridge.sendChart(orderingState(), supplyDistribution, flashHint, day, _flowUnit);
              if (r.cancelled) return;
              flashHint(global.PharmacyChartSync.describe(r) + (r.ok ? "" : " — يمكنك إعادة الإرسال من «سجل الإرسال إلى الجارت»"));
              if (r.ok) { saveSentSupplies(supplyDistribution, day, flowKey()); closeMedSummary(); }
            } catch (err) {
              flashHint("تعذّر الإرسال: " + (err.message || err));
            } finally {
              sendBtn.disabled = false;
            }
          });
          footer.appendChild(sendBtn);
          // Also add a "skip / close" button so the user can review
          // without sending.
          const closeBtn = document.createElement("button");
          closeBtn.type = "button";
          closeBtn.className = "med-summary-cancel-btn";
          closeBtn.textContent = "إغلاق بدون إرسال";
          closeBtn.addEventListener("click", closeMedSummary);
          footer.appendChild(closeBtn);
        }
      } else {
        // ----- Chart mode (original "print-chart-btn") -----
        // Generate chart as a downloadable image overlay on the
        // reference chart template (img/chart-reference.png).
        flashHint("يتم توليد صورة الجارت... انتظر قليلاً");
        const wrapState = {
          patients: orderedPatientsMap(),
          meds: state.medications,
          supplyDistribution: supplyDistribution
        };
        setTimeout(async () => {
          try {
            const pages = await global.PharmacyChartImage.generateChartImage(wrapState);
            if (pages && pages.length > 0) {
              flashHint(`تم توليد ${pages.length} صفحة جارت — تحقق من التنزيلات`);
            }
          } catch (err) {
            console.error("[chart-image] error:", err);
            flashHint("تعذّر توليد صورة الجارت: " + (err.message || err));
          }
        }, 50);
      }
    });

    // ----- Distribute + Send button (توزيع المستلزمات + إرسال) -----
    // Combines the supply-order modal + med-summary review + chart
    // bridge into ONE workflow:
    //   1. Open the supply-order modal (same modal the chart button
    //      uses, but with a different submit-button label)
    //   2. On submit: distribute the supplies across patients + save
    //      the distribution
    //   3. Show the med-summary modal so the user can review the
    //      tally (meds + supplies) before sending
    //   4. The footer of the med-summary modal has "إرسال إلى جارت
    //      الجارت" + "إغلاق بدون إرسال" buttons.
    //   5. When the user clicks "إرسال", call
    //      PharmacyChartBridge.sendChart(state, supplyDistribution)
    //      which now accepts the supply distribution as a 2nd arg
    //      and injects the supplies into each patient's med list.
    $("distribute-send-btn").addEventListener("click", () => {
      if (!pickFlowUnit()) return;
      if (!state.medications || state.medications.length === 0) {
        flashHint("لا توجد أدوية في الكتالوج");
        return;
      }
      // Count occupied patients we order for (this unit)
      const occCount = occupiedCount(flowPatientsMap());
      if (occCount === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return;
      }
      // Set the mode so the supply-order submit handler knows to
      // take the "send" branch instead of the "chart" branch.
      _supplyOrderMode = "send";
      // Update the submit button label so the user knows what
      // happens after they enter the supply quantities.
      const submitBtn = $("supply-order-submit");
      if (submitBtn) {
        submitBtn.textContent = "متابعة → مراجعة البيانات";
      }
      // Update the modal title so the user knows this is a
      // distribute+send workflow, not a chart-generation workflow.
      // (The title lives inside the modal's <h3> header.)
      const modalTitle = document.querySelector("#supply-order-modal .supply-order-head h3");
      if (modalTitle) {
        modalTitle.textContent = "توزيع المستلزمات ثم إرسال بيانات " + flowUnitName() + " إلى الجارت";
      }
      openSupplyOrderModal(occCount);
    });

    // ----- «الطلبية» (pharmacists + admin) -----
    // Every medicine of the patients we order for with its total daily count
    // (what the chart receives), plus the supplies of the last successful send
    // to the chart — so the order can be written by hand.
    $("order-list-btn").addEventListener("click", async () => {
      if (!pickFlowUnit()) return;
      if (!state.medications || state.medications.length === 0) { flashHint("لا توجد أدوية في الكتالوج"); return; }
      if (occupiedCount(flowPatientsMap()) === 0) { flashHint("لا يوجد مرضى مشغولون"); return; }
      const sent = loadSentSupplies(flowKey());
      // Thursday: the chart app doubles every medicine except the ones flagged
      // «لا يُضاعف يوم الخميس» there — read those so the order matches the chart
      let noDouble = null, noDoubleError = false;
      if (new Date().getDay() === 4 && global.PharmacyChartSync && global.PharmacyChartSync.noDouble) {
        const Bridge = global.PharmacyChartBridge || {};
        const SN = Bridge.SUPPLY_CHART_NAMES || {};
        const byId = {};
        (state.medications || []).forEach(m => { if (m && m.id) byId[m.id] = m; });
        const names = new Set();
        Object.values(flowPatientsMap()).forEach(p => {
          if (!p || !p.name || !p.name.trim()) return;
          (p.medications || []).forEach(pm => {
            const c = pm && byId[pm.id];
            const n = c && String(c.nameChart || SN[c.id] || c.nameTrade || "").trim();
            if (n) names.add(n);
          });
        });
        if (sent && sent.dist) Object.keys(sent.dist).forEach(id => {
          const c = byId[id];
          const n = String((c && c.nameChart) || SN[id] || (c && (c.nameTrade || c.nameEn)) || "").trim();
          if (n) names.add(n);
        });
        const r = await global.PharmacyChartSync.noDouble(Array.from(names), flashHint);
        if (r.cancelled) return;
        if (r.ok) noDouble = new Set((r.noDouble || []).map(n => String(n).toLowerCase().replace(/\s+/g, " ").trim()));
        else noDoubleError = true;
      }
      const when = sent && sent.at ? new Date(sent.at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "";
      showMedSummaryList(sent ? sent.dist : null, false, {
        order: true,
        noDouble, noDoubleError,
        title: "الطلبية — " + flowUnitName(),
        note: sent
          ? "المستلزمات: آخر إرسال إلى الجارت" + (sent.day ? " ليوم " + sent.day : "") + (when ? " (" + when + ")" : "")
          : "لم تُرسل مستلزمات إلى الجارت من هذا الجهاز بعد"
      });
    });

    // The print-chart-btn still works as before (chart mode):
    $("print-chart-btn").addEventListener("click", () => {
      if (!CHART_PRINT_ENABLED || !(Auth && Auth.isAdmin())) return;   // retired for now; admin only
      if (!state.medications || state.medications.length === 0) {
        flashHint("لا توجد أدوية في الكتالوج");
        return;
      }
      // Count occupied patients we order for
      const occCount = occupiedCount(orderedPatientsMap());
      if (occCount === 0) {
        flashHint("لا يوجد مرضى مشغولون لطباعة التشارت");
        return;
      }
      // Reset the submit button label + modal title in case the user
      // previously opened it via the distribute-send button.
      _supplyOrderMode = "chart";
      const submitBtn = $("supply-order-submit");
      if (submitBtn) {
        submitBtn.textContent = "توزيع واطبع التشارت";
      }
      const modalTitle = document.querySelector("#supply-order-modal .supply-order-head h3");
      if (modalTitle) {
        modalTitle.textContent = "قائمة طلب المستلزمات";
      }
      openSupplyOrderModal(occCount);
    });

    // (Sync button removed — Realtime handles live updates, and
    // pullCatalogOnBoot handles initial sync on app open.)

    // Admin back button
    $("admin-back-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      state.admin.selectedId = null;
      UI.hideAdminForm();
      state.currentBed = null;
      UI.showView("home");
    });

    // ----- Settings view (for non-admin pharmacists) -----
    $("settings-back-btn").addEventListener("click", () => {
      state.currentBed = null;
      UI.showView("home");
    });

    // Settings (and the admin page): critical-medicines monitoring
    ["settings-abx-btn", "admin-abx-btn"].forEach(id => {
      const b = $(id);
      if (b) b.addEventListener("click", () => {
        renderAbxMonitor();
        UI.showView("abx");
      });
    });

    // Settings: drug interactions (everyone)
    $("settings-interactions-btn").addEventListener("click", () => { renderInteractionsPage(); UI.showView("interactions"); });
    $("interactions-back-btn").addEventListener("click", () => UI.showView("settings"));
    ["ix-a", "ix-b"].forEach(id => $(id).addEventListener("change", renderInteractionsResult));

    // Settings: change own password
    $("settings-password-btn").addEventListener("click", openPasswordDialog);

    // Settings: chart bridge
    $("settings-bridge-btn").addEventListener("click", async () => {
      if (!global.PharmacyChartBridge) {
        flashHint("تعذّر تحميل وحدة جسر الجارت");
        return;
      }
      const unit = await askChoice("إرسال بيانات أي ردهة إلى الجارت؟", [["1", "الوحدة الأولى (نساء)"], ["3", "الوحدة الثالثة (رجال)"], ["p", "ردهة الخاص (الوحدتان)"]]);
      if (!unit) return;
      UI.showView("home");
      flashHint("يتم إرسال بيانات المرضى إلى الجارت...");
      setTimeout(async () => {
        try {
          const r = await global.PharmacyChartBridge.sendChart(orderingState(), null, flashHint, undefined, unit, unit === "p" ? "private" : "general");
          if (!r.cancelled) flashHint(global.PharmacyChartSync.describe(r));
        } catch (err) {
          flashHint("تعذّر الإرسال: " + (err.message || err));
        }
      }, 50);
    });

    // Settings: dark mode toggle button
    $("settings-darkmode-btn").addEventListener("click", () => {
      const html = document.documentElement;
      const isDark = html.getAttribute("data-theme") === "dark";
      if (isDark) {
        html.removeAttribute("data-theme");
        try { localStorage.setItem("pharma.darkmode", "false"); } catch (e) {}
      } else {
        html.setAttribute("data-theme", "dark");
        try { localStorage.setItem("pharma.darkmode", "true"); } catch (e) {}
      }
      // Update the value display immediately
      const valueEl = $("settings-darkmode-value");
      if (valueEl) {
        const nowDark = html.getAttribute("data-theme") === "dark";
        valueEl.textContent = nowDark ? "مُفعّل" : "مُعطّل";
      }
    });

    // Settings: catalogue editing (an allowed pharmacist)
    $("settings-catalog-btn").addEventListener("click", openCatalogEditor);
    $("settings-quotes-btn").addEventListener("click", openQuotesEditor);

    // Settings: TV display mode entry
    $("settings-tv-btn").addEventListener("click", () => {
      if (!(Auth && Auth.isAdmin && Auth.isAdmin())) return;   // admin + the TV account only
      // Close the settings view first, then enter display mode
      UI.showView("home");
      enterDisplayMode();
    });

    // ----- Med Request Modal (doctor → admin) -----
    // Opens a modal where the doctor enters the details of a new
    // medication not in the catalog. On submit, the request is saved
    // to localStorage + a notification is pushed for the admin.
    // The admin reviews it in the admin view and can approve (adds
    // the med to the catalog) or reject it.
    function openMedRequestModal() {
      // Clear all fields
      ["med-req-name-trade", "med-req-name-en", "med-req-name-ar",
       "med-req-dose", "med-req-notes"].forEach(id => {
        const el = $(id);
        if (el) el.value = "";
      });
      const formEl = $("med-req-form");
      if (formEl) formEl.value = "";
      const freqEl = $("med-req-frequency");
      if (freqEl) freqEl.value = "";
      const errEl = $("med-req-error");
      if (errEl) errEl.hidden = true;
      // Show modal
      $("med-request-overlay").hidden = false;
      $("med-request-modal").hidden = false;
      setTimeout(() => $("med-req-name-trade")?.focus(), 50);
    }
    function closeMedRequestModal() {
      $("med-request-overlay").hidden = true;
      $("med-request-modal").hidden = true;
    }
    function submitMedRequest() {
      // Doctors give only the name, the dosage form and the dose
      const nameTrade = ($("med-req-name-trade")?.value || "").trim();
      const missing = !nameTrade ? "med-req-name-trade"
        : !($("med-req-form")?.value || "").trim() ? "med-req-form"
        : !($("med-req-dose")?.value || "").trim() ? "med-req-dose" : null;
      if (missing) {
        $("med-req-error").hidden = false;
        $(missing)?.focus();
        return;
      }
      const nameEn = ($("med-req-name-en")?.value || "").trim();
      const nameAr = ($("med-req-name-ar")?.value || "").trim();
      const dose = ($("med-req-dose")?.value || "").trim();
      const form = ($("med-req-form")?.value || "").trim() || "tablet";
      const frequency = ($("med-req-frequency")?.value || "").trim() || "1×1";
      const notes = ($("med-req-notes")?.value || "").trim();
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;

      const record = {
        id: "med-req-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        nameTrade: nameTrade,
        nameEn: nameEn,
        nameAr: nameAr,
        dose: dose,
        form: form,
        frequency: frequency,
        notes: notes,
        requestedBy: user ? user.username : "—",
        requestedAt: new Date().toISOString(),
        status: "pending"
      };
      Storage.addMedRequest(record);
      // Push to Supabase so the admin on ANOTHER device sees the request
      if (SB && SB.isConfigured && SB.isConfigured()) {
        const client = SB.getClient();
        if (client) {
          client.from("med_requests").upsert({
            id: record.id,
            name_trade: record.nameTrade,
            name_en: record.nameEn,
            name_ar: record.nameAr,
            dose: record.dose,
            form: record.form,
            frequency: record.frequency,
            notes: record.notes,
            requested_by: record.requestedBy,
            requested_at: record.requestedAt,
            status: "pending"
          }).then(({ error }) => {
            if (error) console.warn("[Supabase] med request push failed:", error.message);
          });
        }
      }
      // Push a notification so the admin sees a new request waiting
      pushNotification("med_request",
        `طلب دواء جديد: ${nameTrade} — من ${user ? (user.displayName || user.username) : "—"}`,
        nameTrade, "");
      closeMedRequestModal();
      flashHint("تم إرسال طلب إضافة الدواء — سيتم مراجعته من قبل المسؤول");
    }
    $("settings-med-request-btn").addEventListener("click", openMedRequestModal);
    $("med-request-close").addEventListener("click", closeMedRequestModal);
    $("med-request-cancel").addEventListener("click", closeMedRequestModal);
    $("med-request-overlay").addEventListener("click", closeMedRequestModal);
    $("med-request-submit").addEventListener("click", submitMedRequest);

    // ----- Admin: render med requests list -----
    // Renders the pending + reviewed med requests in the admin view.
    // The admin can approve (adds to catalog) or reject each request.
    // NOTE: These functions are ALSO defined at the top-level scope
    // (outside bindEvents) so openAdminView() can call renderMedRequests().
    // The top-level definitions are the REAL ones — these are kept
    // here only for the event-listener binding that references
    // approveMedRequest/rejectMedRequest via closure.
    // The actual implementations are at the top-level after bindEvents.

    // Settings: logout button
    $("settings-logout-btn").addEventListener("click", userLogout);

    // Admin "دواء جديد"
    $("admin-new-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = true;
      state.admin.selectedId = null;
      UI.showAdminForm({}, true);
      UI.renderAdminMedList(state.medications, null);
      $("adm-name-ar").focus();
    });

    // Admin list clicks (delegated) — edit / delete
    // (move-up/down/top/bottom replaced with drag-and-drop, see below)
    $("admin-med-list").addEventListener("click", (e) => {
      const editBtn = e.target.closest('[data-action="edit-med"]');
      const delBtn  = e.target.closest('[data-action="del-med"]');
      if (editBtn) {
        const id = editBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.showAdminForm(m, false);
        UI.renderAdminMedList(state.medications, id);
      } else if (delBtn) {
        const id = delBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        const label = UI.primaryName(m) || "هذا الدواء";
        if (!confirm(`حذف "${label}" من الكتالوج؟\n(لن يؤثر على العلاجات المسجلة بالفعل على المرضى)`)) return;
        // Cloud is the source of truth: snapshot before edit, revert on push failure
        const snapshot = state.medications.slice();
        state.medications = state.medications.filter(x => x.id !== id);
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: restore snapshot, re-save, re-render
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
        });
        if (state.admin.editingId === id) {
          state.admin.editingId = null;
          state.admin.isNew = false;
          UI.hideAdminForm();
        }
        state.admin.selectedId = null;
        UI.renderAdminMedList(state.medications, null);
        flashHint("تم حذف الدواء من الكتالوج");
      }
    });

    // ---- Drag-and-drop reordering for the admin med list ----
    // Each .admin-med-row is draggable=true (set in ui.js). We use
    // HTML5 Drag and Drop API to allow the user to grab a row and
    // drop it in a new position — the entire state.medications array
    // is reordered accordingly (across all form groups). On drop,
    // we save + push to cloud + re-render.
    (function setupAdminDragDrop() {
      const listEl = $("admin-med-list");
      if (!listEl) return;

      let draggedId = null;
      let draggedRow = null;

      // dragstart: capture the dragged row's med id
      listEl.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (!row) return;
        draggedId = row.dataset.medId;
        draggedRow = row;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        // Some browsers require setData for drag to start
        try { e.dataTransfer.setData("text/plain", draggedId); } catch (_) {}
      });

      // dragend: cleanup
      listEl.addEventListener("dragend", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (row) row.classList.remove("dragging");
        // Clear any remaining drag-over markers
        listEl.querySelectorAll(".admin-med-row.drag-over").forEach(r => {
          r.classList.remove("drag-over");
        });
        draggedId = null;
        draggedRow = null;
      });

      // dragover: prevent default to allow drop, mark the row under the
      // cursor with .drag-over so we can show a visual indicator
      listEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const row = e.target.closest(".admin-med-row");
        if (!row || row === draggedRow) return;
        // Clear previous drag-over markers, set on the new one
        listEl.querySelectorAll(".admin-med-row.drag-over").forEach(r => {
          r.classList.remove("drag-over");
        });
        row.classList.add("drag-over");
      });

      // dragleave: clear drag-over when leaving a row
      listEl.addEventListener("dragleave", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (row) row.classList.remove("drag-over");
      });

      // drop: reorder the med in state.medications
      listEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetRow = e.target.closest(".admin-med-row");
        if (!targetRow || !draggedId) return;
        const targetId = targetRow.dataset.medId;
        if (targetId === draggedId) return;  // dropped on itself

        const fromIdx = state.medications.findIndex(x => x.id === draggedId);
        const toIdx   = state.medications.findIndex(x => x.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;

        const snapshot = state.medications.slice();
        const item = state.medications[fromIdx];
        state.medications.splice(fromIdx, 1);
        state.medications.splice(toIdx, 0, item);
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, draggedId);
        });
        UI.renderAdminMedList(state.medications, draggedId);
        // Scroll the moved row into view
        const rowEl = document.querySelector(`.admin-med-row[data-med-id="${draggedId}"]`);
        if (rowEl) rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    })();

    // Admin: frequency dropdown — toggle custom field
    $("adm-freq").addEventListener("change", UI.toggleAdminFreqCustom);

    // Admin: cancel edit
    $("admin-cancel").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      UI.hideAdminForm();
    });

    // Admin: save (add or update)
    $("admin-save").addEventListener("click", () => {
      const data = UI.readAdminForm();
      // validation — at least one name is required (trade, ar, or en)
      if (!data.nameTrade && !data.nameAr && !data.nameEn) {
        flashHint("أدخل اسم الدواء (تجاري أو علمي)");
        $("adm-name-trade").focus();
        return;
      }
      // dose is OPTIONAL — some forms (syrups, solutions) don't have
      // a fixed dose, so we allow it to be empty.
      if (!data.defaultFrequency) {
        flashHint("أدخل التكرار الافتراضي");
        $("adm-freq").focus();
        return;
      }
      if (state.admin.isNew) {
        // generate stable id from scientific name (preferred) or trade name or arabic
        const baseSource = data.nameEn || data.nameTrade || data.nameAr;
        const base = baseSource
          .toLowerCase()
          .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32) || ("med-" + Date.now());
        let id = base;
        let counter = 2;
        while (state.medications.some(m => m.id === id)) {
          id = `${base}-${counter++}`;
        }
        const snapshot = state.medications.slice();
        state.medications.push({
          id,
          nameTrade: data.nameTrade,
          nameAr:    data.nameAr,
          nameEn:    data.nameEn,
          nameChart: data.nameChart,
          form:      data.form,
          defaultDose: data.defaultDose,
          defaultFrequency: data.defaultFrequency
        });
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: remove the added med, re-save, re-render
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
        });
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.renderAdminMedList(state.medications, id);
        // keep form open so admin can keep editing if desired, but switch title to edit
        UI.showAdminForm(state.medications.find(m => m.id === id), false);
        flashHint("تمت إضافة الدواء");
      } else {
        const m = state.medications.find(x => x.id === state.admin.editingId);
        if (!m) return;
        const snapshot = state.medications.slice();
        m.nameTrade = data.nameTrade;
        m.nameAr = data.nameAr;
        m.nameEn = data.nameEn;
        m.nameChart = data.nameChart;
        m.form = data.form;
        m.defaultDose = data.defaultDose;
        m.defaultFrequency = data.defaultFrequency;
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: restore the pre-edit snapshot
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, m.id);
        });
        UI.renderAdminMedList(state.medications, m.id);
        flashHint("تم حفظ التعديلات");
      }
    });

    // Admin: merge missing default meds into the current catalog and
    // push the result to the cloud. Unlike 'restore' (which replaces
    // the catalog with the defaults), this MERGES: keeps all the
    // user's existing meds (including custom ones they added) AND
    // adds any default med that's missing by id.
    //
    // Use case: user has 64 meds in their cloud (32 old defaults +
    // 32 custom additions). DEFAULT_MEDICATIONS now has 56 meds
    // (32 old + 24 new). Merging gives 64 + 24 = 88 meds.
    $("admin-restore-default-catalog").addEventListener("click", async () => {
      const def = (Meds && Meds.DEFAULT_MEDICATIONS) || [];
      if (!Array.isArray(def) || def.length === 0) {
        flashHint("لا يوجد كتالوج افتراضي متاح");
        return;
      }
      // Find which default meds are missing from the current catalog
      const existingIds = new Set(state.medications.map(m => m && m.id).filter(Boolean));
      const missing = def.filter(m => m && m.id && !existingIds.has(m.id));
      if (missing.length === 0) {
        flashHint("كل الأدوية الافتراضية موجودة بالفعل في الكتالوج");
        return;
      }
      if (!confirm(`سيتم إضافة ${missing.length} دواء جديد من الكتالوج الافتراضي إلى الكتالوج الحالي (${state.medications.length} دواء).\nالكتالوج سيصبح ${state.medications.length + missing.length} دواء ويرتفع للسحابة.\nكل الأجهزة ستراه بعد المزامنة.\nهل تريد المتابعة؟`)) return;
      // Snapshot for revert
      const snapshot = state.medications.slice();
      // Merge: append missing default meds to the current catalog
      // (preserves user's custom meds AND the existing order)
      const merged = state.medications.concat(missing);
      state.medications = merged;
      Storage.saveMedications(merged);
      UI.renderAdminMedList(merged, null);
      flashHint(`تمت إضافة ${missing.length} دواء محليًا — جارٍ الرفع للسحابة…`);
      // Push merged catalog to the cloud so other devices also get them
      if (SBSync && SBSync.pushCatalog && SB && SB.isConfigured()) {
        const res = await SBSync.pushCatalog();
        if (res.ok) {
          updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
          flashHint(`تم رفع ${res.count} دواء للسحابة — كل الأجهزة ستراها`);
        } else {
          // Revert on failure so the user knows the cloud didn't get it
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
          updateSupabaseStatusUI("فشل الرفع: " + res.error, "error");
          flashHint("فشل الرفع — تم إلغاء الإضافة. تحقق من الشبكة وحاول مرة أخرى");
        }
      } else {
        flashHint(`تمت إضافة ${missing.length} دواء محليًا (Supabase غير مُهيّأ — الأجهزة الأخرى لن تراها)`);
      }
    });

    // Admin: wipe patients only (keep medications)
    $("admin-wipe").addEventListener("click", () => {
      if (!confirm("⚠ تحذير: هذا سيمسح جميع بيانات المرضى نهائيًا.\nالأدوية لن تُمسح.\nهل أنت متأكد؟")) return;
      // Audit log — record the sensitive wipe action
      if (Auth && Auth.auditLog) {
        Auth.auditLog("data_wiped", "مسح جميع بيانات المرضى");
      }
      // Every bed card — with or without a name (plate, labs, medicines…)
      Storage.wipeAllPatients();
      state.patients = {};
      state.currentBed = null;
      UI.showView("home");
      refreshStatsAndRooms();
      flashHint("تم مسح جميع بيانات المرضى");
      // The cloud rows + a marker so every other device drops its copies too
      // (the only bulk delete; everywhere else we upsert-merge)
      if (SBSync && SBSync.wipeAllPatientsEverywhere) {
        SBSync.wipeAllPatientsEverywhere().then(r => {
          if (!r.ok) { console.warn("[Supabase] wipe push failed:", r.error); flashHint("تعذّر المسح من السحابة: " + r.error); }
        });
      }
    });

    // ----- User Management (admin only) -----
    // NOTE: the renderUsersList() and refreshUsersList() functions
    // are defined at the module top-level (outside bindEvents) so
    // that openAdminView() can call them. The event listeners below
    // reference the same top-level functions via closure.
    // Create new user button
    $("user-create-btn").addEventListener("click", async () => {
      const displayName = $("user-display-name").value.trim();
      const username = $("user-username").value.trim().toLowerCase();
      const password = $("user-password").value;
      const role = $("user-role").value;
      const gender = $("user-gender").value;
      if (role === "admin" && !(Auth && Auth.isSuperAdmin && Auth.isSuperAdmin())) { flashHint("إنشاء مسؤول بصلاحية قصوى للمسؤول الأعلى فقط"); return; }
      if (!displayName || !username || !password) {
        flashHint("أدخل جميع الحقول الثلاثة");
        return;
      }
      if (!Auth || !Auth.createUser) { flashHint("نظام المصادقة غير مُهيّأ"); return; }
      const creator = Auth.getCurrentUser();
      const res = await Auth.createUser(creator ? creator.username : "admin", username, password, displayName, role, gender);
      if (res.ok) {
        flashHint(`تم إنشاء المستخدم "${displayName}"`);
        $("user-display-name").value = "";
        $("user-username").value = "";
        $("user-password").value = "";
        $("user-role").value = "pharmacist";
        $("user-gender").value = "male";
        refreshUsersList();
      } else {
        flashHint("فشل إنشاء المستخدم: " + (res.error || ""));
      }
    });
    // Refresh users list button
    $("user-refresh-btn").addEventListener("click", refreshUsersList);
    // User row actions (event delegation)
    $("admin-users-list").addEventListener("click", async (e) => {
      const flagBtn = e.target.closest(".btn-user-flag");
      if (flagBtn) {
        const on = !flagBtn.dataset.on;
        const what = flagBtn.dataset.flag === "can_exit_patients"
          ? "حذف المرضى وتفريغ الأسرّة والخروج والوفاة"
          : "إدارة مقولات شاشة العرض";
        if (!confirm((on ? "السماح لـ «" : "إلغاء سماح «") + flagBtn.dataset.name + "» بـ" + what + "؟")) return;
        const res = await Auth.setUserFlag(flagBtn.dataset.uid, flagBtn.dataset.flag, on);
        flashHint(res.ok ? (on ? "✓ تم منح الصلاحية (تظهر بعد تسجيل الدخول من جديد)" : "أُلغيت الصلاحية") : "تعذّر الحفظ: " + res.error);
        if (res.ok) refreshUsersList();
        return;
      }
      const catBtn = e.target.closest(".btn-user-catalog");
      if (catBtn) {
        const on = !catBtn.dataset.on;
        if (!confirm((on ? "السماح لـ «" : "إلغاء سماح «") + catBtn.dataset.name + (on ? "» بإضافة الأدوية وتعديلها في الكتالوج؟" : "» بتعديل الكتالوج؟"))) return;
        const res = await Auth.setCatalogEditor(catBtn.dataset.uid, on);
        flashHint(res.ok ? (on ? "✓ صار بإمكانها/بإمكانه تعديل الكتالوج (بعد تسجيل الدخول من جديد)" : "أُلغيت صلاحية تعديل الكتالوج") : "تعذّر الحفظ: " + res.error);
        if (res.ok) refreshUsersList();
        return;
      }
      const resetBtn = e.target.closest(".btn-user-reset");
      const toggleBtn = e.target.closest(".btn-user-toggle");
      const deleteBtn = e.target.closest(".btn-user-delete");
      if (resetBtn) {
        const uid = resetBtn.dataset.uid;
        const name = resetBtn.dataset.name;
        const newPass = prompt(`إعادة تعيين كلمة المرور للمستخدم "${name}"\nأدخل كلمة المرور الجديدة (${Auth.MIN_PASSWORD || 8} أحرف على الأقل):`);
        if (!newPass) return;
        if (!Auth || !Auth.resetPassword) return;
        const res = await Auth.resetPassword(uid, newPass);
        if (res.ok) flashHint(`تم تغيير كلمة مرور "${name}"`);
        else flashHint("فشل تغيير كلمة المرور: " + (res.error || ""));
      } else if (toggleBtn) {
        const uid = toggleBtn.dataset.uid;
        const cur = toggleBtn.dataset.active === "true";
        if (!confirm(cur ? "تعطيل هذا الحساب؟" : "تفعيل هذا الحساب؟")) return;
        if (!Auth || !Auth.toggleUserActive) return;
        const res = await Auth.toggleUserActive(uid, cur);
        if (res.ok) { flashHint(cur ? "تم التعطيل" : "تم التفعيل"); refreshUsersList(); }
        else flashHint("فشل: " + (res.error || ""));
      } else if (deleteBtn) {
        const uid = deleteBtn.dataset.uid;
        const username = deleteBtn.dataset.username;
        const name = deleteBtn.dataset.name;
        if (!confirm(`⚠ حذف نهائي للمستخدم "${name}" (@${username})؟\nلا يمكن التراجع.`)) return;
        if (!Auth || !Auth.deleteUser) return;
        if (Auth.auditLog) Auth.auditLog("user_deleted", `حذف مستخدم "${name}" (@${username})`);
        const res = await Auth.deleteUser(uid);
        if (res.ok) { flashHint("تم حذف المستخدم"); refreshUsersList(); }
        else flashHint("فشل الحذف: " + (res.error || ""));
      }
    });

    // ----- Audit log (admin only) -----
    // NOTE: renderAuditLog() and refreshAuditLog() are defined at
    // module top-level so openAdminView() can call them.
    $("audit-refresh-btn").addEventListener("click", refreshAuditLog);
    $("audit-clear-btn").addEventListener("click", clearAuditLog);
    $("med-requests-clear-btn").addEventListener("click", clearReviewedMedRequests);

    // ----- Supabase: test / save / clear -----
    $("sb-test").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      // Use whatever is currently in the inputs (even if not saved yet)
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        return;
      }
      // Save temporarily so testConnection can use it
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("جارٍ الاختبار…", "loading");
      const res = await SB.testConnection();
      if (res.ok) {
        updateSupabaseStatusUI("الاتصال ناجح ✓", "connected");
        flashHint("تم الاتصال بـ Supabase بنجاح");
      } else {
        updateSupabaseStatusUI("فشل الاتصال: " + res.error, "error");
        flashHint("فشل الاتصال بـ Supabase");
      }
    });

    $("sb-save").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        flashHint("أدخل URL و Anon Key");
        return;
      }
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("تم الحفظ · جارٍ المزامنة…", "loading");
      flashHint("تم حفظ إعدادات Supabase");
      // Try to pull the catalog right away
      const res = await SBSync.pullCatalog();
      if (res.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
        flashHint("تمت المزامنة من Supabase");
      } else {
        // Pull failed → push the local catalog to populate the empty table
        const pushRes = await SBSync.pushCatalog();
        if (pushRes.ok) {
          updateSupabaseStatusUI(`مربوط · ${pushRes.count} دواء (مرفوع محليًا)`, "connected");
          flashHint("تم رفع الكتالوج المحلي إلى Supabase");
        } else {
          updateSupabaseStatusUI("مربوط لكن فشلت المزامنة: " + pushRes.error, "error");
          flashHint("فشلت المزامنة مع Supabase");
        }
      }
      // Also merge-pull patients so the user's local patients stay
      // in sync with any other device that pushed data to the cloud.
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
      }
    });

    $("sb-clear").addEventListener("click", () => {
      if (!SB) return;
      if (!confirm("إلغاء ربط Supabase؟ سيبقى الكتالوج المحلي كما هو.")) return;
      SB.clearConfig();
      refreshSupabaseInputs();
      updateSupabaseStatusUI("غير مربوط");
      flashHint("تم إلغاء ربط Supabase");
    });

    // Manual push/pull buttons (advanced)
    $("sb-push-now").addEventListener("click", pushCatalogManual);
    $("sb-pull-now").addEventListener("click", pullCatalogManual);
  }

  // -------- Admin: User Management + Audit Log helpers --------
  // These are top-level (not inside bindEvents) so openAdminView()
  // can call them. bindEvents() wires the event listeners that
  // reference the same functions via closure.
  function renderUsersList(users) {
    const container = $("admin-users-list");
    if (!container) return;
    if (!Array.isArray(users) || users.length === 0) {
      container.innerHTML = '<div class="admin-users-empty">لا يوجد مستخدمون بعد. أنشئ أول مستخدم بالأعلى.</div>';
      return;
    }
    const currentUser = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    container.innerHTML = "";
    users.forEach(u => {
      const row = document.createElement("div");
      row.className = "admin-user-row" + (u.active === false ? " is-inactive" : "");
      const roleLabel =
        u.role === "admin" ? (u.limited_admin ? "مسؤول الطابق" : "مسؤول ذو صلاحية قصوى") :
        u.role === "doctor" ? "طبيب" :
        u.role === "tv" ? "تلفاز (عرض فقط)" :
        "صيدلي";
      const created = u.created_at
        ? new Date(u.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })
        : "—";
      // Strip the |male or |female suffix from display_name for UI
      const cleanName = escapeHtml((u.display_name || "").split("|")[0] || u.username);
      const uname = escapeHtml(u.username);
      const uid = escapeHtml(u.id);
      // Extract gender for a small badge
      const genderSuffix = (u.display_name || "").split("|")[1];
      const genderLabel = genderSuffix === "female" ? "أنثى" : "ذكر";
      row.innerHTML = `
        <div class="admin-user-info">
          <div class="admin-user-name">${cleanName}</div>
          <div class="admin-user-meta">
            <span class="admin-user-username">@${uname}</span>
            <span class="admin-user-role admin-user-role-${escapeHtml(u.role)}">${roleLabel}</span>
            <span class="admin-user-gender">${genderLabel}</span>
            <span class="admin-user-state ${u.active === false ? "is-off" : "is-on"}">${u.active === false ? "معطّل" : "نشط"}</span>
          </div>
          <div class="admin-user-meta">أنشأه: ${escapeHtml(u.created_by || "—")} · ${created}</div>
        </div>
        <div class="admin-user-actions">
          <button class="btn-user-reset" data-uid="${uid}" data-name="${cleanName}" type="button">🔑 كلمة مرور</button>
          ${u.role === "pharmacist" ? `<button class="btn-user-catalog btn-user-flag${u.can_exit_patients ? " is-on" : ""}" data-flag="can_exit_patients" data-uid="${uid}" data-name="${cleanName}" data-on="${u.can_exit_patients ? "1" : ""}" type="button">${u.can_exit_patients ? "✓ الحذف والخروج" : "الحذف والخروج"}</button><button class="btn-user-catalog btn-user-flag${u.can_edit_quotes ? " is-on" : ""}" data-flag="can_edit_quotes" data-uid="${uid}" data-name="${cleanName}" data-on="${u.can_edit_quotes ? "1" : ""}" type="button">${u.can_edit_quotes ? "✓ المقولات" : "المقولات"}</button>` : ""}
          <button class="btn-user-toggle" data-uid="${uid}" data-active="${u.active}" type="button">${u.active === false ? "تفعيل" : "تعطيل"}</button>
          <button class="btn-user-delete" data-uid="${uid}" data-username="${uname}" data-name="${cleanName}" type="button">🗑 حذف</button>
        </div>
      `;
      // Don't let admin delete or disable their own account
      if (currentUser && currentUser.username === u.username) {
        row.querySelectorAll(".btn-user-toggle, .btn-user-delete").forEach(b => b.remove());
      }
      // The supreme admin's account is untouchable by anyone else (the database refuses it too, features.sql §25)
      if (u.role === "admin" && !u.limited_admin && !(Auth.isSuperAdmin && Auth.isSuperAdmin())) {
        const acts = row.querySelector(".admin-user-actions");
        if (acts) acts.innerHTML = '<span class="admin-user-locked">🔒 حساب محمي</span>';
      }
      container.appendChild(row);
    });
  }
  async function refreshUsersList() {
    if (!Auth || !Auth.listUsers) return;
    const list = $("admin-users-list");
    if (list) list.innerHTML = '<div class="admin-users-loading">جارٍ التحميل…</div>';
    const res = await Auth.listUsers();
    if (res.ok) renderUsersList(res.users);
    else if (list) list.innerHTML = '<div class="admin-users-error">فشل تحميل المستخدمين: ' + (res.error || "") + '</div>';
  }
  function renderAuditLog(entries) {
    const container = $("admin-audit-list");
    if (!container) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      container.innerHTML = '<div class="admin-audit-empty">لا يوجد نشاط مسجّل بعد.</div>';
      return;
    }
    const actionLabels = {
      patient_added: "➕ إضافة مريض",
      patient_deleted: "❌ حذف مريض",
      med_added: "💊 إضافة دواء",
      med_deleted: "🗑 حذف دواء",
      data_wiped: "⚠️ مسح بيانات",
      user_deleted: "👤 حذف مستخدم"
    };
    container.innerHTML = "";
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "audit-row";
      const dt = entry.created_at
        ? new Date(entry.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "medium" })
        : "—";
      row.innerHTML = `
        <div class="audit-row-meta">
          <span class="audit-user">${escapeHtml(displayNameOf(entry.username))}</span>
          <span class="audit-action">${actionLabels[entry.action] || escapeHtml(entry.action)}</span>
          <span class="audit-time">${dt}</span>
        </div>
        <div class="audit-row-details">${escapeHtml(typeof entry.details === "object" && entry.details ? JSON.stringify(entry.details) : (entry.details || ""))}</div>
      `;
      container.appendChild(row);
    });
  }
  async function refreshAuditLog() {
    if (!Auth || !Auth.getAuditLog) return;
    const list = $("admin-audit-list");
    if (list) list.innerHTML = '<div class="admin-audit-loading">جارٍ التحميل…</div>';
    const [res] = await Promise.all([Auth.getAuditLog(200), loadDisplayNames()]);   // show display names
    if (res.ok) renderAuditLog(res.entries);
    else if (list) list.innerHTML = '<div class="admin-audit-error">فشل تحميل السجل: ' + (res.error || "") + '</div>';
  }

  // Admin: empty the sensitive-activity log (after a confirmation)
  async function clearAuditLog() {
    if (!(Auth && Auth.isAdmin && Auth.isAdmin()) || !Auth.clearAuditLog) return;
    if (!confirm("مسح سجل النشاط الحساس بالكامل من جميع الأجهزة؟\nلا يمكن التراجع عن ذلك.")) return;
    const res = await Auth.clearAuditLog();
    if (!res.ok) { alert("تعذّر مسح السجل: " + (res.error || "")); return; }
    flashHint("تم مسح سجل النشاط الحساس");
    refreshAuditLog();
  }
  // Admin: remove approved / rejected med requests; pending ones stay
  // (they still need a decision).
  async function clearReviewedMedRequests() {
    if (!(Auth && Auth.isAdmin && Auth.isAdmin())) return;
    const all = Storage.loadMedRequests();
    const reviewed = all.filter(r => r.status === "approved" || r.status === "rejected");
    if (!reviewed.length) { flashHint("لا توجد طلبات مُراجَعة للمسح"); return; }
    if (!confirm("مسح " + reviewed.length + " طلباً مُراجَعاً (موافَق عليه أو مرفوض)؟\nالطلبات المعلّقة تبقى.")) return;
    const client = SB && SB.getClient ? SB.getClient() : null;
    if (client) {
      const { error } = await client.from("med_requests").delete().in("status", ["approved", "rejected"]);
      if (error) { alert("تعذّر مسح الطلبات: " + error.message); return; }
    }
    Storage.saveMedRequests(all.filter(r => r.status !== "approved" && r.status !== "rejected"));
    renderMedRequests();
    flashHint("تم مسح الطلبات المُراجَعة");
  }

  // -------- Settings view (for non-admin pharmacists) --------
  // -------- Admin: Med Requests (top-level, outside bindEvents) --------
  // These functions are defined here (top-level scope, NOT inside
  // bindEvents) so openAdminView() can call renderMedRequests().
  // (bindEvents is a separate closure — functions defined inside it
  // are not accessible from openAdminView which lives at the top level.)
  function renderMedRequests() {
    const list = $("admin-med-requests-list");
    if (!list) return;
    list.innerHTML = "";
    const requests = Storage.loadMedRequests();
    if (requests.length === 0) {
      list.innerHTML = `<p class="admin-discharged-hint">لا توجد طلبات حالياً</p>`;
      return;
    }
    const formLabels = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    requests.forEach(r => {
      const dateStr = r.requestedAt
        ? new Date(r.requestedAt).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
        : "—";
      const statusBadge = r.status === "pending"
        ? `<span style="background:#FEF3C7;color:#A16207;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">بانتظار</span>`
        : r.status === "approved"
        ? `<span style="background:#DCFCE7;color:#15803D;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">موافق</span>`
        : `<span style="background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">مرفوض</span>`;
      const card = document.createElement("div");
      card.className = "discharged-row";
      let actionsHtml = "";
      if (r.status === "pending") {
        actionsHtml = `
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button type="button" data-action="approve" data-id="${r.id}"
              style="flex:1;padding:8px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
              ✅ موافقة وإضافة
            </button>
            <button type="button" data-action="reject" data-id="${r.id}"
              style="flex:1;padding:8px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
              ❌ رفض
            </button>
          </div>
        `;
      }
      card.innerHTML = `
        <div class="discharged-row-head">
          <div class="discharged-row-name">${escapeHtml(r.nameTrade || "—")}</div>
          <div class="discharged-row-date">${dateStr} ${statusBadge}</div>
        </div>
        <div class="discharged-row-meta">
          <span>${escapeHtml(r.nameEn || "")}</span>
          ${r.nameAr ? `<span>· ${escapeHtml(r.nameAr)}</span>` : ""}
          ${r.dose ? `<span>· ${escapeHtml(r.dose)}</span>` : ""}
          <span>· ${escapeHtml(formLabels[r.form] || r.form || "—")}</span>
          <span>· ${escapeHtml(r.frequency || "—")}</span>
          ${r.notes ? `<span>· 📝 ${escapeHtml(r.notes)}</span>` : ""}
          <span>· طلب: ${escapeHtml(r.requestedBy || "—")}</span>
        </div>
        ${actionsHtml}
      `;
      list.appendChild(card);
    });
    list.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === "approve") approveMedRequest(id);
        else if (action === "reject") rejectMedRequest(id);
      });
    });
  }
  function approveMedRequest(id) {
    const requests = Storage.loadMedRequests();
    const req = requests.find(r => r.id === id);
    if (!req) return;
    const slug = (req.nameTrade || req.nameEn || "med")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "med-" + Date.now();
    const medId = slug + "-" + Date.now().toString(36);
    const meds = Storage.loadMedications();
    meds.push({
      id: medId,
      nameTrade: req.nameTrade || "",
      nameAr: req.nameAr || "",
      nameEn: req.nameEn || "",
      form: req.form || "tablet",
      defaultDose: req.dose || "",
      defaultFrequency: req.frequency || "1×1"
    });
    Storage.saveMedications(meds);
    state.medications = meds;
    if (SBSync && SBSync.pushCatalog) {
      SBSync.pushCatalog().then(r => {
        if (!r.ok) console.warn("[Supabase] catalog push failed:", r.error);
      });
    }
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const reviewedAt = new Date().toISOString();
    Storage.updateMedRequest(id, {
      status: "approved",
      reviewedBy: user ? user.username : "—",
      reviewedAt: reviewedAt,
      approvedMedId: medId
    });
    // Also update Supabase so the status syncs to other devices
    if (SB && SB.isConfigured && SB.isConfigured()) {
      const client = SB.getClient();
      if (client) {
        client.from("med_requests").update({
          status: "approved",
          reviewed_by: user ? user.username : "—",
          reviewed_at: reviewedAt,
          approved_med_id: medId
        }).eq("id", id).then(({ error }) => {
          if (error) console.warn("[Supabase] med request update failed:", error.message);
        });
      }
    }
    UI.renderAdminMedList(meds, null);
    renderMedRequests();
    flashHint(`تمت إضافة "${req.nameTrade}" إلى كتالوج الأدوية`);
  }
  function rejectMedRequest(id) {
    const requests = Storage.loadMedRequests();
    const req = requests.find(r => r.id === id);
    if (!req) return;
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const reviewedAt = new Date().toISOString();
    Storage.updateMedRequest(id, {
      status: "rejected",
      reviewedBy: user ? user.username : "—",
      reviewedAt: reviewedAt
    });
    // Also update Supabase so the status syncs to other devices
    if (SB && SB.isConfigured && SB.isConfigured()) {
      const client = SB.getClient();
      if (client) {
        client.from("med_requests").update({
          status: "rejected",
          reviewed_by: user ? user.username : "—",
          reviewed_at: reviewedAt
        }).eq("id", id).then(({ error }) => {
          if (error) console.warn("[Supabase] med request update failed:", error.message);
        });
      }
    }
    renderMedRequests();
    flashHint(`تم رفض طلب "${req.nameTrade}"`);
  }

  // Shows a simplified settings page with:
  //   - Dark/light mode toggle
  //   - TV display mode entry
  //   - Logout button
  // Opens when a non-admin pharmacist taps the gear ⚙ button. Admins
  // see the full admin view (openAdminView) instead.
  function openSettingsView() {
    // Update the dark-mode value display
    const valueEl = $("settings-darkmode-value");
    if (valueEl) {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      valueEl.textContent = isDark ? "مُفعّل" : "مُعطّل";
    }
    const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
    // The ward display: the admin (header button) and the TV account only
    // Catalogue editing: a pharmacist the admin allowed
    const catRow = $("settings-catalog-btn");
    if (catRow) catRow.hidden = !(Auth && Auth.canEditCatalog && Auth.canEditCatalog() && !(Auth.isAdmin && Auth.isAdmin()));
    const quotesRow = $("settings-quotes-btn");
    if (quotesRow) quotesRow.hidden = !(Auth && Auth.canEditQuotes && Auth.canEditQuotes() && !(Auth.isAdmin && Auth.isAdmin()));
    const tvRow = $("settings-tv-btn");
    if (tvRow) tvRow.hidden = !(Auth && Auth.isAdmin && Auth.isAdmin());
    // Hide the chart bridge row for ALL roles — its functionality is
    // now integrated into the new "distribute-send-btn" in the header
    // (which combines supply distribution + med-summary review +
    // chart-bridge send into one workflow). Admins + pharmacists
    // use that header button; doctors don't see it (it's a
    // pharmacist task).
    const bridgeRow = $("settings-bridge-btn");
    if (bridgeRow) bridgeRow.hidden = true;
    // Hide ABX + Albumin monitoring row for doctors. That monitoring
    // is a pharmacist task — doctors don't need to see antibiotic
    // usage reports. Admins + pharmacists still see it.
    const abxRow = $("settings-abx-btn");
    if (abxRow) abxRow.hidden = isDoctor;
    // Show the "request new medication" row only for doctors (the
    // primary users who request new meds) + admins (who may also
    // want to add meds directly). Hide it for pharmacists.
    const medReqRow = $("settings-med-request-btn");
    if (medReqRow) {
      const isAdmin = Auth && Auth.isAdmin();
      medReqRow.hidden = !(isDoctor || isAdmin);
    }
    // Show pending med requests count for admins in the row value
    if (Auth && Auth.isAdmin && Auth.isAdmin()) {
      const pendingCount = Storage.getPendingMedRequestsCount();
      const valEl = $("settings-med-request-value");
      if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
    }
    // The discharged/dead patients list row stays visible to ALL
    // roles (admin + doctor + pharmacist) — every role may need
    // to look up a returning patient's history.
    UI.showView("settings");
  }

  // -------- Admin view --------
  // A pharmacist the admin allowed: the medicines catalogue only (add / edit),
  // in the admin view with every other section hidden (.catalog-only)
  function openCatalogEditor() {
    if (!(Auth && Auth.canEditCatalog && Auth.canEditCatalog())) return;
    if (Auth.isAdmin && Auth.isAdmin()) { openAdminView(); return; }
    state.admin.isNew = false;
    state.admin.selectedId = null;
    UI.hideAdminForm();
    UI.renderAdminMedList(state.medications, null);
    $("view-admin").classList.remove("quotes-only");
    $("view-admin").classList.add("catalog-only");
    UI.showView("admin");
  }

  // A pharmacist the admin allowed: the ward-display sayings only
  function openQuotesEditor() {
    if (!(Auth && Auth.canEditQuotes && Auth.canEditQuotes())) return;
    if (Auth.isAdmin && Auth.isAdmin()) { openAdminView(); return; }
    $("view-admin").classList.remove("catalog-only");
    $("view-admin").classList.add("quotes-only");
    const quotesSection = document.getElementById("admin-quotes-section");
    if (quotesSection) quotesSection.hidden = false;
    if (global.PharmacyDailyQuotes) global.PharmacyDailyQuotes.renderAdmin();
    UI.showView("admin");
  }

  function openAdminView() {
    $("view-admin").classList.remove("catalog-only");
    $("view-admin").classList.remove("quotes-only");
    state.admin.isNew = false;
    state.admin.selectedId = null;
    UI.hideAdminForm();
    UI.renderAdminMedList(state.medications, null);
    refreshSupabaseInputs();
    // The default Supabase config is embedded, so the app is always
    // "configured" out of the box. Show that in the status badge.
    if (SB && SB.isConfigured()) {
      const usingEmbedded = SB.isUsingEmbedded();
      const label = usingEmbedded ? "مربوط تلقائيًا · جاهز للمزامنة" : "مربوط بإعداد مخصص";
      updateSupabaseStatusUI(label, "connected");
    } else {
      updateSupabaseStatusUI("غير مربوط");
    }
    // Show/hide the admin-only User Management + Audit Log sections
    // based on the current user's role.
    const isAdmin = Auth && Auth.isAdmin();
    const usersSection = document.getElementById("admin-users-section");
    const auditSection = document.getElementById("admin-audit-section");
    const quotesSection = document.getElementById("admin-quotes-section");
    if (quotesSection) quotesSection.hidden = !isAdmin;
    if (usersSection) usersSection.hidden = !isAdmin;
    if (auditSection)  auditSection.hidden  = !isAdmin;
    if (isAdmin) {
      // Auto-load users list + audit log on view open
      refreshUsersList();
      refreshAuditLog();
      if (global.PharmacyDailyQuotes) global.PharmacyDailyQuotes.renderAdmin();
      // Pull latest med requests from Supabase (so the admin sees
      // new requests from doctors immediately when opening admin view)
      pullMedRequestsFromCloud();
    }
    UI.showView("admin");
  }

  // -------- Patient sheets (A4) --------
  // Layout + rendering live in print-sheets.js.
  // Sheets open in an in-app preview first; "طباعة / PDF" prints them
  async function printPatientSheet(patient, currentBed) {
    if (!patient || !currentBed) return;
    const r = await global.PharmacyPrintSheets.preview([{ patient, currentBed }]);
    if (r && r.printed === false) flashHint("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة");
  }
  async function printAllPatientSheets(occPatients) {
    const r = await global.PharmacyPrintSheets.preview(occPatients);
    if (r && r.printed === false) flashHint("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة");
  }

  // Helper: escape HTML special chars to prevent XSS in the print window
  function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }


  function openSheetFromPatientView() {
    if (!state.currentBed) {
      UI.showView("home");
      flashHint("اختر سريرًا أولًا لإضافة علاج");
      return;
    }
    const current = state.patients[state.currentBed.key];
    if (global.PharmacyBoarders.isNoOrder(current)) {
      flashHint("مرضى الطابق السابع لا يُطلب لهم علاج");
      return;
    }
    // Plate number (رقم الطبلة) = 6 digits, mandatory before adding medicines
    // for pharmacists only; optional for doctors and the admin — but a number
    // they do write must be 6 digits too.
    const plateOptional = !!(Auth && ((Auth.isDoctor && Auth.isDoctor()) || (Auth.isAdmin && Auth.isAdmin())));
    const plateVal = String((current && current.plateNumber) || "").trim();
    if ((!plateOptional || plateVal) && !isValidPlate(plateVal)) {
      const plate = $("patient-plate-input");
      if (plate) {
        plate.classList.add("is-required-missing");
        plate.focus();
      }
      flashHint(plateVal ? "رقم الطبلة يتكون من 6 أرقام" : "أدخل رقم الطبلة أولاً (6 أرقام) — الحقل إجباري");
      return;
    }
    resetSheet();
    // Render the tabs (auto-picks the first non-empty form as active)
    state.sheet.activeTab = UI.renderSheetTabs(state.medications, state.sheet.activeTab) || "vial";
    UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
    bindMedOptionCheckboxes();
    syncSelectedUI();
    UI.openSheet();
    state.sheet.open = true;
  }
  function closeSheet() {
    UI.closeSheet();
    state.sheet.open = false;
  }
  function resetSheet() {
    state.sheet.selected.clear();
    state.sheet.selectedList = [];
    state.sheet.filter = "";
    // Default to "vial" — renderSheetTabs will pick a real default
    // (first non-empty form) when the sheet opens.
    state.sheet.activeTab = "vial";
    $("med-search").value = "";
    $("selected-list").innerHTML = "";
    $("sheet-add").disabled = true;
    $("sheet-selected").hidden = true;
    $("selected-count").textContent = "0";
  }

  // Re-bind checkboxes after re-render (preserves checked state from selected set)
  function bindMedOptionCheckboxes() {
    document.querySelectorAll('#med-options input[type="checkbox"]').forEach(cb => {
      cb.checked = state.sheet.selected.has(cb.dataset.medId);
    });
  }

  function addToSelected(id) {
    if (state.sheet.selected.has(id)) return;
    const m = state.medications.find(x => x.id === id);
    if (!m) return;
    state.sheet.selected.add(id);
    state.sheet.selectedList.push({
      id: m.id,
      nameTrade: m.nameTrade,
      nameAr:    m.nameAr,
      nameEn:    m.nameEn,
      form:      m.form || "vial",
      dose: m.defaultDose,
      frequency: m.defaultFrequency
    });
  }
  function removeFromSelected(id) {
    state.sheet.selected.delete(id);
    state.sheet.selectedList = state.sheet.selectedList.filter(s => s.id !== id);
  }
  function syncSelectedUI() {
    const count = state.sheet.selectedList.length;
    $("selected-count").textContent = String(count);
    $("sheet-selected").hidden = count === 0;
    $("sheet-add").disabled = count === 0;
    UI.renderSelectedList(state.sheet.selectedList);
  }

  // -------- Notification system --------
  // Patient events (new patient, medicine changes, discharge, death,
  // return to floor) are shared through the cloud notifications table
  // (features.sql §8) and reach other people by role:
  //   a doctor's action      → doctors, pharmacists, admin
  //   a pharmacist's action  → pharmacists, admin
  //   the admin's action     → admin, pharmacists
  // never the person who did it. The database enforces who may read
  // (and send to) which audience. Medicine requests keep their own
  // path (med_requests table → admin).
  function notifAudience() {
    const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
    const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
    return (isDoctor && !isAdmin) ? ["doctor", "pharmacist", "admin"] : ["pharmacist", "admin"];
  }
  function myRole() {
    if (Auth && Auth.isAdmin && Auth.isAdmin()) return "admin";
    if (Auth && Auth.isDoctor && Auth.isDoctor()) return "doctor";
    return "pharmacist";
  }
  let _myUserId = null;
  async function myUserId() {
    if (_myUserId) return _myUserId;
    try {
      const client = SB && SB.getClient ? SB.getClient() : null;
      const { data } = client ? await client.auth.getSession() : { data: null };
      _myUserId = (data && data.session && data.session.user && data.session.user.id) || null;
    } catch (e) { /* offline */ }
    return _myUserId;
  }
  function notifFromRow(row) {
    return {
      cloudId: row.id,
      type: row.type,
      message: row.message || "",
      patientName: row.patient_name || "",
      room: row.room || "",
      date: row.created_at || new Date().toISOString(),
      read: false,
      byUser: "",
      byName: row.actor_name || "—",
      actorRole: row.actor_role || ""
    };
  }
  // A notification row arrived (realtime) or was fetched: show it unless it is ours
  async function receiveCloudNotification(row, quiet) {
    if (!row || row.id == null) return;
    const me = await myUserId();
    if (me && row.actor_id === me) return;
    if (Storage.addCloudNotification(notifFromRow(row))) {
      updateNotifBadge();
      const view = $("view-notifications");
      if (view && !view.hidden) renderNotifications();
    }
  }
  // Catch up on what arrived while this device was closed
  const NOTIF_SINCE_KEY = "pharma.notif-since.v1";
  async function pullCloudNotifications() {
    const client = SB && SB.isConfigured() ? SB.getClient() : null;
    if (!client) return;
    let since = null;
    try { since = localStorage.getItem(NOTIF_SINCE_KEY); } catch (e) { /* blocked */ }
    const now = new Date().toISOString();
    if (!since) {                                   // first time on this device: start from now
      try { localStorage.setItem(NOTIF_SINCE_KEY, now); } catch (e) { /* blocked */ }
      return;
    }
    const { data, error } = await client.from("notifications").select("*")
      .gt("created_at", since).order("created_at", { ascending: true }).limit(100);
    if (error || !Array.isArray(data)) return;      // table not created yet → nothing
    for (const row of data) await receiveCloudNotification(row, true);
    try { localStorage.setItem(NOTIF_SINCE_KEY, data.length ? data[data.length - 1].created_at : now); } catch (e) { /* blocked */ }
  }

  function pushNotification(type, message, patientName, room) {
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
    if (type !== "med_request") {
      // Shared: to the others by role (not to this device — it's our own action)
      const client = SB && SB.isConfigured() ? SB.getClient() : null;
      if (client) {
        client.from("notifications").insert({
          type: type,
          message: message || "",
          patient_name: patientName || "",
          room: room || "",
          actor_name: user ? (user.displayName || user.username) : "",
          actor_role: myRole(),
          audience: notifAudience()
        }).then(({ error }) => {
          if (error) { console.warn("[notifications] send failed:", error.message); flashHint("تعذّر إرسال الإشعار للمسؤول"); }
        });
      }
      return;
    }
    // Medicine requests: shown on the admin's device (med_requests table)
    if (!isAdmin) return;
    const record = {
      type: type,
      message: message,
      patientName: patientName || "",
      room: room || "",
      date: new Date().toISOString(),
      read: false,
      byUser: user ? user.username : "—",
      byName: user ? (user.displayName || user.username) : "—"
    };
    Storage.addNotification(record);
    updateNotifBadge();
  }

  function updateNotifBadge() {
    const badge = $("notif-badge");
    if (!badge) return;
    const count = Storage.getUnreadCount();
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // Notifications show the user's display name, never the username.
  // Other users' names come from profiles (readable by the admin only —
  // RLS); until loaded, or for other roles, the username is the fallback.
  let _displayNames = null;
  let _displayNamesLoading = null;
  function loadDisplayNames() {
    if (_displayNames || _displayNamesLoading) return _displayNamesLoading || Promise.resolve();
    const client = SB && SB.getClient ? SB.getClient() : null;
    if (!client || !(Auth && Auth.isAdmin && Auth.isAdmin())) return Promise.resolve();
    _displayNamesLoading = client.from("profiles").select("username, display_name").then(({ data }) => {
      _displayNames = {};
      (data || []).forEach(p => {
        const name = String(p.display_name || "").split("|")[0].trim();
        if (p.username && name) _displayNames[p.username] = name;
      });
    }).catch(() => {}).then(() => { _displayNamesLoading = null; });
    return _displayNamesLoading;
  }
  function displayNameOf(username) {
    if (!username || username === "—") return "—";
    const me = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    if (me && me.username === username && me.displayName) return me.displayName;
    if (_displayNames && _displayNames[username]) return _displayNames[username];
    loadDisplayNames();
    return username;
  }

  function renderNotifications() {
    const list = $("notif-list");
    if (!list) return;
    // Re-render once other users' display names arrive
    if (!_displayNames && Auth && Auth.isAdmin && Auth.isAdmin()) {
      loadDisplayNames().then(() => { if (_displayNames) renderNotifications(); });
    }
    list.innerHTML = "";
    const notifications = Storage.loadNotifications();
    if (notifications.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><p>لا توجد إشعارات</p></div>`;
    }
    const typeIcons = {
      patient_added: "➕",
      med_changed: "💊",
      patient_discharged: "🚪",
      patient_died: "⚠️",
      patient_deleted: "🗑️",
      med_request: "💊"
    };
    // Pharmacists + admin: the doctors' notifications (new patient, death,
    // discharge, treatment changes — the important ones) in their own part
    const isDoctorUser = !!(Auth && Auth.isDoctor && Auth.isDoctor()) && !(Auth.isAdmin && Auth.isAdmin());
    const split = !isDoctorUser && notifications.length > 0;
    const groups = split
      ? [["إشعارات الأطباء — مهمة", "is-doctors", notifications.map((n, i) => [n, i]).filter(([n]) => n.actorRole === "doctor")],
         ["إشعارات الصيادلة والمسؤول", "is-pharmacy", notifications.map((n, i) => [n, i]).filter(([n]) => n.actorRole !== "doctor")]]
      : [[null, "", notifications.map((n, i) => [n, i])]];
    groups.forEach(([title, cls, items]) => {
      if (title) {
        const unread = items.filter(([n]) => !n.read).length;
        const head = document.createElement("div");
        head.className = "notif-group-head " + cls;
        head.textContent = title + (unread ? " (" + unread + ")" : "");
        list.appendChild(head);
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "notif-group-empty";
          empty.textContent = "لا توجد إشعارات";
          list.appendChild(empty);
        }
      }
      items.forEach(([n, i]) => renderNotifRow(n, i));
    });
    function renderNotifRow(n, i) {
      const icon = typeIcons[n.type] || "🔔";
      const dateStr = new Date(n.date).toLocaleString("ar", {
        dateStyle: "short", timeStyle: "short"
      });
      const row = document.createElement("div");
      row.className = "notif-row" + (n.read ? "" : " notif-unread");
      row.innerHTML = `
        <div class="notif-icon">${icon}</div>
        <div class="notif-content">
          <div class="notif-message">${escapeHtml(n.message)}</div>
          <div class="notif-meta">${dateStr} · بواسطة ${escapeHtml(n.byName || displayNameOf(n.byUser))}</div>
        </div>
        ${!n.read ? '<div class="notif-dot"></div>' : ''}
      `;
      if (n.actorRole === "doctor" && split) row.classList.add("notif-important");
      row.addEventListener("click", () => {
        Storage.markNotificationRead(i);
        renderNotifications();
        updateNotifBadge();
      });
      list.appendChild(row);
    }
    // Show/hide the "clear all" button — admin only
    const clearBtn = $("notif-clear-all-btn");
    if (clearBtn) {
      const isAdmin = Auth && Auth.isAdmin();
      clearBtn.hidden = !(isAdmin && notifications.length > 0);
    }
  }

  // -------- Open a patient --------
  // -------- Discharged / Dead patients view --------
  let _dischargedTab = "discharged";

  // Tab → archive kind + its local list
  const ARCHIVE_TABS = {
    discharged:  () => Storage.loadDischarged(),
    dead:        () => Storage.loadDead(),
    transferred: () => Storage.loadTransferred()
  };
  function archiveKind(tab) { return ARCHIVE_TABS[tab] ? tab : "discharged"; }

  function renderDischargedView() {
    // "عادوا لطوابقهم" is for pharmacists + admin only
    const isDoctorUser = !!(Auth && Auth.isDoctor && Auth.isDoctor());
    const transferredTab = $("transferred-tab");
    if (transferredTab) transferredTab.hidden = isDoctorUser;
    if (isDoctorUser && _dischargedTab === "transferred") _dischargedTab = "discharged";
    const counts = {};
    Object.keys(ARCHIVE_TABS).forEach(t => {
      counts[t] = ARCHIVE_TABS[t]().length;
      const el = $(t + "-count");
      if (el) el.textContent = counts[t];
    });
    // Default to the first tab (discharged)
    document.querySelectorAll(".discharged-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === _dischargedTab);
    });
    // Show/hide the "clear all" button — admin only
    const clearBtn = $("discharged-clear-all-btn");
    if (clearBtn) {
      const isAdmin = Auth && Auth.isAdmin();
      clearBtn.hidden = !(isAdmin && counts[archiveKind(_dischargedTab)] > 0);
    }
    renderDischargedList(_dischargedTab);
  }

  // «العلاج والتحاليل» of an archived record (medicines + labs at discharge /
  // death, older records have medicines only)
  function archiveDetailsHtml(r) {
    const meds = Array.isArray(r.medications) ? r.medications.filter(Boolean) : [];
    const labs = r.labs && typeof r.labs === "object" ? r.labs : {};
    const hist = Array.isArray(r.labHistory) ? r.labHistory.filter(Boolean) : [];
    const defs = (global.PharmacyPrintSheets && global.PharmacyPrintSheets.LAB_DEFS) || [];
    const labVals = defs.filter(([, k]) => labs[k] != null && String(labs[k]).trim() !== "");
    if (!meds.length && !labVals.length && !hist.length) return "";
    const catalog = state.medications || [];
    const medLine = (m) => {
      const c = catalog.find(x => x && x.id === m.id) || {};
      const name = m.nameTrade || c.nameTrade || m.nameEn || c.nameEn || m.id || "";
      const extra = [m.dose, m.frequency].filter(x => x && String(x).trim()).join(" · ");
      return `<li><span dir="ltr">${escapeHtml(name)}</span>${extra ? ` <span class="arch-med-extra" dir="ltr">${escapeHtml(extra)}</span>` : ""}</li>`;
    };
    const dates = labs._dates || {};
    const labLine = ([label, k]) => `<li dir="ltr"><b>${escapeHtml(label)}</b>: ${escapeHtml(labs[k])}${dates[k] ? ` <span class="arch-med-extra">(${escapeHtml(dates[k])})</span>` : ""}</li>`;
    const histLine = (h) => `<li dir="ltr">${escapeHtml(h.date || "—")} — ${escapeHtml(h.label || h.key || "")}: ${escapeHtml(h.value)}</li>`;
    return `<details class="arch-details"><summary>العلاج والتحاليل</summary>
      ${meds.length ? `<div class="arch-sub">العلاج (${meds.length})</div><ul class="arch-list">${meds.map(medLine).join("")}</ul>` : ""}
      ${labVals.length ? `<div class="arch-sub">آخر التحاليل</div><ul class="arch-list">${labVals.map(labLine).join("")}</ul>` : ""}
      ${hist.length ? `<div class="arch-sub">النتائج السابقة</div><ul class="arch-list">${hist.map(histLine).join("")}</ul>` : ""}
    </details>`;
  }

  function renderDischargedList(tab) {
    _dischargedTab = tab || "discharged";
    const list = $("discharged-list");
    if (!list) return;
    list.innerHTML = "";

    const records = ARCHIVE_TABS[archiveKind(tab)]();

    if (records.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><p>لا يوجد مرضى في هذه القائمة</p></div>`;
      return;
    }

    const isAdmin = Auth && Auth.isAdmin();

    records.forEach((r, i) => {
      const date = r.dischargedAt || r.diedAt || r.transferredAt || "";
      const dateStr = date
        ? new Date(date).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
        : "—";
      const medCount = (r.medications || []).length;
      // Show the final diagnosis if present (discharged patients only —
      // dead patients have no final diagnosis field).
      const finalDx = (r.finalDiagnosis && String(r.finalDiagnosis).trim())
        ? String(r.finalDiagnosis).trim()
        : "";
      const admissionDx = (r.diagnosis && String(r.diagnosis).trim())
        ? String(r.diagnosis).trim()
        : "";
      const row = document.createElement("div");
      row.className = "discharged-row" + (finalDx ? " has-final-dx" : "");
      row.innerHTML = `
        <div class="discharged-row-head">
          <div class="discharged-row-name">${escapeHtml(r.name || "—")}</div>
          <div class="discharged-row-date">${dateStr}</div>
        </div>
        <div class="discharged-row-meta">
          <span>غرفة ${r.roomNumber || "—"} · سرير ${r.roomNumber && r.bedNumber ? global.PharmacyWard.bedLabel(r.roomNumber, r.bedNumber) : "—"}</span>
          ${r.plateNumber ? `<span>· طبلة ${escapeHtml(r.plateNumber)}</span>` : ""}
          ${r.doctor ? `<span>· ${escapeHtml(r.doctor)}</span>` : ""}
          ${medCount ? `<span>· ${medCount} دواء</span>` : ""}
        </div>
        ${finalDx ? `<div class="discharged-row-final-dx"><span class="dx-label">التشخيص النهائي:</span> <span class="dx-value">${escapeHtml(finalDx)}</span></div>` : ""}
        ${(!finalDx && admissionDx) ? `<div class="discharged-row-dx"><span class="dx-label">التشخيص:</span> <span class="dx-value">${escapeHtml(admissionDx)}</span></div>` : ""}
        ${r.transferredTo ? `<div class="discharged-row-dx"><span class="dx-label">عاد إلى:</span> <span class="dx-value">${escapeHtml(r.transferredTo)}</span></div>` : ""}
        ${r.originLabel ? `<div class="discharged-row-dx"><span class="dx-label">مستضاف من:</span> <span class="dx-value">${escapeHtml(r.originLabel)}</span></div>` : ""}
        ${archiveDetailsHtml(r)}
        ${r.pending ? `<div class="discharged-row-pending">⏳ لم يُرفع للسحابة بعد</div>` : ""}
        ${isAdmin && r.id ? `<div style="margin-top:6px;text-left:left;">
          <button type="button" data-del-id="${escapeHtml(r.id)}" style="padding:4px 10px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">🗑 حذف هذا السجل</button>
        </div>` : ""}
      `;
      list.appendChild(row);
    });
    // Bind per-record delete buttons (admin only)
    if (isAdmin) {
      list.querySelectorAll("button[data-del-id]").forEach(btn => {
        btn.addEventListener("click", () => {
          if (!confirm("هل تريد حذف هذا السجل؟")) return;
          const kind = archiveKind(_dischargedTab);
          global.PharmacyArchive.remove(kind, btn.dataset.delId).then(res => {
            renderDischargedView();
            flashHint(res.ok ? "تم حذف السجل" : "فشل الحذف: " + res.error);
          });
        });
      });
    }
  }

  // -------- Antibiotic + Albumin monitoring --------
  // Scans all occupied patients for antibiotic + albumin medications
  // and displays them in two tables. No separate database — reads
  // directly from state.patients each time the view is opened.

  // Antibiotic / albumin detection + day counting: clinical.js

  // «مراقبة الأدوية الحرجة»: the meronem / albumin counters open a table
  // (name · plate · dose or amount dispensed · day); a row opens creatinine +
  // albumin and a note on the patient's condition (labs._critNote).
  function renderAbxFocus(merEntries, albEntries, critEntries, otherAbxEntries) {
    const box = $("abx-focus");
    if (!box) return;
    const kind = state.abxFocus;
    const critDef = (Clinical.CRITICAL_KINDS || []).find(c => c.kind === kind);
    if (kind !== "meronem" && kind !== "albumin" && kind !== "otherabx" && !critDef) { box.hidden = true; box.innerHTML = ""; return; }
    const Meds = global.PharmacyMedications || {};
    const Bridge = global.PharmacyChartBridge || {};
    const rows = new Map();   // one row per patient
    (kind === "meronem" ? merEntries : kind === "otherabx" ? (otherAbxEntries || []) : critDef ? (critEntries || []).filter(x => x.kind === kind) : albEntries).forEach(e => {
      let r = rows.get(e.key);
      if (!r) { r = { e, parts: [], qty: 0, day: e.day }; rows.set(e.key, r); }
      if (kind === "otherabx") {
        // several antibiotics per patient: name + dose + frequency (+ course day)
        r.parts.push([e.medName, String(e.dose || "").trim(), e.freq].filter(Boolean).join(" ") + (e.day ? " (" + e.day + ")" : ""));
      } else if (critDef) {
        r.parts.push([String(e.dose || "").trim(), e.freq].filter(Boolean).join(" "));
      } else if (kind === "meronem") {
        const nm = Meds.parseFreq ? Meds.parseFreq(e.freq) : null;
        const dose = String(e.dose || "").trim();
        r.parts.push(nm && dose ? dose + "×" + nm.m : [dose, e.freq].filter(Boolean).join(" "));
      } else {
        const q = Bridge.dailyQuantity ? Bridge.dailyQuantity(e.medId, e.freq, e.form) : null;
        r.qty += q || 0;
      }
    });
    const list = Array.from(rows.values()).sort((a, b) =>
      global.PharmacyWard.bedLabelOfKey(a.e.key) - global.PharmacyWard.bedLabelOfKey(b.e.key));
    const title = critDef ? "مرضى " + critDef.label : kind === "otherabx" ? "مرضى بقية المضادات الحيوية" : kind === "meronem" ? "مرضى الميرونيم" : "مرضى الألبومين";
    const col3 = kind === "albumin" ? "العدد المصروف" : kind === "otherabx" ? "المضاد والجرعة" : "الجرعة";
    const labCell = (p, key, label) => {
      const labs = (p && p.labs) || {};
      const v = labs[key] ? String(labs[key]).trim() : "";
      const d = labs._dates && labs._dates[key] ? labs._dates[key] : "";
      return `<div class="crit-lab"><span class="crit-lab-name">${label}</span><span class="crit-lab-val">${escapeHtml(v || "—")}</span>${d ? `<span class="crit-lab-date">${escapeHtml(d)}</span>` : ""}</div>`;
    };
    // a lab of the open patient: the recorded result with its date, a field + date for a NEW result, and the older ones
    const labBlock = (p, key, label, bk) => {
      const hist = (Array.isArray(p.labHistory) ? p.labHistory : []).filter(x => x && x.key === key).slice().reverse();
      return `<div class="crit-labblock">${labCell(p, key, label)}
        <div class="crit-lab-new">
          <input type="text" inputmode="decimal" class="crit-lab-input" data-lab-input="${key}" placeholder="نتيجة جديدة" autocomplete="off">
          <input type="date" class="crit-lab-dateinput" data-lab-date="${key}" value="${Clinical.todayISO()}">
          <button type="button" class="crit-lab-save" data-action="crit-save" data-key="${bk}" data-lab="${key}">حفظ</button>
        </div>
        ${hist.length ? `<div class="crit-lab-hist">${hist.map(x => `<span>${escapeHtml(x.value)} <small>${escapeHtml(x.date || "")}</small></span>`).join("")}</div>` : ""}
      </div>`;
    };
    box.hidden = false;
    box.innerHTML = `<h3>${title}</h3><div class="crit-table">
      <div class="crit-row crit-row-header"><span>اسم المريض</span><span>رقم الطبلة</span><span>${col3}</span><span>اليوم</span></div>` +
      (list.length ? list.map(r => {
        const open = kind === "albumin" && state.abxOpenKey === r.e.key;
        const p = state.patients[r.e.key] || {};
        const third = kind === "albumin" ? (r.qty ? String(r.qty) : "—") : (r.parts.join(" + ") || "—");
        // the labs + diagnosis note open for albumin patients only
        const canOpen = kind === "albumin";
        return `<button type="button" class="crit-row${open ? " is-open" : ""}"${canOpen ? ` data-action="abx-row" data-key="${escapeHtml(r.e.key)}" aria-expanded="${open}"` : ""}>
            <span class="crit-name">${escapeHtml(r.e.name)}</span>
            <span class="crit-plate">${escapeHtml(r.e.plate || "—")}</span>
            <span class="crit-dose" dir="ltr">${escapeHtml(third)}</span>
            <span class="crit-day" dir="ltr">${escapeHtml(r.day || "—")}</span>
          </button>` + (open ? (() => {
            const bk = escapeHtml(r.e.key);
            const hasNote = !!(p.labs && String(p.labs._critNote || "").trim());
            const diagOpen = state.abxDiagKey === r.e.key;
            return `<div class="crit-detail">
            <div class="crit-labs">${labBlock(p, "creatinine", "S. Creatinine", bk)}${labBlock(p, "albumin", "S. Albumin", bk)}</div>
            <button type="button" class="crit-diag-btn${hasNote ? " has-note" : ""}${diagOpen ? " is-open" : ""}" data-action="crit-diag" data-key="${bk}" aria-expanded="${diagOpen}">التشخيص${hasNote ? " ✓" : ""}</button>
            ${diagOpen ? `<label class="crit-note-label" for="crit-note">تشخيص حالة المريض</label>
            <textarea id="crit-note" class="crit-note" rows="6" data-key="${bk}" placeholder="اكتب حالة المريض…">${escapeHtml((p.labs && p.labs._critNote) || "")}</textarea>` : ""}
          </div>`;
          })() : "");
      }).join("") : `<div class="abx-empty">لا يوجد مرضى حالياً</div>`) + `</div>`;
  }

  // The note on the patient's condition — kept in labs._critNote (travels
  // with the labs JSON, no new column)
  let _critNoteTimer = null;
  function saveCritLab(bedKey, labKey, value, date) {
    const p = state.patients[bedKey];
    const v = String(value || "").trim();
    if (!p || !v) { flashHint("اكتب النتيجة أولاً"); return false; }
    if (!p.labs || typeof p.labs !== "object") p.labs = {};
    if (!p.labs._dates || typeof p.labs._dates !== "object") p.labs._dates = {};
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : Clinical.todayISO();
    const prev = p.labs[labKey] ? String(p.labs[labKey]).trim() : "";
    if (prev) {
      if (!Array.isArray(p.labHistory)) p.labHistory = [];
      p.labHistory.push({ date: p.labs._dates[labKey] || day, key: labKey, label: labKey === "albumin" ? "S. Albumin" : "S. Creatinine", value: prev });
    }
    p.labs[labKey] = v;
    p.labs._dates[labKey] = day;
    persistPatient(bedKey);
    flashHint("✓ سُجّلت النتيجة");
    return true;
  }
  function saveCritNote(ta) {
    const key = ta && ta.dataset.key;
    if (!key || !state.patients[key]) return;
    const p = state.patients[key];
    if (!p.labs || typeof p.labs !== "object") p.labs = {};
    const v = String(ta.value || "");
    if ((p.labs._critNote || "") === v) return;
    if (v.trim()) p.labs._critNote = v; else delete p.labs._critNote;
    persistPatient(key);
  }

  function renderAbxMonitor() {
    const Ward = global.PharmacyWard;
    if (!Ward) return;

    // ---- Day tracking ----
    // Each antibiotic / albumin has its own course day (D1 = the day it
    // was added, med.startDate). Meds added before per-med tracking
    // fall back to the patient's firstMedDate, which is set to today
    // the first time we see the patient on a critical med.
    function ensureLegacyStart(patient, bedKey) {
      const hasCriticalMed = (patient.medications || []).some(pm =>
        pm && !pm.startDate && (Clinical.isAntibiotic(pm) || Clinical.isAlbumin(pm) || Clinical.criticalKind(pm))
      );
      if (hasCriticalMed && !patient.firstMedDate) {
        patient.firstMedDate = Clinical.todayISO();
        Storage.upsertPatient(bedKey, patient);
      }
    }

    // Collect all occupied patients with their antibiotic/albumin meds
    const abxEntries = [];
    const albEntries = [];
    const critEntries = [];   // I.V.I.G / Aranesp-Eprex / Amphotericin / Caspofungin

    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        ensureLegacyStart(p, key);

        (p.medications || []).forEach(pm => {
          const dayLabel = Clinical.abxDayLabel(pm, p);
          if (!pm || !pm.id) return;
          const catalog = (state.medications || []).find(m => m && m.id === pm.id);
          const medName = catalog ? (catalog.nameEn || catalog.nameTrade) : (pm.nameEn || pm.nameTrade || pm.id);
          const dose = pm.dose || (catalog ? catalog.defaultDose : "") || "";
          const freq = pm.frequency || (catalog ? catalog.defaultFrequency : "") || "";

          if (Clinical.isAntibiotic(pm)) {
            abxEntries.push({
              key, form: catalog ? catalog.form : (pm.form || ""),
              name: p.name.trim(),
              room: room.id,
              bed: bed.number,
              plate: p.plateNumber || "",
              doctor: p.doctor || "",
              diagnosis: p.diagnosis || "",
              day: dayLabel,
              medName, dose, freq, medId: pm.id
            });
          }
          const ck = Clinical.criticalKind(pm);
          if (ck) {
            critEntries.push({
              key, kind: ck, form: catalog ? catalog.form : (pm.form || ""),
              name: p.name.trim(),
              room: room.id,
              bed: bed.number,
              plate: p.plateNumber || "",
              diagnosis: p.diagnosis || "",
              day: dayLabel,
              medName, dose, freq, medId: pm.id
            });
          }
          if (Clinical.isAlbumin(pm)) {
            albEntries.push({
              key, form: catalog ? catalog.form : (pm.form || ""),
              name: p.name.trim(),
              room: room.id,
              bed: bed.number,
              plate: p.plateNumber || "",
              doctor: p.doctor || "",
              diagnosis: p.diagnosis || "",
              day: dayLabel,
              medName, dose, freq, medId: pm.id
            });
          }
        });
      });
    });

    // ---- Summary stats ----
    const statsEl = $("abx-stats");
    if (statsEl) {
      // Patients (not doses) on Meronem / on albumin
      const patientId = (e) => e.room + "-" + e.bed;
      const isMeronem = (e) => /meropenem|meronem|ميروب|ميرون/i.test((e.medId || "") + " " + (e.medName || ""));
      const meronemPatients = new Set(abxEntries.filter(isMeronem).map(patientId));
      const albPatients = new Set(albEntries.map(patientId));
      // the rest of the antibiotics (everything but Meronem, which has its own card)
      const otherAbx = abxEntries.filter(e => !isMeronem(e));
      const otherAbxPatients = new Set(otherAbx.map(patientId));
      const on = (k) => state.abxFocus === k ? " is-open" : "";
      statsEl.innerHTML = `
        <button type="button" class="abx-stat-card abx-stat-btn${on("meronem")}" data-action="abx-focus" data-focus="meronem" aria-expanded="${state.abxFocus === "meronem"}">
          <div class="abx-stat-num">${meronemPatients.size}</div>
          <div class="abx-stat-label">مريض على الميرونيم</div>
        </button>
        <button type="button" class="abx-stat-card abx-stat-btn${on("otherabx")}" data-action="abx-focus" data-focus="otherabx" aria-expanded="${state.abxFocus === "otherabx"}">
          <div class="abx-stat-num">${otherAbxPatients.size}</div>
          <div class="abx-stat-label">بقية المضادات الحيوية</div>
        </button>
        <button type="button" class="abx-stat-card abx-stat-btn${on("albumin")}" data-action="abx-focus" data-focus="albumin" aria-expanded="${state.abxFocus === "albumin"}">
          <div class="abx-stat-num">${albPatients.size}</div>
          <div class="abx-stat-label">مريض على ألبومين</div>
        </button>` + (Clinical.CRITICAL_KINDS || []).map(c => {
          const n = new Set(critEntries.filter(e => e.kind === c.kind).map(patientId)).size;
          return `<button type="button" class="abx-stat-card abx-stat-btn${on(c.kind)}" data-action="abx-focus" data-focus="${c.kind}" aria-expanded="${state.abxFocus === c.kind}">
          <div class="abx-stat-num">${n}</div>
          <div class="abx-stat-label">مريض على ${escapeHtml(c.label).split("/").join("/<wbr>")}</div>
        </button>`;
        }).join("");
      renderAbxFocus(abxEntries.filter(isMeronem), albEntries, critEntries, otherAbx);
    }

    // ---- Other critical medicines table ----
    const critTable = $("abx-crit-table");
    if (critTable) {
      if (critEntries.length === 0) {
        critTable.innerHTML = `<div class="abx-empty">لا يوجد مرضى على هذه الأدوية حالياً</div>`;
      } else {
        const labelOf = (k) => ((Clinical.CRITICAL_KINDS || []).find(c => c.kind === k) || {}).label || k;
        critEntries.sort((a, b) => labelOf(a.kind).localeCompare(labelOf(b.kind)) ||
          global.PharmacyWard.bedLabelOfKey(a.key) - global.PharmacyWard.bedLabelOfKey(b.key));
        critTable.innerHTML = `
          <div class="abx-row abx-row-header">
            <span>المريض</span>
            <span>الغرفة</span>
            <span>الدواء</span>
            <span>الجرعة</span>
            <span>التكرار</span>
            <span>اليوم</span>
          </div>
        ` + critEntries.map(e => `
          <div class="abx-row">
            <span class="abx-cell-name">${escapeHtml(e.name)}</span>
            <span class="abx-cell-room">${global.PharmacyWard.roomTitle(e.room)} · س ${global.PharmacyWard.bedLabel(e.room, e.bed)}</span>
            <span class="abx-cell-med">${escapeHtml(labelOf(e.kind))}</span>
            <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
            <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
            <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
          </div>
        `).join("");
      }
    }

    // ---- A critical drug chosen: only its patients are shown, no other list ----
    document.querySelectorAll("#view-abx [data-abx-list]").forEach(sec => { sec.hidden = !!state.abxFocus; });

    // ---- Antibiotics table ----
    const abxTable = $("abx-antibiotics-table");
    if (abxTable) {
      if (abxEntries.length === 0) {
        abxTable.innerHTML = `<div class="abx-empty">لا يوجد مرضى على مضادات حيوية حالياً</div>`;
      } else {
        // Sort by antibiotic name (group same antibiotics together)
        abxEntries.sort((a, b) => a.medName.localeCompare(b.medName));
        abxTable.innerHTML = `
          <div class="abx-row abx-row-header">
            <span>المريض</span>
            <span>الدواء</span>
            <span>الجرعة</span>
            <span>التكرار</span>
            <span>اليوم</span>
          </div>
        ` + abxEntries.map(e => `
          <div class="abx-row">
            <span class="abx-cell-name">${escapeHtml(e.name)}</span>
            <span class="abx-cell-med">${escapeHtml(e.medName)}</span>
            <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
            <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
            <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
          </div>
        `).join("");
      }
    }

    // ---- Albumin table ----
    const albTable = $("abx-albumin-table");
    if (albTable) {
      if (albEntries.length === 0) {
        albTable.innerHTML = `<div class="abx-empty">لا يوجد مرضى على ألبومين حالياً</div>`;
      } else {
        albTable.innerHTML = `
          <div class="abx-row abx-row-header">
            <span>المريض</span>
            <span>الغرفة</span>
            <span>الجرعة</span>
            <span>التكرار</span>
            <span>اليوم</span>
            <span>التشخيص</span>
          </div>
        ` + albEntries.map(e => `
          <div class="abx-row">
            <span class="abx-cell-name">${escapeHtml(e.name)}</span>
            <span class="abx-cell-room">${global.PharmacyWard.roomTitle(e.room)} · س ${global.PharmacyWard.bedLabel(e.room, e.bed)}</span>
            <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
            <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
            <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
            <span class="abx-cell-diag">${escapeHtml(e.diagnosis || "—")}</span>
          </div>
        `).join("");
      }
    }
  }

  // A card shown from this device's copy is checked against the cloud: if the bed was reused or the patient
  // removed on another device, the stale copy is replaced (never saved over the new patient).
  async function verifyOpenedBed(key) {
    if (!SBSync || !SBSync.fetchBed) return;
    const mine = state.patients[key];
    if (!mine || !(mine.name || "").trim()) return;
    const r = await SBSync.fetchBed(key);
    if (!r.ok || !state.currentBed || state.currentBed.key !== key) return;
    const cur = state.patients[key];
    if (!cur || isPendingExit(key)) return;
    const clean = !hasUnsavedEdits(cur);
    if (!r.row) {
      if (clean && Number.isInteger(cur.version)) {          // synced before, gone now: removed on another device
        delete state.patients[key];
        Storage.deletePatient(key);
        state.currentBed = null;
        UI.showView("home");
        refreshStatsAndRooms();
        flashHint("حُذف هذا المريض من هذا السرير على جهاز آخر");
      }
      return;
    }
    const cloud = SBSync.cloudPatient ? SBSync.cloudPatient(r.row) : null;
    if (!cloud) return;
    const another = (cur.pid && cloud.pid && cur.pid !== cloud.pid) || (clean && String(cur.name || "").trim() !== String(cloud.name || "").trim());
    if (another || (clean && Number.isInteger(cloud.version) && cloud.version > (cur.version || 0))) {
      state.patients[key] = cloud;
      Storage.putPatient(key, cloud);
      refreshStatsAndRooms();
      UI.renderPatientView(cloud, state.currentBed.roomId, state.currentBed.bed);
      if (another) flashHint("تغيّر مريض هذا السرير على جهاز آخر — عُرض المريض الحالي");
    }
  }
  // A bed another person has open is closed to everyone else until he leaves (presence.js). The admin may
  // go in anyway, after a confirmation; he then comes first and the other is taken out.
  function blockedByLock(key) {
    const P = global.PharmacyPresence;
    const who = P && P.lockedBy ? P.lockedBy(key) : null;
    if (who === null) return false;
    const msg = "هذا السرير مفتوح الآن عند " + (who || "شخص آخر") + " — انتظر خروجه";
    if (Auth && Auth.isAdmin && Auth.isAdmin()) {
      if (!confirm(msg + "\nهل تفتحه رغم ذلك (كمسؤول)؟ سيخرج منه الآخر.")) return true;
      if (P.force) P.force();
      return false;
    }
    flashHint(msg);
    return true;
  }
  function openPatient({ key, roomId, bed }) {
    if (!(state.currentBed && state.currentBed.key === key) && blockedByLock(key)) return;
    // Flush any pending changes from the previously-open patient
    // (if any) BEFORE switching to the new one. This ensures the
    // gender toggle / lab values on the previous patient are saved
    // before we overwrite state.currentBed with the new bed key.
    flushPendingPatientChanges();
    if (isPendingExit(key)) commitPendingExit();     // the old patient's delete first, so a new one never lands on his row
    state.currentBed = { key, roomId, bed };
    setLabsOpen(false);   // each patient opens with the labs folded (doctors)
    closeLabsPrintPanel();
    const p = state.patients[key] || null;
    UI.renderPatientView(p, roomId, bed);
    updatePlateDupWarning(false);
    UI.showView("patient");
    verifyOpenedBed(key);
    global.PharmacyPatientHistory.reset();
    // A newly opened patient starts with the allergy list closed
    $("allergy-panel").hidden = true;
    $("allergy-toggle").setAttribute("aria-expanded", "false");
    // Deleting a patient: admin + pharmacists
    const delBtn = $("delete-patient");
    if (delBtn) delBtn.hidden = !(Auth && ((Auth.isPharmacist && Auth.isPharmacist()) || (Auth.canExitPatients && Auth.canExitPatients())));
    // Hide the per-patient print button for pharmacists — only
    // admin + doctor can print individual patient sheets.
    const printBtn = $("print-patient-sheet-btn");
    if (printBtn) {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      printBtn.hidden = !(isAdmin || isDoctor);
    }
    // View-only sheet button: pharmacists (the admin + doctors have the print one)
    const viewSheetBtn = $("view-patient-sheet-btn");
    if (viewSheetBtn) viewSheetBtn.hidden = !(Auth && Auth.isPharmacist && Auth.isPharmacist());
    // Pills form for this patient: admin + pharmacists (not doctors), and
    // not for 7th-floor hematology patients on a pharmacist account (never ordered)
    const pillsOneBtn = $("print-patient-pills-btn");
    if (pillsOneBtn) {
      const cur = state.currentBed && state.patients[state.currentBed.key];
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      const isPharm = Auth && Auth.isPharmacist && Auth.isPharmacist();
      pillsOneBtn.hidden = !(isAdmin || (isPharm && !(cur && global.PharmacyBoarders.isNoOrder(cur))));
    }
    // Diagnosis field: editable by doctors + admins only.
    // Pharmacists see it (read-only) so they can read the diagnosis
    // but not modify it.
    const diagnosisInput = $("patient-diagnosis-input");
    if (diagnosisInput) {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      diagnosisInput.disabled = !(isAdmin || isDoctor);
    }
    // Lab fields: same access control as diagnosis (doctors + admins)
    document.querySelectorAll(".lab-input").forEach(el => {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      el.disabled = !(isAdmin || isDoctor);
    });
    document.querySelectorAll(".lab-add-btn").forEach(btn => {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      btn.hidden = !(isAdmin || isDoctor);
    });
  }

  // -------- Lightweight toast (no extra DOM) --------
  let hintTimer = null;
  function flashHint(msg) {
    let t = $("app-hint");
    if (!t) {
      t = document.createElement("div");
      t.id = "app-hint";
      t.style.cssText = `
        position:fixed;
        left:50%; top: calc(env(safe-area-inset-top, 0px) + 16px);
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        color:#fff;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        z-index: 200;
        box-shadow: 0 4px 14px rgba(15,23,42,0.30);
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease, transform 180ms ease;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  // -------- Drug interactions page --------
  // DDInter 2.0 (imported pairs between this catalogue's medicines — js/ddinter-data.js,
  // js/ddinter.js; CC BY-NC-SA 4.0) + the app's own few rules (clinical.js). Shows a
  // two-drug check, the patients who have a Major / Moderate interaction now, and
  // the overall counts. Supplies are not in the lists.
  const IX_LEVEL = { 3: ["شديد", "Major", "lv3"], 2: ["متوسط", "Moderate", "lv2"], 1: ["طفيف", "Minor", "lv1"], 0: ["غير محدد", "Unknown", "lv0"] };
  function ixMedLabel(m) {
    return (m.nameTrade || m.nameEn || m.id) + (m.nameEn && m.nameTrade && m.nameEn !== m.nameTrade ? " — " + m.nameEn : "");
  }
  function ixLine(it) {
    const d = it.severity === "danger";
    return `<div class="ix-row ${d ? "is-danger" : "is-warning"}"><span class="ix-dot">${d ? "🔴" : "🟡"}</span><span>${escapeHtml(it.msg)}</span></div>`;
  }
  // one DDInter interaction → a row
  function ixDDRow(r) {
    const L = IX_LEVEL[r.level] || IX_LEVEL[0];
    return `<div class="ix-row ix-dd ${L[2]}"><span class="ix-badge ${L[2]}">${L[0]}</span><span dir="ltr" class="ix-pair">${escapeHtml(r.drugA)} + ${escapeHtml(r.drugB)}</span>${r.mechanisms.length ? `<span class="ix-mech" dir="ltr">${r.mechanisms.map(escapeHtml).join(" · ")}</span>` : ""}</div>`;
  }
  function ixData() { return global.PharmacyDDInterData && global.PharmacyDDInter ? global.PharmacyDDInterData : null; }
  function renderInteractionsResult() {
    const box = $("ix-result");
    if (!box) return;
    const byId = {};
    (state.medications || []).forEach(m => { if (m && m.id) byId[m.id] = m; });
    const a = byId[$("ix-a").value], b = byId[$("ix-b").value];
    if (!a || !b) { box.innerHTML = '<div class="ix-hint">اختر دوائين لفحص التداخل بينهما</div>'; return; }
    if (a.id === b.id) { box.innerHTML = '<div class="ix-hint">اختر دوائين مختلفين</div>'; return; }
    const D = ixData();
    const dd = D ? global.PharmacyDDInter.check(D, a, b) : [];
    const own = Clinical.checkDrugInteractions([a, b]);
    box.innerHTML = (dd.length || own.length)
      ? dd.map(ixDDRow).join("") + own.map(ixLine).join("")
      : '<div class="ix-ok">لا يوجد تداخل مسجّل بين هذين الدوائين' + (D ? " في DDInter" : "") + " — وهذا لا يعني أنه غير موجود، راجع المراجع الدوائية.</div>";
  }
  function renderInteractionsPage() {
    const meds = (state.medications || []).filter(m => m && m.id && m.form !== "supplies" && m.category !== "supplies").slice()
      .sort((x, y) => ixMedLabel(x).localeCompare(ixMedLabel(y)));
    ["ix-a", "ix-b"].forEach(id => {
      const sel = $(id);
      const keep = sel.value;
      sel.innerHTML = '<option value="">— اختر دواءً —</option>' + meds.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(ixMedLabel(m))}</option>`).join("");
      if (keep && meds.some(m => m.id === keep)) sel.value = keep;
    });
    renderInteractionsResult();
    const D = ixData();
    const DDI = global.PharmacyDDInter;
    const byId = {};
    (state.medications || []).forEach(m => { if (m && m.id) byId[m.id] = m; });
    // patients with a Major / Moderate interaction now, in ward order
    const Ward = global.PharmacyWard;
    const rows = [];
    Ward.ROOMS.forEach(room => room.beds.forEach(bed => {
      const key = Ward.bedKey(room.id, bed.number);
      const p = state.patients[key];
      if (!p || !p.name || !p.name.trim()) return;
      const own = Clinical.medAlerts(p).interactions;
      let dd = [];
      if (D) {
        const cat = (p.medications || []).map(pm => byId[pm.id]).filter(m => m && m.form !== "supplies");
        dd = DDI.forMeds(D, cat).filter(r => r.level >= 2);
      }
      if (own.length || dd.length) rows.push({ p, room, bed, own, dd });
    }));
    $("ix-patients").innerHTML = rows.length
      ? rows.map(r => `<div class="ix-patient"><div class="ix-patient-head"><strong>${escapeHtml(r.p.name.trim())}</strong><span>${global.PharmacyWard.roomTitle(r.room.id)} · سرير ${Ward.bedLabel(r.room.id, r.bed.number)}</span></div>${r.dd.map(ixDDRow).join("")}${r.own.map(ixLine).join("")}</div>`).join("")
      : '<div class="ix-ok">لا يوجد مريض لديه تداخل شديد أو متوسط مسجّل حاليًا</div>';
    // the overall picture
    const own = Clinical.DRUG_INTERACTIONS || [];
    if (D) {
      const c = { 3: 0, 2: 0, 1: 0, 0: 0 };
      (D.pairs || []).forEach(s => { c[s.split("|")[2]]++; });
      $("ix-count").textContent = "(" + (D.pairs || []).length + ")";
      $("ix-all").innerHTML = `<div class="ix-ok">DDInter 2.0 · ${escapeHtml(D.generated || "")}: شديد ${c[3]} · متوسط ${c[2]} · طفيف ${c[1]} · غير محدد ${c[0]}</div>` + own.map(ixLine).join("");
    } else {
      $("ix-count").textContent = "(" + own.length + ")";
      $("ix-all").innerHTML = own.map(ixLine).join("");
    }
    $("ix-source").hidden = !D;
  }

  // -------- Specialist names --------
  // Everyone types the specialist's name their own way («عبد الرسول» /
  // «عبدالرسول», «مؤيد» / «مويد»): the same person must not become two.
  // The names already used in the ward (other patients) are the reference.
  function wardSpecialistNames(exceptKey) {
    return Object.keys(state.patients)
      .filter(k => k !== exceptKey)
      .map(k => state.patients[k] && state.patients[k].doctor)
      .filter(d => d && String(d).trim());
  }
  window.addEventListener("specialists-changed", () => refreshSpecialistsList());
  function refreshSpecialistsList() {
    const dl = $("specialists-list");
    const SP = global.PharmacySpecialists;
    if (!dl || !SP) return;
    const names = Array.from(SP.canonical(wardSpecialistNames(null)).values()).map(g => g.display).sort();
    dl.innerHTML = "";
    names.forEach(n => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); });
  }
  // On leaving the field: same person with another spelling → the ward's
  // spelling; a probable typo → ask first
  function unifySpecialistName(bedKey) {
    const SP = global.PharmacySpecialists;
    const p = state.patients[bedKey];
    if (!SP || !p || !p.doctor) return;
    const input = $("patient-doctor-input");
    const r = SP.resolve(p.doctor, wardSpecialistNames(bedKey));
    let name = r.name;
    if (r.how === "similar" && confirm("هل تقصد الأخصائي «" + r.suggest + "»؟\n(الاسم الذي كتبته: «" + r.name + "»)")) {
      name = r.suggest;
    }
    if (name !== p.doctor) {
      p.doctor = name;
      if (input) input.value = name;
      if (r.how === "exact") flashHint("وُحّد اسم الأخصائي: " + name);
    }
  }

  // -------- Seniors (الأخصائيون) view --------
  // Groups occupied patients by their attending physician (patient.doctor
  // field) and displays each physician with their patient list.
  // Called from the bottom-nav click handler when user taps the
  // 'seniors' tab. Tab visibility is controlled separately by
  // applySeniorsNavVisibility() (admin + doctor roles only).
  function renderSeniorsView() {
    const list = $("seniors-list");
    if (!list) return;
    list.innerHTML = "";

    const Ward = global.PharmacyWard;
    if (!Ward) return;

    // Group occupied patients by their attending physician
    const groups = {};  // doctorName -> [patient, patient, ...]
    const spellings = global.PharmacySpecialists
      ? global.PharmacySpecialists.canonical(Object.keys(state.patients)
          .filter(k => state.patients[k] && state.patients[k].name && state.patients[k].name.trim())
          .map(k => state.patients[k].doctor))
      : new Map();
    const spellingOf = (k) => spellings.has(k) ? spellings.get(k).display : "";
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;
        // spellings of one person («عبد الرسول» / «عبدالرسول»…) share one card,
        // named by the spelling used most
        const SP = global.PharmacySpecialists;
        const doctor = (p.doctor && p.doctor.trim())
          ? ((SP && spellingOf(SP.key(p.doctor))) || p.doctor.trim())
          : "بدون طبيب معالج";
        if (!groups[doctor]) groups[doctor] = [];
        groups[doctor].push({
          name: p.name.trim(),
          room: room.id,
          bed: bed.number,
          plate: p.plateNumber || "",
          age: p.age || "",
          gender: p.gender || "",
          diagnosis: p.diagnosis || "",
          medCount: (p.medications || []).length
        });
      });
    });

    const doctorNames = Object.keys(groups).sort();

    // Show empty state only when there are no patients at all OR
    // the only "doctor" is the placeholder for unassigned patients.
    if (doctorNames.length === 0
        || (doctorNames.length === 1 && doctorNames[0] === "بدون طبيب معالج")) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><p>لا يوجد أطباء أخصائيون بعد</p><span>عند تحديد الطبيب المعالج للمرضى سيظهر هنا</span></div>`;
      return;
    }

    doctorNames.forEach(doctor => {
      const patients = groups[doctor];
      const card = document.createElement("div");
      card.className = "senior-card";
      let html = `
        <div class="senior-card-head">
          <div class="senior-name">${escapeHtml(doctor)}</div>
          <div class="senior-count">${patients.length} مريض</div>
        </div>
        <div class="senior-patients">
      `;
      patients.forEach(p => {
        const meta = [
          global.PharmacyWard.roomTitle(p.room),
          "سرير " + global.PharmacyWard.bedLabel(p.room, p.bed),
          p.plate ? "طبلة " + p.plate : "",
          p.age ? "العمر " + p.age : "",
          p.gender === "male" ? "ذكر" : (p.gender === "female" ? "أنثى" : ""),
          p.diagnosis ? escapeHtml(p.diagnosis) : "",
          p.medCount + " دواء"
        ].filter(Boolean).join(" · ");
        html += `
          <div class="senior-patient-row">
            <span class="senior-patient-name">${escapeHtml(p.name)}</span>
            <span class="senior-patient-meta">${meta}</span>
          </div>
        `;
      });
      html += `</div>`;
      card.innerHTML = html;
      list.appendChild(card);
    });
  }

  // -------- Boot --------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})(window);
