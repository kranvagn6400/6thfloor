/* ============================================================
   file-mark.js  —  «الطبلة غير موجودة — لم تتم المقارنة»
   ============================================================
   In the morning round the pharmacist compares the medicines in the doctor's
   paper file with the patient's card. When the file is not there (it may come
   back in an hour or two, or only tomorrow) the bed is marked here, so the
   patient is not forgotten: an orange file mark on the bed in the rooms view
   and a counter «لم تُقارَن: n» above the rooms with the list.
   «تمت المقارنة» clears it (who / when is kept). The mark does NOT reset at the
   end of the day — it stays until the comparison is done.
   Kept in patient.labs._cmp = { missing, at, by, doneAt, doneBy } (labs JSON —
   no new column; shared like the rest of the patient).
   For now: the supreme admin only (Auth.isSuperAdmin) — to test it first.
   ============================================================ */

(function (global) {
  "use strict";

  const Auth = () => global.PharmacyAuth;
  const App = () => global.PharmacyApp;
  const enabled = () => {
    const A = Auth();
    return !!(A && A.isLoggedIn && A.isLoggedIn() && A.isSuperAdmin && A.isSuperAdmin());
  };
  const FILE_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="4" y1="4" x2="20" y2="20"/></svg>';

  function who() {
    const A = Auth(), u = A && A.getCurrentUser ? A.getCurrentUser() : null;
    return String((u && (u.displayName || u.username)) || "").split("|")[0].trim();
  }
  const patients = () => (App() && App().state && App().state.patients) || {};
  const cmpOf = (p) => (p && p.labs && p.labs._cmp) || null;
  function isMissing(key) {
    const p = patients()[key];
    const c = cmpOf(p);
    return !!(c && c.missing && p && p.name && p.name.trim());
  }
  // every occupied bed whose file was not there and is not compared yet
  function missingList() {
    const P = patients();
    return Object.keys(P).filter(isMissing).map(k => ({ key: k, p: P[k], c: cmpOf(P[k]) }));
  }
  function timeOf(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const t = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const same = new Date().toDateString() === d.toDateString();
    return same ? t : (d.getDate() + "/" + (d.getMonth() + 1) + " " + t);
  }

  function setMissing(key, missing) {
    const app = App();
    if (!enabled() || !app || !app.editPatient) return;
    app.editPatient(key, (p) => {
      p.labs = p.labs || {};
      const now = new Date().toISOString();
      p.labs._cmp = missing
        ? { missing: true, at: now, by: who() }
        : { missing: false, at: (p.labs._cmp && p.labs._cmp.at) || "", by: (p.labs._cmp && p.labs._cmp.by) || "", doneAt: now, doneBy: who() };
    });
    app.redrawRooms && app.redrawRooms();
    updateCardButton();
  }

  // ---------- the button in the patient card ----------
  function updateCardButton() {
    const btn = document.getElementById("file-missing-btn");
    if (!btn) return;
    const app = App();
    const cur = app && app.state && app.state.currentBed;
    const p = cur && patients()[cur.key];
    btn.hidden = !(enabled() && p && p.name && p.name.trim());
    if (btn.hidden) return;
    const miss = isMissing(cur.key);
    btn.classList.toggle("is-on", miss);
    btn.innerHTML = miss ? "✓ تمت المقارنة" : '<span aria-hidden="true">' + FILE_OFF + "</span> الطبلة غير موجودة";
    btn.title = miss ? "الطبلة ظهرت وتمت مقارنة العلاج" : "الطبلة غير موجودة الآن — علّم المريض لتقارن علاجه لاحقًا";
  }

  // ---------- the list popup ----------
  function close() { const o = document.getElementById("fm-overlay"); if (o) o.remove(); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function openList() {
    close();
    const ov = el("div", "fm-overlay"); ov.id = "fm-overlay";
    const box = el("div", "fm-box"); ov.appendChild(box);
    const head = el("div", "fm-head");
    head.appendChild(el("strong", null, "لم تتم مقارنة علاجهم (الطبلة غير موجودة)"));
    const x = el("button", "fm-x", "✕"); x.type = "button"; x.addEventListener("click", close);
    head.appendChild(x); box.appendChild(head);
    const list = missingList();
    if (!list.length) box.appendChild(el("p", "fm-empty", "لا يوجد مرضى بانتظار المقارنة."));
    list.forEach(({ key, p, c }) => {
      const W = global.PharmacyWard, m = /room-(\d+)-bed-(\d+)/.exec(key) || [];
      const row = el("div", "fm-row");
      const info = el("div", "fm-info");
      info.appendChild(el("strong", null, p.name.trim()));
      info.appendChild(el("span", null, (W && m[1] ? "سرير " + W.bedLabel(parseInt(m[1], 10), parseInt(m[2], 10)) + " · " : "") + "منذ " + timeOf(c.at) + (c.by ? " · " + c.by : "")));
      row.appendChild(info);
      const open = el("button", "fm-btn", "فتح"); open.type = "button";
      open.addEventListener("click", () => { close(); App().openPatient({ key, roomId: parseInt(m[1], 10), bed: parseInt(m[2], 10) }); });
      const done = el("button", "fm-btn ok", "تمت المقارنة"); done.type = "button";
      done.addEventListener("click", () => { setMissing(key, false); openList(); });
      row.appendChild(open); row.appendChild(done);
      box.appendChild(row);
    });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  function init() {
    // the bed mark / the counter in the rooms view (capture: the bed underneath must not open)
    const grid = document.getElementById("rooms-grid");
    if (grid) grid.addEventListener("click", (e) => {
      const t = e.target.closest("[data-fm-key], [data-fm-all]");
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      openList();
    }, true);
    const btn = document.getElementById("file-missing-btn");
    if (btn) btn.addEventListener("click", () => {
      const cur = App().state.currentBed;
      if (cur) setMissing(cur.key, !isMissing(cur.key));
    });
  }

  global.PharmacyFileMark = { enabled, isMissing, count: () => missingList().length, openList, updateCardButton, init, ICON: FILE_OFF };
})(window);
