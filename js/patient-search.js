/* ============================================================
   patient-search.js  —  Patient search on the patients page («المرضى»)
   ============================================================
   Matches name, plate number (رقم الطبلة), attending doctor and
   diagnosis. Arabic letter variants are folded (أ/إ/آ→ا, ة→ه, ى→ي)
   so "احمد" finds "أحمد". Tapping a result opens the patient.
   ============================================================ */

(function (global) {
  "use strict";

  function fold(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[ً-ْ]/g, "")      // tashkeel
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/\s+/g, " ")
      .trim();
  }

  function search(query) {
    const App = global.PharmacyApp;
    const Ward = global.PharmacyWard;
    const q = fold(query);
    if (!q || !App || !Ward) return [];
    const results = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(b => {
        const key = Ward.bedKey(room.id, b.number);
        const p = App.state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;
        const nameHit = fold(p.name).indexOf(q) >= 0;
        // Pharmacist + 7th-floor patient: only name + doctor are visible
        const restricted = global.PharmacyBoarders && global.PharmacyBoarders.hidesDetails(p);
        const other = (restricted ? [p.doctor] : [p.plateNumber, p.doctor, p.diagnosis]).map(fold).join(" | ");
        if (nameHit || other.indexOf(q) >= 0) {
          results.push({ key, roomId: room.id, bed: b.number, patient: p, nameHit });
        }
      });
    });
    // Name matches first, then by room / bed
    results.sort((a, b) => (b.nameHit - a.nameHit) || (a.roomId - b.roomId) || (a.bed - b.bed));
    return results.slice(0, 20);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(results, query) {
    const box = document.getElementById("ward-search-results");
    if (!box) return;
    box.innerHTML = "";
    if (!fold(query)) { box.hidden = true; return; }
    box.hidden = false;
    if (results.length === 0) {
      box.appendChild(el("div", "ward-search-empty", "لا يوجد مريض مطابق"));
      return;
    }
    results.forEach(r => {
      const btn = el("button", "ward-search-item");
      btn.type = "button";
      btn.dataset.key = r.key;
      btn.dataset.roomId = r.roomId;
      btn.dataset.bed = r.bed;
      const main = el("span", "ward-search-main");
      main.appendChild(el("span", "ward-search-name", r.patient.name.trim()));
      const restricted = global.PharmacyBoarders && global.PharmacyBoarders.hidesDetails(r.patient);
      const meta = (restricted
        ? [r.patient.doctor || ""]
        : [r.patient.plateNumber ? "طبلة " + r.patient.plateNumber : "", r.patient.doctor || "", r.patient.diagnosis || ""])
        .filter(Boolean).join(" · ");
      if (meta) main.appendChild(el("span", "ward-search-meta", meta));
      btn.appendChild(main);
      btn.appendChild(el("span", "ward-search-loc", global.PharmacyWard.roomTitle(r.roomId) + " · س " + global.PharmacyWard.bedLabel(r.roomId, r.bed)));
      box.appendChild(btn);
    });
  }

  function clear() {
    const input = document.getElementById("ward-search-input");
    if (input) input.value = "";
    render([], "");
  }

  function init() {
    const input = document.getElementById("ward-search-input");
    const box = document.getElementById("ward-search-results");
    if (!input || !box) return;
    input.addEventListener("input", () => render(search(input.value), input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { clear(); input.blur(); }
      if (e.key === "Enter") {
        const first = box.querySelector(".ward-search-item");
        if (first) first.click();
      }
    });
    box.addEventListener("click", (e) => {
      const item = e.target.closest(".ward-search-item");
      if (!item) return;
      clear();
      global.PharmacyApp.openPatient({
        key: item.dataset.key,
        roomId: parseInt(item.dataset.roomId, 10),
        bed: parseInt(item.dataset.bed, 10)
      });
    });
  }

  global.PharmacyPatientSearch = { init, search, clear };
})(window);
