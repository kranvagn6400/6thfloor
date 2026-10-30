/* ministry.js — «مواقف وزارة الصحة» (settings page; admin + the pharmacists the admin allowed: profiles.can_ministry)
   ------------------------------------------------------------------------------------------------
   The forms the Ministry asks for (js/ministry-forms.js): IVIG, albumin, tigecycline, colistin, and the antibiotics status.
   For each: the patients on the drug, a form filled from the patient's data (name, specialist, plate, sex, age, quantity, quarter + month…)
   where the rest is chosen / typed, a review, then «إرسال» — the server function api/ministry-send.js posts it to the Ministry's form.
   A sent form is remembered on the patient (labs._ministry[form]). */
(function (global) {
  "use strict";

  const MF = global.MinistryForms;
  const PROD = "https://6thfloor.vercel.app";
  const $ = (id) => document.getElementById(id);
  const App = () => global.PharmacyApp;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const digits = (s) => String(s == null ? "" : s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  let S = { screen: "list", form: "", key: "", v: null, busy: false };
  // forms with NO editor: everything comes from the patient's card (the pharmacist enters it there); a press sends it, and a
  // missing piece of data stops it with the list of what the card lacks
  const AUTO = { albumin: true };
  const NEEDS = { name: "اسم المريض", doctor: "اسم الطبيب (الأخصائي)", plate: "رقم الطبلة", gender: "الجنس", age: "العمر", dx: "الحالة المطابقة في استمارة الألبومين (أو التشخيص)" };

  // The albumin condition the pharmacist ticks when he prints the albumin form (patient-forms.js, item n) → the Ministry's own
  // group + choice (index in that group's list, js/ministry-forms.js). A condition with no counterpart is sent under «Others» with its own text.
  const ALB_MAP = {
    1: ["part1", 0],      // cirrhosis + paracentesis > 4 L
    3: ["part1", 2],      // ascites not responsive to diuretics
    4: ["part2", 1],      // hepatorenal syndrome (cirrhosis)
    5: ["part2", 7],      // high-risk spontaneous bacterial peritonitis
    6: ["part1", 6],      // severe oedema with serum albumin < 2
    7: ["part3", 0],      // acute nephrotic syndrome
    8: ["part2", 0],      // therapeutic plasmapheresis
    9: ["part4", 1],      // ARDS
    10: ["part2", 6],     // post cardio-pulmonary bypass
    11: ["part2", 6],     // extensive intestinal resection
    12: ["part2", 8],     // > 40% liver resection
    13: ["part2", 9],     // post liver transplant
    14: ["part1", 3],     // burns
    15: ["part1", 4],     // hyperbilirubinemia of the newborn
    16: ["part1", 1],     // malnutrition syndrome
    17: ["part4", 3]      // second line in hypovolemic shock
  };
  // → { branch, dx } for the albumin form from the patient's ticked condition, else his diagnosis text (Others), else empty
  function albuminDx(p) {
    const f = MF.FORMS.albumin.fields.find((x) => x.t === "branch"), PFm = global.PharmacyPatientForms;
    const ticks = (p.labs && p.labs._forms && p.labs._forms.albumin && p.labs._forms.albumin.ticks) || [];
    const n = ticks.slice().sort((a, b) => a - b)[0];
    if (n) {
      const m = ALB_MAP[n];
      if (m && f.branches[m[0]] && f.branches[m[0]].opts[m[1]]) return { branch: m[0], dx: f.branches[m[0]].opts[m[1]] };
      const it = PFm && PFm.FORMS && PFm.FORMS.albumin.items.find((x) => x.n === n);
      if (it && (it.text || it.label)) return { branch: "others", dx: String(it.text || it.label) };
    }
    const own = String(p.diagnosis || "").trim();
    return own ? { branch: "others", dx: own } : { branch: "others", dx: "" };
  }

  function allowed() { const A = global.PharmacyAuth; return !!(A && A.canMinistry && A.canMinistry()); }

  // ---- which patients each form is for ----
  const MATCH = { ivig: /ivig|immunoglobulin/i, tigecycline: /tigecycline|tigacycline/i, colistin: /colistin/i };
  const catOf = (pm) => (App().state.medications || []).find((m) => m && m.id === pm.id) || {};
  const probe = (pm, c) => [pm.id, pm.nameEn, pm.nameTrade, c.nameEn, c.nameTrade, c.nameChart].join(" ");
  // → the patient's medicines the form is about ([{ pm, c }]) — one for a drug form, every antibiotic for the antibiotics status
  function medsOf(formId, p) {
    const Clin = global.PharmacyClinical, out = [];
    for (const pm of (p && p.medications) || []) {
      if (!pm) continue;
      const c = catOf(pm), merged = Object.assign({}, pm, c);
      const hit = formId === "albumin" ? !!(Clin && Clin.isAlbumin(merged))
        : formId === "antibiotics" ? !!(Clin && Clin.isAntibiotic(merged))
        : MATCH[formId].test(probe(pm, c));
      if (hit) out.push({ pm, c });
    }
    return out;
  }
  function patients(formId) {
    const st = App().state, W = global.PharmacyWard, out = [];
    Object.keys(st.patients || {}).forEach((key) => {
      const p = st.patients[key];
      if (!p || !p.name || !p.name.trim()) return;
      const meds = medsOf(formId, p);
      if (meds.length) out.push({ key, p, meds, order: (W && W.bedLabelOfKey && W.bedLabelOfKey(key)) || 999 });
    });
    return out.sort((a, b) => a.order - b.order);
  }
  const sentToday = (p, formId) => { const r = p.labs && p.labs._ministry && p.labs._ministry[formId]; return !!(r && r.date === todayISO()); };

  // ---- the values a form starts with: everything the app knows ----
  const num = (s) => { const m = /\d+(\.\d+)?/.exec(digits(s)); return m ? m[0] : ""; };
  function dailyQty(x) {
    const Bridge = global.PharmacyChartBridge, m0 = x.meds[0];
    const freq = m0.pm.frequency || m0.c.defaultFrequency || "";
    const q = Bridge && Bridge.dailyQuantity ? Bridge.dailyQuantity(m0.pm.id, freq, m0.c.form) : null;
    return q > 0 ? q : 1;
  }
  // an antibiotic of the patient → the name the status form lists
  const ABX_NAMES = [["amikacin", /amikacin/i], ["amoxicillin", /amoxi(cillin|l)(?!.*clav)/i], ["augementin", /augment|clavul/i], ["ceftrixone", /ceftri|ceftrixone/i],
    ["ceftazidime", /ceftazidime/i], ["cefotaxime", /cefotaxime/i], ["ciprofloxacin", /cipro/i], ["colistin", /colistin/i], ["flagyl", /flagyl|metronidazole/i],
    ["gentamicin", /gentamicin|gentamycin|garamycin/i], ["levofloxacin", /levofloxacin/i], ["meropenem", /meropenem|meronem/i], ["septrin", /septrin|trimethoprim|co-trimox|methoprim/i],
    ["tazocin", /tazocin|piperacillin/i], ["vancomycin", /vancomycin/i]];
  function defaults(formId, x) {
    const f = MF.FORMS[formId], p = x.p, now = new Date(), v = {};
    const sex = p.gender === "female" ? (formId === "tigecycline" ? "أنثى" : "انثى") : p.gender === "male" ? "ذكر" : "";
    const creat = num(p.labs && p.labs.creatinine);
    const dx = String(p.diagnosis || "").trim();
    f.fields.forEach((fl) => { if (fl.t === "fixed") v[fl.k] = fl.v; });
    const set = (k, val) => { if (f.fields.some((fl) => fl.k === k)) v[k] = val; };
    const seasonField = f.fields.find((fl) => fl.k === "season"), monthField = f.fields.find((fl) => fl.k === "month");
    if (seasonField) set("season", MF.seasonOf(now.getMonth(), f));
    if (monthField) set("month", monthField.opts[now.getMonth()] || "");        // tigecycline's form has no December → empty, the user is told
    set("name", String(p.name || "").trim()); set("doctor", String(p.doctor || "").trim());
    set("plate", digits(p.plateNumber || "")); set("gender", sex); set("age", num(p.age));
    if (formId === "ivig" || formId === "albumin") { set("vials", String(dailyQty(x))); set("branch", ""); set("dx", ""); }
    // albumin: the lost quantity is always 0; the Ministry's group + choice come from the condition ticked on the albumin form
    if (formId === "albumin") { set("waste", "0"); const d = albuminDx(p); v.branch = d.branch; v.dx = d.dx; }
    if (formId === "tigecycline") {
      const m0 = x.meds[0].pm, nm = MATCH.tigecycline, fr = (global.PharmacyMedications && global.PharmacyMedications.parseFreq) ? global.PharmacyMedications.parseFreq(m0.frequency || x.meds[0].c.defaultFrequency || "") : null;
      set("ward", "الباطنية"); set("dx", dx); set("creat", creat);
      set("dose", (m0.dose ? m0.dose : "50mg") + (fr && fr.m ? " × " + fr.m : "")); void nm;
      set("days", ""); set("culture", ""); set("indication", "");
    }
    if (formId === "colistin") {
      set("ward", "الباطنية"); set("start", x.meds[0].pm.startDate || todayISO()); set("weight", num(p.weight)); set("creat", creat);
      set("sharing", "لا"); set("days", "غير محدد من قبل الطبيب"); set("culture", "not done"); set("committee", ""); set("dx", "");
      set("dose", ""); set("given", ""); set("waste", "0");
    }
    if (formId === "antibiotics") {
      const Clin = global.PharmacyClinical, names = [], doses = [], freqs = [];
      let oral = false, inj = false, days = 0;
      x.meds.forEach(({ pm, c }) => {
        const pr = probe(pm, c), hit = ABX_NAMES.find((a) => a[1].test(pr));
        if (hit && names.indexOf(hit[0]) < 0) names.push(hit[0]);
        const form = c.form || pm.form || "";
        if (/tablet|capsule|syrup|suppository/i.test(form)) oral = true; else inj = true;
        const g = /^(\d+(?:\.\d+)?)\s*g\b/i.exec(String(pm.dose || "").trim()), mg = /^(\d+)\s*mg\b/i.exec(String(pm.dose || "").trim());
        const d = g ? Math.round(Number(g[1]) * 1000) + " mg" : mg ? mg[1] + " mg" : "";
        if (d && doses.indexOf(d) < 0) doses.push(d);
        const fr = global.PharmacyMedications && global.PharmacyMedications.parseFreq ? global.PharmacyMedications.parseFreq(pm.frequency || c.defaultFrequency || "") : null;
        const m = fr && fr.m ? String(fr.m) : "";
        if (m && ["1", "2", "3", "4"].indexOf(m) >= 0 && freqs.indexOf(m) < 0) freqs.push(m);
        const dd = Clin && Clin.abxDay ? Clin.abxDay(pm, p) : null; if (dd && dd > days) days = dd;
      });
      const allowedDose = f.fields.find((fl) => fl.k === "dose").opts;
      set("ward", "الباطنية"); set("dx", dx); set("stay", ""); set("allergy", p.allergies && String(Array.isArray(p.allergies) ? p.allergies.join("") : p.allergies).trim() ? "نعم" : "لا");
      set("count", String(x.meds.length)); set("names", names); set("oral", oral ? "نعم" : "لا"); set("inj", inj ? "نعم" : "لا");
      set("dose", doses.filter((d) => allowedDose.indexOf(d) >= 0)); set("freq", freqs); set("days", days ? String(days) : "");
      ["culture", "review", "same", "inc", "dec", "change", "add", "stop", "cure", "worse", "death", "dcCont", "dcStop"].forEach((k) => set(k, "لا"));
      set("floor", "٦");
    }
    return v;
  }

  // ---- screens ----
  function head(title, sub, backAction) {
    return '<button type="button" class="mn-back" data-act="' + backAction + '">‹ رجوع</button><h3 class="mn-title">' + esc(title) + "</h3>" + (sub ? '<p class="mn-sub">' + esc(sub) + "</p>" : "");
  }
  function drawList() {
    const forms = Object.keys(MF.FORMS).map((id) => {
      const f = MF.FORMS[id], n = patients(id).length;
      return '<button type="button" class="mn-card" data-act="form" data-f="' + id + '"><b>' + esc(f.title) + "</b><small>" + esc(f.sub) + "</small><span>" + n + " مريض</span></button>";
    }).join("");
    $("ministry-body").innerHTML = '<p class="mn-note">اختر الدواء لتظهر مرضاه، ثم املأ النموذج وأرسله إلى الوزارة.</p>' + forms;
  }
  function drawPatients() {
    const f = MF.FORMS[S.form], rows = patients(S.form);
    $("ministry-body").innerHTML = head(f.title, f.sub, "list") + (rows.length ? rows.map((x) => {
      const done = sentToday(x.p, S.form);
      return '<button type="button" class="mn-pt" data-act="pt" data-k="' + esc(x.key) + '"><b>' + esc(x.p.name) + "</b><small>" +
        esc((global.PharmacyWard.bedText ? global.PharmacyWard.bedText(x.key) : x.key) + (x.p.plateNumber ? " · طبلة " + x.p.plateNumber : "")) + '</small><span class="mn-st' + (done ? " ok" : "") + '">' + (done ? "أُرسل اليوم ✓" : AUTO[S.form] ? "اضغط للإرسال" : "لم يُرسل") + "</span></button>";
    }).join("") : '<div class="mn-empty">لا يوجد مرضى على هذا الدواء حاليًا.</div>');
  }
  const OTHER = "__other__";
  function fieldHtml(fl, v) {
    const id = "mn-f-" + fl.k, val = v[fl.k];
    const lab = '<label for="' + id + '">' + esc(fl.label) + (fl.req ? " *" : "") + "</label>";
    let body = "";
    if (fl.t === "fixed") return '<div class="mn-fixed full">' + esc(fl.v) + "</div>";
    if (fl.t === "text" || fl.t === "num") body = '<input id="' + id + '" type="text" ' + (fl.t === "num" ? 'inputmode="decimal" dir="ltr"' : "") + ' value="' + esc(val) + '">';
    else if (fl.t === "date") body = '<input id="' + id + '" type="date" dir="ltr" value="' + esc(val) + '">';
    else if (fl.t === "radio") {
      const isOther = fl.other && val && fl.opts.indexOf(val) < 0;
      body = '<select id="' + id + '"><option value="">— اختر —</option>' + fl.opts.map((o) => '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(o) + "</option>").join("") +
        (fl.other ? '<option value="' + OTHER + '"' + (isOther ? " selected" : "") + ">أخرى…</option>" : "") + "</select>" +
        (isOther ? '<input id="' + id + '-o" type="text" class="mn-oth" placeholder="اكتب" value="' + esc(val) + '">' : "");
    } else if (fl.t === "check") {
      const arr = Array.isArray(val) ? val : [], extra = arr.filter((x) => fl.opts.indexOf(x) < 0)[0] || "";
      body = '<div class="mn-chips" id="' + id + '">' + fl.opts.map((o) => '<label class="mn-chip"><input type="checkbox" data-k="' + fl.k + '" value="' + esc(o) + '"' + (arr.indexOf(o) >= 0 ? " checked" : "") + "><span>" + esc(o) + "</span></label>").join("") + "</div>" +
        (fl.other ? '<input id="' + id + '-o" type="text" class="mn-oth" placeholder="أخرى (اختياري)" value="' + esc(extra) + '">' : "");
    } else if (fl.t === "branch") {
      const bs = fl.branches, b = bs[v.branch];
      body = '<select id="mn-f-branch"><option value="">— اختر —</option>' + Object.keys(bs).map((k) => '<option value="' + k + '"' + (k === v.branch ? " selected" : "") + ">" + esc(bs[k].label) + "</option>").join("") + "</select>" +
        (!b ? "" : b.free ? '<input id="mn-f-dx" type="text" dir="ltr" class="mn-oth" placeholder="التشخيص" value="' + esc(v.dx) + '">'
          : '<select id="mn-f-dx" dir="ltr" class="mn-oth"><option value="">— اختر التشخيص —</option>' + b.opts.map((o) => '<option value="' + esc(o) + '"' + (o === v.dx ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>");
    }
    return '<div class="mn-fld' + (fl.half ? "" : " full") + '">' + lab + body + "</div>";
  }
  function drawEditor() {
    const f = MF.FORMS[S.form], v = S.v;
    const warn = f.id === "tigecycline" && !v.month ? '<div class="mn-warn">نموذج Tigecycline لا يتضمن شهر كانون الأول، فلا يمكن إرساله في هذا الشهر.</div>' : "";
    $("ministry-body").innerHTML = head(f.title, "راجع البيانات قبل الإرسال", "pts") + warn +
      '<div class="mn-form">' + f.fields.map((fl) => fieldHtml(fl, v)).join("") + "</div>" +
      '<button type="button" class="mn-send" id="mn-send" data-act="send"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "جارٍ الإرسال…" : "إرسال إلى الوزارة") + "</button>";
  }
  function readEditor() {
    const f = MF.FORMS[S.form], v = S.v, g = (id) => { const e = $(id); return e ? e.value : null; };
    f.fields.forEach((fl) => {
      if (fl.t === "fixed") return;
      const id = "mn-f-" + fl.k;
      if (fl.t === "check") {
        const arr = Array.from(document.querySelectorAll('#ministry-body input[type=checkbox][data-k="' + fl.k + '"]')).filter((c) => c.checked).map((c) => c.value);
        const o = g(id + "-o"); if (o && o.trim()) arr.push(o.trim());
        v[fl.k] = arr;
      } else if (fl.t === "branch") {
        const b = g("mn-f-branch"); if (b !== null) v.branch = b;
        const d = g("mn-f-dx"); if (d !== null) v.dx = d;
      } else if (fl.t === "radio" && fl.other) {
        const sv = g(id), o = g(id + "-o");
        v[fl.k] = sv === OTHER ? (o != null ? o : "") : (sv != null ? sv : v[fl.k]);
      } else {
        const sv = g(id);
        if (sv !== null) v[fl.k] = (fl.t === "num" || fl.k === "plate") ? digits(sv) : sv;
      }
    });
  }

  // ---- sending ----
  async function token() {
    const SB = global.PharmacySupabase, client = SB && SB.getClient ? SB.getClient() : null;
    if (!client) return "";
    try { const { data } = await client.auth.getSession(); return (data && data.session && data.session.access_token) || ""; } catch (e) { return ""; }
  }
  function summary(f, v) {
    return f.fields.filter((fl) => fl.t !== "fixed").map((fl) => {
      const val = fl.t === "branch" ? (fl.branches[v.branch] ? fl.branches[v.branch].label + ": " + v.dx : "") : Array.isArray(v[fl.k]) ? v[fl.k].join("، ") : v[fl.k];
      return fl.label + ": " + (val || "—");
    }).join("\n");
  }
  // → the card data an auto form lacks (Arabic names)
  function missingOf(formId, v) { return Object.keys(NEEDS).filter((k) => !String(v[k] == null ? "" : v[k]).trim()).map((k) => NEEDS[k]); }
  async function send() {
    if (S.busy) return;
    if (!AUTO[S.form]) readEditor();
    const f = MF.FORMS[S.form], v = S.v;
    const bad = MF.validate(S.form, v);
    if (bad) { App().flashHint(bad); return; }
    const x = App().state.patients[S.key];
    if (x && sentToday(x, S.form) && !confirm("أُرسل نموذج هذا المريض اليوم من قبل. هل ترسله مرة ثانية؟")) return;
    const shown = AUTO[S.form] ? v.name + " — طبلة " + v.plate + "\nالفيالات: " + v.vials + "\n" + f.fields.find((x) => x.t === "branch").branches[v.branch].label + ": " + v.dx : summary(f, v);
    if (!confirm("إرسال إلى وزارة الصحة — " + f.title + ":\n\n" + shown + "\n\nهل تريد الإرسال؟")) return;
    S.busy = true; if (!AUTO[S.form]) drawEditor();
    let r, body = {};
    try {
      r = await fetch((location.origin === PROD ? "" : PROD) + "/api/ministry-send", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) },
        body: JSON.stringify({ form: S.form, values: v })
      });
      try { body = await r.json(); } catch (e) { /* empty */ }
    } catch (e) { r = null; }
    S.busy = false;
    if (!r || !r.ok || body.ok === false) { if (!AUTO[S.form]) drawEditor(); App().flashHint("⚠ " + ((body && body.message) || "تعذّر الإرسال — تحقق من الإنترنت")); return; }
    if (x) {
      if (!x.labs || typeof x.labs !== "object") x.labs = {};
      if (!x.labs._ministry) x.labs._ministry = {};
      x.labs._ministry[S.form] = { date: todayISO() };
      App().savePatient(S.key);
    }
    App().flashHint("✓ أُرسل موقف " + f.short + " إلى الوزارة: " + (v.name || ""));
    S.screen = "pts"; drawPatients();
  }

  // ---- wiring ----
  function open() {
    if (!allowed()) return;
    S = { screen: "list", form: "", key: "", v: null, busy: false };
    drawList();
    global.PharmacyUI.showView("ministry");
  }
  function init() {
    const btn = $("settings-ministry-btn"); if (btn) btn.addEventListener("click", open);
    const back = $("ministry-back-btn"); if (back) back.addEventListener("click", () => global.PharmacyUI.showView("settings"));
    const body = $("ministry-body"); if (!body) return;
    body.addEventListener("change", (e) => {
      if (S.screen !== "edit") return;
      const id = e.target.id || "";
      readEditor();
      // a choice that changes what is shown: the diagnosis group, an «other…» option
      if (id === "mn-f-branch") { S.v.dx = ""; drawEditor(); }
      else if (e.target.tagName === "SELECT" && e.target.value === OTHER) { const fl = MF.FORMS[S.form].fields.find((x) => "mn-f-" + x.k === id); if (fl) { S.v[fl.k] = " "; drawEditor(); const o = $(id + "-o"); if (o) { o.value = ""; o.focus(); } } }
    });
    body.addEventListener("input", () => { if (S.screen === "edit") readEditor(); });
    body.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]"); if (!a || !allowed()) return;
      const act = a.dataset.act;
      if (act === "list") { S.screen = "list"; drawList(); }
      else if (act === "form") { S.form = a.dataset.f; S.screen = "pts"; drawPatients(); }
      else if (act === "pts") { S.screen = "pts"; drawPatients(); }
      else if (act === "pt") {
        const x = patients(S.form).find((y) => y.key === a.dataset.k); if (!x) return;
        S.key = x.key; S.v = defaults(S.form, x);
        if (AUTO[S.form]) {                                      // no editor: check the card, then confirm + send
          const miss = missingOf(S.form, S.v);
          if (miss.length) { App().flashHint("لم تكتمل المعلومات الآتية في سرير المريض: " + miss.join("، ")); return; }
          send();
          return;
        }
        S.screen = "edit"; drawEditor();
      } else if (act === "send") send();
    });
  }

  global.PharmacyMinistry = { open, _defaults: defaults, _patients: patients };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
