/* drug-prep.js — «تحضير الأدوية الخاصة» (settings page; the super admin only for now).
   A button per medicine; a press shows its preparation as animated scenes, one per step, moved through with
   previous / next only (no auto-play — the user asked); the step text is typed in while the scene plays. The recipes
   are the ward's own (given by the user) — never add a recipe or an amount that the user did not give.
   prefers-reduced-motion: no animation, the text shown at once. */
(function (global) {
  "use strict";

  const TYPE_MS = 28;        // one letter of the step text
  const $ = (id) => document.getElementById(id);
  const reduced = () => !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------- drawing pieces (viewBox 300 × 200, shapes only — the only writing is the weight on the balance) ----------------
  const BEAKER = "M96 46 L102 50 L102 140 Q102 152 114 152 L186 152 Q198 152 198 140 L198 50 L204 46";
  const BEAKER_IN = "M103 30 L197 30 L197 140 Q197 151 186 151 L114 151 Q103 151 103 140Z";
  const JAR = "M138 96 L182 96 L182 104 Q194 109 194 121 L194 164 Q194 172 186 172 L134 172 Q126 172 126 164 L126 121 Q126 109 138 104Z";
  const JAR_IN = "M139 86 L181 86 L181 105 Q193 110 193 121 L193 164 Q193 171 186 171 L134 171 Q127 171 127 164 L127 121 Q127 110 139 105Z";
  // the same jar drawn with the right corner of its mouth at (0, 0), to be tilted around it when it pours
  const JAR_L = "M-44 0 L0 0 L0 8 Q12 13 12 25 L12 68 Q12 76 4 76 L-48 76 Q-56 76 -56 68 L-56 25 Q-56 13 -44 8Z";
  const JAR_L_IN = "M-43 -10 L-1 -10 L-1 9 Q11 14 11 25 L11 68 Q11 75 4 75 L-48 75 Q-55 75 -55 68 L-55 25 Q-55 14 -43 9Z";
  // a bottle drawn with its mouth at (0, 0) and the body below it — tilted around the mouth by the dp-tilt classes
  const BOTTLE = "M-7 0 L7 0 L7 10 L19 22 L19 58 Q19 64 13 64 L-13 64 Q-19 64 -19 58 L-19 22 L-7 10Z";
  const BOTTLE_IN = "M-6 1 L6 1 L6 10.5 L18 22.5 L18 58 Q18 63 13 63 L-13 63 Q-18 63 -18 58 L-18 22.5 L-6 10.5Z";

  const clip = (id, d) => '<clipPath id="' + id + '"><path d="' + d + '"/></clipPath>';
  const liquid = (clipId, top, cls, bottom) => '<g clip-path="url(#' + clipId + ')"><rect class="' + cls + '" x="96" y="' + top + '" width="116" height="' + ((bottom || 156) - top) + '"/></g>';
  const beaker = () => '<path class="ln" d="' + BEAKER + '"/><path class="ln thin" d="M102 70 L122 70 M102 90 L114 90 M102 110 L122 110 M102 130 L114 130"/><path class="shine" d="M111 62 L111 126"/>';
  const bar = () => '<rect class="bar dp-spin" x="134" y="140" width="32" height="8" rx="4"/>';
  const plate = () => '<path class="plate" d="M72 154 L228 154 L228 180 Q228 186 222 186 L78 186 Q72 186 72 180Z"/><circle class="knob" cx="205" cy="170" r="7"/><circle class="led dp-blink" cx="92" cy="170" r="3.5"/>';
  const swirl = (top) => '<g clip-path="url(#dpIn)"><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 26) + '" rx="32" ry="6"/><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 52) + '" rx="22" ry="5"/></g>';
  const noHeat = () => '<g class="dp-popin"><circle class="bad" cx="252" cy="46" r="22"/><path class="badfill" d="M252 30 Q243 42 248 49 Q247 42 253 39 Q259 47 254 55 Q262 51 260 44 Q265 52 251 60 Q237 54 252 30Z"/><path class="bad" d="M236 62 L268 30"/></g>';
  const tilting = (x, y, cls, fillCls, flip, k) => '<g transform="translate(' + x + " " + y + ") scale(" + (flip ? -(k || 1) : (k || 1)) + " " + (k || 1) + ')"><g class="' + cls + '">' +
    '<g clip-path="url(#dpBtl)"><rect class="' + fillCls + '" x="-20" y="0" width="40" height="64"/></g><path class="ln glass" d="' + BOTTLE + '"/></g></g>';
  const stream = (d, cls) => '<path class="stream ' + (cls || "dp-stream") + '" d="' + d + '"/>';
  const sparkle = (x, y, delay) => '<path class="spark dp-pop" style="--d:' + delay + 's" d="M' + x + " " + (y - 9) + " L" + x + " " + (y + 9) + " M" + (x - 9) + " " + y + " L" + (x + 9) + " " + y + '"/>';
  const dots = (pts, cls) => pts.map((p) => '<circle class="' + cls + '" style="--d:' + p[2] + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[3] || 3.2) + '"/>').join("");
  const capsule = (x, y, cls) => '<g transform="translate(' + x + " " + y + ')"' + (cls ? ' class="' + cls + '"' : "") + '><path class="capA" d="M0 -6 L-10 -6 Q-16 -6 -16 0 Q-16 6 -10 6 L0 6Z"/><path class="capB" d="M0 -6 L10 -6 Q16 -6 16 0 Q16 6 10 6 L0 6Z"/></g>';
  const label = (x, y, w, h) => '<g class="dp-slide"><rect class="lbl" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3"/><path class="lblline" d="M' + (x + 7) + " " + (y + 10) + " L" + (x + w - 7) + " " + (y + 10) + " M" + (x + 7) + " " + (y + 19) + " L" + (x + w - 7) + " " + (y + 19) + " M" + (x + 7) + " " + (y + 28) + " L" + (x + w - 17) + " " + (y + 28) + '"/></g>';
  // the electronic balance (weighing steps): the screen counts up to the weight while the pan is loaded
  const balance = (readings) => '<path class="scaleb" d="M88 156 L212 156 L216 186 Q216 192 210 192 L90 192 Q84 192 84 186Z"/>' +
    '<path class="scalep" d="M144 148 L156 148 L156 156 L144 156Z M100 140 L200 140 L196 148 L104 148Z"/><rect class="lcd" x="122" y="164" width="56" height="19" rx="3"/>' +
    readings.map((r, k) => '<text class="lcdt ' + (k === readings.length - 1 ? "dp-lcdlast" : "dp-lcdstep") + '" style="--d:' + (k * 0.6) + 's" x="150" y="177.5" text-anchor="middle" direction="ltr">' + r + " g</text>").join("");
  // the dropper: rubber bulb + glass tube with the clear acid; dy moves it down
  const dropper = (dy, dripCls) => '<g transform="translate(0 ' + dy + ')"><path class="acid" d="M144 38 L156 38 L156 56 L151.5 68 L148.5 68 L144 56Z"/><path class="ln glass" d="M143 26 L157 26 L157 56 L152 70 L148 70 L143 56Z"/>' +
    '<path class="rubber dp-squeeze" d="M141 27 L141 14 Q141 0 150 0 Q159 0 159 14 L159 27Z"/>' +
    '<path class="drop ' + dripCls + '" style="--d:0s" d="M150 72 Q145 80 150 84 Q155 80 150 72Z"/><path class="drop ' + dripCls + '" style="--d:.8s" d="M150 72 Q145 80 150 84 Q155 80 150 72Z"/></g>';
  const SPOON = '<g class="dp-tip"><path class="powder" d="M-30 0 Q-30 18 0 18 Q30 18 30 0Z"/><path class="ln" d="M-30 0 Q-30 18 0 18 Q30 18 30 0 M28 2 L60 -8"/></g>';
  const arrowDown = (x, y1, y2) => '<path class="acc dp-bob" d="M' + x + " " + y1 + " L" + x + " " + y2 + " M" + (x - 10) + " " + (y2 - 11) + " L" + x + " " + (y2 + 1) + " L" + (x + 10) + " " + (y2 - 11) + '"/>';

  const SCENES = {
    // ---- Joulie's oral solution ----
    jBar: () => clip("dpIn", BEAKER_IN) + beaker() + '<g class="dp-dropin"><rect class="bar" x="134" y="140" width="32" height="8" rx="4"/></g>' + arrowDown(150, 8, 34),
    jWater: () => clip("dpIn", BEAKER_IN) + clip("dpBtl", BOTTLE_IN) + plate() + liquid("dpIn", 70, "water dp-rise") + swirl(70) + beaker() + bar() +
      tilting(90, 30, "dp-tilt", "water dp-drainB") + stream("M90 32 Q104 40 118 92") + noHeat(),
    jWeighP: () => balance(["0.0", "4.3", "8.5", "12.8", "17.0"]) + '<path class="boat" d="M112 140 L188 140 L180 128 L120 128Z"/><path class="powder dp-grow" d="M124 129 Q150 98 176 129Z"/>' +
      '<g transform="translate(150 44)">' + SPOON + "</g>" + dots([[132, 90, 0], [140, 92, 0.3], [128, 94, 0.6], [146, 94, 0.9]], "pw dp-fall3"),
    jWeighA: () => balance(["0.0", "1.4", "2.9", "4.3", "5.7"]) + clip("dpSb", "M129 100 L171 100 L171 136 Q171 139 168 139 L132 139 Q129 139 129 136Z") +
      '<g clip-path="url(#dpSb)"><rect class="acid dp-grow" x="126" y="112" width="48" height="30"/></g><path class="ln thin" d="M128 100 L128 136 Q128 140 132 140 L168 140 Q172 140 172 136 L172 100"/>' + dropper(18, "dp-drip2"),
    jPowder: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 76, "water") + liquid("dpIn", 76, "cloud dp-cloudin") + swirl(76) + beaker() + bar() +
      '<g transform="translate(150 2)">' + SPOON + "</g>" +
      dots([[140, 46, 0], [148, 48, 0.35], [136, 50, 0.7], [152, 50, 1.05], [144, 46, 1.4], [132, 48, 1.75]], "pw dp-fall"),
    jAcid: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 76, "water") + liquid("dpIn", 76, "cloud") + swirl(76) + beaker() + bar() +
      // the small beaker it was weighed in is poured into the graduated beaker (and empties)
      '<g transform="translate(128 40) scale(.85)"><g class="dp-tiltS"><rect class="acid dp-drain" x="-40" y="2" width="38" height="36"/><path class="ln glass" d="M2 -2 L0 0 L0 36 Q0 40 -4 40 L-38 40 Q-42 40 -42 36 L-42 0 L-44 -2"/></g></g>' +
      stream("M128 42 Q132 58 134 80", "dp-stream acidst"),
    jClear: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 70, "water") + liquid("dpIn", 70, "cloud dp-clearing") + swirl(70) + beaker() + bar() +
      sparkle(80, 70, 2.4) + sparkle(220, 96, 2.7) + sparkle(74, 116, 3.0) +
      '<circle class="ok dp-popin2" cx="246" cy="44" r="22"/><path class="ok dp-check" pathLength="1" d="M235 45 L243 54 L259 34"/>',
    jBottle: () => clip("dpAm", "M186 140 L186 184 Q186 191 193 191 L237 191 Q244 191 244 184 L244 140 Q244 129 232 127 L232 118 L198 118 L198 127 Q186 129 186 140Z") +
      '<path class="amber" d="M185 140 L185 184 Q185 192 193 192 L237 192 Q245 192 245 184 L245 140 Q245 128 232 126 L232 116 L198 116 L198 126 Q185 128 185 140Z"/>' +
      '<g clip-path="url(#dpAm)"><rect class="ambfill dp-rise" x="180" y="128" width="70" height="66"/></g>' +
      '<path class="ln" d="M190 86 L240 86 L224 114 L206 114Z"/>' +
      '<g transform="translate(196 70)"><g class="dp-tiltB"><rect class="water dp-drain" x="-48" y="2" width="46" height="58"/><path class="ln glass" d="M2 -2 L0 0 L0 54 Q0 62 -8 62 L-42 62 Q-50 62 -50 54 L-50 0 L-52 -2"/></g></g>' +
      stream("M196 72 Q208 86 214 112") + label(193, 146, 44, 36),

    // ---- Magic solution ----
    mMix: () => clip("dpJ", JAR_IN) + clip("dpBtl", BOTTLE_IN) + liquid("dpJ", 150, "dexa dp-mRiseL", 176) + liquid("dpJ", 128, "dph dp-mRiseR", 150) +
      stream("M146 78 Q150 104 152 150", "dp-mStrL st-dexa") + stream("M174 78 Q170 100 168 128", "dp-mStrR st-dph") + '<path class="ln glass" d="' + JAR + '"/>' +
      tilting(146, 76, "dp-mBotL", "dexa dp-mDrL", false, .85) + tilting(174, 76, "dp-mBotR", "dph dp-mDrR", true, .85),
    mNys: () => clip("dpJ", JAR_IN) + clip("dpBtl", BOTTLE_IN) + liquid("dpJ", 128, "mix", 176) + liquid("dpJ", 110, "nys dp-mRiseL", 128) +
      stream("M146 78 Q150 96 152 128", "dp-mStrL st-nys") + stream("M174 78 Q170 96 168 128", "dp-mStrL st-nys") + '<path class="ln glass" d="' + JAR + '"/>' +
      tilting(146, 76, "dp-mBotL", "nys dp-mDrL", false, .85) + tilting(174, 76, "dp-mBotL", "nys dp-mDrL", true, .85),
    mCaps: () => clip("dpJ", JAR_IN) + liquid("dpJ", 110, "magic", 176) + '<path class="ln glass" d="' + JAR + '"/>' +
      [284, 242, 200, 120, 78, 36].map((x, k) => '<g style="--c:' + (k * 0.85) + 's">' +
        '<g transform="translate(' + x + ' 22)"><g class="dp-capGo" style="--dx:' + (160 - x) + 'px">' +
        '<path class="capA dp-capA" d="M0 -6 L-10 -6 Q-16 -6 -16 0 Q-16 6 -10 6 L0 6Z"/><path class="capB dp-capB" d="M0 -6 L10 -6 Q16 -6 16 0 Q16 6 10 6 L0 6Z"/></g></g>' +
        dots([[157, 60, 0, 2.6], [163, 60, 0.12, 2.6], [160, 62, 0.24, 2.6]], "tetra dp-capDust") + "</g>").join(""),
    // the mixing jar fills the first new bottle, moves over the second one and fills it too, and ends empty
    mFill: () => clip("dpB1", "M206 132 L206 178 Q206 183 211 183 L235 183 Q240 183 240 178 L240 132 Q240 126 232 125 L232 118 L214 118 L214 125 Q206 126 206 132Z") +
      clip("dpB2n", "M256 132 L256 178 Q256 183 261 183 L285 183 Q290 183 290 178 L290 132 Q290 126 282 125 L282 118 L264 118 L264 125 Q256 126 256 132Z") + clip("dpJL", JAR_L_IN) +
      '<g clip-path="url(#dpB1)"><rect class="magic dp-fRise1" x="203" y="132" width="40" height="54"/></g>' +
      '<g clip-path="url(#dpB2n)"><rect class="magic dp-fRise2" x="253" y="132" width="40" height="54"/></g>' +
      '<path class="ln glass" d="M205 132 L205 178 Q205 184 211 184 L235 184 Q241 184 241 178 L241 132 Q241 125 233 124 L233 116 L213 116 L213 124 Q205 125 205 132Z"/>' +
      '<path class="ln glass" d="M255 132 L255 178 Q255 184 261 184 L285 184 Q291 184 291 178 L291 132 Q291 125 283 124 L283 116 L263 116 L263 124 Q255 125 255 132Z"/>' +
      stream("M200 98 Q212 104 223 128", "dp-fStr1 st-magic") + stream("M250 98 Q262 104 273 128", "dp-fStr2 st-magic") +
      '<g transform="translate(200 96)"><g class="dp-fMove"><g transform="scale(.8)"><g class="dp-fJar"><g clip-path="url(#dpJL)"><rect class="magic dp-fDr" x="-58" y="14" width="72" height="64"/></g><path class="ln glass" d="' + JAR_L + '"/></g></g></g></g>',
    mLabel: () => '<g class="dp-shake">' + clip("dpB2", "M121 82 L121 168 Q121 175 128 175 L172 175 Q179 175 179 168 L179 82 Q179 72 166 70 L166 58 L134 58 L134 70 Q121 72 121 82Z") +
      '<g clip-path="url(#dpB2)"><rect class="magic" x="116" y="84" width="70" height="96"/>' + dots([[134, 168, 0], [146, 170, .2], [158, 167, .4], [168, 170, .6], [140, 163, .3], [162, 162, .5]], "sed dp-float") + "</g>" +
      '<rect class="cap" x="132" y="46" width="36" height="13" rx="3"/>' +
      '<path class="ln glass" d="M120 82 L120 168 Q120 176 128 176 L172 176 Q180 176 180 168 L180 82 Q180 71 166 69 L166 58 L134 58 L134 69 Q120 71 120 82Z"/>' +
      label(126, 96, 48, 38) + "</g>" +
      '<path class="acc dp-waveL" d="M96 92 Q86 112 96 132"/><path class="acc dp-waveR" d="M204 92 Q214 112 204 132"/>'
  };
  function scene(name) {
    const f = SCENES[name];
    return '<svg class="dp-svg" viewBox="0 0 300 200" role="img" aria-hidden="true">' + (f ? f() : "") + "</svg>";
  }

  // ---------------- the recipes (the ward's own, as given by the user) ----------------
  const DRUGS = [
    {
      id: "joulie", name: "Joulie's oral solution", ar: "محلول جولي الفموي — تحضير 100 mL", tone: "blue",
      steps: [
        { scene: "jBar", text: "ضع قضيب التحريك المغناطيسي في الكأس المدرّج." },
        { scene: "jWater", text: "أضف 90 مل من الماء المعقّم للحقن، ثم ضع الكأس على جهاز الخلط وشغّل التدوير المغناطيسي لتتكوّن دوّامة مائية داخل الكأس، ولا تستخدم الحرارة." },
        { scene: "jWeighP", text: "زِن 17 غرامًا من مسحوق الدايهايدروس دايصوديوم فوسفيت باستخدام الميزان." },
        { scene: "jPowder", text: "أضف الـ 17 غرامًا من المسحوق تدريجيًا إلى الكأس." },
        { scene: "jWeighA", text: "زِن 5.7 غرامًا (3.4 مل) من محلول حمض الفسفوريك باستخدام الميزان والقطّارة." },
        { scene: "jAcid", text: "اسكب الـ 3.4 مل من محلول حمض الفسفوريك من الكأس الصغير الذي وُزن فيه إلى الكأس المدرّج." },
        { scene: "jClear", text: "اترك الخليط ليتجانس ويذوب بشكل كامل حتى ترى محلولًا صافيًا بدون رواسب." },
        { scene: "jBottle", text: "عبّئ المحلول المتجانس في قارورات زجاجية داكنة لحفظه من الضوء." }
      ],
      info: [
        { title: "المكونات", items: ["الماء المعقّم للحقن (Sterile water for injection): 90 مل", "مسحوق الدايهايدروس دايصوديوم فوسفيت (Dihydrous Disodium phosphate): 17 غرامًا", "محلول حمض الفسفوريك 85% (Phosphoric acid): 3.4 مل = 5.7 غرامًا"] },
        { title: "الثبات والحفظ", items: ["مدة الثبات: 7 أيام.", "الحفظ: في درجة حرارة الغرفة، وبعيدًا عن الضوء."] }
      ]
    },
    {
      id: "magic", name: "Magic solution", ar: "المحلول السحري", tone: "pink",
      steps: [
        { scene: "mMix", text: "اخلط زجاجة الدكسون (Dexamethasone) وزجاجة الارمين (Diphenhydramine) معًا." },
        { scene: "mNys", text: "أضف إليهما زجاجتي النيستاتين (Nystatin)." },
        { scene: "mCaps", text: "افتح كبسولات التتراسيكلين (Tetracycline) الستة وأضف محتواها إلى الخليط." },
        { scene: "mFill", text: "عبّئ الخليط في زجاجات جديدة." },
        { scene: "mLabel", text: "اكتب على الزجاجة المحضّرة: اسم المريض، وتاريخ التحضير، وتاريخ الإتلاف، وعبارة «رجّ جيدًا قبل الاستعمال» لأن المواد الفعالة ترسب في قعر الزجاجة." }
      ],
      info: [
        { title: "المكونات", items: ["Dexamethasone (الدكسون): زجاجة كاملة", "Diphenhydramine (الارمين): زجاجة كاملة", "Nystatin (محلول نيستاتين): زجاجتان كاملتان", "Tetracycline (تيتراسيكلين): 6 كبسولات"] },
        { title: "طريقة الاستخدام", items: ["ثقّف المريض بأن يتغرغر بالمحلول ثم يبلعه.", "أربع مرات في اليوم."] }
      ]
    }
  ];

  const TILE_ICON = {
    blue: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 8h24M14 8v30a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4V8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M15 24h18v14a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#3d9bd6" opacity=".75"/></svg>',
    pink: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M19 5h10v7l6 6v22a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V18l6-6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14.5 26h19v14a2.5 2.5 0 0 1-2.5 2.5H17a2.5 2.5 0 0 1-2.5-2.5z" fill="#e07aa8" opacity=".8"/></svg>'
  };

  // ---------------- player ----------------
  let cur = null, idx = 0, typeTimer = 0;

  function typeText(text) {
    clearInterval(typeTimer);
    const el = $("dp-step"), chars = Array.from(text);
    if (reduced()) { el.textContent = text; return; }
    el.innerHTML = '<span class="dp-typed"></span><span class="dp-ghost" aria-hidden="true"></span>';
    const typed = el.firstChild, ghost = el.lastChild;
    let n = 0;
    const draw = () => { typed.textContent = chars.slice(0, n).join(""); ghost.textContent = chars.slice(n).join(""); };
    draw();
    typeTimer = setInterval(() => { n++; draw(); if (n >= chars.length) clearInterval(typeTimer); }, TYPE_MS);
  }

  function renderMenu() {
    const grid = $("dp-grid");
    if (!grid) return;
    grid.innerHTML = "";
    DRUGS.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "dp-tile dp-" + d.tone; b.dataset.id = d.id;
      b.innerHTML = '<span class="dp-ticon">' + TILE_ICON[d.tone] + '</span><span class="dp-tname"><b dir="ltr"></b><small></small><span class="dp-tcount"></span></span>';
      b.querySelector("b").textContent = d.name;
      b.querySelector("small").textContent = d.ar;
      b.querySelector(".dp-tcount").textContent = d.steps.length + " خطوات";
      grid.appendChild(b);
    });
  }

  function renderStep() {
    const n = cur.steps.length, st = cur.steps[idx];
    $("dp-art").innerHTML = scene(st.scene);           // a fresh SVG restarts every animation
    $("dp-num").textContent = (idx + 1) + " / " + n;
    $("dp-text").setAttribute("aria-label", st.text);
    typeText(st.text);
    const segs = $("dp-segs");
    segs.innerHTML = cur.steps.map((x, k) => '<button type="button" class="dp-seg' + (k < idx ? " is-done" : k === idx ? " is-on" : "") + '" data-k="' + k + '" aria-label="الخطوة ' + (k + 1) + '"><i></i></button>').join("");
    $("dp-prev").disabled = idx === 0;
    $("dp-next").disabled = idx === n - 1;
  }

  function renderInfo() {
    const box = $("dp-info");
    box.innerHTML = "";
    cur.info.forEach((p) => {
      const card = document.createElement("div");
      card.className = "dp-icard";
      const h = document.createElement("h4"); h.textContent = p.title; card.appendChild(h);
      const ul = document.createElement("ul");
      p.items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      card.appendChild(ul);
      box.appendChild(card);
    });
  }

  function play(id) {
    cur = DRUGS.find((d) => d.id === id);
    if (!cur) return;
    $("dp-name").textContent = cur.name;
    $("dp-ar").textContent = cur.ar;
    $("dp-menu").hidden = true;
    $("dp-player").hidden = false;
    idx = 0;
    renderInfo(); renderStep();
    global.PharmacyUI.setScrollY && global.PharmacyUI.setScrollY(0);
  }

  function toMenu() {
    clearInterval(typeTimer); cur = null;
    $("dp-player").hidden = true;
    $("dp-menu").hidden = false;
    $("dp-art").innerHTML = "";
  }

  function open() {
    const A = global.PharmacyAuth;
    if (!(A && A.isSuperAdmin && A.isSuperAdmin())) return;      // hidden from everyone else for now
    renderMenu(); toMenu();
    global.PharmacyUI.showView("prep");
  }

  function init() {
    const btn = $("settings-prep-btn"); if (btn) btn.addEventListener("click", open);
    const back = $("prep-back-btn");
    if (back) back.addEventListener("click", () => {
      if (cur) toMenu(); else global.PharmacyUI.showView("settings");
    });
    const grid = $("dp-grid");
    if (grid) grid.addEventListener("click", (e) => { const t = e.target.closest(".dp-tile"); if (t) play(t.dataset.id); });
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
    on("dp-prev", () => { if (cur && idx > 0) { idx--; renderStep(); } });
    on("dp-next", () => { if (cur && idx < cur.steps.length - 1) { idx++; renderStep(); } });
    on("dp-segs", (e) => { const s = e.target.closest(".dp-seg"); if (s && cur) { idx = +s.dataset.k || 0; renderStep(); } });
  }

  global.PharmacyDrugPrep = { open, DRUGS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
