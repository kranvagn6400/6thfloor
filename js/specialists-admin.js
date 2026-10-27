/* The ward's specialists list, managed by the ADMIN pharmacist: edit a name, delete one, add one.
   The list is saved in app_settings key "specialists" = { list: [...] } (every signed-in user reads it, only the
   admin may write it — the database refuses anyone else) and every device follows it live. Until the admin
   saves, the built-in list of specialists.js is used. The last list read is cached on the device.
   Renaming a specialist also renames him on every patient who carries the old spelling. */
(function (global) {
  "use strict";
  var CACHE = "pharma.specialists", SKEY = "specialists";
  var SP = function () { return global.PharmacySpecialists; };
  var channel = null;

  function client() {
    var SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  }
  function isAdmin() { var A = global.PharmacyAuth; return !!(A && A.isAdmin && A.isAdmin()); }
  function cached() {
    try { var v = JSON.parse(localStorage.getItem(CACHE) || "null"); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function cache(list) { try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch (e) { /* blocked */ } }

  function apply(list) {                                     // list: array | null (= the built-in names)
    if (SP()) SP().setKnown(list);
    render();
    try { window.dispatchEvent(new Event("specialists-changed")); } catch (e) { /* old browser */ }
  }

  async function load() {
    var c = client();
    if (!c) return;
    try {
      var r = await c.from("app_settings").select("value").eq("key", SKEY).maybeSingle();
      if (r.error) return;
      var v = r.data && r.data.value ? (typeof r.data.value === "string" ? JSON.parse(r.data.value) : r.data.value) : null;
      var list = v && Array.isArray(v.list) ? v.list : null;  // no row = the built-in list
      if (list) cache(list); else { try { localStorage.removeItem(CACHE); } catch (e) { /* blocked */ } }
      apply(list);
    } catch (e) { /* offline / table missing: keep the cached list */ }
  }
  function start() {
    load();
    var c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-specialists")
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, function () { load(); })
          .subscribe();
      } catch (e) { /* the visibility refresh below still picks it up */ }
    }
  }

  function flash(msg) { var f = global.PharmacyApp && global.PharmacyApp.flashHint; if (f) f(msg); }

  async function save(list) {
    if (!isAdmin()) return { ok: false, error: "تعديل أسماء الأخصائيين للمسؤول فقط" };
    var c = client();
    if (!c) return { ok: false, error: "غير متصل" };
    var r = await c.from("app_settings").upsert({ key: SKEY, value: { list: list }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (r.error) return { ok: false, error: r.error.message || "تعذّر الحفظ" };
    cache(list);
    apply(list);
    return { ok: true };
  }

  // the patients who carry the old spelling get the new one
  function renamePatients(oldName, newName) {
    var app = global.PharmacyApp, sp = SP();
    if (!app || !sp) return 0;
    var ok = sp.key(oldName), n = 0, patients = app.state.patients;
    Object.keys(patients).forEach(function (k) {
      var p = patients[k];
      if (p && p.doctor && sp.key(p.doctor) === ok) { p.doctor = newName; app.savePatient(k); n++; }
    });
    if (n) app.refresh();
    return n;
  }

  // ---- the admin page ----
  function render() {
    var box = document.getElementById("admin-spec-list");
    if (!box || !SP()) return;
    var list = SP().getKnown();
    box.textContent = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "spec-empty";
      empty.textContent = "لا أسماء محفوظة. (تبقى الأسماء المكتوبة على المرضى تُقترح عند الكتابة.)";
      box.appendChild(empty);
    }
    list.forEach(function (name, i) {
      var row = document.createElement("div");
      row.className = "spec-row";
      var input = document.createElement("input");
      input.type = "text";
      input.className = "spec-input";
      input.value = name;
      input.setAttribute("aria-label", "اسم الأخصائي");
      input.addEventListener("change", async function () {
        var next = SP().clean(input.value);
        if (!next) { input.value = name; flash("الاسم فارغ — للحذف استعمل زر الحذف"); return; }
        var copy = SP().getKnown();
        if (copy.some(function (n, j) { return j !== i && SP().key(n) === SP().key(next); })) { input.value = name; flash("هذا الأخصائي موجود في القائمة"); return; }
        copy[i] = next;
        var r = await save(copy);
        if (!r.ok) { input.value = name; flash("تعذّر الحفظ: " + r.error); return; }
        var n = next !== name ? renamePatients(name, next) : 0;
        flash("✓ عُدّل الاسم" + (n ? " وحُدّث عند " + n + " مريض" : ""));
      });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "spec-del";
      del.textContent = "حذف";
      del.addEventListener("click", async function () {
        if (!confirm("حذف الأخصائي «" + name + "» من القائمة؟\n(لا يتغير شيء عند المرضى المكتوب عندهم اسمه)")) return;
        var copy = SP().getKnown(); copy.splice(i, 1);
        var r = await save(copy);
        flash(r.ok ? "✓ حُذف من القائمة" : "تعذّر الحفظ: " + r.error);
      });
      row.appendChild(input);
      row.appendChild(del);
      box.appendChild(row);
    });
    var sum = document.getElementById("admin-spec-summary");
    if (sum) sum.textContent = "قائمة الأخصائيين (" + list.length + ") — اضغط للتعديل أو الحذف";
    var add = document.getElementById("admin-spec-add");
    if (add && !add._bound) { add._bound = true; add.addEventListener("click", onAdd); }
  }
  async function onAdd() {
    var input = document.getElementById("admin-spec-new");
    var name = SP().clean(input && input.value);
    if (!name) { flash("اكتب اسم الأخصائي أولًا"); return; }
    var list = SP().getKnown();
    if (list.some(function (n) { return SP().key(n) === SP().key(name); })) { flash("هذا الأخصائي موجود في القائمة"); return; }
    list.push(name);
    var r = await save(list);
    if (r.ok) { input.value = ""; flash("✓ أُضيف: " + name); } else flash("تعذّر الحفظ: " + r.error);
  }
  // start from the cached list at once (offline starts), refresh from the cloud in start()
  var c0 = cached();
  if (c0 && SP()) SP().setKnown(c0);
  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState !== "loading") render();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  global.PharmacySpecialistsAdmin = { start: start, load: load, save: save, render: render };
})(window);
