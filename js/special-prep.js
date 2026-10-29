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
  // No writing inside the drawings: only shapes. Glass = outline, liquids / powder / bottles = colour.
  const G = (d, delay, cls) => '<path class="fade ' + (cls || "") + '" style="--d:' + delay + 's" d="' + d + '"/>';
  const BEAKER = "M96 46 L102 50 L102 140 Q102 152 114 152 L186 152 Q198 152 198 140 L198 50 L204 46";
  const TICKS = (d0) => P("M102 70 L124 70", d0) + P("M102 90 L114 90", d0 + 0.1) + P("M102 110 L124 110", d0 + 0.2) + P("M102 130 L114 130", d0 + 0.3);
  const SHINE = (d0) => P("M111 62 L111 126", d0, "hl");
  const LIQ = (top, d0, dip) => G(dip
    ? "M103 " + top + " L128 " + top + " Q150 " + (top + 30) + " 172 " + top + " L197 " + top + " L197 140 Q197 151 186 151 L114 151 Q103 151 103 140Z"
    : "M103 " + top + " L197 " + top + " L197 140 Q197 151 186 151 L114 151 Q103 151 103 140Z", d0, "water");
  const BAR = (d0) => '<g class="fade" style="--d:' + d0 + 's"><path class="barb" d="M134 148 L166 148 Q172 148 172 144 Q172 140 166 140 L134 140 Q128 140 128 144 Q128 148 134 148Z"/></g>';
  const PLATE = (d0) => G("M72 154 L228 154 L228 180 Q228 186 222 186 L78 186 Q72 186 72 180Z", d0, "plate") + DOTC(205, 170, 7, d0 + 0.3, "knob") + DOTC(92, 170, 3.5, d0 + 0.4, "led");
  const DOTC = (x, y, r, delay, cls) => '<circle class="fade ' + (cls || "") + '" style="--d:' + delay + 's" cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
  const SPARK = (x, y, d0) => P("M" + x + " " + (y - 9) + " L" + x + " " + (y + 9) + " M" + (x - 9) + " " + y + " L" + (x + 9) + " " + y, d0, "acc thin");
  const ART = {
    // 1) the stirring bar goes into an empty graduated beaker
    beaker: () => P(BEAKER, 0) + TICKS(0.5) + SHINE(1.0) + BAR(1.3) +
      P("M150 8 L150 34 M139 24 L150 36 L161 24", 1.7, "acc"),
    // 2) sterile water poured in, the beaker stands on the stirrer plate (switched on, NO heat)
    water: () => PLATE(0) + LIQ(70, 1.2, true) + P(BEAKER, 0.4) + TICKS(0.8) + SHINE(1.4) + BAR(1.3) +
      '<g transform="translate(86 26) rotate(125)">' + P("M-9 0 L9 0 L9 12 L22 26 L22 62 Q22 70 14 70 L-14 70 Q-22 70 -22 62 L-22 26 L-9 12Z", 1.6) +
      G("M-20 36 L20 36 L20 62 Q20 68 14 68 L-14 68 Q-20 68 -20 62Z", 2.0, "water") + "</g>" +
      P("M97 40 Q112 46 122 66", 2.4, "stream") +
      P("M118 124 Q150 108 182 124 M174 114 L184 125 L170 128", 2.7, "acc") +
      P("M268 50 A22 22 0 1 1 224 50 A22 22 0 1 1 268 50", 3.0, "bad") + P("M230 66 L262 34", 3.3, "bad") +
      P("M246 34 Q238 46 243 52 Q242 45 248 42 Q254 50 249 58 Q257 54 255 47 Q260 55 246 63 Q232 57 246 34Z", 3.1, "bad"),
    // 3) the white powder is added gradually while it stirs
    powder: () => PLATE(0) + LIQ(86, 0.6, true) + P(BEAKER, 0.2) + TICKS(0.6) + SHINE(1.0) + BAR(0.9) +
      '<g transform="translate(150 24) rotate(-28)">' + G("M-30 0 Q-30 18 0 18 Q30 18 30 0Z", 1.3, "powderfill") + P("M-30 0 Q-30 18 0 18 Q30 18 30 0", 1.2) + P("M28 2 L76 -14", 1.5) + "</g>" +
      DOTC(132, 54, 3.4, 2.0, "pw") + DOTC(140, 64, 3.4, 2.2, "pw") + DOTC(129, 72, 3.4, 2.4, "pw") + DOTC(146, 76, 3.4, 2.6, "pw") + DOTC(136, 82, 3, 2.8, "pw") +
      P("M118 128 Q150 112 182 128 M174 118 L184 129 L170 132", 2.9, "acc"),
    // 4) the acid, measured in a syringe, drops in
    acid: () => PLATE(0) + LIQ(86, 0.6, true) + P(BEAKER, 0.2) + TICKS(0.6) + SHINE(1.0) + BAR(0.9) +
      G("M141 26 L159 26 L159 56 L141 56Z", 1.6, "acid") +
      P("M140 8 L160 8 L160 56 L156 56 L156 66 L144 66 L144 56 L140 56Z", 1.2) + P("M133 8 L167 8", 1.4) + P("M140 2 L160 2 M150 2 L150 22", 1.5) + G("M141 20 L159 20 L159 27 L141 27Z", 1.7, "rubber") +
      P("M160 32 L167 32 M160 40 L167 40 M160 48 L167 48", 1.9, "thin") +
      '<path class="fade drop" style="--d:2.4s" d="M150 70 Q145 78 150 82 Q155 78 150 70Z"/><path class="fade drop" style="--d:2.7s" d="M150 76 Q146 82 150 86 Q154 82 150 76Z" transform="translate(0 6)"/>',
    // 5) stir until completely clear
    clear: () => PLATE(0) + LIQ(66, 0.6, true) + P(BEAKER, 0.2) + TICKS(0.6) + SHINE(1.0) + BAR(0.9) +
      P("M118 124 Q150 108 182 124 M174 114 L184 125 L170 128", 1.4, "acc") +
      SPARK(84, 70, 1.8) + SPARK(216, 90, 2.0) + SPARK(76, 112, 2.2) + SPARK(226, 50, 2.4) +
      P("M262 40 A22 22 0 1 1 218 40 A22 22 0 1 1 262 40", 2.6, "ok") + P("M228 41 L236 50 L252 31", 3.0, "ok"),
    // 6) poured through a funnel into a dark (amber) bottle, then labelled
    bottle: () => G("M185 140 L185 184 Q185 192 193 192 L237 192 Q245 192 245 184 L245 140 Q245 128 232 126 L232 116 L198 116 L198 126 Q185 128 185 140Z", 0.2, "amber") +
      P("M185 140 L185 184 Q185 192 193 192 L237 192 Q245 192 245 184 L245 140 Q245 128 232 126 L232 116 L198 116 L198 126 Q185 128 185 140Z", 0) +
      P("M190 84 L240 84 L224 114 L206 114Z", 0.8) +
      '<g transform="translate(192 74) rotate(55) scale(0.6) translate(-198 -46)">' + LIQ(70, 1.4, false) + P(BEAKER, 1.0) + TICKS(1.3) + "</g>" +
      P("M193 77 Q206 88 212 112", 2.2, "stream") +
      G("M193 146 L237 146 L237 182 L193 182Z", 2.8, "lbl") + P("M200 156 L230 156 M200 165 L230 165 M200 174 L220 174", 3.1, "lblline")
  };
  function artSvg(name) {
    const f = ART[name];
    return '<svg class="sp-svg" viewBox="0 0 300 200" role="img" aria-hidden="true">' + (f ? f() : "") + "</svg>";
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
