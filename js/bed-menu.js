/* ============================================================
   bed-menu.js  —  the quick menu of an occupied bed (long-press)
   ============================================================
   Opened by bed-drag.js: a long-press on a bed that is released WITHOUT moving
   (touch), or a right-click (mouse). A long-press that moves is still the drag
   that moves / swaps the patient.
   Actions: open the card · add a medicine · Bird Vision (view only) ·
   «الطبلة غير موجودة» / «رجعت الطبلة» (admin + pharmacists, js/file-mark.js).
   ============================================================ */

(function (global) {
  "use strict";

  const App = () => global.PharmacyApp;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function parse(key) {
    const m = /room-(\d+)-bed-(\d+)/.exec(String(key || ""));
    return m ? { key, roomId: parseInt(m[1], 10), bed: parseInt(m[2], 10) } : null;
  }
  function close() { const o = document.getElementById("bm-overlay"); if (o) o.remove(); }

  function open(key) {
    const app = App(), ref = parse(key);
    const p = app && app.state && app.state.patients[key];
    if (!app || !ref || !p || !String(p.name || "").trim()) return;
    close();
    const ov = el("div", "bm-overlay"); ov.id = "bm-overlay";
    const sheet = el("div", "bm-sheet"); ov.appendChild(sheet);
    sheet.setAttribute("role", "dialog");
    const W = global.PharmacyWard;
    sheet.appendChild(el("div", "bm-title", String(p.name).trim()));
    sheet.appendChild(el("div", "bm-sub", W && W.bedText ? W.bedText(key) : ""));

    const add = (label, fn, cls) => {
      const b = el("button", "bm-btn" + (cls ? " " + cls : ""), label);
      b.type = "button";
      b.addEventListener("click", () => { close(); fn(); });
      sheet.appendChild(b);
    };
    add("فتح بطاقة المريض", () => app.openPatient(ref));
    add("＋ إضافة علاج", () => app.addMedFor(ref));
    add("Bird Vision", () => {
      if (global.PharmacyPrintSheets) global.PharmacyPrintSheets.preview([{ patient: p, currentBed: ref }], { viewOnly: true, title: "Bird Vision" });
    });
    const FM = global.PharmacyFileMark;
    if (FM && FM.enabled && FM.enabled()) {
      add(FM.isMissing(key) ? "✓ رجعت الطبلة" : "الطبلة غير موجودة", () => FM.toggle(key), "bm-file");
    }
    const cancel = el("button", "bm-btn bm-cancel", "إغلاق");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    sheet.appendChild(cancel);

    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.addEventListener("keydown", function onKey(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } });
    document.body.appendChild(ov);
  }

  global.PharmacyBedMenu = { open, close };
})(window);
