// Specialist (attending physician) names are typed by hand, so the same person
// arrives as «عبد الرسول الموسوي» / «عبدالرسول الموسوي», «احمد مؤيد» / «أحمد مويد»,
// or with two letters swapped. This module decides when two spellings are the
// same person: key() ignores spelling noise, resolve() maps a typed name onto
// the spelling already used in the ward.
(function (global) {
  "use strict";

  // Spelling noise removed: tashkeel, tatweel, hamza forms, ة/ه, ى/ي, ؤ/و, ئ/ي,
  // punctuation, a leading title (د. / دكتور / أخصائي…) and every space
  // («عبد الرسول» = «عبدالرسول»).
  function key(name) {
    let s = String(name || "").toLowerCase()
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/ـ/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ؤ/g, "و")
      .replace(/[ئىی]/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ک/g, "ك")
      .replace(/ء/g, "")
      .replace(/[.,،\-_'"()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    s = s.replace(/^(?:الدكتور|دكتور|الاستاذ|استاذ|الاخصائي|اخصائي|د)\s+/, "");
    return s.replace(/\s+/g, "");
  }

  // The name as typed, tidied: single spaces, no edges
  function clean(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
  }

  // Edit distance where swapping two neighbouring letters counts as ONE edit
  function distance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const d = [];
    for (let i = 0; i <= m; i++) { d.push([i]); }
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[m][n];
  }

  // The ward's specialists, as the user gave them. Always the reference
  // spelling (they outweigh whatever the patients happen to hold), and always
  // offered while typing. A new specialist: add the name here.
  const DEFAULT_KNOWN = [];
  // The list in force: the admin edits it (specialists-admin.js, shared by every device); until he does,
  // this built-in list. An empty list is allowed («مسح الكل»).
  let known = DEFAULT_KNOWN.slice();
  function setKnown(list) { known = (Array.isArray(list) ? list : DEFAULT_KNOWN).map(clean).filter(Boolean); }
  function getKnown() { return known.slice(); }
  const KNOWN_WEIGHT = 100000;

  // Two different keys are "probably the same person": one slip in a name of
  // reasonable length (two for a long name). Short names never match loosely.
  function similar(k1, k2) {
    const len = Math.min(k1.length, k2.length);
    if (len < 6) return false;
    const limit = len >= 12 ? 2 : 1;
    return distance(k1, k2) <= limit;
  }

  // names → Map(key → { display, count }); display = the spelling used most
  function canonical(names) {
    const byKey = new Map();
    const add = (raw, w) => {
      const c = clean(raw);
      const k = key(c);
      if (!k) return;
      let g = byKey.get(k);
      if (!g) { g = { spellings: new Map(), count: 0 }; byKey.set(k, g); }
      g.count += w;
      g.spellings.set(c, (g.spellings.get(c) || 0) + w);
    };
    known.forEach(n => add(n, KNOWN_WEIGHT));
    (names || []).forEach(raw => add(raw, 1));
    const out = new Map();
    byKey.forEach((g, k) => {
      let best = null, bestN = -1;
      g.spellings.forEach((cnt, sp) => { if (cnt > bestN) { best = sp; bestN = cnt; } });
      out.set(k, { display: best, count: g.count });
    });
    return out;
  }

  // typed name + the specialists already in the ward →
  //   { name }                         nothing to unify
  //   { name: <ward spelling>, how: "exact" }   same person, spelled differently
  //   { name: <typed>, suggest: <ward spelling>, how: "similar" }   maybe a typo
  function resolve(typed, existingNames) {
    const t = clean(typed);
    const k = key(t);
    if (!k) return { name: t };
    const map = canonical(existingNames);
    if (map.has(k)) {
      const display = map.get(k).display;
      return display === t ? { name: t } : { name: display, how: "exact" };
    }
    let best = null, bestD = Infinity;
    map.forEach((g, k2) => {
      if (!similar(k, k2)) return;
      const dd = distance(k, k2);
      if (dd < bestD || (dd === bestD && g.count > (best ? best.count : 0))) { best = g; bestD = dd; }
    });
    if (best) return { name: t, suggest: best.display, how: "similar" };
    return { name: t };
  }

  global.PharmacySpecialists = { KNOWN: DEFAULT_KNOWN, DEFAULT_KNOWN, getKnown, setKnown, key, clean, distance, similar, canonical, resolve };
})(typeof window !== "undefined" ? window : globalThis);
