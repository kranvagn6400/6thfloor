/* ============================================================
   ward-plus.js  —  أدوات العمل اليومي داخل الردهة
   ============================================================
   1) السابق / التالي بين المرضى داخل بطاقة المريض.
   2) السحب على السرير: يسارًا = إضافة علاج، يمينًا = Bird Vision.
   3) رسوم التحاليل المصغّرة (spark) تستدعيها ui.js.
   4) حاسبات سريعة (تسريب مل/س، وظائف الكلى).
   5) تلاشٍ خفيف عند تبديل الصفحات (CSS فقط).
   المكتبة (GSAP) من CDN وهي اختيارية: إن لم
   تتوفر يعمل كل شيء بدونها. كل الحركة تتوقف مع prefers-reduced-motion.
   دعم قرار فقط — الحاسبات لا تحل محل بروتوكول المستشفى.
   ============================================================ */

(function (global) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const App = () => global.PharmacyApp;
  const UI = global.PharmacyUI;
  const Ward = global.PharmacyWard;
  const reduce = () => !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const G = () => (global.gsap && !reduce() ? global.gsap : null);
  const today = () => new Date().toLocaleDateString("en-CA");
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const haptic = (p) => { try { if (global.navigator.vibrate) global.navigator.vibrate(p); } catch (e) { /* ignore */ } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------- المرضى بترتيب الردهة ----------
  function occupied() {
    const app = App();
    const st = (app && app.state && app.state.patients) || {};
    const out = [];
    Ward.ROOMS.forEach(r => r.beds.forEach(b => {
      const key = Ward.bedKey(r.id, b.number);
      const p = st[key];
      if (p && p.name && p.name.trim()) out.push({ key, roomId: r.id, bed: b.number, p, label: Ward.bedLabel(r.id, b.number) });
    }));
    out.sort((a, b) => a.roomId - b.roomId || a.label - b.label);
    return out;
  }

  // ---------- السابق / التالي ----------
  let nav = null;
  function buildNav() {
    const back = $("back-btn");
    if (!back || nav) return;
    nav = el("div", "wp-nav");
    nav.hidden = true;
    nav.innerHTML = '<button type="button" class="wp-prev" aria-label="المريض السابق">› السابق</button><div class="wp-nav-mid"><b></b><span></span></div><button type="button" class="wp-next" aria-label="المريض التالي">التالي ‹</button>';
    back.insertAdjacentElement("afterend", nav);
    nav.querySelector(".wp-prev").addEventListener("click", () => go(-1));
    nav.querySelector(".wp-next").addEventListener("click", () => go(1));
  }
  function updateNav() {
    buildNav();
    const app = App(), cb = app && app.state.currentBed;
    const list = occupied();
    const i = cb ? list.findIndex(o => o.key === cb.key) : -1;
    if (!nav) return;
    nav.hidden = i < 0 || list.length < 2;
    if (nav.hidden) return;
    nav.querySelector(".wp-nav-mid b").textContent = (i + 1) + " من " + list.length;
    const nxt = list[(i + 1) % list.length];
    nav.querySelector(".wp-nav-mid span").textContent = "التالي: " + nxt.p.name.trim();
  }
  function go(dir) {
    const app = App(), cb = app && app.state.currentBed;
    if (!cb) return;
    const list = occupied();
    const i = list.findIndex(o => o.key === cb.key);
    if (i < 0 || list.length < 2) return;
    for (let step = 1; step < list.length; step++) {
      const t = list[(i + dir * step + list.length * step) % list.length];
      app.openPatient({ key: t.key, roomId: t.roomId, bed: t.bed });
      if (app.state.currentBed && app.state.currentBed.key === t.key) {      // قد يمنعه قفل السرير
        haptic(12);
        if (UI.setScrollY) UI.setScrollY(0);
        const g = G();
        if (g) g.fromTo("#view-patient", { x: dir > 0 ? -34 : 34, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "power2.out", clearProps: "transform,opacity" });
        return;
      }
    }
  }
  function onCard() { updateNav(); }

  // ---------- السحب على السرير ----------
  function initSwipe() {
    const grid = $("rooms-grid");
    if (!grid) return;
    let s = null, block = false;
    const reset = (b, animate) => {
      if (!b) return;
      if (animate) { b.classList.add("wp-back"); setTimeout(() => b.classList.remove("wp-back"), 260); }
      b.classList.remove("wp-swiping", "is-left", "is-right");
      b.style.transform = ""; b.style.removeProperty("--wp-p"); delete b.dataset.wpAct;
    };
    grid.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { s = null; return; }
      const b = e.target.closest(".bed-btn");
      if (!b || b.classList.contains("state-empty")) { s = null; return; }
      const t = e.touches[0];
      s = { b, x: t.clientX, y: t.clientY, on: false, dx: 0 };
    }, { passive: true });
    grid.addEventListener("touchmove", (e) => {
      if (!s) return;
      if (document.body.classList.contains("bed-dragging")) { reset(s.b); s = null; return; }
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (!s.on) {
        if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.6) { s.on = true; s.b.classList.add("wp-swiping"); }
        else { if (Math.abs(dy) > 14) s = null; return; }
      }
      s.dx = dx;
      const c = Math.max(-100, Math.min(100, dx));
      s.b.style.transform = "translateX(" + (c * 0.6) + "px)";
      s.b.classList.toggle("is-left", dx < 0);
      s.b.classList.toggle("is-right", dx > 0);
      s.b.dataset.wpAct = dx < 0 ? "＋ إضافة علاج" : "👁 Bird Vision";
      s.b.style.setProperty("--wp-p", Math.min(1, Math.abs(dx) / 80).toFixed(2));
    }, { passive: true });
    const finish = (cancel) => {
      if (!s) return;
      const { b, dx, on } = s;
      s = null;
      if (!on) return;
      reset(b, true);
      block = true; setTimeout(() => { block = false; }, 450);
      if (cancel || Math.abs(dx) < 80) return;
      const ref = { key: b.dataset.key, roomId: parseInt(b.dataset.roomId, 10), bed: parseInt(b.dataset.bed, 10) };
      haptic(20);
      if (dx < 0) App().addMedFor(ref);
      else {
        App().openPatient(ref);
        setTimeout(() => {
          const cb = App().state.currentBed, btn = $("print-patient-sheet-btn");
          if (cb && cb.key === ref.key && btn) btn.click();
        }, 220);
      }
    };
    grid.addEventListener("touchend", () => finish(false));
    grid.addEventListener("touchcancel", () => finish(true));
    grid.addEventListener("click", (e) => { if (block) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // ---------- رسوم التحاليل المصغّرة ----------
  function labNum(key, v) {
    let n = parseFloat(String(v == null ? "" : v).replace(/,/g, ""));
    if (!isFinite(n)) return null;
    if ((key === "wbc" || key === "plt") && n >= 1000) n /= 1000;
    return n;
  }
  function spark(labs, hist, key, status) {
    const pts = [];
    (hist || []).forEach(h => {
      if (!h || h.key !== key) return;
      const n = labNum(key, h.value);
      if (n != null) pts.push({ d: String(h.date || ""), n });
    });
    pts.sort((a, b) => a.d.localeCompare(b.d));
    const cur = labNum(key, labs && labs[key]);
    if (cur != null) pts.push({ d: "9999", n: cur });
    const s = pts.slice(-6);
    if (s.length < 2) return null;
    const W = 56, H = 18, P = 3;
    const lo = Math.min.apply(null, s.map(p => p.n)), hi = Math.max.apply(null, s.map(p => p.n));
    const X = (i) => P + (W - 2 * P) * (i / (s.length - 1));
    const Y = (n) => hi === lo ? H / 2 : H - P - (H - 2 * P) * ((n - lo) / (hi - lo));
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("aria-hidden", "true");
    const pl = document.createElementNS(NS, "polyline");
    pl.setAttribute("points", s.map((p, i) => X(i).toFixed(1) + "," + Y(p.n).toFixed(1)).join(" "));
    svg.appendChild(pl);
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", X(s.length - 1).toFixed(1)); c.setAttribute("cy", Y(s[s.length - 1].n).toFixed(1)); c.setAttribute("r", "2.4");
    svg.appendChild(c);
    const w = el("div", "lab-spark" + (status === "high" ? " is-high" : status === "low" ? " is-low" : ""));
    w.title = s.map(p => p.n).join(" ← ");
    w.appendChild(svg);
    return w;
  }

  // ---------- الحاسبات ----------
  const f1 = (n, d) => (isFinite(n) ? String(Math.round(n * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)) : "—");
  const TABS = [
    { id: "inf", title: "تسريب (مل/س)",
      fields: [{ k: "vol", l: "الحجم (مل)", v: "500" }, { k: "hrs", l: "المدة (ساعة)", v: "8" }, { k: "df", l: "عيار القطرة (قطرة/مل)", sel: ["20", "15", "60"] }],
      calc: (v) => {
        if (!(v.vol > 0 && v.hrs > 0)) return null;
        const rate = v.vol / v.hrs;
        return { big: f1(rate) + " مل/ساعة", rows: [["قطرة/دقيقة", f1(v.vol * v.df / (v.hrs * 60), 0)], ["مل/دقيقة", f1(rate / 60, 2)]] };
      } },
    { id: "renal", title: "وظائف الكلى",
      fields: [{ k: "age", l: "العمر (سنة)", p: "age" }, { k: "sex", l: "الجنس", sel: ["male", "female"], selText: ["ذكر", "أنثى"], p: "sex" }, { k: "wt", l: "الوزن (كغ)", p: "wt" }, { k: "ht", l: "الطول (سم) اختياري", p: "ht" }, { k: "scr", l: "كرياتنين المصل (ملغ/دل)", p: "scr" }],
      calc: (v, sel) => {
        const C = global.PharmacyClinical;
        if (!C || !(v.age > 0 && v.wt > 0 && v.scr > 0)) return null;
        const pt = { age: String(v.age), gender: sel.sex, labs: { creatinine: String(v.scr), weight: String(v.wt), height: v.ht > 0 ? String(v.ht) : "" } };
        const c = C.calculateCrCl(pt), g = C.calculateGFR ? C.calculateGFR(pt) : null;
        if (!c) return null;
        const rows = [["الوزن المستخدم", f1(c.weightUsed) + " كغ (" + c.basisLabel + ")"]];
        if (g && g.gfr != null) rows.push(["eGFR (CKD-EPI)", f1(g.gfr, 0) + " مل/د"]);
        return { big: "CrCl " + f1(c.crcl, 0) + " مل/دقيقة", rows };
      } }
  ];
  let calcEl = null, calcBack = null, calcTab = "inf";
  function patientPrefill() {
    const app = App(), cb = app && app.state.currentBed, p = cb && app.state.patients[cb.key];
    const L = (p && p.labs) || {};
    const num = (x) => { const n = parseFloat(String(x == null ? "" : x)); return isFinite(n) ? String(n) : ""; };
    return { wt: num(L.weight), ht: num(L.height), age: num(p && p.age), scr: num(L.creatinine), sex: p && p.gender === "female" ? "female" : "male" };
  }
  function renderCalc() {
    const tab = TABS.find(t => t.id === calcTab) || TABS[0];
    const pre = patientPrefill();
    calcEl.querySelector(".wp-tabs").innerHTML = TABS.map(t => '<button type="button" data-t="' + t.id + '" class="' + (t.id === tab.id ? "on" : "") + '">' + t.title + "</button>").join("");
    calcEl.querySelector(".wp-body").innerHTML = '<div class="wp-grid">' + tab.fields.map(f => {
      if (f.sel) return '<label>' + f.l + '<select data-k="' + f.k + '">' + f.sel.map((o, i) => '<option value="' + o + '"' + ((f.p && pre[f.p] === o) ? " selected" : "") + ">" + (f.selText ? f.selText[i] : o) + "</option>").join("") + "</select></label>";
      const val = f.p ? pre[f.p] : (f.v || "");
      return '<label>' + f.l + '<input data-k="' + f.k + '" inputmode="decimal" value="' + val + '"></label>';
    }).join("") + '</div><div class="wp-result" hidden></div><div class="wp-note">للمراجعة مع بروتوكول المستشفى — دعم قرار فقط.</div>';
    calcEl.querySelectorAll(".wp-tabs button").forEach(b => b.addEventListener("click", () => { calcTab = b.dataset.t; renderCalc(); }));
    calcEl.querySelectorAll(".wp-body input, .wp-body select").forEach(i => i.addEventListener("input", runCalc));
    runCalc();
  }
  function runCalc() {
    const tab = TABS.find(t => t.id === calcTab) || TABS[0];
    const v = {}, sel = {};
    calcEl.querySelectorAll(".wp-body [data-k]").forEach(i => {
      if (i.tagName === "SELECT") { sel[i.dataset.k] = i.value; v[i.dataset.k] = parseFloat(i.value); }
      else v[i.dataset.k] = parseFloat(String(i.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    });
    const out = tab.calc(v, sel);
    const box = calcEl.querySelector(".wp-result");
    if (!out) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="big"></div>' + out.rows.map(r => '<div class="row"><span></span><b></b></div>').join("");
    box.querySelector(".big").textContent = out.big;
    box.querySelectorAll(".row").forEach((row, i) => { row.children[0].textContent = out.rows[i][0]; row.children[1].textContent = out.rows[i][1]; });
  }
  function openCalc() {
    if (!calcEl) {
      calcBack = el("div", "wp-sheet-back");
      calcEl = el("div", "wp-sheet");
      calcEl.innerHTML = '<div class="wp-sheet-grip"></div><h3><span>Drops Calculator</span><button type="button" aria-label="إغلاق">✕</button></h3><div class="wp-tabs"></div><div class="wp-body"></div>';
      document.body.appendChild(calcBack); document.body.appendChild(calcEl);
      calcBack.addEventListener("click", closeCalc);
      calcEl.querySelector("h3 button").addEventListener("click", closeCalc);
    }
    renderCalc();
    requestAnimationFrame(() => { calcBack.classList.add("open"); calcEl.classList.add("open"); });
  }
  function closeCalc() { if (calcEl) { calcBack.classList.remove("open"); calcEl.classList.remove("open"); } }
  function buildCalcButton() {
    const bar = document.querySelector(".meds-head-actions");
    if (!bar || $("wp-calc-btn")) return;
    const b = el("button", "add-med-fab patient-print-btn wp-calc-btn");
    b.id = "wp-calc-btn"; b.type = "button"; b.title = "Drops Calculator";
    b.innerHTML = '<span aria-hidden="true">🧮</span> حاسبات';
    b.addEventListener("click", openCalc);
    bar.insertBefore(b, $("open-med-sheet"));
  }

  // ---------- تلاشٍ خفيف عند تبديل الصفحات + ربط الواجهة ----------
  // (بلا لقطات للصفحة ولا تمدّد — CSS فقط، حتى يبقى الفتح سلسًا على الجوالات المتوسطة)
  function afterShow(name) {
    if (name !== "patient") closeCalc();
    if (reduce()) return;
    const v = document.querySelector(".view[data-view=\"" + name + "\"]");
    if (!v) return;
    v.classList.remove("wp-fade");
    void v.offsetWidth;
    v.classList.add("wp-fade");
    setTimeout(() => v.classList.remove("wp-fade"), 220);
  }
  function wrapUI() {
    const origShow = UI.showView, origRender = UI.renderPatientView;
    UI.showView = function (name) {
      const from = origShow._lastView;
      const r = origShow.apply(UI, arguments);
      if (from !== name) afterShow(name);
      return r;
    };
    Object.defineProperty(UI.showView, "_lastView", { get: () => origShow._lastView, set: (v) => { origShow._lastView = v; } });   // handover.js / duty-roster.js read it
    UI.renderPatientView = function () {
      const r = origRender.apply(UI, arguments);
      try { buildCalcButton(); onCard(); } catch (e) { /* never break the card */ }
      return r;
    };
  }

  function init() {
    if (!UI || !Ward) return;
    wrapUI();
    buildNav();
    initSwipe();
  }

  global.PharmacyWardPlus = { spark, openCalc, occupied, go };
  init();
})(window);
