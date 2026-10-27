/* ============================================================
   occasions.js  —  Ramadan / Eid / New Year theme
   ============================================================
   Sets html[data-occasion="ramadan" | "eid-fitr" | "eid-adha" | "newyear"]
   (css/occasions.css draws the art on the header and the ward display) and writes
   the greeting chip. Automatic: by the Hijri calendar (Umm al-Qura, from Intl)
   Ramadan; Eid al-Fitr 1-3 Shawwal; Eid al-Adha 9-13 Dhul-Hijjah — and the New
   Year / Christmas season 24 Dec - 2 Jan.

   Only the ADMIN controls it: the choice (تلقائي ← رمضان ← عيد الفطر ← عيد الأضحى ←
   رأس السنة ← إيقاف) is saved in app_settings key "occasion" (features.sql §17: every
   signed-in user reads it, only the admin may write it — the database refuses anyone
   else) and every device follows it, live. The moon sighting can differ by a day,
   which is why the admin can set it by hand. The last value read is cached on the
   device for offline starts.
   ============================================================ */

(function (global) {
  "use strict";

  const CACHE = "pharma.occasion";
  const SKEY = "occasion";
  const MODES = ["auto", "ramadan", "eid-fitr", "eid-adha", "newyear", "off"];
  const LABEL = { auto: "تلقائي", ramadan: "رمضان", "eid-fitr": "عيد الفطر", "eid-adha": "عيد الأضحى", newyear: "رأس السنة", off: "إيقاف" };
  const GREETING = { ramadan: "رمضان كريم", "eid-fitr": "عيد فطر مبارك", "eid-adha": "عيد أضحى مبارك", newyear: "كل عام وأنتم بخير" };

  // Hijri month / day of a date, or null when the browser has no such calendar
  function hijri(date) {
    try {
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric" }).formatToParts(date);
      const get = (t) => Number((parts.find(p => p.type === t) || {}).value);
      const month = get("month"), day = get("day");
      return month >= 1 && day >= 1 ? { month, day } : null;
    } catch (e) { return null; }
  }

  // → "ramadan" | "eid-fitr" | "eid-adha" | "newyear" | null for a date
  function kindOf(date) {
    const gm = date.getMonth() + 1, gd = date.getDate();
    const h = hijri(date);
    if (h) {
      if (h.month === 9) return "ramadan";
      if (h.month === 10 && h.day <= 3) return "eid-fitr";
      if (h.month === 12 && h.day >= 9 && h.day <= 13) return "eid-adha";
    }
    if ((gm === 12 && gd >= 24) || (gm === 1 && gd <= 2)) return "newyear";
    return null;
  }

  function getMode() {
    try { const m = localStorage.getItem(CACHE); return MODES.indexOf(m) !== -1 ? m : "auto"; } catch (e) { return "auto"; }
  }
  function cacheMode(m) {
    try { localStorage.setItem(CACHE, m); } catch (e) { /* blocked */ }
  }

  // The occasion in force now: "ramadan" | "eid-fitr" | "eid-adha" | "newyear" | null
  function current(date) {
    const m = getMode();
    if (m === "off") return null;
    if (m !== "auto") return m;
    return kindOf(date || new Date());
  }

  function apply() {
    const k = current();
    const root = document.documentElement;
    if (k) root.setAttribute("data-occasion", k);
    else root.removeAttribute("data-occasion");
    ["occasion-chip", "display-occasion"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = k ? GREETING[k] : "";
      el.hidden = !k;
    });
    ["occasion-deco", "display-deco"].forEach(id => { const d = document.getElementById(id); if (d) d.hidden = !k; });
    // the admin's control
    const sel = document.getElementById("admin-occasion-select");
    if (sel && sel.value !== getMode()) sel.value = getMode();
    const now = document.getElementById("admin-occasion-now");
    if (now) now.textContent = k ? "الظاهر الآن: " + GREETING[k] : "لا مناسبة ظاهرة الآن";
  }

  // ---- the shared setting ----
  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  };
  let channel = null;

  async function load() {
    const c = client();
    if (!c) return;
    try {
      const { data, error } = await c.from("app_settings").select("value").eq("key", SKEY).maybeSingle();
      if (error) return;
      const v = data && data.value ? (typeof data.value === "string" ? JSON.parse(data.value) : data.value) : null;
      cacheMode(v && MODES.indexOf(v.mode) !== -1 ? v.mode : "auto");     // no row = automatic
      apply();
    } catch (e) { /* offline / table missing: keep the cached choice */ }
  }
  function start() {
    load();
    const c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-occasion")
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => load())
          .subscribe();
      } catch (e) { /* the hourly refresh below still picks it up */ }
    }
  }

  // Admin only (also enforced by the database)
  async function setMode(m) {
    const A = global.PharmacyAuth;
    if (!(A && A.isAdmin && A.isAdmin())) return { ok: false, error: "تغيير المظهر للمسؤول فقط" };
    if (MODES.indexOf(m) === -1) return { ok: false, error: "قيمة غير معروفة" };
    const c = client();
    if (!c) return { ok: false, error: "غير متصل" };
    const { error } = await c.from("app_settings").upsert({ key: SKEY, value: { mode: m }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      const msg = error.message || "";
      return { ok: false, error: /does not exist|schema cache|Could not find the table/i.test(msg) ? "شغّل القسم 17 من features.sql في Supabase" : msg };
    }
    cacheMode(m);
    apply();
    return { ok: true };
  }

  function init() {
    apply();
    const sel = document.getElementById("admin-occasion-select");
    if (sel) {
      sel.innerHTML = MODES.map(m => '<option value="' + m + '">' + LABEL[m] + "</option>").join("");
      sel.value = getMode();
      sel.addEventListener("change", async () => {
        const r = await setMode(sel.value);
        const f = global.PharmacyApp && global.PharmacyApp.flashHint;
        if (f) f(r.ok ? "✓ مظهر المناسبات: " + LABEL[sel.value] + " (لكل الأجهزة)" : "تعذّر الحفظ: " + r.error);
        if (!r.ok) { sel.value = getMode(); }
      });
    }
    setInterval(apply, 30 * 60 * 1000);                     // a new day may start an occasion
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { apply(); load(); } });
  }

  global.PharmacyOccasions = { kindOf, hijri, current, getMode, apply, setMode, start, load, GREETING, MODES, LABEL };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
