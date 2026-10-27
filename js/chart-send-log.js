/* ============================================================
   chart-send-log.js  —  "سجل الإرسال إلى الجارت"
   ============================================================
   Every send to the chart app (chart-bridge.js sendChart) is kept
   here with the exact table that was sent and the outcome, so a failed
   send can be re-sent or checked later. Also shows the linked chart
   account (chart-sync.js). Stored on this device (localStorage): last
   40 sends, 30 days; cleared when the user logs out.
   Pharmacists + admin (the ordering roles).
   ============================================================ */

(function (global) {
  "use strict";

  const KEY = "pharma.chart-send-log.v1";
  const MAX_ENTRIES = 40;
  const MAX_AGE_MS = 30 * 86400000;

  function load() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function save(list) {
    const now = Date.now();
    const kept = list.filter(e => e && now - new Date(e.at).getTime() < MAX_AGE_MS).slice(0, MAX_ENTRIES);
    try { localStorage.setItem(KEY, JSON.stringify(kept)); return true; }
    catch (e) { return false; }
  }

  // TSV → { header: [...], rows: [[...]] }
  function parseTsv(tsv) {
    const lines = String(tsv || "").split("\n");
    const header = (lines.shift() || "").split("\t");
    return { header, rows: lines.filter(Boolean).map(l => l.split("\t")) };
  }

  // Called by chart-bridge after building the table. Returns the entry.
  function add(tsv, meta) {
    const Auth = global.PharmacyAuth;
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const t = parseTsv(tsv);
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      by: user ? (user.displayName || user.username) : "—",
      patients: t.rows.length,
      items: Math.max(0, t.header.length - 2),
      withSupplies: !!(meta && meta.withSupplies),
      date: (meta && meta.date) || "",           // the chart's day ("" = the day it was sent)
      resends: 0,
      tsv: tsv
    };
    const list = load();
    list.unshift(entry);
    save(list);
    return entry;
  }

  function markResent(id) {
    const list = load();
    const e = list.find(x => x.id === id);
    if (e) { e.resends = (e.resends || 0) + 1; e.lastResendAt = new Date().toISOString(); save(list); }
    return e;
  }

  // Outcome of the last attempt (chart-bridge sendTsv)
  function setResult(id, r) {
    const list = load();
    const e = list.find(x => x.id === id);
    if (!e) return;
    e.result = {
      ok: !!r.ok,
      complete: r.complete !== false,
      at: new Date().toISOString(),
      message: r.ok ? "" : (r.message || "تعذّر الإرسال"),
      skipped: (r.summary && r.summary.skipped) || []
    };
    save(list);
    const view = document.getElementById("view-sendlog");
    if (view && !view.hidden) render();
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* blocked */ }
  }

  // ---------- View ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const fmt = (iso) => new Date(iso).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
  const flash = (m) => global.PharmacyApp && global.PharmacyApp.flashHint(m);

  function previewTable(tsv) {
    const t = parseTsv(tsv);
    const wrap = el("div", "sendlog-table-wrap");
    const table = el("table", "sendlog-table");
    const thead = el("thead");
    const hr = el("tr");
    ["اسم المريض", "رقم الطبلة"].concat(t.header.slice(2)).forEach(h => hr.appendChild(el("th", null, h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el("tbody");
    t.rows.forEach(r => {
      const tr = el("tr");
      for (let i = 0; i < t.header.length; i++) tr.appendChild(el("td", null, r[i] || ""));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function render() {
    const listEl = document.getElementById("sendlog-list");
    if (!listEl) return;
    const list = load();
    listEl.innerHTML = "";
    if (!list.length) {
      listEl.appendChild(el("div", "tasks-empty", "لا توجد عمليات إرسال محفوظة على هذا الجهاز بعد"));
      return;
    }
    list.forEach((e, i) => {
      const card = el("div", "sendlog-card" + (i === 0 ? " is-latest" : ""));
      const head = el("div", "sendlog-head");
      head.appendChild(el("strong", "sendlog-when", fmt(e.at)));
      if (i === 0) head.appendChild(el("span", "sendlog-tag", "الأحدث"));
      card.appendChild(head);
      const meta = [e.patients + " مريض", e.items + " دواء/مستلزم", "بواسطة " + e.by];
      if (e.resends) meta.push("أُعيد إرساله " + e.resends + (e.resends === 1 ? " مرة" : " مرات"));
      card.appendChild(el("div", "sendlog-meta", meta.join(" · ")));
      const res = e.result;
      const partial = res && res.ok && res.complete === false;
      card.appendChild(el("div", "sendlog-status " + (!res ? "is-pending" : partial ? "is-partial" : res.ok ? "is-ok" : "is-bad"),
        !res ? "لم يُعرف ناتج الإرسال"
          : partial ? "⚠ حُفظ جزئياً " + fmt(res.at) + " — راجع القائمة"
          : res.ok ? "✓ حُفظ في الجارت " + fmt(res.at) : "✗ فشل: " + res.message));
      if (res && res.skipped && res.skipped.length) {
        const ul = el("ul", "sendlog-skipped");
        res.skipped.forEach(x => ul.appendChild(el("li", null, x)));
        card.appendChild(ul);
      }
      const actions = el("div", "sendlog-actions");
      [["resend", "إعادة الإرسال"], ["view", "عرض"], ["open", "فتح الجارت"]].forEach(([act, label]) => {
        const b = el("button", "sendlog-btn sendlog-" + act, label);
        b.type = "button";
        b.dataset.act = act;
        b.dataset.id = e.id;
        actions.appendChild(b);
      });
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function copyTsv(tsv) {
    try { await navigator.clipboard.writeText(tsv); return true; }
    catch (e) { return false; }
  }

  function open() {
    const Auth = global.PharmacyAuth;
    if (!(Auth && (Auth.isAdmin() || Auth.isPharmacist()))) return;
    global.PharmacyUI.showView("sendlog");
    renderAccount();
    render();
  }

  // Chart account card (chart-sync.js): linked / change / unlink
  function renderAccount() {
    const box = document.getElementById("sendlog-account");
    const Sync = global.PharmacyChartSync;
    if (!box || !Sync) return;
    const acc = Sync.getAccount();
    box.innerHTML = "";
    box.appendChild(el("div", "sendlog-acc-text", acc
      ? "يُرسَل بحساب الجارت الخاص بهذا الجهاز: " + acc.username
      : "يُرسَل بحساب الجارت المشترك للردهة"));
    const row = el("div", "sendlog-actions");
    const link = el("button", "sendlog-btn", acc ? "تغيير الحساب" : "استعمال حساب آخر");
    link.type = "button";
    link.addEventListener("click", async () => { await Sync.askAccount(); renderAccount(); });
    row.appendChild(link);
    if (acc) {
      const un = el("button", "sendlog-btn", "الرجوع للحساب المشترك");
      un.type = "button";
      un.addEventListener("click", () => {
        if (!confirm("الرجوع إلى حساب الجارت المشترك على هذا الجهاز؟")) return;
        Sync.clearAccount();
        renderAccount();
      });
      row.appendChild(un);
    }
    box.appendChild(row);
  }

  function init() {
    ["settings-sendlog-btn", "admin-sendlog-btn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", open);
    });
    const back = document.getElementById("sendlog-back-btn");
    if (back) back.addEventListener("click", () => {
      const Auth = global.PharmacyAuth;
      global.PharmacyUI.showView(Auth && Auth.isAdmin() ? "admin" : "settings");
    });
    const listEl = document.getElementById("sendlog-list");
    if (listEl) listEl.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const entry = load().find(x => x.id === b.dataset.id);
      if (!entry) return;
      const card = b.closest(".sendlog-card");
      if (b.dataset.act === "view") {
        const shown = card.querySelector(".sendlog-table-wrap");
        if (shown) { shown.remove(); b.textContent = "عرض"; }
        else { card.appendChild(previewTable(entry.tsv)); b.textContent = "إخفاء"; }
      } else if (b.dataset.act === "open") {
        global.PharmacyChartBridge.openChart(entry.tsv);
      } else if (b.dataset.act === "resend") {
        // a send made for a chosen day goes back to that day's chart
        const day = entry.date || "";
        if (!confirm("إعادة إرسال بيانات " + fmt(entry.at) + " إلى جارت " + (day ? "يوم " + day : "اليوم") + "؟")) return;
        b.disabled = true;
        markResent(entry.id);
        const r = await global.PharmacyChartBridge.sendTsv(entry.tsv, entry.id, flash, day);
        b.disabled = false;
        renderAccount();
        render();
        if (!r.cancelled) flash(global.PharmacyChartSync.describe(r));
      }
    });
  }

  global.PharmacyChartLog = { init, open, render, add, load, parseTsv, setResult, clear };
})(window);
