/* ============================================================
   duty-roster.js  —  جدول الخفارات (pharmacists + admin)
   ============================================================
   A monthly table of the pharmacists' duties, three columns:
     · الخفارة الصباحية (أيام العطل) — the morning duty, which exists only on holidays
       (Friday and Saturday by default; the admin can tick any other day as a holiday)
     · الخفارة الوسطية
     · خفارة المبيت
   The holiday morning duty has several pharmacists: Friday 3, Saturday 5, and Thursday
   (when it is a holiday) 4 — so that column shows that many name fields (slots()).
   The ADMIN fills it (every day of the month, a name or names in each cell); the
   pharmacists only SEE it — and only the days that have a duty, their own name
   highlighted. Kept in app_settings key "duty_roster" (features.sql §17: every
   signed-in user reads it, only the admin writes it — the database refuses anyone
   else) and every device follows it live. «طباعة» draws it on A4 in Cairo.
   ============================================================ */

(function (global) {
  "use strict";

  const SKEY = "duty_roster";
  const CACHE = "pharma.roster.v1";
  const WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
  const FIELDS = [["m", "الخفارة الصباحية (أيام العطل)"], ["d", "الخفارة الوسطية"], ["n", "خفارة المبيت"]];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
  const todayISO = () => { const t = new Date(); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()); };
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const isAdmin = () => { const A = global.PharmacyAuth; return !!(A && A.isAdmin && A.isAdmin()); };

  let days = {};                       // "2026-10-24" → { m, d, n, h }   (h: 1 / 0 = holiday set by hand)
  const now = new Date();
  let cur = { y: now.getFullYear(), m: now.getMonth() };
  let channel = null, saveTimer = null, saving = false;

  // Friday and Saturday are the weekend; a hand-set flag wins
  function holiday(iso) {
    const e = days[iso];
    if (e && e.h != null) return !!e.h;
    const wd = new Date(iso + "T12:00:00").getDay();
    return wd === 5 || wd === 6;
  }
  // the morning duty keeps a LIST of names (older data may hold one string)
  const namesOf = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => String(x || "").trim()).filter(Boolean);
  const has = (e) => !!(e && (namesOf(e.m).length || String(e.d || "").trim() || String(e.n || "").trim()));
  // how many pharmacists the holiday morning duty has: Friday 3, Saturday 5, Thursday 4 (any
  // other day marked as a holiday: 3); 0 on a day that is not a holiday
  function slots(iso) {
    if (!holiday(iso)) return 0;
    const wd = new Date(iso + "T12:00:00").getDay();
    return wd === 5 ? 3 : wd === 6 ? 5 : wd === 4 ? 4 : 3;
  }

  // ---- the shared setting ----
  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  };
  function readCache() {
    try { const v = JSON.parse(localStorage.getItem(CACHE) || "null"); if (v && typeof v === "object") days = v; } catch (e) { /* ignore */ }
  }
  function writeCache() { try { localStorage.setItem(CACHE, JSON.stringify(days)); } catch (e) { /* blocked */ } }

  async function load() {
    const c = client();
    if (!c || saving || saveTimer) return;                  // never overwrite what the admin is typing
    try {
      const { data, error } = await c.from("app_settings").select("value").eq("key", SKEY).maybeSingle();
      if (error) return;
      const v = data && data.value ? (typeof data.value === "string" ? JSON.parse(data.value) : data.value) : null;
      days = v && v.days && typeof v.days === "object" ? v.days : {};
      writeCache();
      updateCounter();
      if (viewOpen() && !typing()) render();
    } catch (e) { /* offline / table missing: keep the cached roster */ }
  }
  function start() {
    readCache();
    updateCounter();
    load();
    const c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-duty-roster")
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => load())
          .subscribe();
      } catch (e) { /* the page reloads it when opened */ }
    }
  }
  function saveSoon() {
    if (!isAdmin()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const c = client();
      if (!c) return;
      saving = true;
      try {
        // keep the last 400 days so the setting stays small
        const keep = {};
        Object.keys(days).sort().slice(-400).forEach(k => { if (has(days[k]) || days[k].h != null) keep[k] = days[k]; });
        days = keep; writeCache();
        const { error } = await c.from("app_settings").upsert({ key: SKEY, value: { days }, updated_at: new Date().toISOString() }, { onConflict: "key" });
        const f = global.PharmacyApp && global.PharmacyApp.flashHint;
        if (error && f) f(/does not exist|schema cache|Could not find the table/i.test(error.message || "") ? "شغّل القسم 17 من features.sql في Supabase" : "تعذّر حفظ الجدول: " + error.message);
      } catch (e) { /* offline: kept in the cache, saved on the next edit */ }
      saving = false;
    }, 700);
  }

  // ---- the page ----
  const viewOpen = () => { const v = $("view-roster"); return !!(v && !v.hidden); };
  const typing = () => { const a = document.activeElement; return !!(a && a.classList && a.classList.contains("rs-in")); };
  // Is this written name the signed-in pharmacist? Spellings are compared loosely
  // (spaces, hamza…), and either name may be the longer one («عبدالله رائد» / «عبد الله رائد عبد…»)
  function isMe(token) {
    const me = myName();
    if (!me || !token) return false;
    const SP = global.PharmacySpecialists;
    const k = (s) => (SP && SP.key ? SP.key(s) : String(s).replace(/\s+/g, "").toLowerCase());
    const a = k(token), b = k(me);
    return a.length >= 4 && b.length >= 4 && (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
  }
  // names, one a line — only the signed-in pharmacist's own name is highlighted
  const namesHtml = (names) => names.map(n => (isMe(n) ? '<span class="rs-me">' + esc(n) + "</span>" : esc(n))).join("<br>");
  const splitNames = (v) => String(v || "").split(/[،,\n]+/).map(s => s.trim()).filter(Boolean);
  // The admin is a pharmacist too: his account name may differ from the name the roster
  // carries, so he can write it once (kept on this device)
  const MYKEY = "pharma.roster.myname";
  const savedMyName = () => { try { return String(localStorage.getItem(MYKEY) || "").trim(); } catch (e) { return ""; } };
  const myName = () => {
    if (isAdmin() && savedMyName()) return savedMyName();
    const A = global.PharmacyAuth; const u = A && A.getCurrentUser ? A.getCurrentUser() : null;
    return u && u.displayName ? String(u.displayName).trim() : "";
  };

  function cellHtml(e, f, admin, iso) {
    if (f === "m") {
      const n = slots(iso), list = (e && Array.isArray(e.m)) ? e.m : namesOf(e && e.m);
      if (admin) {
        if (!n) return '<td><input class="rs-in" disabled placeholder="ليست عطلة"></td>';
        let h = "<td>";
        for (let i = 0; i < n; i++) h += '<input class="rs-in rs-m' + (isMe(list[i] || "") ? " rs-mine" : "") + '" data-f="m" data-i="' + i + '" list="rs-names" type="text" autocomplete="off" placeholder="الصيدلاني ' + (i + 1) + '" value="' + esc(list[i] || "") + '">';
        return h + "</td>";
      }
      const names = namesOf(list);
      return "<td>" + (names.length ? namesHtml(names) : '<span class="rs-none">—</span>') + "</td>";
    }
    const val = (e && e[f]) || "";
    if (admin) {
      const off = f === "m" && !holiday(iso);
      return '<td><input class="rs-in' + (splitNames(val).some(isMe) ? " rs-mine" : "") + '" data-f="' + f + '" list="rs-names" type="text" autocomplete="off" value="' + esc(val) + '"' + (off ? " disabled placeholder=\"ليست عطلة\"" : "") + "></td>";
    }
    const names = splitNames(val);
    return "<td>" + (names.length ? namesHtml(names) : '<span class="rs-none">—</span>') + "</td>";
  }

  // ---- the counter: days to the signed-in pharmacist's nearest duty ----
  const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 864e5);
  // → { iso, diff, kinds: ["صباحية" | "وسطية" | "مبيت"] } | null — today counts (diff 0)
  function nextDuty() {
    const today = todayISO();
    const keys = Object.keys(days).filter(k => k >= today).sort();
    for (const iso of keys) {
      const e = days[iso] || {};
      const kinds = [];
      if (namesOf(e.m).some(isMe)) kinds.push("صباحية");
      if (splitNames(e.d).some(isMe)) kinds.push("وسطية");
      if (splitNames(e.n).some(isMe)) kinds.push("مبيت");
      if (kinds.length) return { iso, diff: dayDiff(today, iso), kinds };
    }
    return null;
  }
  // "اليوم" / "غدًا" / "بعد يومين" / "بعد 5 أيام" / "بعد 12 يومًا"
  function inDays(n) {
    if (n === 0) return "اليوم";
    if (n === 1) return "غدًا";
    if (n === 2) return "بعد يومين";
    return "بعد " + n + (n <= 10 ? " أيام" : " يومًا");
  }
  const hasDuties = () => { const A = global.PharmacyAuth; return !!(A && ((A.isPharmacist && A.isPharmacist()) || (A.isAdmin && A.isAdmin()))); };
  // «الوسطية» / «الصباحية» / «المبيت» — the kind(s) of the coming duty, for the counter
  const KIND_LABEL = { "صباحية": "الصباحية", "وسطية": "الوسطية", "مبيت": "المبيت" };
  const kindsLabel = (kinds) => (kinds || []).map(k => KIND_LABEL[k] || k).join(" و");
  function updateCounter() {
    const val = $("settings-roster-value");
    const aval = $("admin-roster-value");
    const card = $("rs-next-card");
    const mn = $("rs-myname");
    if (mn) { mn.hidden = !isAdmin(); if (isAdmin() && document.activeElement !== mn) mn.value = savedMyName() || (myName() || ""); }
    if (!hasDuties()) { if (val) val.textContent = ""; if (aval) aval.textContent = ""; if (card) card.hidden = true; return; }
    const nx = nextDuty();
    if (val) val.textContent = nx ? "خفارتك " + kindsLabel(nx.kinds) + " " + inDays(nx.diff) : "";
    if (aval) aval.textContent = nx ? "خفارتك " + kindsLabel(nx.kinds) + " القادمة " + inDays(nx.diff) : "";
    if (!card) return;
    card.hidden = false;
    if (!nx) {
      $("rs-next-num").textContent = "—";
      $("rs-next-title").textContent = "لا توجد خفارة قادمة لك في الجدول";
      $("rs-next-sub").textContent = "";
      return;
    }
    const wd = WD[new Date(nx.iso + "T12:00:00").getDay()];
    $("rs-next-num").innerHTML = nx.diff === 0 ? "اليوم" : nx.diff === 1 ? "غدًا" : nx.diff + "<small>" + (nx.diff === 2 ? "يومان" : nx.diff <= 10 ? "أيام" : "يومًا") + "</small>";
    $("rs-next-title").textContent = "خفارتك " + kindsLabel(nx.kinds) + " القادمة " + (nx.diff === 0 ? "اليوم" : inDays(nx.diff));
    $("rs-next-sub").textContent = wd + " " + Number(nx.iso.slice(8)) + "/" + Number(nx.iso.slice(5, 7)) + "/" + nx.iso.slice(0, 4) + " — " + nx.kinds.map(k => k === "مبيت" ? "خفارة مبيت" : "خفارة " + k).join(" و");
  }

  function render() {
    updateCounter();
    const body = $("rs-body");
    if (!body) return;
    const admin = isAdmin();
    $("rs-month").textContent = MONTHS[cur.m] + " " + cur.y;
    $("rs-sub").textContent = admin ? "اكتب اسم الصيدلاني في كل خفارة؛ الصيادلة يرون أيام الخفارات فقط" : "أيام الخفارات فقط — ويظهر اسمك مظلّلًا";
    $("rs-note").textContent = admin ? "الخفارة الصباحية في أيام العطل فقط: الجمعة صيدلانيان، والسبت ثلاثة، والخميس إن كان عطلة أربعة، وبقية الأيام إن عُلّمت عطلة ثلاثة (علّم اليوم بخانة «عطلة»)." : "";
    const today = todayISO();
    let rows = "", shown = 0;
    for (let d = 1; d <= daysIn(cur.y, cur.m); d++) {
      const iso = isoOf(cur.y, cur.m, d);
      const e = days[iso];
      if (!admin && !has(e)) continue;
      shown++;
      const wd = WD[new Date(iso + "T12:00:00").getDay()];
      const hol = holiday(iso);
      rows += '<tr data-iso="' + iso + '" class="' + (hol ? "is-hol " : "") + (iso === today ? "is-today" : "") + '"><th scope="row"><span class="rs-w">' + wd + '</span> <span class="rs-d">' + d + "/" + (cur.m + 1) + "/" + cur.y + "</span>" +
        (admin ? '<label class="rs-h"><input type="checkbox" class="rs-hol"' + (hol ? " checked" : "") + "> عطلة</label>" : "") + "</th>" +
        FIELDS.map(([f]) => cellHtml(e, f, admin, iso)).join("") + "</tr>";
    }
    body.innerHTML = rows || '<tr><td colspan="4" class="rs-empty">لا توجد خفارات مسجّلة في هذا الشهر</td></tr>';
    $("rs-print").hidden = !Object.keys(days).some(k => k.slice(0, 7) === cur.y + "-" + pad(cur.m + 1) && has(days[k]));
  }

  async function fillNames() {
    const dl = $("rs-names");
    const A = global.PharmacyAuth;
    if (!dl || !isAdmin() || !A || !A.listUsers) return;
    try {
      const r = await A.listUsers();
      if (!r.ok) return;
      const names = r.users.filter(u => (u.role === "pharmacist" || u.role === "admin") && u.active !== false)
        .map(u => String(u.display_name || u.username || "").split("|")[0].trim()).filter(Boolean).sort();
      dl.innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join("");
    } catch (e) { /* free text still works */ }
  }

  // ---- the printed month ----
  function printHtml() {
    const f = (n) => new URL("fonts/" + n, location.href).href;
    const prefix = cur.y + "-" + pad(cur.m + 1);
    const list = Object.keys(days).filter(k => k.slice(0, 7) === prefix && has(days[k])).sort();
    const rows = list.map(iso => {
      const e = days[iso], hol = holiday(iso), d = Number(iso.slice(8));
      const wd = WD[new Date(iso + "T12:00:00").getDay()];
      return "<tr" + (hol ? ' class="h"' : "") + "><td>" + d + "/" + (cur.m + 1) + "</td><td>" + wd + "</td><td>" + namesOf(e.m).map(esc).join("<br>") + "</td><td>" + esc(e.d || "") + "</td><td>" + esc(e.n || "") + "</td></tr>";
    }).join("");
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>جدول الخفارات</title><style>' +
      '@font-face{font-family:"Cairo";src:url("' + f("Cairo-Regular.ttf") + '") format("truetype");font-weight:400;font-display:block}' +
      '@font-face{font-family:"Cairo";src:url("' + f("Cairo-Bold.ttf") + '") format("truetype");font-weight:700;font-display:block}' +
      "@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Cairo,'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;color:#000;margin:0}" +
      "h1{font-size:16pt;text-align:center;margin:0 0 3mm}h2{font-size:12pt;font-weight:400;text-align:center;margin:0 0 6mm}" +
      "table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.25mm solid #777;padding:1.6mm 1.5mm;font-size:11pt;text-align:center;vertical-align:middle;overflow-wrap:anywhere}" +
      "thead th{border:.7mm solid #000;font-weight:700;background:#fff}tr.h td{background:#f1f1f1}" +
      "col.c1{width:11%}col.c2{width:17%}</style></head><body><h1>جدول الخفارات</h1><h2>" + MONTHS[cur.m] + " " + cur.y + "</h2>" +
      "<table><colgroup><col class=c1><col class=c2><col><col><col></colgroup><thead><tr><th>التاريخ</th><th>اليوم</th><th>الخفارة الصباحية<br>(أيام العطل)</th><th>الخفارة الوسطية</th><th>خفارة المبيت</th></tr></thead><tbody>" +
      rows + "</tbody></table></body></html>";
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function preview() {
    const old = $("roster-preview");
    if (old) old.remove();
    const overlay = el("div"); overlay.id = "roster-preview";
    overlay.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.72);display:flex;flex-direction:column;";
    const bar = el("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:10px 12px;background:#14211f;color:#fff;flex-wrap:wrap;";
    const title = el("strong", null, "جدول الخفارات — " + MONTHS[cur.m] + " " + cur.y);
    title.style.cssText = "flex:1;min-width:140px;font-size:14px;";
    const printBtn = el("button", null, "🖨 طباعة / حفظ PDF"), closeBtn = el("button", null, "إغلاق");
    [printBtn, closeBtn].forEach(b => { b.type = "button"; b.style.cssText = "padding:8px 14px;border-radius:10px;border:0;font:inherit;font-weight:800;cursor:pointer;background:#fff;color:#14211f;"; });
    printBtn.style.background = "#f5b301";
    bar.appendChild(title); bar.appendChild(printBtn); bar.appendChild(closeBtn);
    const stage = el("div"); stage.style.cssText = "flex:1;overflow:auto;padding:12px;display:flex;justify-content:center;";
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "معاينة جدول الخفارات");
    const W = 794, H = 1123;
    frame.style.cssText = "border:0;background:#fff;width:" + W + "px;height:" + H + "px;transform-origin:top center;flex:none;";
    const fit = () => { const s = Math.min(1, (window.innerWidth - 24) / W); frame.style.transform = "scale(" + s + ")"; frame.style.marginBottom = (-H * (1 - s)) + "px"; };
    frame.srcdoc = printHtml();
    stage.appendChild(frame); overlay.appendChild(bar); overlay.appendChild(stage); document.body.appendChild(overlay);
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    closeBtn.addEventListener("click", () => { window.removeEventListener("resize", onResize); overlay.remove(); });
    printBtn.addEventListener("click", () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* blocked */ } });
  }

  // ---- open / events ----
  function open() {
    const A = global.PharmacyAuth;
    if (!(A && (A.isAdmin() || (A.isPharmacist && A.isPharmacist())))) return;      // pharmacists + admin
    const UI = global.PharmacyUI;
    api._from = (UI.showView._lastView && UI.showView._lastView !== "roster") ? UI.showView._lastView : "settings";
    readCache();
    render();
    UI.showView("roster");
    load();
    fillNames();
  }
  function shiftMonth(delta) {
    cur.m += delta;
    if (cur.m < 0) { cur.m = 11; cur.y--; } else if (cur.m > 11) { cur.m = 0; cur.y++; }
    render();
  }
  function init() {
    ["settings-roster-btn", "admin-roster-btn"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", open); });
    const back = $("roster-back-btn");
    if (back) back.addEventListener("click", () => global.PharmacyUI.showView(api._from || "settings"));
    const mn = $("rs-myname");
    if (mn) mn.addEventListener("change", () => {
      try { localStorage.setItem(MYKEY, mn.value.trim()); } catch (e) { /* blocked */ }
      updateCounter();
      if (viewOpen()) render();
    });
    setInterval(updateCounter, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) updateCounter(); });
    const view = $("view-roster");
    if (!view) return;
    $("rs-prev").addEventListener("click", () => shiftMonth(-1));
    $("rs-next").addEventListener("click", () => shiftMonth(1));
    $("rs-print").addEventListener("click", preview);
    view.addEventListener("input", (e) => {
      if (!isAdmin() || !e.target.classList.contains("rs-in")) return;
      const tr = e.target.closest("tr"); const iso = tr.dataset.iso;
      days[iso] = days[iso] || {};
      if (e.target.dataset.f === "m") {
        const arr = Array.isArray(days[iso].m) ? days[iso].m.slice() : namesOf(days[iso].m);
        arr[Number(e.target.dataset.i)] = e.target.value;
        days[iso].m = arr;
      } else days[iso][e.target.dataset.f] = e.target.value;
      saveSoon();
    });
    view.addEventListener("change", (e) => {
      if (!isAdmin() || !e.target.classList.contains("rs-hol")) return;
      const tr = e.target.closest("tr"); const iso = tr.dataset.iso;
      days[iso] = days[iso] || {};
      days[iso].h = e.target.checked ? 1 : 0;
      saveSoon();
      render();
    });
  }

  const api = { open, start, load, holiday, has, slots, printHtml, nextDuty, inDays, updateCounter };
  global.PharmacyDutyRoster = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
