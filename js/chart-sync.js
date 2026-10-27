/* ============================================================
   chart-sync.js  —  sends our table straight into the chart app
   ============================================================
   Calls the Vercel function api/chart-sync.js, which logs in to the
   chart app, merges the table into today's ward chart and saves it.
   Normally the ward's shared chart account is used (set on Vercel, never
   on the device). Only when none is set (412) — or to override it — a
   personal account is asked for and kept on this device (localStorage),
   removed when the user logs out.
   ============================================================ */

(function (global) {
  "use strict";

  const KEY = "pharma.chart-account.v1";
  const PROD = "https://clinical-chart.vercel.app";

  function endpoint() {
    return (location.origin === PROD ? "" : PROD) + "/api/chart-sync";
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function getAccount() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || "null");
      return a && a.username && a.password ? a : null;
    } catch (e) { return null; }
  }
  function setAccount(a) {
    try { localStorage.setItem(KEY, JSON.stringify({ username: a.username, password: a.password })); } catch (e) { /* blocked */ }
  }
  function clearAccount() {
    try { localStorage.removeItem(KEY); } catch (e) { /* blocked */ }
  }

  async function appToken() {
    const SB = global.PharmacySupabase;
    const client = SB && SB.getClient ? SB.getClient() : null;
    if (!client) return "";
    try {
      const { data } = await client.auth.getSession();
      return (data && data.session && data.session.access_token) || "";
    } catch (e) { return ""; }
  }

  async function call(payload) {
    const token = await appToken();
    let r;
    try {
      r = await fetch(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return { ok: false, status: 0, message: "تعذّر الاتصال — تحقق من الإنترنت" };
    }
    let body = {};
    try { body = await r.json(); } catch (e) { /* empty */ }
    return Object.assign({ status: r.status }, body, { ok: r.ok && body.ok !== false, message: body.message || (r.ok ? "" : "تعذّر الإرسال (" + r.status + ")") });
  }

  // ---------- account dialog ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Resolves with the saved account, or null when cancelled
  function askAccount() {
    return new Promise(resolve => {
      const old = document.getElementById("chart-account-modal");
      if (old) old.remove();
      const cur = getAccount();
      const overlay = el("div", "chart-acc-overlay");
      overlay.id = "chart-account-modal";
      const box = el("div", "chart-acc-box");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.appendChild(el("h3", "chart-acc-title", "ربط حساب الجارت"));
      box.appendChild(el("p", "chart-acc-hint",
        "حسابك في موقع الجارت — يُحفظ على هذا الجهاز فقط ويُحذف عند تسجيل الخروج من التطبيق. يُستعمل لتعبئة جارت الوحدتين تلقائياً."));
      const user = el("input", "chart-acc-input");
      user.type = "text"; user.placeholder = "اسم المستخدم في الجارت"; user.autocomplete = "off"; user.dir = "ltr";
      user.value = cur ? cur.username : "";
      const pass = el("input", "chart-acc-input");
      pass.type = "password"; pass.placeholder = "كلمة المرور"; pass.autocomplete = "off"; pass.dir = "ltr";
      const msg = el("div", "chart-acc-msg");
      const row = el("div", "chart-acc-actions");
      const test = el("button", "sendlog-btn", "اختبار الاتصال");
      const save = el("button", "sendlog-btn sendlog-resend", "حفظ");
      const cancel = el("button", "sendlog-btn", "إلغاء");
      [test, save, cancel].forEach(b => { b.type = "button"; row.appendChild(b); });
      box.appendChild(user); box.appendChild(pass); box.appendChild(msg); box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      setTimeout(() => (cur ? pass : user).focus(), 50);

      const close = (val) => { overlay.remove(); resolve(val); };
      const read = () => ({ username: user.value.trim(), password: pass.value });
      const show = (t, bad) => { msg.textContent = t; msg.classList.toggle("is-bad", !!bad); };
      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      test.addEventListener("click", async () => {
        const a = read();
        if (!a.username || !a.password) { show("أدخل اسم المستخدم وكلمة المرور", true); return; }
        test.disabled = true;
        show("جارٍ الاتصال بالجارت… قد يستغرق دقيقة إذا كان الموقع نائماً");
        const r = await call({ action: "test", username: a.username, password: a.password, date: todayISO() });
        test.disabled = false;
        show(r.ok ? "✓ تم الدخول — جارت اليوم فيه " + r.patients + " مريض" : r.message, !r.ok);
      });
      save.addEventListener("click", () => {
        const a = read();
        if (!a.username || !a.password) { show("أدخل اسم المستخدم وكلمة المرور", true); return; }
        setAccount(a);
        close(a);
      });
    });
  }

  // Send a table (TSV) into today's ward chart. Asks for the account the
  // first time (or after a wrong password). → { ok, summary | message }
  // date: the chart's day ("YYYY-MM-DD"), today when empty
  async function send(tsv, onProgress, date, unit) {
    let acc = getAccount();                         // personal override, if any
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayISO();
    const payload = (a) => Object.assign({ action: "send", date: day, tsv, unit: unit || "1" }, a ? { username: a.username, password: a.password } : {});
    if (onProgress) onProgress("جارٍ الإرسال إلى الجارت… قد يستغرق دقيقة إذا كان موقع الجارت نائماً");
    let r = await call(payload(acc));
    // No shared account on the server, or a wrong personal one → ask once
    if (!r.ok && (r.status === 412 || (r.status === 401 && acc && !r.shared && !/تطبيق الردهة/.test(r.message)))) {
      acc = await askAccount();
      if (!acc) return { ok: false, cancelled: true, message: "أُلغي الإرسال" };
      if (onProgress) onProgress("جارٍ الإرسال إلى الجارت…");
      r = await call(payload(acc));
    }
    return r;
  }

  // Which of our medicine names the chart app does NOT double on Thursdays.
  // Cached for the day (the list rarely changes; reading it logs in to the chart).
  // → { ok, noDouble: [names] } | { ok: false, message }
  async function noDouble(names, onProgress) {
    const day = todayISO();
    const sig = names.slice().sort().join("|");
    try {
      const c = JSON.parse(localStorage.getItem("pharma.noDouble.v1") || "null");
      if (c && c.day === day && c.sig === sig) return { ok: true, noDouble: c.noDouble, cached: true };
    } catch (e) { /* ignore */ }
    let acc = getAccount();
    const payload = (a) => Object.assign({ action: "nodouble", date: day, names }, a ? { username: a.username, password: a.password } : {});
    if (onProgress) onProgress("جارٍ قراءة الأدوية المستثناة من المضاعفة في الجارت…");
    let r = await call(payload(acc));
    if (!r.ok && (r.status === 412 || (r.status === 401 && acc && !r.shared && !/تطبيق الردهة/.test(r.message)))) {
      acc = await askAccount();
      if (!acc) return { ok: false, cancelled: true, message: "أُلغيت القراءة" };
      r = await call(payload(acc));
    }
    if (r.ok) { try { localStorage.setItem("pharma.noDouble.v1", JSON.stringify({ day, sig, noDouble: r.noDouble || [] })); } catch (e) { /* blocked */ } }
    return r;
  }

  function describe(r) {
    if (!r.ok) return r.message;
    const s = r.summary || {};
    let t = (r.complete === false ? "⚠ حُفظ جزئياً في الجارت: " : "✓ حُفظ في الجارت: ") + s.patients + " مريض · " + s.meds + " دواء";
    if (s.newPatients) t += " · " + s.newPatients + " مريض جديد";
    if (s.extra && s.extra.patients) t += " · " + s.extra.patients + " مريض في الجارت الإضافي";
    if (s.skipped && s.skipped.length) t += " — يحتاج انتباهك: " + s.skipped.length;
    return t;
  }

  global.PharmacyChartSync = { send, noDouble, askAccount, getAccount, clearAccount, describe, todayISO };
})(window);
