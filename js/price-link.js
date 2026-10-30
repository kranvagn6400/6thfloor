/* price-link.js — links a catalogue medicine to its drug on the price site (mediprice-pharmacy.vercel.app)
   ------------------------------------------------------------------------------------------------
   med.priceRef  = the drug's id on the price site (medications.price_ref, features.sql §27)
   med.priceSeen = the price the admin last accepted (medications.price_seen)
   • the private discharge form reads the LINKED drug's price live (private-form.js linkedPrice);
   • in the catalogue list a yellow ⚠ shows on a drug whose site price changed since it was accepted, or that left the site;
   • the editor has «الدواء في موقع الأسعار» (search → pick), a notice with «اعتماد السعر الجديد», and a button on the list
     that links the not-yet-linked drugs automatically (the same name matching as the discharge form).
   The list comes from our function /api/drug-prices (the site itself has no CORS). */
(function (global) {
  "use strict";

  const CACHE = "pharma.pricelist.v3";
  const TTL = 30 * 60 * 1000;
  let list = null, loading = null;
  let D = { ref: "", seen: 0 };            // the link of the drug open in the editor (saved with the form)

  const $ = (id) => document.getElementById(id);
  const App = () => global.PharmacyApp;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

  function loadList(force) {
    if (list && !force) return Promise.resolve(list);
    if (loading && !force) return loading;
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(CACHE) || "null");
        if (c && Date.now() - c.t < TTL && Array.isArray(c.list) && c.list.length) { list = c.list; return Promise.resolve(list); }
      } catch (e) { /* blocked */ }
    }
    loading = fetch("/api/drug-prices").then((r) => { if (!r.ok) throw new Error("drug-prices " + r.status); return r.json(); }).then((j) => {
      const l = ((j && j.list) || []).filter((d) => d && d.id && d.name && d.price > 0);
      if (!l.length) throw new Error("empty price list");
      list = l;
      try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), list: l })); } catch (e) { /* blocked */ }
      return l;
    }).catch((e) => { console.warn("[price-link]", e); return null; }).then((l) => { loading = null; return l; });
    return loading;
  }

  // → { state: "none" | "ok" | "changed" | "missing", entry?, from?, to? }
  function statusOf(med, l) {
    if (!med || !med.priceRef) return { state: "none" };
    const e = (l || []).find((x) => x.id === med.priceRef);
    if (!e) return { state: "missing" };
    if (med.priceSeen > 0 && Math.abs(e.price - med.priceSeen) > 0.0001) return { state: "changed", entry: e, from: med.priceSeen, to: e.price };
    return { state: "ok", entry: e };
  }
  function noteOf(st) {
    return st.state === "missing" ? "هذا الدواء لم يعد موجودًا في موقع الأسعار"
      : st.state === "changed" ? "تغيّر سعره في موقع الأسعار من " + fmt(st.from) + " إلى " + fmt(st.to) : "";
  }

  // ---- the coloured dots in the catalogue list: green = linked, yellow = its price changed / it left the site, red = not linked ----
  function putDot(row, cls, title) {
    const old = row.querySelector(".pl-dot"); if (old) old.remove();
    const d = document.createElement("span");
    d.className = "pl-dot " + cls; d.title = title; d.setAttribute("aria-label", title);
    const nameEl = row.querySelector(".admin-med-name"); if (nameEl) nameEl.appendChild(d);
  }
  function decorate() {
    const rows = () => Array.from(document.querySelectorAll("#admin-med-list .admin-med-row"));
    const medOf = (row) => ((App() && App().state.medications) || []).find((x) => x.id === row.dataset.medId);
    // the red dots do not need the site: they show at once
    rows().forEach((row) => { const m = medOf(row); if (m && !m.priceRef) putDot(row, "is-red", "غير مربوط بموقع الأسعار"); });
    loadList().then((l) => {
      let n = 0;
      rows().forEach((row) => {
        const m = medOf(row); if (!m || !m.priceRef) return;
        if (!l) { putDot(row, "is-grey", "مربوط — تعذّر التحقق من الموقع الآن"); return; }
        const st = statusOf(m, l);
        if (st.state === "changed" || st.state === "missing") { n++; putDot(row, "is-yellow", noteOf(st)); }
        else putDot(row, "is-green", "مربوط بموقع الأسعار");
      });
      const head = document.querySelector(".admin-list-head h3");
      if (head) { const o = head.querySelector(".pl-count"); if (o) o.remove(); if (n) { const s2 = document.createElement("span"); s2.className = "pl-count"; s2.textContent = "● " + n; s2.title = "أدوية تغيّر سعرها في موقع الأسعار أو لم تعد فيه"; head.appendChild(s2); } }
    });
  }

  // ---- the editor field ----
  function draft() { return { ref: D.ref || "", seen: D.seen > 0 ? D.seen : 0 }; }
  function bindEditor(med) {
    D = { ref: (med && med.priceRef) || "", seen: (med && med.priceSeen) || 0 };
    const s = $("adm-link-search"); if (s) s.value = "";
    const r = $("adm-link-results"); if (r) r.innerHTML = "";
    renderCurrent();
  }
  function renderCurrent() {
    const cur = $("adm-link-current"), warn = $("adm-link-warn");
    if (!cur) return;
    if (!D.ref) { cur.textContent = "غير مربوط"; if (warn) warn.hidden = true; return; }
    cur.textContent = "…";
    loadList().then((l) => {
      if (!$("adm-link-current")) return;
      if (!l) { cur.textContent = "مربوط (تعذّر الاتصال بموقع الأسعار الآن)"; return; }
      const st = statusOf({ priceRef: D.ref, priceSeen: D.seen }, l), e = st.entry;
      cur.innerHTML = e
        ? "<b dir=\"ltr\">" + esc(e.name) + "</b>" + (e.alt ? ' <small dir="ltr">(' + esc(e.alt) + ")</small>" : "") + " — <b>" + esc(fmt(e.price)) + " د.ع</b> <button type=\"button\" class=\"pl-unlink\" id=\"adm-link-clear\">إزالة الربط</button>"
        : "مربوط بدواء لم يعد في الموقع <button type=\"button\" class=\"pl-unlink\" id=\"adm-link-clear\">إزالة الربط</button>";
      if (warn) {
        if (st.state === "changed") { warn.hidden = false; warn.innerHTML = "⚠ " + esc(noteOf(st)) + ". <button type=\"button\" id=\"adm-link-accept\">اعتماد السعر الجديد</button> <small>(ثم احفظ التعديل)</small>"; }
        else if (st.state === "missing") { warn.hidden = false; warn.textContent = "⚠ " + noteOf(st) + " — اختر دواءً آخر أو أزل الربط."; }
        else warn.hidden = true;
      }
    });
  }
  function showResults() {
    const box = $("adm-link-results"), q = (($("adm-link-search") || {}).value || "").trim().toLowerCase();
    if (!box) return;
    if (!q) { box.innerHTML = ""; return; }
    loadList().then((l) => {
      if (!l) { box.innerHTML = '<div class="pl-none">تعذّر الاتصال بموقع الأسعار</div>'; return; }
      const toks = q.split(/\s+/);
      const hits = l.filter((e) => { const t = (e.name + " " + (e.alt || "")).toLowerCase(); return toks.every((w) => t.indexOf(w) >= 0); }).slice(0, 12);
      box.innerHTML = hits.length ? hits.map((e) => '<button type="button" class="pl-hit" data-id="' + esc(e.id) + '"><b dir="ltr">' + esc(e.name) + "</b>" + (e.alt ? '<small dir="ltr">' + esc(e.alt) + "</small>" : "") + "<span>" + esc(fmt(e.price)) + "</span></button>").join("") : '<div class="pl-none">لا يوجد دواء بهذا الاسم</div>';
    });
  }

  // ---- «ربط تلقائي»: links the not-yet-linked drugs the same way the discharge form finds a price ----
  async function autoLinkAll() {
    const A = App(), PF = global.PharmacyPrivateForm;
    if (!A || !PF || !PF.pickEntry) return;
    const l = await loadList(true);
    if (!l) { A.flashHint("تعذّر الاتصال بموقع الأسعار"); return; }
    const todo = (A.state.medications || []).filter((m) => m && !m.priceRef && String(m.nameChart || "").trim());
    const found = [];
    todo.forEach((m) => { const e = PF.pickEntry(String(m.nameChart).trim(), [l]); if (e) found.push([m, e]); });
    if (!found.length) { A.flashHint("لا توجد أدوية جديدة للربط"); return; }
    if (!confirm("سيُربط " + found.length + " دواء بما يطابقها في موقع الأسعار (من أصل " + todo.length + " غير مربوط). تراجعها بعد ذلك من القائمة. المتابعة؟")) return;
    found.forEach(([m, e]) => { m.priceRef = e.id; m.priceSeen = e.price; });
    await A.catalogChanged();
    A.redrawAdminMeds();
    A.flashHint("✓ رُبط " + found.length + " دواء بموقع الأسعار");
  }

  function init() {
    const s = $("adm-link-search"); if (s) s.addEventListener("input", showResults);
    const box = $("adm-link-results");
    if (box) box.addEventListener("click", (e) => {
      const b = e.target.closest(".pl-hit"); if (!b) return;
      const hit = (list || []).find((x) => x.id === b.dataset.id); if (!hit) return;
      D = { ref: hit.id, seen: hit.price };
      if (s) s.value = ""; box.innerHTML = "";
      renderCurrent();
    });
    const f = $("adm-link-field");
    if (f) f.addEventListener("click", (e) => {
      if (e.target.closest("#adm-link-clear")) { D = { ref: "", seen: 0 }; renderCurrent(); return; }
      if (e.target.closest("#adm-link-accept")) { const e2 = (list || []).find((x) => x.id === D.ref); if (e2) { D.seen = e2.price; renderCurrent(); } }
    });
    const auto = $("admin-autolink-btn"); if (auto) auto.addEventListener("click", autoLinkAll);
  }

  global.PharmacyPriceLink = { loadList, statusOf, decorate, bindEditor, draft, autoLinkAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
