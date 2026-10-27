/* Personal greetings: a welcome-back / birthday message for a named colleague.
   - The person herself gets a greeting card (with falling confetti) the first time she opens the app on the day.
   - Everyone else gets a short hint (toast) once that day, so the ward can say it too.
   The list is managed by the ADMIN (admin page «التهاني والترحيب»): add / edit / delete, with the day, the title and
   the message. It is saved in app_settings key "greetings" = { events: [...] } (every signed-in user reads it, only
   the admin may write it) and every device follows it live. Until he saves, the built-in DEFAULTS are used.
   An event: { id, match, kind: "birthday" | "welcome", yearly: "MM-DD" | on: "YYYY-MM-DD" [, until], title, text [, hint] }.
   `match` = a name as written on her account (compared loosely, like the duty roster). */
(function (global) {
  "use strict";

  var DEFAULTS = [];
  var events = DEFAULTS.slice();
  var CACHE = "pharma.greetings", SKEY = "greetings";
  var channel = null;

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayParts(d) {
    d = d || new Date();
    return { iso: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), md: pad(d.getMonth() + 1) + "-" + pad(d.getDate()) };
  }
  function isToday(ev, t) {
    if (ev.yearly) return ev.yearly === t.md;
    return !!ev.on && t.iso >= ev.on && t.iso <= (ev.until || ev.on);
  }

  // the same loose name comparison the duty roster uses (spaces, hamza… ignored; either name may be the longer)
  function sameName(a, b) {
    var SP = global.PharmacySpecialists;
    var k = function (s) { return SP && SP.key ? SP.key(s) : String(s || "").replace(/\s+/g, "").toLowerCase(); };
    var x = k(a), y = k(b);
    return x.length >= 4 && y.length >= 4 && (x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1);
  }
  function myName() {
    var A = global.PharmacyAuth, u = A && A.getCurrentUser ? A.getCurrentUser() : null;
    return u && u.displayName ? String(u.displayName) : "";
  }
  function hintOf(ev) {
    return ev.hint || (ev.kind === "birthday" ? "اليوم عيد ميلاد " + ev.match + " — كل عام وأنتم بخير" : "اليوم: " + (ev.title || ev.match));
  }

  // the person herself: once per event (a birthday: once per year); the others: once per day
  function seenKey(ev, t, role) {
    var when = role === "self" ? (ev.yearly ? t.iso.slice(0, 4) : "once") : t.iso;
    return "pharma.greet." + ev.id + "." + when + "." + role;
  }
  function seen(ev, t, role) { try { return !!localStorage.getItem(seenKey(ev, t, role)); } catch (e) { return false; } }
  function markSeen(ev, t, role) { try { localStorage.setItem(seenKey(ev, t, role), "1"); } catch (e) { /* blocked */ } }

  // ---- the card ----
  function confetti(box) {
    var cols = ["#f43f5e", "#f59e0b", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899", "#fde68a"];
    for (var i = 0; i < 36; i++) {
      var s = document.createElement("i");
      s.className = "greet-conf";
      s.style.left = Math.round(Math.random() * 100) + "%";
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 2.2).toFixed(2) + "s";
      s.style.animationDuration = (3 + Math.random() * 2.5).toFixed(2) + "s";
      s.style.transform = "rotate(" + Math.round(Math.random() * 360) + "deg)";
      box.appendChild(s);
    }
  }
  function showCard(ev) {
    var old = document.getElementById("greet-overlay");
    if (old) old.remove();
    var ov = document.createElement("div");
    ov.id = "greet-overlay";
    ov.className = "greet-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    var rain = document.createElement("div");
    rain.className = "greet-rain";
    rain.setAttribute("aria-hidden", "true");
    confetti(rain);
    var card = document.createElement("div");
    card.className = "greet-card greet-" + ev.kind;
    var mark = document.createElement("div");
    mark.className = "greet-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = ev.kind === "birthday"
      ? '<svg viewBox="0 0 48 48" width="56" height="56"><rect x="8" y="24" width="32" height="16" rx="4" fill="#f59e0b"/><rect x="8" y="24" width="32" height="6" fill="#fde68a"/><path d="M24 12v8M16 14v6M32 14v6" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="10" r="2.6" fill="#f43f5e"/><circle cx="16" cy="12" r="2.2" fill="#f43f5e"/><circle cx="32" cy="12" r="2.2" fill="#f43f5e"/></svg>'
      : '<svg viewBox="0 0 48 48" width="56" height="56"><path d="M24 6 28.5 18 41 18.5 31 26.5 34.5 39 24 32 13.5 39 17 26.5 7 18.5 19.5 18z" fill="#fde68a" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/></svg>';
    var h = document.createElement("h2");
    h.className = "greet-title";
    h.textContent = ev.title || "";
    var p = document.createElement("p");
    p.className = "greet-text";
    p.textContent = ev.text || "";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "greet-close";
    b.textContent = "شكرًا";
    b.addEventListener("click", function () { ov.remove(); });
    card.appendChild(mark);
    if (ev.title) card.appendChild(h);
    if (ev.text) card.appendChild(p);
    card.appendChild(b);
    ov.appendChild(rain); ov.appendChild(card);
    document.body.appendChild(ov);
  }

  // → the event shown (for tests), or null
  function check(date, name) {
    var t = todayParts(date), me = name != null ? name : myName();
    var A = global.PharmacyAuth;
    if (!(A && A.isLoggedIn && A.isLoggedIn()) || (A.isTv && A.isTv())) return null;
    var shown = null;
    events.forEach(function (ev) {
      if (!isToday(ev, t)) return;
      if (sameName(me, ev.match)) {
        if (seen(ev, t, "self")) return;
        markSeen(ev, t, "self");
        showCard(ev);
        shown = ev;
      } else if (!seen(ev, t, "other")) {
        markSeen(ev, t, "other");
        var f = global.PharmacyApp && global.PharmacyApp.flashHint;
        if (f) f(hintOf(ev));
        shown = shown || ev;
      }
    });
    return shown;
  }

  // ---- the shared list ----
  function client() {
    var SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  }
  function isAdmin() { var A = global.PharmacyAuth; return !!(A && A.isAdmin && A.isAdmin()); }
  function cleanEvent(e) {
    if (!e || !e.id || !e.match) return null;
    var out = { id: String(e.id), match: String(e.match).trim(), kind: e.kind === "welcome" ? "welcome" : "birthday", title: String(e.title || "").trim(), text: String(e.text || "").trim() };
    if (e.hint) out.hint = String(e.hint);
    if (out.kind === "birthday") {
      var md = String(e.yearly || "").slice(-5);
      if (!/^\d{2}-\d{2}$/.test(md)) return null;
      out.yearly = md;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.on || ""))) return null;
      out.on = e.on;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.until || "")) && e.until > e.on) out.until = e.until;
    }
    return out.match ? out : null;
  }
  function setEvents(list) {
    events = Array.isArray(list) ? list.map(cleanEvent).filter(Boolean) : DEFAULTS.slice();
    renderAdmin();
  }
  function cached() { try { var v = JSON.parse(localStorage.getItem(CACHE) || "null"); return Array.isArray(v) ? v : null; } catch (e) { return null; } }

  async function load() {
    var c = client();
    if (!c) return;
    try {
      var r = await c.from("app_settings").select("value").eq("key", SKEY).maybeSingle();
      if (r.error) return;
      var v = r.data && r.data.value ? (typeof r.data.value === "string" ? JSON.parse(r.data.value) : r.data.value) : null;
      var list = v && Array.isArray(v.events) ? v.events : null;    // no row = the built-in list
      try { if (list) localStorage.setItem(CACHE, JSON.stringify(list)); else localStorage.removeItem(CACHE); } catch (e) { /* blocked */ }
      setEvents(list);
    } catch (e) { /* offline / table missing: keep the cached list */ }
  }
  async function save(list) {
    if (!isAdmin()) return { ok: false, error: "التهاني للمسؤول وحده" };
    var c = client();
    if (!c) return { ok: false, error: "غير متصل" };
    var clean = list.map(cleanEvent).filter(Boolean);
    var r = await c.from("app_settings").upsert({ key: SKEY, value: { events: clean }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (r.error) return { ok: false, error: r.error.message || "تعذّر الحفظ" };
    try { localStorage.setItem(CACHE, JSON.stringify(clean)); } catch (e) { /* blocked */ }
    setEvents(clean);
    return { ok: true };
  }
  function start() {
    load();
    loadAccounts();
    var c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-greetings")
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, function () { load(); })
          .subscribe();
      } catch (e) { /* the visibility refresh below still picks it up */ }
    }
    setTimeout(function () { check(); }, 1800);                  // after the list had a moment to arrive
  }

  // ---- the admin page ----
  var MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
  function flash(m) { var f = global.PharmacyApp && global.PharmacyApp.flashHint; if (f) f(m); }
  function dateText(ev) {
    if (ev.yearly) { var p = ev.yearly.split("-"); return Number(p[1]) + " " + MONTHS[Number(p[0]) - 1] + " (كل سنة)"; }
    return ev.on + (ev.until ? " ← " + ev.until : "");
  }
  var editingId = null;

  function renderAdmin() {
    var box = document.getElementById("admin-greet-list");
    if (!box) return;
    box.textContent = "";
    if (!events.length) {
      var e0 = document.createElement("div");
      e0.className = "spec-empty";
      e0.textContent = "لا توجد تهانٍ محفوظة.";
      box.appendChild(e0);
    }
    events.forEach(function (ev) {
      var row = document.createElement("div");
      row.className = "greet-row";
      var info = document.createElement("div");
      info.className = "greet-info";
      var l1 = document.createElement("strong");
      l1.textContent = (ev.kind === "birthday" ? "عيد ميلاد — " : "ترحيب — ") + ev.match;
      var l2 = document.createElement("span");
      l2.textContent = dateText(ev) + (ev.title ? " · «" + ev.title + "»" : "");
      info.appendChild(l1); info.appendChild(l2);
      var preview = document.createElement("button");
      preview.type = "button"; preview.className = "spec-del greet-act"; preview.textContent = "معاينة";
      preview.addEventListener("click", function () { showCard(ev); });
      var edit = document.createElement("button");
      edit.type = "button"; edit.className = "spec-del greet-act"; edit.textContent = "تعديل";
      edit.addEventListener("click", function () { fillForm(ev); });
      var del = document.createElement("button");
      del.type = "button"; del.className = "spec-del"; del.textContent = "حذف";
      del.addEventListener("click", async function () {
        if (!confirm("حذف تهنئة «" + ev.match + "»؟")) return;
        var r = await save(events.filter(function (x) { return x.id !== ev.id; }));
        flash(r.ok ? "✓ حُذفت" : "تعذّر الحفظ: " + r.error);
        if (editingId === ev.id) fillForm(null);
      });
      row.appendChild(info); row.appendChild(preview); row.appendChild(edit); row.appendChild(del);
      box.appendChild(row);
    });
  }

  function $(id) { return document.getElementById(id); }
  function syncKind() {
    var k = $("greet-kind") ? $("greet-kind").value : "birthday";
    var until = $("greet-until-wrap"), lab = $("greet-date-label");
    if (until) until.hidden = k === "birthday";
    if (lab) lab.textContent = k === "birthday" ? "يوم عيد الميلاد (الشهر واليوم، يتكرر كل سنة)" : "اليوم";
  }
  // the «لمن» choices = the existing accounts (never typed); an old greeting whose name is no account any more stays selectable
  var accountNames = [];
  function fillNameOptions(keep) {
    var sel = $("greet-name");
    if (!sel) return;
    var want = keep != null ? keep : sel.value;
    var names = accountNames.slice();
    if (want && !names.some(function (n) { return n === want; })) names.push(want);
    sel.textContent = "";
    var o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "— اختر الحساب —";
    sel.appendChild(o0);
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    sel.value = want || "";
  }
  async function loadAccounts() {
    var A = global.PharmacyAuth;
    if (!isAdmin() || !A || !A.listUsers) return;
    try {
      var r = await A.listUsers();
      if (!r.ok) return;
      accountNames = r.users.filter(function (u) { return u.role !== "tv" && u.active !== false; })
        .map(function (u) { return String(u.display_name || u.username || "").split("|")[0].trim(); })
        .filter(function (n, i, a) { return n && a.indexOf(n) === i; }).sort();
      fillNameOptions();
    } catch (e) { /* the list stays as it was */ }
  }
  function fillForm(ev) {
    editingId = ev ? ev.id : null;
    if (!$("greet-kind")) return;
    $("greet-kind").value = ev ? ev.kind : "birthday";
    fillNameOptions(ev ? ev.match : "");
    if (!accountNames.length) loadAccounts();
    $("greet-date").value = ev ? (ev.yearly ? "2000-" + ev.yearly : ev.on) : "";
    $("greet-until").value = ev && ev.until ? ev.until : "";
    $("greet-title").value = ev ? ev.title : "";
    $("greet-text").value = ev ? ev.text : "";
    $("greet-save").textContent = ev ? "حفظ التعديل" : "إضافة";
    $("greet-cancel").hidden = !ev;
    syncKind();
  }
  async function onSave() {
    var kind = $("greet-kind").value, name = $("greet-name").value.trim(), date = $("greet-date").value;
    if (!name) { flash("اختر الحساب"); return; }
    if (!date) { flash("اختر اليوم"); return; }
    var old = editingId ? events.filter(function (x) { return x.id === editingId; })[0] : null;
    var ev = { id: editingId || ("g" + Date.now().toString(36)), match: name, kind: kind, title: $("greet-title").value.trim(), text: $("greet-text").value.trim() };
    if (old && old.hint) ev.hint = old.hint;
    if (kind === "birthday") ev.yearly = date.slice(5);
    else { ev.on = date; ev.until = $("greet-until").value || ""; }
    var list = editingId ? events.map(function (x) { return x.id === editingId ? ev : x; }) : events.concat([ev]);
    var r = await save(list);
    if (r.ok) { flash("✓ حُفظت التهنئة"); fillForm(null); } else flash("تعذّر الحفظ: " + r.error);
  }

  function init() {
    var c0 = cached();
    if (c0) events = c0.map(cleanEvent).filter(Boolean);
    renderAdmin();
    if ($("greet-kind")) {
      $("greet-kind").addEventListener("change", syncKind);
      $("greet-save").addEventListener("click", onSave);
      $("greet-cancel").addEventListener("click", function () { fillForm(null); });
      fillForm(null);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });

  global.PharmacyGreetings = { start: start, load: load, check: check, setEvents: setEvents, getEvents: function () { return events.slice(); }, DEFAULTS: DEFAULTS, isToday: isToday, sameName: sameName, save: save };
})(window);
