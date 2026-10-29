/* drug-prep.js — «تحضير الأدوية الخاصة» (settings page; the super admin only for now).
   A button per medicine; a press plays its preparation as animated scenes, one per step (auto-advance,
   pause / previous / next); the step text is typed in while the scene plays. The recipes are the ward's own (given by the user) — never add a recipe or an
   amount that the user did not give. prefers-reduced-motion: no animation and no auto-advance. */
(function (global) {
  "use strict";

  const STEP_MS = 6500;      // the shortest step
  const TYPE_MS = 45;        // one letter of the step text
  const READ_MS = 3500;      // time left to read once the text is typed
  const stepMs = (st) => Math.max(STEP_MS, Array.from(st.text).length * TYPE_MS + READ_MS);
  const $ = (id) => document.getElementById(id);
  const reduced = () => !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------- drawing pieces (viewBox 300 × 200, shapes only — no writing inside the drawings) ----------------
  const BEAKER = "M96 46 L102 50 L102 140 Q102 152 114 152 L186 152 Q198 152 198 140 L198 50 L204 46";
  const BEAKER_IN = "M103 30 L197 30 L197 140 Q197 151 186 151 L114 151 Q103 151 103 140Z";
  const JAR = "M130 70 L190 70 L190 80 Q206 86 206 102 L206 162 Q206 172 196 172 L124 172 Q114 172 114 162 L114 102 Q114 86 130 80Z";
  const JAR_IN = "M131 60 L189 60 L189 81 Q205 87 205 102 L205 162 Q205 171 196 171 L124 171 Q115 171 115 162 L115 102 Q115 87 131 81Z";
  // a bottle drawn with its mouth at (0, 0) and the body below it — tilted around the mouth by the dp-tilt classes
  const BOTTLE = "M-7 0 L7 0 L7 10 L19 22 L19 58 Q19 64 13 64 L-13 64 Q-19 64 -19 58 L-19 22 L-7 10Z";
  const BOTTLE_FILL = "M-6 4 L6 4 L6 10 L18 22 L18 36 L-18 36 L-18 22 L-6 10Z";   // the liquid sits at the mouth when poured

  const clip = (id, d) => '<clipPath id="' + id + '"><path d="' + d + '"/></clipPath>';
  const liquid = (clipId, top, cls, bottom) => '<g clip-path="url(#' + clipId + ')"><rect class="' + cls + '" x="96" y="' + top + '" width="116" height="' + ((bottom || 156) - top) + '"/></g>';
  const beaker = () => '<path class="ln" d="' + BEAKER + '"/><path class="ln thin" d="M102 70 L122 70 M102 90 L114 90 M102 110 L122 110 M102 130 L114 130"/><path class="shine" d="M111 62 L111 126"/>';
  const bar = () => '<rect class="bar dp-spin" x="134" y="140" width="32" height="8" rx="4"/>';
  const plate = () => '<path class="plate" d="M72 154 L228 154 L228 180 Q228 186 222 186 L78 186 Q72 186 72 180Z"/><circle class="knob" cx="205" cy="170" r="7"/><circle class="led dp-blink" cx="92" cy="170" r="3.5"/>';
  const swirl = (top) => '<g clip-path="url(#dpIn)"><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 26) + '" rx="32" ry="6"/><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 52) + '" rx="22" ry="5"/></g>';
  const noHeat = () => '<g class="dp-popin"><circle class="bad" cx="252" cy="46" r="22"/><path class="badfill" d="M252 30 Q243 42 248 49 Q247 42 253 39 Q259 47 254 55 Q262 51 260 44 Q265 52 251 60 Q237 54 252 30Z"/><path class="bad" d="M236 62 L268 30"/></g>';
  const tilting = (x, y, cls, fillCls, flip) => '<g transform="translate(' + x + " " + y + ")" + (flip ? " scale(-1 1)" : "") + '"><g class="' + cls + '"><path class="' + fillCls + '" d="' + BOTTLE_FILL + '"/><path class="ln glass" d="' + BOTTLE + '"/></g></g>';
  const stream = (d, cls) => '<path class="stream ' + (cls || "dp-stream") + '" d="' + d + '"/>';
  const sparkle = (x, y, delay) => '<path class="spark dp-pop" style="--d:' + delay + 's" d="M' + x + " " + (y - 9) + " L" + x + " " + (y + 9) + " M" + (x - 9) + " " + y + " L" + (x + 9) + " " + y + '"/>';
  const dots = (pts, cls) => pts.map((p) => '<circle class="' + cls + '" style="--d:' + p[2] + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[3] || 3.2) + '"/>').join("");
  const capsule = (x, y, cls) => '<g transform="translate(' + x + " " + y + ')"' + (cls ? ' class="' + cls + '"' : "") + '><path class="capA" d="M0 -6 L-10 -6 Q-16 -6 -16 0 Q-16 6 -10 6 L0 6Z"/><path class="capB" d="M0 -6 L10 -6 Q16 -6 16 0 Q16 6 10 6 L0 6Z"/></g>';
  const label = (x, y, w, h) => '<g class="dp-slide"><rect class="lbl" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3"/><path class="lblline" d="M' + (x + 7) + " " + (y + 10) + " L" + (x + w - 7) + " " + (y + 10) + " M" + (x + 7) + " " + (y + 19) + " L" + (x + w - 7) + " " + (y + 19) + " M" + (x + 7) + " " + (y + 28) + " L" + (x + w - 17) + " " + (y + 28) + '"/></g>';
  const arrowDown = (x, y1, y2) => '<path class="acc dp-bob" d="M' + x + " " + y1 + " L" + x + " " + y2 + " M" + (x - 10) + " " + (y2 - 11) + " L" + x + " " + (y2 + 1) + " L" + (x + 10) + " " + (y2 - 11) + '"/>';

  const SCENES = {
    // ---- Joulie's oral solution ----
    jBar: () => clip("dpIn", BEAKER_IN) + beaker() + '<g class="dp-dropin"><rect class="bar" x="134" y="140" width="32" height="8" rx="4"/></g>' + arrowDown(150, 8, 34),
    jWater: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 70, "water dp-rise") + swirl(70) + beaker() + bar() +
      tilting(90, 30, "dp-tilt", "water dp-drainB") + stream("M90 32 Q104 40 118 92") + noHeat(),
    jPowder: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 76, "water") + liquid("dpIn", 76, "cloud dp-cloudin") + swirl(76) + beaker() + bar() +
      '<g transform="translate(150 2)"><g class="dp-tip"><path class="powder" d="M-30 0 Q-30 18 0 18 Q30 18 30 0Z"/><path class="ln" d="M-30 0 Q-30 18 0 18 Q30 18 30 0 M28 2 L60 -8"/></g></g>' +
      dots([[140, 46, 0], [148, 48, 0.35], [136, 50, 0.7], [152, 50, 1.05], [144, 46, 1.4], [132, 48, 1.75]], "pw dp-fall"),
    jAcid: () => clip("dpIn", BEAKER_IN) + plate() + liquid("dpIn", 76, "water") + liquid("dpIn", 76, "cloud") + swirl(76) + beaker() + bar() +
      '<path class="acid" d="M144 38 L156 38 L156 56 L151.5 68 L148.5 68 L144 56Z"/><path class="ln glass" d="M143 26 L157 26 L157 56 L152 70 L148 70 L143 56Z"/>' +
      '<path class="rubber dp-squeeze" d="M141 27 L141 14 Q141 0 150 0 Q159 0 159 14 L159 27Z"/>' +
      '<path class="drop dp-drip" style="--d:0s" d="M150 72 Q145 80 150 84 Q155 80 150 72Z"/><path class="drop dp-drip" style="--d:.8s" d="M150 72 Q145 80 150 84 Q155 80 150 72Z"/>',
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
    mMix: () => clip("dpJ", JAR_IN) + liquid("dpJ", 112, "mix dp-rise", 176) + '<path class="ln glass" d="' + JAR + '"/>' +
      tilting(124, 50, "dp-tiltL", "dexa dp-drainL") + tilting(196, 50, "dp-tiltR", "dph dp-drainR", true) +
      stream("M124 52 Q128 72 134 106", "dp-streamL") + stream("M196 52 Q192 72 186 106", "dp-streamR"),
    mNys: () => clip("dpJ", JAR_IN) + liquid("dpJ", 112, "mix", 176) + liquid("dpJ", 94, "nys dp-riseTop", 112) + '<path class="ln glass" d="' + JAR + '"/>' +
      tilting(124, 50, "dp-tiltL", "nys dp-drainL") + tilting(196, 50, "dp-tiltL2", "nys dp-drainL", true) +
      stream("M124 52 Q128 70 134 92", "dp-streamL") + stream("M196 52 Q192 70 186 92", "dp-streamL"),
    mCaps: () => clip("dpJ", JAR_IN) + liquid("dpJ", 94, "magic", 176) + '<path class="ln glass" d="' + JAR + '"/>' +
      capsule(40, 30) + capsule(80, 30) + capsule(220, 30) + capsule(260, 30) + capsule(40, 60, "dp-fade") +
      '<g transform="translate(160 36)"><g class="dp-openA"><path class="capA" d="M0 -6 L-10 -6 Q-16 -6 -16 0 Q-16 6 -10 6 L0 6Z"/></g><g class="dp-openB"><path class="capB" d="M0 -6 L10 -6 Q16 -6 16 0 Q16 6 10 6 L0 6Z"/></g></g>' +
      dots([[158, 46, 0.9, 2.6], [162, 46, 1.2, 2.6], [156, 48, 1.5, 2.6], [164, 48, 1.8, 2.6], [160, 46, 2.1, 2.6]], "tetra dp-fall2"),
    mFill: () => clip("dpB1", "M183 132 L183 178 Q183 183 188 183 L212 183 Q217 183 217 178 L217 132 Q217 126 209 125 L209 118 L191 118 L191 125 Q183 126 183 132Z") +
      '<g clip-path="url(#dpB1)"><rect class="magic dp-rise" x="180" y="128" width="40" height="58"/></g>' +
      '<path class="ln glass" d="M182 132 L182 178 Q182 184 188 184 L212 184 Q218 184 218 178 L218 132 Q218 125 210 124 L210 116 L190 116 L190 124 Q182 125 182 132Z"/>' +
      '<path class="magic" d="M233 140 L233 178 Q233 183 238 183 L262 183 Q267 183 267 178 L267 140Z"/>' +
      '<path class="ln glass" d="M232 132 L232 178 Q232 184 238 184 L262 184 Q268 184 268 178 L268 132 Q268 125 260 124 L260 116 L240 116 L240 124 Q232 125 232 132Z"/>' +
      '<g transform="translate(196 96) scale(1.35)"><g class="dp-tiltB"><path class="magic dp-drainB" d="' + BOTTLE_FILL + '"/><path class="ln glass" d="' + BOTTLE + '"/></g></g>' +
      stream("M197 98 Q200 108 200 128"),
    mLabel: () => '<g class="dp-shake">' + clip("dpB2", "M121 82 L121 168 Q121 175 128 175 L172 175 Q179 175 179 168 L179 82 Q179 72 166 70 L166 58 L134 58 L134 70 Q121 72 121 82Z") +
      '<g clip-path="url(#dpB2)"><rect class="magic" x="116" y="84" width="70" height="96"/>' + dots([[134, 168, 0], [146, 170, .2], [158, 167, .4], [168, 170, .6], [140, 163, .3], [162, 162, .5]], "sed dp-float") + "</g>" +
      '<rect class="cap" x="132" y="46" width="36" height="13" rx="3"/>' +
      '<path class="ln glass" d="M120 82 L120 168 Q120 176 128 176 L172 176 Q180 176 180 168 L180 82 Q180 71 166 69 L166 58 L134 58 L134 69 Q120 71 120 82Z"/>' +
      label(126, 96, 48, 38) + "</g>" +
      '<path class="acc dp-waveL" d="M96 92 Q86 112 96 132"/><path class="acc dp-waveR" d="M204 92 Q214 112 204 132"/>',
    mGargle: () => '<circle class="skin" cx="122" cy="98" r="48"/><path class="skin" d="M100 140 L100 192 L146 192 L146 140Z"/>' +
      '<circle class="eye" cx="138" cy="80" r="4.5"/><path class="ln" d="M126 70 Q137 64 148 70"/>' +
      '<ellipse class="mouth" cx="160" cy="112" rx="11" ry="8"/>' +
      dots([[164, 100, 0, 4], [172, 96, .5, 3], [158, 94, 1, 3.5], [168, 102, 1.5, 2.6]], "bub dp-bubble") +
      '<path class="swallow dp-flow" d="M156 120 Q146 132 141 150 L138 176"/>' +
      '<path class="acc dp-flowHead" d="M129 172 L138 185 L147 172"/>'
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
        { scene: "jWater", text: "أضف 90 مل من الماء المعقّم للحقن، ثم ضع الكأس على جهاز الخلط وشغّل التدوير المغناطيسي لتتكوّن دوّامة مائية داخل الكأس." },
        { scene: "jPowder", text: "أضف تدريجيًا 17 غرامًا من مسحوق الدايهايدروس دايصوديوم فوسفيت بعد وزنها باستخدام الميزان." },
        { scene: "jAcid", text: "أضف 3.4 مل من محلول حمض الفسفوريك (5.7g) باستخدام القطّارة بعد وزنها." },
        { scene: "jClear", text: "اترك الخليط ليتجانس ويذوب بشكل كامل حتى ترى محلولًا صافيًا بدون رواسب." },
        { scene: "jBottle", text: "عبّئ المحلول المتجانس في قارورات زجاجية داكنة لحفظه من الضوء." }
      ],
      info: [
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
        { scene: "mLabel", text: "اكتب على الزجاجة المحضّرة: اسم المريض، وتاريخ التحضير، وتاريخ الإتلاف، وعبارة «رجّ جيدًا قبل الاستعمال» لأن المواد الفعالة ترسب في قعر الزجاجة." },
        { scene: "mGargle", text: "ثقّف المريض بأن يتغرغر بالمحلول ثم يبلعه." }
      ],
      info: [
        { title: "المكونات", items: ["Dexamethasone (الدكسون): زجاجة كاملة", "Diphenhydramine (الارمين): زجاجة كاملة", "Nystatin (محلول نيستاتين): زجاجتان كاملتان", "Tetracycline (تيتراسيكلين): 6 كبسولات"] },
        { title: "طريقة الإعطاء", items: ["أربع مرات في اليوم."] }
      ]
    }
  ];

  const TILE_ICON = {
    blue: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 8h24M14 8v30a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4V8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M15 24h18v14a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#3d9bd6" opacity=".75"/></svg>',
    pink: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M19 5h10v7l6 6v22a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V18l6-6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14.5 26h19v14a2.5 2.5 0 0 1-2.5 2.5H17a2.5 2.5 0 0 1-2.5-2.5z" fill="#e07aa8" opacity=".8"/></svg>'
  };
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>';
  const ICON_AGAIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 3v5h5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------------- player ----------------
  let cur = null, idx = 0, playing = false, ended = false, timer = 0, t0 = 0, remain = STEP_MS, typeTimer = 0;

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

  function stopTimer() { clearTimeout(timer); timer = 0; }
  function schedule(ms) {
    stopTimer(); t0 = Date.now(); remain = ms;
    timer = setTimeout(() => {
      const view = $("view-prep");
      if (!view || view.hidden) { stopTimer(); playing = false; return; }
      if (idx < cur.steps.length - 1) { idx++; renderStep(); }
      else { playing = false; ended = true; updateControls(); }
    }, ms);
  }

  function updateControls() {
    const n = cur.steps.length, play = $("dp-play");
    $("dp-prev").disabled = idx === 0;
    $("dp-next").disabled = idx === n - 1;
    play.innerHTML = ended ? ICON_AGAIN : playing ? ICON_PAUSE : ICON_PLAY;
    play.setAttribute("aria-label", ended ? "إعادة من البداية" : playing ? "إيقاف مؤقت" : "تشغيل");
    $("dp-player").classList.toggle("dp-paused", !playing);
  }

  function renderStep() {
    const n = cur.steps.length, st = cur.steps[idx];
    $("dp-art").innerHTML = scene(st.scene);           // a fresh SVG restarts every animation
    $("dp-num").textContent = (idx + 1) + " / " + n;
    $("dp-text").setAttribute("aria-label", st.text);
    typeText(st.text);
    const segs = $("dp-segs");
    segs.innerHTML = cur.steps.map((x, k) => '<button type="button" class="dp-seg' + (k < idx ? " is-done" : k === idx ? " is-on" : "") + '" data-k="' + k + '" aria-label="الخطوة ' + (k + 1) + '"><i style="animation-duration:' + stepMs(x) + 'ms"></i></button>').join("");
    ended = false;
    if (playing) schedule(stepMs(st)); else { stopTimer(); remain = stepMs(st); }
    updateControls();
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
    idx = 0; playing = !reduced();
    renderInfo(); renderStep();
    global.PharmacyUI.setScrollY && global.PharmacyUI.setScrollY(0);
  }

  function toMenu() {
    stopTimer(); clearInterval(typeTimer); playing = false; cur = null;
    $("dp-player").hidden = true;
    $("dp-menu").hidden = false;
    $("dp-art").innerHTML = "";
  }

  function togglePlay() {
    if (ended) { idx = 0; playing = true; renderStep(); return; }
    if (playing) { stopTimer(); remain = Math.max(0, remain - (Date.now() - t0)); playing = false; }
    else { playing = true; schedule(remain); }
    updateControls();
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
      if (cur) toMenu(); else { stopTimer(); global.PharmacyUI.showView("settings"); }
    });
    const grid = $("dp-grid");
    if (grid) grid.addEventListener("click", (e) => { const t = e.target.closest(".dp-tile"); if (t) play(t.dataset.id); });
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
    on("dp-prev", () => { if (cur && idx > 0) { idx--; renderStep(); } });
    on("dp-next", () => { if (cur && idx < cur.steps.length - 1) { idx++; renderStep(); } });
    on("dp-play", () => { if (cur) togglePlay(); });
    on("dp-segs", (e) => { const s = e.target.closest(".dp-seg"); if (s && cur) { idx = +s.dataset.k || 0; renderStep(); } });
  }

  global.PharmacyDrugPrep = { open, DRUGS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
