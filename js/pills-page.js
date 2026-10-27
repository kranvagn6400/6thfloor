/* ============================================================
   pills-page.js — «الحبوب» (bottom-nav tab, pharmacists + admin)
   ------------------------------------------------------------
   The patients who have tablets, split into الرجال (rooms 1-4) and
   النساء (rooms 5, 7-10); room 6 (ICU) goes by the patient's gender
   (PharmacyWard.roomGender), unknown → its own group. Each tablet can
   be edited here: dose, frequency (½ tablets too), the time written on
   the pills form (med.time — empty = from the frequency) and how to
   take it (med.usage — empty = the catalogue's / "مع أو بدون طعام").
   The pills form (pills-form.js) prints med.time / med.usage when set.
   Like the pills forms: 7th-floor hematology patients are left out
   (orderedPatients). Doctors see nothing.
   ============================================================ */
(function (global) {
  "use strict";

  const App = () => global.PharmacyApp;
  const Auth = () => global.PharmacyAuth;

  const TIME_OPTIONS = ["صباحاً", "مساءً", "صباحاً ومساءً", "قبل النوم", "كل 24 ساعة", "كل 12 ساعة", "كل 8 ساعات", "كل 6 ساعات", "عند الحاجة"];
  const USAGE_OPTIONS = ["مع أو بدون طعام", "مع الطعام", "بعد الأكل", "قبل الطعام بساعة أو بعده بساعتين", "قبل الطعام بـ 30 دقيقة", "قبل الطعام بـ 60 دقيقة", "على معدة فارغة", "قبل النوم", "تُمضغ", "تحت اللسان"];

  function roleOk() {
    const A = Auth();
    return !!(A && (A.isAdmin() || (A.isPharmacist && A.isPharmacist())));
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- pure: who has tablets, in which section (tested) ----
  // patients: bed_key → patient; medications: the catalogue.
  // → { men: [...], women: [...], icu: [...] }, each item
  //   { key, roomId, bed, patient, meds: [{ index, pm, catalog }] }
  function groups(patients, medications) {
    const Ward = global.PharmacyWard;
    const byId = new Map((medications || []).filter(m => m && m.id).map(m => [m.id, m]));
    const out = { men: [], women: [], icu: [] };
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(b => {
        const key = Ward.bedKey(room.id, b.number);
        const p = patients && patients[key];
        if (!p || !p.name || !p.name.trim()) return;
        const meds = (Array.isArray(p.medications) ? p.medications : [])
          .map((pm, index) => ({ index, pm, catalog: pm && byId.get(pm.id) }))
          .filter(x => x.pm && x.catalog && x.catalog.form === "tablet");
        if (!meds.length) return;
        const g = Ward.roomGender(room.id) || p.gender || "";
        const item = { key, roomId: room.id, bed: b.number, patient: p, meds };
        (g === "male" ? out.men : g === "female" ? out.women : out.icu).push(item);
      });
    });
    return out;
  }

  // ---- which forms to print ----
  // Each patient card has a tick: «طباعة». The section button prints the TICKED ones only. What is NOT
  // ticked is remembered on this device (so a new patient is ticked by default).
  const SKIP_KEY = "pharma.pills.skip.v1";
  function loadSkip() {
    try { const a = JSON.parse(localStorage.getItem(SKIP_KEY) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
  }
  function saveSkip(set) { try { localStorage.setItem(SKIP_KEY, JSON.stringify(Array.from(set))); } catch (e) { /* blocked */ } }
  // → the items of a section that are ticked
  function selected(items, skip) { return items.filter(x => !skip.has(x.key)); }

  // ---- rendering ----
  function datalist(id, options) {
    if (document.getElementById(id)) return;
    const dl = el("datalist");
    dl.id = id;
    options.forEach(o => { const op = document.createElement("option"); op.value = o; dl.appendChild(op); });
    document.body.appendChild(dl);
  }

  function field(label, control) {
    const w = el("label", "pills-field");
    w.appendChild(el("span", "pills-field-label", label));
    w.appendChild(control);
    return w;
  }

  function save(key, index, apply) {
    const app = App();
    const p = app.state.patients[key];
    const pm = p && p.medications && p.medications[index];
    if (!pm) return;
    apply(pm);
    app.savePatient(key);
  }

  function medRow(item, m) {
    const Meds = global.PharmacyMedications;
    const PF = global.PharmacyPillsForm;
    const pm = m.pm, cat = m.catalog;
    const row = el("div", "pills-med");
    const head = el("div", "pills-med-name");
    head.appendChild(el("strong", null, cat.nameTrade || cat.nameEn || pm.id));
    row.appendChild(head);
    const grid = el("div", "pills-med-fields");

    const dose = el("input", "pills-input");
    dose.type = "text";
    dose.dir = "ltr";
    dose.value = pm.dose || "";
    dose.placeholder = cat.defaultDose || "الجرعة";
    dose.addEventListener("change", () => save(item.key, m.index, x => { x.dose = dose.value.trim(); }));
    grid.appendChild(field("الجرعة", dose));

    const freq = el("select", "pills-input");
    freq.dir = "ltr";
    const cur = (Meds.medFrequency ? Meds.medFrequency(pm) : pm.frequency) || cat.defaultFrequency || "";
    const opts = Meds.FREQUENCIES.slice();
    if (cur && opts.indexOf(cur) === -1) opts.unshift(cur);
    opts.forEach(f => { const o = new Option("‎" + f + "‎", f); if (f === cur) o.selected = true; freq.appendChild(o); });
    grid.appendChild(field("التكرار", freq));

    const time = el("input", "pills-input");
    time.type = "text";
    time.setAttribute("list", "pills-time-options");
    time.value = pm.time || "";
    const autoTime = () => (PF && PF.freqToTimeInterval ? PF.freqToTimeInterval(freq.value) : "");
    time.placeholder = autoTime();
    time.addEventListener("change", () => save(item.key, m.index, x => { x.time = time.value.trim(); }));
    grid.appendChild(field("الوقت", time));

    const usage = el("input", "pills-input");
    usage.type = "text";
    usage.setAttribute("list", "pills-usage-options");
    usage.value = pm.usage || "";
    usage.placeholder = PF && PF.getMedUsage ? PF.getMedUsage(cat) : "مع أو بدون طعام";
    usage.addEventListener("change", () => save(item.key, m.index, x => { x.usage = usage.value.trim(); }));
    grid.appendChild(field("طريقة الاستخدام", usage));

    freq.addEventListener("change", () => {
      save(item.key, m.index, x => { x.frequency = freq.value; });
      time.placeholder = autoTime();
      preview.textContent = previewText();
    });
    row.appendChild(grid);

    // what the pills form will write in the usage column
    const previewText = () => {
      const pf = Meds.parseFreq ? Meds.parseFreq(freq.value) : null;
      const n = pf && PF && PF.tabletsText ? PF.tabletsText(pf.n) : "";
      return "في الاستمارة: " + [time.value.trim() || time.placeholder, [n, usage.value.trim() || usage.placeholder].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    };
    const preview = el("div", "pills-med-preview", "");
    preview.textContent = previewText();
    [time, usage, dose].forEach(c => c.addEventListener("input", () => { preview.textContent = previewText(); }));
    row.appendChild(preview);
    return row;
  }

  function patientCard(item) {
    const card = el("div", "pills-patient");
    const head = el("div", "pills-patient-head");
    const pick = el("input", "pills-pick");
    pick.type = "checkbox";
    pick.title = "طباعة استمارة هذا المريض ضمن «استمارات …»";
    pick.setAttribute("aria-label", "طباعة استمارة " + item.patient.name.trim());
    pick.checked = !loadSkip().has(item.key);
    pick.addEventListener("change", () => {
      const s = loadSkip();
      if (pick.checked) s.delete(item.key); else s.add(item.key);
      saveSkip(s);
      updatePickCount();
    });
    head.appendChild(pick);
    const who = el("button", "pills-patient-who");
    who.type = "button";
    who.appendChild(el("strong", null, item.patient.name.trim()));
    who.appendChild(el("span", "pills-patient-bed",
      global.PharmacyWard.roomTitle(item.roomId) + " · سرير " + global.PharmacyWard.bedLabel(item.roomId, item.bed) +
      (item.patient.plateNumber ? " · " + item.patient.plateNumber : "")));
    who.addEventListener("click", () => App().openPatient({ key: item.key, roomId: item.roomId, bed: item.bed }));
    head.appendChild(who);
    const form = el("button", "pills-form-btn", "الاستمارة");
    form.type = "button";
    form.title = "استمارة الحبوب لهذا المريض";
    form.addEventListener("click", () => openForms({ bedKey: item.key }));
    head.appendChild(form);
    card.appendChild(head);
    item.meds.forEach(m => card.appendChild(medRow(item, m)));
    return card;
  }

  async function openForms(options, patientsMap) {
    const PF = global.PharmacyPillsForm;
    const app = App();
    const st = Object.assign({}, app.orderingState(), patientsMap ? { patients: patientsMap } : {});
    const r = await PF.previewPillsForms(st, options || {});
    if (r && r.error) app.flashHint(r.error);
  }

  // «المحدد: n من m» beside the buttons
  function updatePickCount() {
    const c = document.getElementById("pills-pick-count");
    const box = c && c.closest(".pills-section");
    if (!c || !box || !box._items) return;
    c.textContent = "المحدد: " + selected(box._items, loadSkip()).length + " من " + box._items.length;
  }

  function section(title, cls, items) {
    const box = el("section", "pills-section " + cls);
    const head = el("div", "pills-section-head");
    head.appendChild(el("h3", null, title + " (" + items.length + ")"));
    if (items.length) {
      const count = el("span", "pills-pick-count", "");
      count.id = "pills-pick-count";
      head.appendChild(count);
      const setAll = (on) => {
        const s = loadSkip();
        items.forEach(x => { if (on) s.delete(x.key); else s.add(x.key); });
        saveSkip(s);
        box.querySelectorAll(".pills-pick").forEach(c => { c.checked = on; });
        updatePickCount();
      };
      const allOn = el("button", "pills-form-btn", "تحديد الكل"); allOn.type = "button"; allOn.addEventListener("click", () => setAll(true));
      const allOff = el("button", "pills-form-btn", "إلغاء التحديد"); allOff.type = "button"; allOff.addEventListener("click", () => setAll(false));
      head.appendChild(allOn);
      head.appendChild(allOff);
      const all = el("button", "pills-form-btn pills-print-sel", "طباعة المحدد");
      all.type = "button";
      all.addEventListener("click", () => {
        const chosen = selected(items, loadSkip());
        if (!chosen.length) { App().flashHint("حدّد استمارة واحدة على الأقل للطباعة"); return; }
        const map = {};
        chosen.forEach(x => { map[x.key] = x.patient; });
        openForms({}, map);
      });
      head.appendChild(all);
      box._items = items;
    }
    box.appendChild(head);
    if (!items.length) box.appendChild(el("div", "tasks-empty", "لا يوجد مرضى لديهم حبوب"));
    items.forEach(x => box.appendChild(patientCard(x)));
    return box;
  }

  function render() {
    const box = document.getElementById("pills-list");
    if (!box) return;
    datalist("pills-time-options", TIME_OPTIONS);
    datalist("pills-usage-options", USAGE_OPTIONS);
    const app = App();
    const g = groups(app.orderingState().patients, app.state.medications);
    box.innerHTML = "";
    // One unit at a time — الوحدة الأولى (women) or الوحدة الثالثة (men), chosen by the bottom tab
    const cur = shown === "men"
      ? { title: "حبوب الوحدة الثالثة", cls: "is-men", items: g.men }
      : { title: "حبوب الوحدة الأولى", cls: "is-women", items: g.women };
    box.appendChild(section(cur.title, cur.cls, cur.items));
    updatePickCount();
  }
  let shown = "women";   // the open unit: "women" = الوحدة الأولى, "men" = الوحدة الثالثة

  function isOpen() {
    const v = document.getElementById("view-pills");
    return !!(v && !v.hidden);
  }
  // Redraw after a sync — not while someone is typing on the page
  function refreshIfOpen() {
    if (!isOpen()) return;
    const a = document.activeElement;
    if (a && a.closest && a.closest("#view-pills") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    render();
  }

  function open(unit) {
    if (!roleOk()) return;
    shown = unit === "3" ? "men" : "women";
    global.PharmacyUI.setPillsUnit(unit === "3" ? "3" : "1");
    global.PharmacyUI.showView("pills");
    render();
  }

  global.PharmacyPillsPage = { open, render, refreshIfOpen, groups, selected, TIME_OPTIONS, USAGE_OPTIONS };
})(window);
