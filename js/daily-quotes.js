/* ============================================================
   daily-quotes.js — a short saying a day on the ward display
   ------------------------------------------------------------
   The admin manages the sayings (admin page → «مقولات شاشة العرض"):
   picks one to keep on screen, or «تلقائي» = a new one each day (the
   same on every screen, changing after midnight); adds and deletes
   them. Stored in app_settings key 'display_quotes' = { list, pinned }
   (features.sql §17: everyone reads, the admin writes). Until the admin
   saves once, QUOTES below is the list. A verse = two halves joined by
   " ... " (shown with ✦ between them).
   ============================================================ */
(function (global) {
  "use strict";

  // The sayings the user gave — never add any of our own.
  const QUOTES = [
    "مَن كانَ لا يَطَأُ التُرابَ بِرِجلِهِ ... يَطَأُ التُرابَ بِناعِمِ الخَدِّ",
    "لا تَشتَرِ العَبدَ إِلّا وَالعَصا مَعَهُ ... إِنَّ العَبيدَ لَأَنجاسٌ مَناكيدُ",
    "مِكَرٍّ مِفَرٍّ مُقْبِلٍ مُدْبِرٍ مَعًا ... كَجُلْمُودِ صَخْرٍ حَطَّهُ السَّيْلُ مِنْ عَلِ",
    "أَنا اِبنُ جَلا وَطَلاعِ الثَنايا ... مَتى أَضَعِ العِمامَةَ تَعرِفوني",
    "إنْ كُنْتَ تَشْكُو مِنَ الدُّنْيَا وقَسْوَتِها ... فَمَنْ تُراهُ مِنَ الأَكْدَارِ قَدْ سَلِمَا؟",
    "ذَهَبَ الَّذينَ عَلَيهِمُ وَجدي ... وَبَقيتُ بَعدَ فِراقِهم وَحدي",
    "للناسِ ظاهرٌ والمظاهرُ تخدعُ، فلا تحكمنَّ بالذي ترى وتسمعُ",
    "هذه هي الحياة ... استقبال و وداع",
    "يُغير الناس وجوههم كل يوم ... فلا تبحث عن قيمتك فيها"
  ];
  const KEY = "display_quotes";

  let list = QUOTES.slice();
  let pinned = "";            // "" = automatic (one a day)
  let channel = null;
  let loaded = false;

  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  };

  // Day number (local calendar day) → the same quote everywhere that day
  function dayIndex(d) {
    const date = d || new Date();
    const start = Date.UTC(date.getFullYear(), 0, 1);
    const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return date.getFullYear() * 366 + Math.round((today - start) / 86400000);
  }
  // pure (tested): what the display shows
  function pick(quotes, pin, d) {
    const qs = (quotes || []).filter(Boolean);
    if (pin && qs.indexOf(pin) !== -1) return pin;
    return qs.length ? qs[dayIndex(d) % qs.length] : "";
  }
  function current(d) { return pick(list, pinned, d); }
  function today(d) { return pick(list, "", d); }

  // A verse typed on two lines → "half ... half"
  function normalize(text) {
    return String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(" ... ").replace(/\s+/g, " ").trim();
  }

  async function load() {
    const c = client();
    if (!c) return;
    try {
      const { data, error } = await c.from("app_settings").select("value").eq("key", KEY).maybeSingle();
      if (error || !data || !data.value) return;
      const v = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (Array.isArray(v.list)) list = v.list.filter(x => typeof x === "string" && x.trim());
      pinned = typeof v.pinned === "string" ? v.pinned : "";
      loaded = true;
    } catch (e) { /* offline / table missing: keep the built-in list */ }
  }
  function start() {
    load();
    const c = client();
    if (c && !channel) {
      try {
        channel = c.channel("pharma-display-quotes")
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => load())
          .subscribe();
      } catch (e) { /* the display clock reloads once a minute anyway */ }
    }
  }

  // ---- admin ----
  async function save(nextList, nextPinned) {
    const c = client();
    if (!c) return { ok: false, error: "غير متصل" };
    const value = { list: nextList, pinned: nextPinned || "" };
    const { error } = await c.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      const m = error.message || "";
      return { ok: false, error: /does not exist|schema cache|Could not find the table/i.test(m) ? "شغّل القسم 17 من features.sql في Supabase" : m };
    }
    list = nextList.slice();
    pinned = value.pinned;
    return { ok: true };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const flash = (m) => global.PharmacyApp && global.PharmacyApp.flashHint(m);

  async function renderAdmin() {
    const box = document.getElementById("admin-quotes");
    if (!box) return;
    await load();
    box.innerHTML = "";
    const name = "dq-choice";
    const option = (value, label, sub) => {
      const row = el("label", "dq-row");
      const r = el("input");
      r.type = "radio";
      r.name = name;
      r.value = value;
      r.checked = value === "" ? !pinned || list.indexOf(pinned) === -1 : value === pinned;
      r.addEventListener("change", async () => {
        const res = await save(list, value);
        flash(res.ok ? (value ? "✓ تظهر هذه المقولة على شاشة العرض" : "✓ مقولة جديدة كل يوم") : "تعذّر الحفظ: " + res.error);
        renderAdmin();
      });
      row.appendChild(r);
      const t = el("span", "dq-text");
      t.appendChild(el("span", null, label));
      if (sub) t.appendChild(el("small", "dq-sub", sub));
      row.appendChild(t);
      return row;
    };
    box.appendChild(option("", "تلقائي — مقولة جديدة كل يوم", "اليوم: " + today().replace(/ \.\.\. /g, " ✦ ")));
    list.forEach((q, i) => {
      const row = option(q, q.replace(/ \.\.\. /g, " ✦ "));
      const del = el("button", "dq-del", "✕");
      del.type = "button";
      del.title = "حذف المقولة";
      del.setAttribute("aria-label", "حذف المقولة");
      del.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!confirm("حذف هذه المقولة؟\n" + q.replace(/ \.\.\. /g, " ✦ "))) return;
        const next = list.filter((_, j) => j !== i);
        const res = await save(next, pinned === q ? "" : pinned);
        flash(res.ok ? "✓ حُذفت المقولة" : "تعذّر الحذف: " + res.error);
        renderAdmin();
      });
      row.appendChild(del);
      box.appendChild(row);
    });
    // add
    const add = el("div", "dq-add");
    const ta = el("textarea", "dq-input");
    ta.rows = 2;
    ta.placeholder = "مقولة جديدة — للبيت اكتب الشطرين في سطرين";
    const btn = el("button", "btn-audit-refresh dq-add-btn", "＋ إضافة المقولة");
    btn.type = "button";
    btn.addEventListener("click", async () => {
      const q = normalize(ta.value);
      if (!q) { flash("اكتب المقولة أولاً"); return; }
      if (list.indexOf(q) !== -1) { flash("المقولة موجودة في القائمة"); return; }
      const res = await save(list.concat(q), pinned);
      flash(res.ok ? "✓ أُضيفت المقولة" : "تعذّر الإضافة: " + res.error);
      if (res.ok) renderAdmin();
    });
    add.appendChild(ta);
    add.appendChild(btn);
    box.appendChild(add);
  }

  // A saying into a box: a verse = exactly two lines (one per half), never
  // wrapped further — when a half doesn't fit, the font gets smaller.
  function renderInto(box, text) {
    box.textContent = "";
    String(text || "").split(" ... ").forEach(part => {
      const line = document.createElement("div");
      line.className = "quote-line";
      line.textContent = part;
      box.appendChild(line);
    });
    fit(box);
  }
  function fit(box) {
    if (!box || !box.isConnected) return;
    box.style.fontSize = "";
    const lines = Array.from(box.querySelectorAll(".quote-line"));
    if (!lines.length || !box.clientWidth) return;
    let px = parseFloat(getComputedStyle(box).fontSize) || 24;
    // also the whole box: on the TV both halves sit side by side on one line
    const tooWide = () => box.scrollWidth > box.clientWidth + 1 || lines.some(l => l.scrollWidth > box.clientWidth + 1);
    while (tooWide() && px > 11) {
      px -= 1;
      box.style.fontSize = px + "px";
    }
  }

  // «حكمة اليوم» (header button, everyone): today's saying in a small card
  async function showPopup() {
    await load();
    const old = document.getElementById("quote-popup");
    if (old) old.remove();
    const overlay = el("div", "quote-popup-overlay");
    overlay.id = "quote-popup";
    const card = el("div", "quote-popup-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "حكمة اليوم");   // no visible title — just the saying
    const body = el("div", "quote-popup-text");
    card.appendChild(body);
    const ok = el("button", "quote-popup-close", "إغلاق");
    ok.type = "button";
    card.appendChild(ok);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    renderInto(body, current() || "لا توجد مقولة بعد");   // after it is on the page (to measure)
    const close = () => overlay.remove();
    ok.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }
  function initButton() {
    const b = document.getElementById("quote-btn");
    if (b) b.addEventListener("click", showPopup);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initButton);
    else initButton();
  }

  global.PharmacyDailyQuotes = { QUOTES, current, today, pick, normalize, dayIndex, load, start, renderAdmin, isLoaded: () => loaded, showPopup, renderInto, fit };
})(window);
