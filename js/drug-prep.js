/* drug-prep.js — «تحضير الأدوية الخاصة» (settings page; the super admin only for now).
   A button per medicine; a press shows its preparation as animated scenes, one per step, moved through with
   previous / next only (no auto-play — the user asked); the step text is typed in while the scene plays. The recipes
   are the ward's own (given by the user) — never add a recipe or an amount that the user did not give. The vial / bag
   medicines are DRAFTS from the manufacturers' leaflets (draft: true, asked for by the user): marked «مسودة» and shown to
   the super admin only until the user approves each one (then remove its draft flag).
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
  // the nystatin bottle: small and round, a wide mouth and no neck (unlike the syrup bottles)
  const NYS_BTL = "M-11 0 L11 0 Q17 2 17 12 L17 30 Q17 44 3 44 L-3 44 Q-17 44 -17 30 L-17 12 Q-17 2 -11 0Z";
  const NYS_IN = "M-10 1 L10 1 Q16 3 16 12 L16 30 Q16 43 3 43 L-3 43 Q-16 43 -16 30 L-16 12 Q-16 3 -10 1Z";

  const clip = (id, d) => '<clipPath id="' + id + '"><path d="' + d + '"/></clipPath>';
  const liquid = (clipId, top, cls, bottom) => '<g clip-path="url(#' + clipId + ')"><rect class="' + cls + '" x="96" y="' + top + '" width="116" height="' + ((bottom || 156) - top) + '"/></g>';
  const beaker = () => '<path class="ln" d="' + BEAKER + '"/><path class="ln thin" d="M102 70 L122 70 M102 90 L114 90 M102 110 L122 110 M102 130 L114 130"/><path class="shine" d="M111 62 L111 126"/>';
  const bar = () => '<rect class="bar dp-spin" x="134" y="140" width="32" height="8" rx="4"/>';
  const plate = () => '<path class="plate" d="M72 154 L228 154 L228 180 Q228 186 222 186 L78 186 Q72 186 72 180Z"/><circle class="knob" cx="205" cy="170" r="7"/><circle class="led dp-blink" cx="92" cy="170" r="3.5"/>';
  const swirl = (top) => '<g clip-path="url(#dpIn)"><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 26) + '" rx="32" ry="6"/><ellipse class="swirl dp-swirl" cx="150" cy="' + (top + 52) + '" rx="22" ry="5"/></g>';
  const noHeat = () => '<g class="dp-popin"><circle class="bad" cx="252" cy="46" r="22"/><path class="badfill" d="M252 30 Q243 42 248 49 Q247 42 253 39 Q259 47 254 55 Q262 51 260 44 Q265 52 251 60 Q237 54 252 30Z"/><path class="bad" d="M236 62 L268 30"/></g>';
  const tilting = (x, y, cls, fillCls, flip, k, round) => '<g transform="translate(' + x + " " + y + ") scale(" + (flip ? -(k || 1) : (k || 1)) + " " + (k || 1) + ')"><g class="' + cls + '">' +
    '<g clip-path="url(#' + (round ? "dpNy" : "dpBtl") + ')"><rect class="' + fillCls + '" x="-20" y="0" width="40" height="64"/></g><path class="ln glass" d="' + (round ? NYS_BTL : BOTTLE) + '"/></g></g>';
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

  // ---------------- shared pieces for the vial / bag medicines ----------------
  const VIAL = "M132 96 L168 96 Q172 96 172 102 L172 166 Q172 172 166 172 L134 172 Q128 172 128 166 L128 102 Q128 96 132 96Z";
  const VIAL_IN = "M133 97 L167 97 Q171 97 171 102 L171 166 Q171 171 166 171 L134 171 Q129 171 129 166 L129 102 Q129 97 133 97Z";
  const vial = (cap, inner) => clip("dpV", VIAL_IN) + '<g clip-path="url(#dpV)">' + inner + "</g>" +
    '<path class="ln glass" d="' + VIAL + '"/><path class="ln glass" d="M139 86 L161 86 L161 96 L139 96Z"/><rect class="vcap" style="fill:' + (cap || "#8d98a0") + '" x="134" y="76" width="32" height="11" rx="2"/>';
  const vLiq = (top, cls) => '<rect class="' + cls + '" x="126" y="' + top + '" width="48" height="' + (174 - top) + '"/>';
  const vPowder = (cls) => '<rect class="vpow ' + (cls || "") + '" x="126" y="154" width="48" height="20"/>';
  // a syringe pointing down with its needle tip at (150, tip) — "Inj" empties it, "Draw" fills it; no needle when tip is 0
  const syringe = (mode, liq, tip, opt) => {
    const f = opt && opt.filter;
    return (f ? '<circle class="filt" cx="150" cy="72" r="7"/>' : "") +
      (tip > 66 ? '<path class="ln thin" d="M150 ' + (f ? 79 : 66) + " L150 " + tip + '"/>' : "") +
      '<rect class="' + liq + " dp-l" + mode + '" x="144" y="33" width="12" height="29"/>' +
      '<path class="ln glass" d="M143 16 L157 16 L157 62 L153 62 L153 66 L147 66 L147 62 L143 62Z"/><path class="ln" d="M136 16 L164 16"/>' +
      '<g class="dp-p' + mode + '"><rect class="rubber" x="144" y="27" width="12" height="6"/><path class="ln" d="M150 27 L150 2 M141 2 L159 2"/></g>';
  };
  // an IV bag with its label; tint = the medicine's colour (animate: it spreads in after the injection)
  const BAG = "M118 14 Q118 8 124 8 L176 8 Q182 8 182 14 L182 82 Q182 94 170 96 L130 96 Q118 94 118 82Z";
  const BAG_IN = "M119 30 L181 30 L181 82 Q181 93 170 95 L130 95 Q119 93 119 82Z";
  const bag = (label, tint, animate) => clip("dpBag", BAG_IN) +
    '<g clip-path="url(#dpBag)"><rect class="water" x="116" y="30" width="68" height="68"/>' + (tint && tint !== "clear" ? '<rect class="' + tint + (animate ? " dp-tintIn" : "") + '" x="116" y="30" width="68" height="68"/>' : "") + "</g>" +
    '<path class="ln glass" d="' + BAG + '"/><circle class="ln thin" cx="150" cy="15" r="3.5"/><path class="ln" d="M143 96 L143 108 M157 96 L157 108"/>' +
    '<rect class="lbl" x="128" y="42" width="44" height="17" rx="2"/><text class="bagt" x="150" y="54.5" text-anchor="middle" direction="ltr">' + (label || "") + "</text>";
  // a 5-micron syringe filter seen from the side, flow left → right: female luer inlet, the disc housing with
  // its white membrane inside, male luer outlet
  const FILTER = '<path class="fstem" d="M-26 -9 L-23 -9 L-23 9 L-26 9Z M-23 -5 L-12 -5 L-12 5 L-23 5Z"/>' +
    '<path class="fbody" d="M-12 -22 Q-12 -27 -6 -27 L6 -27 Q12 -27 12 -22 L12 22 Q12 27 6 27 L-6 27 Q-12 27 -12 22Z"/>' +
    '<path class="fmem" d="M0 -23 L0 23"/><path class="frib" d="M-12 -16 L-8 -16 M-12 -8 L-8 -8 M-12 0 L-8 0 M-12 8 L-8 8 M-12 16 L-8 16 M8 -16 L12 -16 M8 -8 L12 -8 M8 0 L12 0 M8 8 L12 8 M8 16 L12 16"/>' +
    '<path class="fstem" d="M12 -5 L24 -2.6 L24 2.6 L12 5Z"/>';
  const tinted = (d, c, cls) => '<path class="water ' + (cls || "") + '" d="' + d + '"/>' + (c && c !== "clear" ? '<path class="' + c + " " + (cls || "") + '" d="' + d + '"/>' : "");
  const filterSet = (label, o, push) => '<g transform="translate(52 -2) scale(.65)">' + bag(label, push ? o.c : null, push) + "</g>" +
    (push ? '<path class="stream st-amph dp-injStr" d="M154 120 L154 52"/>' : "") +
    '<g' + (push ? "" : ' class="dp-step1"') + '><path class="ln thin" d="M154 50 L154 84"/><rect class="nhub" x="149" y="84" width="10" height="9" rx="1.5"/></g>' +
    '<g' + (push ? "" : ' class="dp-step2"') + '><g transform="translate(154 106) rotate(-90) scale(.55)">' + FILTER + "</g></g>" +
    '<g' + (push ? "" : ' class="dp-step3"') + '><g transform="translate(154 120) rotate(180) scale(.9) translate(-150 -66)">' + syringe(push ? "Inj" : "Full", o.c || "clear", 0) + "</g></g>";
  const drip = (c) => '<path class="ln thin" d="M31 71 L31 76"/>' + tinted("M26 94 L36 94 L36 98 Q36 102 31 102 Q26 102 26 98Z", c) + tinted("M31 79 Q28 83 31 85 Q34 83 31 79Z", c, "dp-drop") +
    '<path class="ln glass" d="M25 76 L37 76 L37 98 Q37 103 31 103 Q25 103 25 98Z"/>';
  // the giving set: a clear tube filled with the bag's fluid, a light flow moving along it
  const line = (d, c) => '<path class="tubeo" d="' + d + '"/><path class="tubew" d="' + d + '"/><path class="tube-water" d="' + d + '"/>' +
    (c && c !== "clear" ? '<path class="tube-' + c + '" d="' + d + '"/>' : "") + '<path class="tflow dp-flowT" d="' + d + '"/>';
  // the back of the patient's hand (no fingers), then the cannula taped on it — drawn after the line so the line ends inside its hub
  const handSkin = () => '<path class="skin" d="M188 138 L260 135 Q286 135 288 157 Q286 179 260 179 L188 184Z"/>';
  const cannula = () => '<path class="cannc" d="M226 150 L246 150"/><path class="cannw" d="M219 144 L229 137 L232 141 L224 147Z M219 156 L229 163 L232 159 L224 153Z"/>' +
    '<rect class="cannhub" x="210" y="145" width="16" height="10" rx="2"/><rect class="tape" x="224" y="141" width="22" height="18" rx="2"/>';
  const clock = (x, y, r) => '<circle class="clockf" cx="' + x + '" cy="' + y + '" r="' + r + '"/>' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => { const a = k * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      return '<path class="ln thin" d="M' + (x + s * r * .78).toFixed(1) + " " + (y - c * r * .78).toFixed(1) + " L" + (x + s * r * .9).toFixed(1) + " " + (y - c * r * .9).toFixed(1) + '"/>'; }).join("") +
    '<path class="hand dp-hand" style="transform-origin:' + x + "px " + y + 'px" d="M' + x + " " + y + " L" + x + " " + (y - r * .7) + '"/><circle class="ln" cx="' + x + '" cy="' + y + '" r="2"/>';
  const noLight = (x, y) => '<g class="dp-popin"><circle class="sun" cx="' + x + '" cy="' + y + '" r="9"/><path class="sunray" d="M' + (x - 16) + " " + y + " L" + (x - 12) + " " + y + " M" + (x + 12) + " " + y + " L" + (x + 16) + " " + y +
    " M" + x + " " + (y - 16) + " L" + x + " " + (y - 12) + " M" + x + " " + (y + 12) + " L" + x + " " + (y + 16) + '"/><path class="bad" d="M' + (x - 15) + " " + (y + 15) + " L" + (x + 15) + " " + (y - 15) + '"/></g>';
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
    mNys: () => clip("dpJ", JAR_IN) + clip("dpNy", NYS_IN) + liquid("dpJ", 128, "mix", 176) + liquid("dpJ", 110, "nys dp-mRiseL", 128) +
      stream("M146 82 Q150 98 152 128", "dp-mStrL st-nys") + stream("M174 82 Q170 98 168 128", "dp-mStrL st-nys") + '<path class="ln glass" d="' + JAR + '"/>' +
      tilting(146, 80, "dp-mBotL", "nys dp-mDrL", false, .85, true) + tilting(174, 80, "dp-mBotL", "nys dp-mDrL", true, .85, true),
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
      '<path class="acc dp-waveL" d="M96 92 Q86 112 96 132"/><path class="acc dp-waveR" d="M204 92 Q214 112 204 132"/>',

    // ---- shared scenes for the vial / bag medicines (o = the step's options) ----
    vAdd: (o) => vial(o.cap, vPowder(o.pc) + vLiq(124, "water dp-vRise")) + syringe("Inj", "water", 100),
    vShake: (o) => '<g class="' + (o.gentle ? "dp-swirlV" : "dp-shakeV") + '">' + vial(o.cap, vLiq(118, "water") + vLiq(118, (o.c || "clear") + " dp-blend") + vPowder((o.pc || "") + " dp-dissolve")) + "</g>" +
      (o.gentle ? '<ellipse class="orbit dp-swirl" cx="150" cy="186" rx="42" ry="7"/>' : '<path class="acc dp-waveL" d="M110 104 Q98 126 110 148"/><path class="acc dp-waveR" d="M190 104 Q202 126 190 148"/>'),
    vDraw: (o) => vial(o.cap, vLiq(112, (o.c || "clear") + " dp-vDrop")) + syringe("Draw", o.c || "clear", 150),
    vCheck: (o) => vial(o.cap, vLiq(112, o.c || "clear")) +
      '<g class="dp-scan"><circle class="lens" cx="200" cy="128" r="20"/><path class="ln" d="M214 142 L234 162"/></g>' +
      '<circle class="ok dp-popin2" cx="246" cy="52" r="20"/><path class="ok dp-check" pathLength="1" d="M236 53 L243 61 L257 43"/>',
    vWarm: (o) => vial(o.cap, vPowder()) +
      '<g class="dp-fadeOut"><path class="snow" d="M66 92 L66 132 M49 102 L83 122 M49 122 L83 102"/></g>' +
      '<rect class="ln glass" x="222" y="66" width="14" height="76" rx="7"/><circle class="thermb" cx="229" cy="148" r="11"/>' +
      '<rect class="thermr dp-thermo" x="225" y="84" width="8" height="62" rx="4"/>',
    bagIn: (o) => bag(o.label, o.c, true) + '<g transform="translate(157 104) rotate(180) scale(.72) translate(-150 -100)">' + syringe("Inj", o.c || "clear", 100, o) + "</g>",
    filterFit: (o) => filterSet("D5W", o, false),
    filterPush: (o) => filterSet("D5W", o, true),
    bagOut: (o) => bag(o.label) + '<g transform="translate(157 104) rotate(180) scale(.72) translate(-150 -100)">' + syringe("Draw", "water", 100) + "</g>",
    bagInvert: (o) => '<g class="dp-invert">' + bag(o.label, o.c) + "</g>",
    infuse: (o) => '<g transform="translate(-62 4) scale(.62)">' + bag(o.label, o.c) + (o.cover ? '<path class="cover" d="' + BAG + '"/>' : "") + "</g>" + drip(o.c) +
      handSkin() + line("M31 104 L31 132 Q31 168 80 168 L172 168 Q192 168 197 158 Q201 150 214 150", o.c) + cannula() +
      clock(150, 76, 30) + (o.cover ? noLight(96, 30) : ""),
    ppe: () => '<g class="dp-pop" style="--d:.2s"><rect class="maskc" x="30" y="82" width="58" height="34" rx="10"/><path class="ln thin" d="M30 90 Q16 96 30 108 M88 90 Q102 96 88 108 M42 94 L76 94 M42 102 L76 102"/></g>' +
      '<g class="dp-pop" style="--d:.6s"><path class="gown" d="M128 52 L172 52 L198 178 L102 178Z"/><path class="ln thin" d="M138 52 Q150 70 162 52 M150 70 L150 178"/></g>' +
      '<g class="dp-pop" style="--d:1s"><path class="glove" d="M222 178 L222 118 Q222 110 229 110 Q236 110 236 118 L236 98 Q236 91 243 91 Q250 91 250 98 L250 94 Q250 87 257 87 Q264 87 264 94 L264 102 Q264 96 270 96 Q276 96 276 103 L276 178Z"/></g>',
    waste: () => '<g class="dp-binfall" style="--d:.2s"><path class="ln" d="M128 8 L150 30 M124 12 L132 4 M150 30 L158 38"/></g>' +
      '<g class="dp-binfall" style="--d:.9s"><rect class="ln glass" x="160" y="6" width="16" height="26" rx="3"/></g>' +
      '<path class="bin" d="M112 92 L188 92 L180 186 L120 186Z"/><rect class="binlid" x="104" y="80" width="92" height="12" rx="3"/>' +
      '<path class="warnTri" d="M150 118 L170 154 L130 154Z"/><path class="ln" d="M150 130 L150 142 M150 147 L150 148"/>',
    oral: (o) => clip("dpCup", "M183 111 L237 111 L231 175 Q230 179 226 179 L194 179 Q190 179 189 175Z") +
      '<g clip-path="url(#dpCup)"><rect class="water" x="180" y="132" width="60" height="50"/><rect class="' + (o.c || "clear") + ' dp-tintIn" x="180" y="132" width="60" height="50"/></g>' +
      '<path class="ln glass" d="M182 110 L238 110 L232 176 Q231 180 227 180 L193 180 Q189 180 188 176Z"/>' +
      '<g transform="translate(60 22)">' + syringe("Inj", o.c || "clear", 0) + "</g>" + '<path class="stream dp-injStr" d="M210 90 L210 130"/>',
    jug: () => clip("dpJug", "M151 75 L245 75 L239 176 Q238 181 233 181 L163 181 Q158 181 157 176Z") + clip("dpBtl", BOTTLE_IN) +
      '<g clip-path="url(#dpJug)"><rect class="water" x="148" y="128" width="100" height="56"/><rect class="lact dp-mRiseL" x="148" y="100" width="100" height="28"/></g>' +
      stream("M160 66 Q168 90 172 100", "dp-mStrL st-lact") + '<path class="ln glass" d="M150 74 L246 74 L240 176 Q239 182 233 182 L163 182 Q157 182 156 176Z"/>' +
      tilting(160, 64, "dp-mBotL", "lact dp-mDrL", false, .85),
    enema: () => '<g transform="translate(-62 4) scale(.62)">' + bag("1 L", "lact") + "</g>" + drip("lact") +
      line("M31 104 L31 132 Q31 166 80 166 L206 166", "lact") + '<path class="cath" d="M206 166 L262 166"/><ellipse class="balloon dp-balloon" cx="266" cy="166" rx="10" ry="7"/>' + clock(170, 78, 30),
    retain: (o) => clock(150, 96, 52) + (o.repeat ? '<path class="acc" d="M214 60 A80 80 0 0 1 222 132 M212 122 L222 134 L232 122"/>' : ""),
    premed: () => '<g class="dp-pop" style="--d:.2s"><circle class="pill" cx="56" cy="100" r="17"/><path class="ln thin" d="M43 100 L69 100"/></g>' +
      '<g class="dp-pop" style="--d:.6s"><rect class="pill2" x="86" y="89" width="44" height="22" rx="11"/></g>' +
      '<path class="acc dp-bob" d="M144 100 L176 100 M166 90 L178 100 L166 110"/>' +
      '<g transform="translate(118 26) scale(.62)">' + bag("NS 0.9%") + "</g>",
    rate: (o) => '<path class="ln thin" d="M30 172 L284 172 M30 172 L30 30"/>' + o.rates.map((r, k) => {
      const w = Math.min(26, 230 / o.rates.length - 6), x = 40 + k * (w + 6), h = r / 400 * 120;
      return '<rect class="bar dp-bar" style="--d:' + (k * 0.35) + 's" x="' + x + '" y="' + (172 - h) + '" width="' + w + '" height="' + h + '" rx="3"/>' +
        '<text class="bart dp-bart" style="--d:' + (k * 0.35) + 's" x="' + (x + w / 2) + '" y="' + (166 - h) + '" text-anchor="middle" direction="ltr">' + r + "</text>";
    }).join("") + '<text class="bart" x="36" y="26" text-anchor="start" direction="ltr">mg/h</text>'
  };
  function scene(st) {
    const f = SCENES[st.scene];
    return '<svg class="dp-svg" viewBox="0 0 300 200" role="img" aria-hidden="true">' + (f ? f(st.o || {}) : "") + "</svg>";
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
        { title: "طريقة الاستخدام", items: ["ثقّف المريض بأن يتغرغر بالمحلول ثم يبلعه.", "أربع مرات في اليوم.", "يُتلف بعد 3 أيام من التحضير."] }
      ]
    },

    // ---- DRAFTS written from the manufacturers' leaflets (draft: true) — shown only to the super admin until the user approves each one ----
    {
      id: "ampho-conv", name: "Amphotericin B — Conventional", ar: "الأمفوتيرسين التقليدي (Deoxycholate) — قنينة 50 ملغ", tone: "vial", color: "#e9b52b", draft: true,
      steps: [
        { scene: "vAdd", o: { cap: "#e9b52b", pc: "powY" }, text: "أضف بسرعة 10 مل من الماء المعقّم للحقن (بدون مادة حافظة) إلى القنينة." },
        { scene: "vShake", o: { cap: "#e9b52b", c: "amph", pc: "powY" }, text: "رجّ القنينة فورًا حتى يصبح المحلول الغرواني ذائبًا ومتجانسًا (التركيز 5 ملغ/مل)." },
        { scene: "vDraw", o: { cap: "#e9b52b", c: "amph" }, text: "اسحب الجرعة المطلوبة من القنينة." },
        { scene: "bagIn", o: { label: "D5W", c: "amph" }, text: "أضفها إلى محلول الدكستروز 5% فقط حتى يصبح التركيز 0.1 ملغ/مل (مثلًا 50 ملغ في 500 مل). لا تستعمل المحلول الملحي." },
        { scene: "infuse", o: { label: "D5W", c: "amph" }, text: "أعطه بالتسريب الوريدي البطيء خلال 2–6 ساعات." }
      ],
      info: [
        { title: "تنبيهات", items: ["لا تتجاوز الجرعة اليومية 1.5 ملغ/كغ — الجرعة الزائدة قد تسبب توقف القلب والتنفس.", "لا يُبدَّل بالأمفوتيرسين اللايبوزومال (AmBisome): جرعاتهما مختلفة.", "لا يُخلط بالمحلول الملحي أو أي محلول فيه أملاح (يترسّب)، ولا بأدوية أخرى.", "اغسل الخط الوريدي بالدكستروز 5% قبل التسريب وبعده."] },
        { title: "الثبات والحفظ", items: ["القنينة المذابة (5 ملغ/مل): 24 ساعة في حرارة الغرفة بعيدًا عن الضوء، أو أسبوع في الثلاجة (2–8°م).", "المحلول المخفف: يُعطى فور تحضيره."] }
      ]
    },
    {
      id: "ampho-lipo", name: "Amphotericin B — Liposomal", ar: "الأمفوتيرسين اللايبوزومال (AmBisome) — قنينة 50 ملغ", tone: "vial", color: "#e39a2d", draft: true,
      steps: [
        { scene: "vAdd", o: { cap: "#e39a2d", pc: "powY" }, text: "أضف 12 مل من الماء المعقّم للحقن إلى القنينة." },
        { scene: "vShake", o: { cap: "#e39a2d", c: "amph", pc: "powY" }, text: "رجّ القنينة بقوة لمدة 30 ثانية حتى ينتشر المسحوق تمامًا (التركيز 4 ملغ/مل)." },
        { scene: "vDraw", o: { cap: "#e39a2d", c: "amph" }, text: "اسحب الجرعة المحسوبة إلى حقنة." },
        { scene: "filterFit", o: { c: "amph" }, text: "ضع إبرة في فتحة كيس الدكستروز 5%، ثم ركّب عليها فلتر 5 ميكرون المرفق بالعلبة، ثم ركّب على الفلتر الحقنة التي تحتوي الدواء." },
        { scene: "filterPush", o: { c: "amph" }, text: "احقن الدواء من خلال الفلتر في الدكستروز 5% حتى يصبح التركيز 1–2 ملغ/مل، واستعمل فلترًا جديدًا لكل قنينة." },
        { scene: "infuse", o: { label: "D5W", c: "amph" }, text: "أعطه بالتسريب خلال 120 دقيقة تقريبًا، ويمكن تقليلها إلى 60 دقيقة إن تحمّلها المريض." }
      ],
      info: [
        { title: "تنبيهات", items: ["لا يُخلط بالمحلول الملحي ولا بأدوية أخرى.", "اغسل الخط الوريدي بالدكستروز 5% قبل التسريب.", "لا يُبدَّل بالأمفوتيرسين التقليدي: جرعاتهما مختلفة.", "للأطفال الصغار يجوز تركيز أقل (0.2–0.5 ملغ/مل)."] },
        { title: "الثبات والحفظ", items: ["القنينة المذابة: حتى 24 ساعة في الثلاجة (2–8°م).", "بعد التخفيف: يجب استعماله خلال 6 ساعات."] }
      ]
    },
    {
      id: "caspofungin", name: "Caspofungin", ar: "الكاسبوفنجين (Cancidas) — قنينة 50 أو 70 ملغ", tone: "vial", color: "#d9534f", draft: true,
      steps: [
        { scene: "vWarm", o: { cap: "#d9534f" }, text: "أخرج القنينة من الثلاجة واتركها حتى تبلغ حرارة الغرفة." },
        { scene: "vAdd", o: { cap: "#d9534f" }, text: "أضف 10.5 مل من المحلول الملحي 0.9% أو الماء المعقّم للحقن إلى القنينة." },
        { scene: "vShake", o: { cap: "#d9534f", gentle: true }, text: "حرّك القنينة بلطف حتى يصبح المحلول ذائبًا ومتجانسًا (5.2 ملغ/مل لقنينة 50 ملغ، و7.2 ملغ/مل لقنينة 70 ملغ)." },
        { scene: "vDraw", o: { cap: "#d9534f" }, text: "اسحب 10 مل من القنينة (أو حجم الجرعة المطلوبة)." },
        { scene: "bagIn", o: { label: "NS 0.9%" }, text: "أضفها إلى كيس 250 مل من المحلول الملحي 0.9% (أو 100 مل لجرعتي 50 و35 ملغ). لا تستعمل محاليل الدكستروز." },
        { scene: "infuse", o: { label: "NS 0.9%" }, text: "أعطه بالتسريب الوريدي البطيء خلال ساعة تقريبًا." }
      ],
      info: [
        { title: "الجرعة", items: ["70 ملغ في اليوم الأول، ثم 50 ملغ يوميًا."] },
        { title: "الثبات والحفظ", items: ["القنينة المذابة: ساعة واحدة في حرارة لا تتجاوز 25°م.", "المحلول المخفف: 24 ساعة في حرارة لا تتجاوز 25°م، أو 48 ساعة في الثلاجة (2–8°م)."] }
      ]
    },
    {
      id: "mtx", name: "MTX — Methotrexate", ar: "الميثوتريكسيت — دواء سام للخلايا", tone: "vial", color: "#e6c229", draft: true,
      steps: [
        { scene: "ppe", text: "ارتدِ القفازات والرداء والكمامة، وحضّره في المكان المخصّص للأدوية السامة للخلايا إن توفّر." },
        { scene: "vCheck", o: { cap: "#e6c229", c: "mtx" }, text: "تأكد من الجرعة والتكرار (أسبوعية أم يومية)، ومن أن المستحضر خالٍ من المادة الحافظة للجرعات العالية والحقن داخل القراب." },
        { scene: "vDraw", o: { cap: "#e6c229", c: "mtx" }, text: "اسحب الجرعة المطلوبة من القنينة." },
        { scene: "bagIn", o: { label: "NS 0.9%", c: "mtx" }, text: "للتسريب: خفّفها في المحلول الملحي 0.9% أو الدكستروز 5% بالحجم الذي يحدده البروتوكول." },
        { scene: "infuse", o: { label: "NS 0.9%", c: "mtx" }, text: "أعطه بالسرعة والمدة اللتين يحددهما البروتوكول." },
        { scene: "waste", text: "تخلّص من الحقن والقنينة والقفازات في حاوية النفايات السامة للخلايا." }
      ],
      info: [
        { title: "تنبيهات", items: ["الخطأ بين الجرعة الأسبوعية واليومية قد يكون قاتلًا.", "الجرعات العالية تحتاج إنقاذًا بـ Leucovorin وترطيبًا وقلونة البول حسب البروتوكول.", "الحقن داخل القراب: بمستحضر خالٍ من المادة الحافظة فقط."] },
        { title: "الإذابة (للمسحوق)", items: ["قنينة 1 غ: تُذاب بـ 19.4 مل من محلول خالٍ من المادة الحافظة (التركيز 50 ملغ/مل)، وتُستعمل فورًا."] }
      ]
    },
    {
      id: "vanco-oral", name: "Vancomycin — Oral", ar: "الفانكومايسين الفموي من القنينة الوريدية", tone: "vial", color: "#4a90d9", draft: true,
      steps: [
        { scene: "vAdd", o: { cap: "#4a90d9" }, text: "أذب قنينة الفانكومايسين 500 ملغ بـ 10 مل من الماء المعقّم للحقن (التركيز 50 ملغ/مل)." },
        { scene: "vShake", o: { cap: "#4a90d9", gentle: true }, text: "حرّك القنينة حتى يذوب المسحوق تمامًا." },
        { scene: "vDraw", o: { cap: "#4a90d9" }, text: "اسحب الجرعة الموصوفة بحقنة (مثلًا 125 ملغ = 2.5 مل)." },
        { scene: "oral", text: "خفّفها في 30 مل من الماء (ويجوز إضافة شراب منكّه)، وأعطها للمريض ليشربها أو عبر الأنبوب الأنفي المعدي." }
      ],
      info: [
        { title: "الجرعة", items: ["لالتهاب القولون بـ C. difficile: عادةً 125 ملغ 4 مرات في اليوم لمدة 10 أيام — حسب وصفة الطبيب."] },
        { title: "الثبات والحفظ", items: ["المحلول المذاب: حتى 14 يومًا في الثلاجة (2–8°م)."] },
        { title: "ملاحظة", items: ["الفانكومايسين الفموي لا يُمتص من الأمعاء؛ يعمل داخلها فقط."] }
      ]
    },
    {
      id: "lactulose-enema", name: "Lactulose Enema", ar: "حقنة اللاكتولوز الشرجية", tone: "vial", color: "#c9a227", draft: true,
      steps: [
        { scene: "jug", text: "اخلط 300 مل من شراب اللاكتولوز مع 700 مل من الماء أو المحلول الملحي (المجموع 1 لتر)." },
        { scene: "enema", text: "أعطه شرجيًا باستخدام قسطرة شرجية ذات بالون." },
        { scene: "retain", o: {}, text: "يحتفظ المريض به 30–60 دقيقة." },
        { scene: "retain", o: { repeat: true }, text: "يمكن تكراره كل 4–6 ساعات؛ وإن خرج بسرعة يُعاد فورًا." }
      ],
      info: [
        { title: "تنبيهات", items: ["لا تستعمل معه محاليل الصابون أو المواد القلوية (تُبطل مفعوله)."] }
      ]
    },
    {
      id: "endoxan", name: "Endoxan — Cyclophosphamide", ar: "الإندوكسان (سايكلوفوسفاميد) — قنينة 500 ملغ أو 1 غ", tone: "vial", color: "#8e5ac8", draft: true,
      steps: [
        { scene: "ppe", text: "ارتدِ القفازات والرداء والكمامة؛ فهو دواء سام للخلايا." },
        { scene: "vAdd", o: { cap: "#8e5ac8" }, text: "أضف المحلول الملحي 0.9% إلى القنينة: 25 مل لقنينة 500 ملغ، و50 مل لقنينة 1 غ (التركيز 20 ملغ/مل)." },
        { scene: "vShake", o: { cap: "#8e5ac8" }, text: "رجّ القنينة بقوة حتى يذوب المسحوق؛ وإن لم يذب فورًا اتركها بضع دقائق حتى يصبح المحلول ذائبًا ومتجانسًا." },
        { scene: "vDraw", o: { cap: "#8e5ac8" }, text: "اسحب الجرعة المطلوبة." },
        { scene: "bagIn", o: { label: "NS 0.9%" }, text: "للتسريب: خفّفه في المحلول الملحي 0.9% أو الدكستروز 5% بالحجم الذي يحدده البروتوكول." },
        { scene: "infuse", o: { label: "NS 0.9%" }, text: "أعطه بالتسريب خلال المدة التي يحددها البروتوكول." },
        { scene: "waste", text: "تخلّص من الحقن والقنينة والقفازات في حاوية النفايات السامة للخلايا." }
      ],
      info: [
        { title: "تنبيهات", items: ["الإذابة بالماء المعقّم تعطي محلولًا ناقص التوتر لا يُحقن مباشرة؛ استعمل المحلول الملحي للحقن المباشر.", "الجرعات العالية: ترطيب جيد وMesna حسب البروتوكول لحماية المثانة."] },
        { title: "الثبات والحفظ", items: ["يُفضَّل استعمال المحلول فورًا، ويُحفظ حتى 24 ساعة في الثلاجة (2–8°م)."] }
      ]
    },
    {
      id: "tigecycline", name: "Tigecycline", ar: "التايجيسايكلين (Tygacil) — قنينة 50 ملغ", tone: "vial", color: "#f08a24", draft: true,
      steps: [
        { scene: "vAdd", o: { cap: "#f08a24" }, text: "أضف 5.3 مل من المحلول الملحي 0.9% أو الدكستروز 5% إلى القنينة." },
        { scene: "vShake", o: { cap: "#f08a24", c: "tige", gentle: true }, text: "حرّك القنينة بلطف حتى يذوب الدواء (التركيز 10 ملغ/مل). لونه الطبيعي أصفر إلى برتقالي؛ إن كان غير ذلك فلا تستعمله." },
        { scene: "vDraw", o: { cap: "#f08a24", c: "tige" }, text: "اسحب فورًا 5 مل من القنينة." },
        { scene: "bagIn", o: { label: "NS 0.9%", c: "tige" }, text: "أضفها إلى كيس 100 مل (التركيز لا يتجاوز 1 ملغ/مل)." },
        { scene: "infuse", o: { label: "NS 0.9%", c: "tige" }, text: "أعطه بالتسريب خلال 30–60 دقيقة." }
      ],
      info: [
        { title: "الجرعة", items: ["100 ملغ جرعة أولى، ثم 50 ملغ كل 12 ساعة."] },
        { title: "الثبات والحفظ", items: ["حتى 24 ساعة في حرارة الغرفة (منها 6 ساعات كحد أقصى داخل القنينة)، أو 48 ساعة في الثلاجة بعد نقله إلى الكيس."] }
      ]
    },
    {
      id: "remdesivir", name: "Remdesivir", ar: "الريمديسيفير (Veklury) — قنينة 100 ملغ مسحوق", tone: "vial", color: "#2a9d8f", draft: true,
      steps: [
        { scene: "vAdd", o: { cap: "#2a9d8f" }, text: "أضف 19 مل من الماء المعقّم للحقن إلى القنينة." },
        { scene: "vShake", o: { cap: "#2a9d8f" }, text: "رجّ القنينة 30 ثانية ثم اتركها 2–3 دقائق؛ كرّر إن لم يذب تمامًا (التركيز 5 ملغ/مل)." },
        { scene: "bagOut", o: { label: "NS 0.9%" }, text: "اسحب من كيس المحلول الملحي 0.9% (250 مل) حجمًا يساوي حجم الدواء الذي ستضيفه." },
        { scene: "vDraw", o: { cap: "#2a9d8f" }, text: "اسحب الجرعة من القنينة: 40 مل لجرعة 200 ملغ، أو 20 مل لجرعة 100 ملغ." },
        { scene: "bagIn", o: { label: "NS 0.9%" }, text: "أضفها إلى الكيس." },
        { scene: "bagInvert", o: { label: "NS 0.9%" }, text: "اقلب الكيس بلطف 20 مرة لمزجه — لا ترجّه." },
        { scene: "infuse", o: { label: "NS 0.9%" }, text: "أعطه بالتسريب خلال 30–120 دقيقة." }
      ],
      info: [
        { title: "الجرعة", items: ["200 ملغ في اليوم الأول، ثم 100 ملغ يوميًا."] },
        { title: "الثبات والحفظ", items: ["المحلول المخفف: 24 ساعة في حرارة الغرفة، أو 48 ساعة في الثلاجة (2–8°م)."] }
      ]
    },
    {
      id: "rituximab", name: "Rituximab", ar: "الريتوكسيماب (MabThera) — 10 ملغ/مل", tone: "vial", color: "#3b5bdb", draft: true,
      steps: [
        { scene: "premed", text: "قبل كل تسريب: أعطِ الدواء المسبق — باراسيتامول ومضاد هيستامين، ومعهما كورتيزون حسب البروتوكول." },
        { scene: "vDraw", o: { cap: "#3b5bdb" }, text: "اسحب الجرعة المطلوبة من القنينة." },
        { scene: "bagIn", o: { label: "NS 0.9%" }, text: "أضفها إلى المحلول الملحي 0.9% أو الدكستروز 5% حتى يصبح التركيز 1–4 ملغ/مل." },
        { scene: "bagInvert", o: { label: "NS 0.9%" }, text: "اقلب الكيس بلطف لمزجه — لا ترجّه حتى لا تتكوّن رغوة." },
        { scene: "rate", o: { rates: [50, 100, 150, 200, 250, 300, 350, 400] }, text: "التسريب الأول: ابدأ بـ 50 ملغ/ساعة، وزِد 50 ملغ/ساعة كل 30 دقيقة حتى 400 ملغ/ساعة كحد أقصى، إن لم تحدث تفاعلات." },
        { scene: "rate", o: { rates: [100, 200, 300, 400] }, text: "التسريبات التالية: ابدأ بـ 100 ملغ/ساعة، وزِد 100 ملغ/ساعة كل 30 دقيقة حتى 400 ملغ/ساعة كحد أقصى." }
      ],
      info: [
        { title: "تنبيهات", items: ["راقب المريض لتفاعلات التسريب؛ أوقف التسريب أو أبطئه عند حدوثها."] },
        { title: "الثبات والحفظ", items: ["المحلول المخفف: 24 ساعة في الثلاجة (2–8°م)، ثم 12 ساعة في حرارة الغرفة."] }
      ]
    }
  ];

  const TILE_ICON = {
    blue: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 8h24M14 8v30a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4V8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M15 24h18v14a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#3d9bd6" opacity=".75"/></svg>',
    pink: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M19 5h10v7l6 6v22a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V18l6-6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14.5 26h19v14a2.5 2.5 0 0 1-2.5 2.5H17a2.5 2.5 0 0 1-2.5-2.5z" fill="#e07aa8" opacity=".8"/></svg>'
  };
  const vialIcon = (c) => '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="17" y="4" width="14" height="6" rx="1.5" fill="' + c + '"/><path d="M19 10h10v4h1.5a3 3 0 0 1 3 3v23a4 4 0 0 1-4 4h-11a4 4 0 0 1-4-4V17a3 3 0 0 1 3-3H19z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16.5 27h15v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" fill="' + c + '" opacity=".75"/></svg>';
  const superAdmin = () => !!(global.PharmacyAuth && global.PharmacyAuth.isSuperAdmin && global.PharmacyAuth.isSuperAdmin());

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
    DRUGS.filter((d) => !d.draft || superAdmin()).forEach((d) => {      // drafts: the super admin only, until approved
      const b = document.createElement("button");
      b.type = "button"; b.className = "dp-tile dp-" + d.tone; b.dataset.id = d.id;
      b.innerHTML = '<span class="dp-ticon"' + (d.color ? ' style="background:color-mix(in srgb, ' + d.color + ' 18%, var(--surface))"' : "") + ">" + (TILE_ICON[d.tone] || vialIcon(d.color)) + "</span>" +
        '<span class="dp-tname"><b dir="ltr"></b><small></small><span class="dp-tmeta"><span class="dp-tcount"></span>' + (d.draft ? '<span class="dp-tdraft">مسودة</span>' : "") + "</span></span>";
      b.querySelector("b").textContent = d.name;
      b.querySelector("small").textContent = d.ar;
      b.querySelector(".dp-tcount").textContent = d.steps.length + " خطوات";
      grid.appendChild(b);
    });
  }

  function renderStep() {
    const n = cur.steps.length, st = cur.steps[idx];
    $("dp-art").innerHTML = scene(st);           // a fresh SVG restarts every animation
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
    $("dp-draft").hidden = !cur.draft;
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
