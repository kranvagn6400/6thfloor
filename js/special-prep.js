/* special-prep.js — «تحضير الأدوية الخاصة» (settings page for pharmacists + admin).
   A searchable list of cards; each opens the numbered steps to reconstitute / dilute / prepare the drug.
   The texts are a DRAFT written from the usual product labels — to be reviewed against the hospital's protocol. */
(function (global) {
  "use strict";

  const REVIEW = "مسودة مبنية على النشرات الشائعة للأدوية — راجعها مع بروتوكول المستشفى ونشرة الشركة المصنّعة قبل الاعتماد.";

  const DRUGS = [
    {
      id: "amphotericin", name: "Amphotericin B", sub: "التقليدي (deoxycholate) 50 mg — وAmBisome الشحمي 50 mg",
      parts: [
        { title: "Amphotericin B التقليدي 50 mg", steps: [
          "أضف 10 mL ماء معقّم للحقن (Sterile Water) إلى القنينة — لا تستعمل محلولًا ملحيًا لأنه يرسّب الدواء.",
          "ارجّ القنينة فورًا حتى يصبح المحلول رائقًا (التركيز 5 mg/mL).",
          "خفّفه بمحلول Dextrose 5% فقط إلى تركيز نحو 0.1 mg/mL (مثلًا 50 mg في 500 mL).",
          "احمِ المحلول من الضوء، وأعطه بالتسريب الوريدي البطيء خلال 2–6 ساعات.",
          "لا تستعمل فلترًا أصغر من 1 ميكرون، ولا تخلطه بأي دواء آخر في المحلول نفسه."
        ] },
        { title: "AmBisome (Liposomal) 50 mg", steps: [
          "أضف 12 mL ماء معقّم للحقن إلى القنينة (التركيز 4 mg/mL).",
          "ارجّ القنينة بقوة 30 ثانية حتى يذوب المسحوق تمامًا.",
          "اسحب الجرعة وخفّفها بمحلول Dextrose 5% إلى تركيز 0.2–2 mg/mL.",
          "مرّر المحلول عبر الفلتر المرفق بالعلبة (5 ميكرون).",
          "أعطه بالتسريب خلال 60–120 دقيقة."
        ] }
      ],
      notes: ["لا يُخلط بمحلول ملحي ولا بأي دواء آخر.", "اللون البرتقالي الضارب إلى الأصفر طبيعي."]
    },
    {
      id: "caspofungin", name: "Caspofungin", sub: "قنينة 50 mg أو 70 mg",
      steps: [
        "أخرج القنينة من الثلاجة واتركها حتى تبلغ حرارة الغرفة.",
        "أضف 10.5 mL من الماء المعقّم أو محلول NaCl 0.9% (التركيز 5 mg/mL للقنينة 50 mg، و7 mg/mL للقنينة 70 mg).",
        "حرّك بلطف حتى يصبح المحلول رائقًا — لا ترجّ بقوة.",
        "اسحب الجرعة المطلوبة وأضفها إلى كيس 250 mL من NaCl 0.9% أو Ringer Lactate.",
        "أعطه بالتسريب الوريدي خلال نحو ساعة."
      ],
      notes: ["لا تستعمل محاليل الدكستروز للتخفيف.", "الجرعة الاعتيادية: 70 mg في اليوم الأول ثم 50 mg يوميًا."]
    },
    {
      id: "joulie", name: "Joulie's oral solution", sub: "محلول جولي الفموي — تحضير 100 mL",
      stepper: [
        { art: "beaker", text: "ضع قضيب التحريك المغناطيسي (magnetic bar stirrer) في كأس مدرّجة (Calibrated beaker)." },
        { art: "water", text: "أضف 90 mL من الماء المعقّم (Sterile water)، ثم ضع الكأس على الصفيحة (hot plate) وشغّل المحرّك ليتكوّن دوّامة (Vortex). لا تستعمل الحرارة!" },
        { art: "powder", text: "أضف تدريجيًا 17 غرامًا من مسحوق Dihydrous Disodium phosphate." },
        { art: "acid", text: "أضف Phosphoric acid 85%: 5.7 غرام = 3.4 mL." },
        { art: "clear", text: "حرّك جيدًا حتى يصبح المحلول رائقًا." },
        { art: "bottle", text: "انقل المحلول إلى عبوة داكنة (Dark container) واكتب عليها بياناته (Label)." }
      ],
      parts: [
        { title: "التركيز", bullets: true, steps: ["1.45 mmol/mL", "2 mmol/mL"] },
        { title: "الثبات والحفظ", bullets: true, steps: ["مدة الثبات: 7 أيام.", "الحفظ: في درجة حرارة الغرفة، وبعيدًا عن الضوء."] }
      ]
    },
    {
      id: "magic", name: "Magic solution", sub: "المحلول السحري",
      parts: [
        { title: "المكونات", bullets: true, steps: [
          "Dexamethasone (الدكسون): زجاجة كاملة",
          "Diphenhydramine (الارمين): زجاجة كاملة",
          "Nystatin (محلول نيستاتين): زجاجتان كاملتان",
          "Tetracycline (تيتراسيكلين): 6 كبسولات"
        ] },
        { title: "طريقة التحضير", steps: [
          "اخلط زجاجة الدكسون وزجاجة الارمين معًا.",
          "أضف إليهما زجاجتي النيستاتين.",
          "افتح كبسولات التتراسيكلين الستة وأضف محتواها إلى الخليط.",
          "عبّئ الخليط في زجاجات جديدة.",
          "اكتب على الزجاجة المحضّرة: اسم المريض، وتاريخ التحضير، وتاريخ الإتلاف، وعبارة «رجّ جيدًا قبل الاستعمال» لأن المواد الفعالة ترسب في قعر الزجاجة.",
          "ثقّف المريض بأن يتغرغر بالمحلول ثم يبلعه."
        ] },
        { title: "طريقة الإعطاء", bullets: true, steps: ["أربع مرات في اليوم."] }
      ]
    },
    {
      id: "mtx", name: "Methotrexate (MTX)", sub: "قنينة أو أمبولة 50 mg",
      steps: [
        "ارتدِ القفازات والمريلة والكمامة؛ فهو دواء سام للخلايا (Cytotoxic) ويُحضَّر في مكان مخصّص إن توفّر.",
        "إن كان مسحوقًا مجففًا: أضف الماء المعقّم أو NaCl 0.9% الخالي من المواد الحافظة حتى تبلغ 25 mg/mL، وحرّك حتى يذوب. وإن كان محلولًا جاهزًا فلا حاجة للإذابة.",
        "اسحب الجرعة الموصوفة بدقة.",
        "للتسريب: خفّفها في NaCl 0.9% أو Dextrose 5% حسب البروتوكول.",
        "للحقن داخل القراب (Intrathecal): استعمل مستحضرًا خاليًا من المواد الحافظة فقط.",
        "تخلّص من الأدوات والنفايات في حاوية النفايات الخطرة."
      ],
      notes: ["يلزم إعطاء Leucovorin (الإنقاذ) حسب البروتوكول عند الجرعات العالية.", "تأكد من الجرعة: الخطأ بين الجرعة اليومية والأسبوعية خطر."]
    },
    {
      id: "vancomycin", name: "Vancomycin", sub: "قنينة 500 mg أو 1 g",
      steps: [
        "أذِب القنينة 500 mg بـ 10 mL ماء معقّم (والقنينة 1 g بـ 20 mL) فيصير التركيز 50 mg/mL.",
        "ارجّ حتى يذوب المسحوق تمامًا ويصبح المحلول رائقًا.",
        "خفّفه بـ NaCl 0.9% أو Dextrose 5% إلى تركيز لا يزيد عن 5 mg/mL (500 mg في 100 mL على الأقل، و1 g في 200 mL على الأقل).",
        "أعطه بالتسريب الوريدي ببطء: ما لا يقل عن 60 دقيقة لكل 1 g، وبسرعة لا تزيد عن 10 mg/دقيقة."
      ],
      notes: ["التسريب السريع يسبب متلازمة «الرجل الأحمر» (Red man syndrome).", "في الخط المركزي أو عند تحديد السوائل يجوز تركيز حتى 10 mg/mL."]
    },
    {
      id: "meronem", name: "Meropenem (Meronem)", sub: "قنينة 500 mg أو 1 g",
      steps: [
        "أذِب القنينة 500 mg بـ 10 mL ماء معقّم للحقن (والقنينة 1 g بـ 20 mL).",
        "ارجّ حتى يذوب المسحوق ويصبح المحلول رائقًا.",
        "للحقن الوريدي المباشر: أعطه ببطء خلال 3–5 دقائق.",
        "للتسريب: خفّفه في 50–100 mL من NaCl 0.9% وأعطه خلال 15–30 دقيقة (أو التسريب الممتد 3 ساعات إن اعتمده البروتوكول).",
        "حضّره قبل الإعطاء مباشرة، فثباته يقصر في حرارة الغرفة."
      ],
      notes: ["يُعدَّل التواتر والجرعة حسب وظائف الكلى (eGFR)."]
    },
    {
      id: "tazocin", name: "Tazocin (Piperacillin/Tazobactam)", sub: "قنينة 4.5 g (أو 2.25 g)",
      steps: [
        "أذِب القنينة 4.5 g بـ 20 mL ماء معقّم أو NaCl 0.9% (والقنينة 2.25 g بـ 10 mL).",
        "ارجّ حتى يذوب المسحوق تمامًا.",
        "خفّفه بـ 50–150 mL من NaCl 0.9% أو Dextrose 5%.",
        "أعطه بالتسريب الوريدي خلال 30 دقيقة (أو التسريب الممتد 4 ساعات إن اعتمده البروتوكول)."
      ],
      notes: ["لا يُخلط بالأمينوغليكوزيدات (مثل Gentamicin) في الكيس أو الخط نفسه؛ أعطها منفصلة.", "تُعدَّل الجرعة حسب وظائف الكلى."]
    },
    {
      id: "voriconazole", name: "Voriconazole", sub: "قنينة وريدية 200 mg",
      steps: [
        "أضف 19 mL ماء معقّم للحقن إلى القنينة (التركيز 10 mg/mL).",
        "ارجّ حتى يذوب المسحوق تمامًا ويصبح المحلول رائقًا.",
        "خفّف الجرعة بـ NaCl 0.9% أو Ringer Lactate أو Dextrose 5% إلى تركيز 0.5–5 mg/mL.",
        "أعطه بالتسريب خلال 1–3 ساعات، وبسرعة لا تزيد عن 3 mg/kg في الساعة."
      ],
      notes: ["لا يُعطى حقنًا مباشرًا (Bolus)، ولا مع منتجات الدم أو الشوارد المركّزة في الخط نفسه.", "الحذر في القصور الكلوي (eGFR أقل من 50) بسبب مادة الحاملة SBECD.", "يُستعمل المحلول المحضّر خلال 24 ساعة إن حُفظ في الثلاجة (2–8°م)."]
    }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const $ = (id) => document.getElementById(id);

  // ---- the drawings: every line is drawn in front of the user (stroke animation), then the labels fade in ----
  const P = (d, delay, cls) => '<path class="dr ' + (cls || "") + '" style="--d:' + delay + 's" pathLength="1" d="' + d + '"/>';
  const TX = (x, y, t, delay, cls) => '<text class="fade ' + (cls || "") + '" style="--d:' + delay + 's" x="' + x + '" y="' + y + '" text-anchor="middle">' + esc(t) + "</text>";
  const FILL = (d, delay, cls) => '<path class="fade ' + (cls || "") + '" style="--d:' + delay + 's" d="' + d + '"/>';
  const DOT = (x, y, r, delay, cls) => '<circle class="fade ' + (cls || "") + '" style="--d:' + delay + 's" cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
  const BEAKER = "M108 36 L108 128 Q108 140 120 140 L180 140 Q192 140 192 128 L192 36";
  const TICKS = (d0) => P("M108 60 L124 60", d0 + 0.2) + P("M108 80 L120 80", d0 + 0.3) + P("M108 100 L124 100", d0 + 0.4) + P("M108 120 L120 120", d0 + 0.5);
  const BAR = (d0) => P("M140 134 L160 134 Q165 134 165 130 Q165 126 160 126 L140 126 Q135 126 135 130 Q135 134 140 134Z", d0, "acc");
  const PLATE = (d0) => P("M92 144 L208 144 L208 158 Q208 162 204 162 L96 162 Q92 162 92 158Z", d0);
  const WATER = (top, d0) => FILL("M109 " + top + " L191 " + top + " L191 128 Q191 139 180 139 L120 139 Q109 139 109 128Z", d0, "water");
  const ART = {
    beaker: () => P(BEAKER, 0) + TICKS(0.4) + BAR(1.2) + TX(150, 176, "Calibrated beaker + magnetic bar", 1.8, "cap"),
    water: () => WATER(66, 1.4) + P(BEAKER, 0) + TICKS(0.3) + PLATE(0.8) + P("M128 80 Q150 70 172 80 Q150 92 130 100 Q150 112 170 112", 1.6, "acc") + BAR(1.3) +
      TX(246, 84, "90 mL", 2, "big") + TX(246, 100, "Sterile water", 2.1, "cap") +
      P("M62 50 A20 20 0 1 1 22 50 A20 20 0 1 1 62 50", 2.2, "bad") + P("M28 64 L56 36", 2.6, "bad") + P("M42 34 Q35 45 40 51 Q39 44 45 41 Q50 49 45 57 Q52 54 50 47 Q55 53 42 61 Q31 56 42 34Z", 2.4, "bad") +
      TX(42, 90, "No heat!", 3, "bad-t"),
    powder: () => WATER(84, 0.2) + P(BEAKER, 0) + TICKS(0.3) + BAR(0.9) +
      P("M112 8 L188 8 L176 28 Q150 38 124 28Z", 1.2) + DOT(150, 46, 3, 1.9, "pw") + DOT(143, 58, 3, 2.1, "pw") + DOT(157, 66, 3, 2.3, "pw") + DOT(148, 78, 3, 2.5, "pw") +
      TX(246, 44, "17 g", 2.6, "big") + TX(246, 60, "Disodium phosphate", 2.7, "cap"),
    acid: () => WATER(84, 0.2) + P(BEAKER, 0) + TICKS(0.3) + BAR(0.9) +
      P("M136 4 L164 4 L164 14 L170 20 L170 52 Q170 58 164 58 L136 58 Q130 58 130 52 L130 20 L136 14Z", 1.2) + FILL("M132 34 L168 34 L168 52 Q168 56 164 56 L136 56 Q132 56 132 52Z", 1.8, "acid") +
      DOT(150, 70, 3.5, 2.3, "drop") + DOT(150, 82, 3.5, 2.6, "drop") +
      TX(246, 44, "3.4 mL", 2.8, "big") + TX(246, 60, "Phosphoric acid 85%", 2.9, "cap"),
    clear: () => WATER(60, 0.2) + P(BEAKER, 0) + TICKS(0.3) + BAR(0.9) + P("M130 80 Q150 72 170 80 Q150 90 134 100", 1.3, "acc") +
      P("M212 40 L222 50 M224 36 L224 48 M236 44 L228 52", 1.8, "acc") + P("M218 78 L231 92 L255 62", 2.2, "ok") + TX(236, 116, "Clear", 2.8, "cap"),
    bottle: () => FILL("M120 70 L120 150 Q120 160 130 160 L170 160 Q180 160 180 150 L180 70 Q180 56 165 52 L165 36 L135 36 L135 52 Q120 56 120 70Z", 0.2, "dark") +
      P("M120 70 L120 150 Q120 160 130 160 L170 160 Q180 160 180 150 L180 70 Q180 56 165 52 L165 36 L135 36 L135 52 Q120 56 120 70Z", 0) +
      FILL("M131 86 L169 86 L169 132 L131 132Z", 1.2, "lbl") + P("M137 98 L163 98 M137 108 L163 108 M137 118 L154 118", 1.6, "lblline") +
      TX(246, 70, "7 days", 2.2, "big") + TX(246, 88, "Room temp", 2.3, "cap") + TX(246, 102, "Protect from light", 2.4, "cap") +
      TX(56, 100, "Dark", 2.0, "cap") + TX(56, 114, "container", 2.1, "cap")
  };
  function artSvg(name) {
    const f = ART[name];
    return '<svg class="sp-svg" viewBox="0 0 300 184" role="img" aria-hidden="true">' + (f ? f() : "") + "</svg>";
  }
  function stepperHtml(d) {
    const i = Math.min(stepIdx, d.stepper.length - 1), st = d.stepper[i], last = i === d.stepper.length - 1;
    return '<div class="sp-stepper">' +
      '<div class="sp-prog">' + d.stepper.map((x, k) => '<button type="button" class="sp-dot' + (k === i ? " is-on" : k < i ? " is-done" : "") + '" data-k="' + k + '" aria-label="الخطوة ' + (k + 1) + '"></button>').join("") + "</div>" +
      '<div class="sp-art">' + artSvg(st.art) + "</div>" +
      '<div class="sp-stext"><span class="sp-num">' + (i + 1) + " / " + d.stepper.length + "</span>" + esc(st.text) + "</div>" +
      '<div class="sp-nav"><button type="button" class="sp-prev"' + (i === 0 ? " disabled" : "") + '>السابق</button><button type="button" class="sp-next"' + (last ? " disabled" : "") + ">التالي</button></div></div>";
  }
  function stepsHtml(steps) {
    return '<ol class="sp-steps">' + steps.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol>";
  }
  function bodyHtml(d) {
    let h = "";
    if (d.missing) h += '<p class="sp-missing">' + esc(d.missing) + "</p>";
    if (d.stepper) h += stepperHtml(d);
    if (d.parts) d.parts.forEach((p) => { h += '<h4 class="sp-part">' + esc(p.title) + "</h4>" + (p.bullets ? '<ul class="sp-steps">' + p.steps.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : stepsHtml(p.steps)); });
    else if (d.steps && d.steps.length) h += stepsHtml(d.steps);
    if (d.notes && d.notes.length) h += '<ul class="sp-notes">' + d.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>";
    return h;
  }

  let openId = "", stepIdx = 0;
  function render() {
    const list = $("sp-list");
    if (!list) return;
    const q = (($("sp-search") && $("sp-search").value) || "").trim().toLowerCase();
    const rows = DRUGS.filter((d) => !q || (d.name + " " + d.sub).toLowerCase().indexOf(q) >= 0);
    list.innerHTML = rows.length ? rows.map((d) => {
      const on = openId === d.id;
      return '<div class="sp-card' + (on ? " is-open" : "") + '" data-id="' + esc(d.id) + '">' +
        '<button type="button" class="sp-head" aria-expanded="' + on + '"><span class="sp-title"><b dir="ltr">' + esc(d.name) + "</b><small>" + esc(d.sub) + '</small></span><span class="sp-chev">›</span></button>' +
        (on ? '<div class="sp-body">' + bodyHtml(d) + "</div>" : "") + "</div>";
    }).join("") : '<div class="sp-empty">لا يوجد دواء بهذا الاسم.</div>';
  }

  function open() {
    const A = global.PharmacyAuth;
    if (!(A && A.isSuperAdmin && A.isSuperAdmin())) return;      // hidden from everyone else for now
    openId = ""; stepIdx = 0;
    if ($("sp-search")) $("sp-search").value = "";
    render();
    global.PharmacyUI.showView("prep");
  }

  function init() {
    const note = $("sp-review"); if (note) note.textContent = REVIEW;
    const btn = $("settings-prep-btn"); if (btn) btn.addEventListener("click", open);
    const back = $("prep-back-btn"); if (back) back.addEventListener("click", () => global.PharmacyUI.showView("settings"));
    const s = $("sp-search"); if (s) s.addEventListener("input", render);
    const list = $("sp-list");
    if (list) list.addEventListener("click", (e) => {
      const card = e.target.closest(".sp-card"); if (!card) return;
      const d = DRUGS.find((x) => x.id === card.dataset.id), n = d && d.stepper ? d.stepper.length : 0;
      if (e.target.closest(".sp-next")) { stepIdx = Math.min(n - 1, stepIdx + 1); render(); return; }
      if (e.target.closest(".sp-prev")) { stepIdx = Math.max(0, stepIdx - 1); render(); return; }
      const dot = e.target.closest(".sp-dot"); if (dot) { stepIdx = +dot.dataset.k || 0; render(); return; }
      const h = e.target.closest(".sp-head"); if (!h) return;
      const id = card.dataset.id;
      openId = openId === id ? "" : id; stepIdx = 0;
      render();
    });
  }

  global.PharmacySpecialPrep = { open, DRUGS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
