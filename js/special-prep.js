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
      id: "joulie", name: "Joulie's solution", sub: "محلول جولي (الفوسفات)",
      steps: [],
      missing: "لم أكتب خطواته: تركيب محلول جولي يختلف بين المستشفيات، ولا أريد أن أضع أرقامًا غير مؤكدة. أرسل لي التركيب والخطوات المعتمدة عندكم لأضيفها."
    },
    {
      id: "magic", name: "Magic solution", sub: "غسول الفم السحري (Magic mouthwash)",
      steps: [
        "جهّز كميات متساوية من المكوّنات الثلاثة: Diphenhydramine syrup، وViscous Lidocaine 2%، ومضاد الحموضة (Maalox أو ما يماثله).",
        "إذا طُلب مضاد فطري، أضف Nystatin suspension بالكمية نفسها.",
        "اخلط المكوّنات في عبوة نظيفة وارجّها جيدًا حتى تتجانس.",
        "اكتب على العبوة: اسم المريض، والتركيب، وتاريخ التحضير، وعبارة «ارجّ قبل الاستعمال».",
        "طريقة الاستعمال المعتادة: مضمضة بنحو 5–10 mL ثم يُبصق، ولا يُبتلع."
      ],
      notes: ["التركيب يختلف بين المستشفيات والأطباء: اعتمد وصفة الطبيب أو بروتوكولكم."]
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

  function stepsHtml(steps) {
    return '<ol class="sp-steps">' + steps.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol>";
  }
  function bodyHtml(d) {
    let h = "";
    if (d.missing) h += '<p class="sp-missing">' + esc(d.missing) + "</p>";
    if (d.parts) d.parts.forEach((p) => { h += '<h4 class="sp-part">' + esc(p.title) + "</h4>" + stepsHtml(p.steps); });
    else if (d.steps && d.steps.length) h += stepsHtml(d.steps);
    if (d.notes && d.notes.length) h += '<ul class="sp-notes">' + d.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>";
    return h;
  }

  let openId = "";
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
    openId = "";
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
      const h = e.target.closest(".sp-head"); if (!h) return;
      const id = h.closest(".sp-card").dataset.id;
      openId = openId === id ? "" : id;
      render();
    });
  }

  global.PharmacySpecialPrep = { open, DRUGS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
