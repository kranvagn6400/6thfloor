#!/usr/bin/env node
// One-off import of drug-drug interactions from DDInter 2.0 (https://ddinter2.scbdd.com)
// into js/ddinter-data.js — ONLY the interactions between the medicines of this ward's
// catalogue (js/medications.js DEFAULT_MEDICATIONS, a copy of the cloud catalogue).
//
// Data licence: CC BY-NC-SA 4.0 (attribution, non-commercial, share-alike) — keep the
// credit that js/ddinter.js and the interactions page carry.
//
//   node scripts/import-ddinter.js            # the whole catalogue
//   node scripts/import-ddinter.js --limit 5  # a quick trial on 5 substances
//   node scripts/import-ddinter.js --only aspirin,glyburide  # add substances to the existing data file
//
// Polite by design: one request at a time, 1.2 s apart, an honest User-Agent, and it
// stops at the first 403 / 429. ~2 requests per substance.
const fs = require("fs");
const path = require("path");

const BASE = "https://ddinter2.scbdd.com";
const UA = "ward5-clinical-chart-import/1.0 (non-commercial hospital tool; one-off import)";
const DELAY = 1200;
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : null;
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

global.window = global;
require("../js/medications.js");
const DD = require("../js/ddinter.js");
const meds = global.PharmacyMedications.DEFAULT_MEDICATIONS.filter(m => m && m.form !== "supplies" && m.category !== "supplies");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let cookie = "", token = "";

async function session() {
  const r = await fetch(BASE + "/server/drug/", { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("home page " + r.status);
  const list = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  cookie = list.map(c => c.split(";")[0]).join("; ");
  const html = await r.text();
  const m = html.match(/csrfmiddlewaretoken:\s*'([^']+)'/);
  if (!m) throw new Error("no csrf token on the page");
  token = m[1];
}

async function post(urlPath, referer, params) {
  await sleep(DELAY);
  const body = new URLSearchParams(Object.assign({ csrfmiddlewaretoken: token }, params));
  const r = await fetch(BASE + urlPath, {
    method: "POST",
    headers: { "User-Agent": UA, Cookie: cookie, "X-Requested-With": "XMLHttpRequest", Referer: BASE + referer, "Content-Type": "application/x-www-form-urlencoded", "X-CSRFToken": (cookie.match(/csrftoken=([^;]+)/) || [])[1] || "" },
    body
  });
  if (r.status === 403 || r.status === 429) throw new Error("the site answered " + r.status + " — stopping (try later)");
  if (!r.ok) throw new Error(urlPath + " answered " + r.status);
  return r.json();
}

// A DDInter drug id for a list of query names (first query with a clear match)
async function findDrug(queries) {
  for (const q of queries) {
    const j = await post("/server/drug-source/", "/server/drug/", { draw: 1, start: 0, length: 10, "search[value]": q });
    const rows = j.data || [];
    const lower = q.toLowerCase();
    const exact = rows.find(r => String(r.name).toLowerCase() === lower);
    const hit = exact || (rows.length === 1 ? rows[0] : rows.find(r => String(r.name).toLowerCase().indexOf(lower) === 0));
    if (hit) return { id: hit.internalID, name: hit.name };
  }
  return null;
}

async function interactionsOf(id) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const j = await post("/server/interact-with/" + id + "/", "/server/drug-detail/" + id + "/", { draw: 1, start, length: 1000, severity: "", mechanism: "" });
    (j.data || []).forEach(r => rows.push(r));
    if (start + 1000 >= (j.recordsFiltered || 0)) break;
  }
  return rows;
}

const maskOf = (r) => DD.FLAGS.reduce((m, f) => m | (String(r[f[0]]) === "1" ? f[1] : 0), 0);

(async () => {
  // 1) the substances of the catalogue
  const subst = new Map();                       // key → queries
  meds.forEach(m => DD.termsOf(m).forEach(t => { if (!subst.has(t.key)) subst.set(t.key, t.queries); }));
  // --only: the substances to ADD to the existing data file (matched by key or by an alias name)
  const DATA_FILE = path.join(__dirname, "..", "js", "ddinter-data.js");
  let old = null;
  if (ONLY) {
    const txt = fs.readFileSync(DATA_FILE, "utf8");
    old = JSON.parse(txt.slice(txt.indexOf("{", txt.indexOf("window.PharmacyDDInterData")), txt.lastIndexOf("}") + 1));
  }
  const keys = (ONLY ? Array.from(subst.keys()).filter(k => ONLY.indexOf(k) !== -1 || (subst.get(k) || []).some(q => ONLY.indexOf(q.toLowerCase()) !== -1)) : Array.from(subst.keys())).slice(0, LIMIT);
  console.log("substances in the catalogue:", subst.size, LIMIT < Infinity ? "(trial: " + keys.length + ")" : "");
  await session();

  // 2) their DDInter ids
  const terms = old ? Object.assign({}, old.terms) : {}, drugs = old ? Object.assign({}, old.drugs) : {}, missing = [];
  const added = new Set();
  for (const k of keys) {
    const d = await findDrug(subst.get(k));
    if (d) { terms[k] = [d.id]; drugs[d.id] = d.name; added.add(d.id); console.log("  ✓", k, "→", d.name, d.id); }
    else { missing.push(k); console.log("  ✗", k, "— not found in DDInter"); }
  }

  // 3) the interactions between those drugs (each drug is asked once)
  const wanted = new Set(Object.keys(drugs));
  const pairs = new Map();
  if (old) old.pairs.forEach(s => { const f = s.split("|"); pairs.set(f[0] + "|" + f[1], { level: Number(f[2]), mask: Number(f[3]) }); });
  let n = 0;
  for (const id of (old ? added : wanted)) {
    n++;
    const rows = await interactionsOf(id);
    let kept = 0;
    rows.forEach(r => {
      if (!wanted.has(r.drug_id) || r.drug_id === id) return;
      const key = id < r.drug_id ? id + "|" + r.drug_id : r.drug_id + "|" + id;
      const prev = pairs.get(key);
      const level = Number(r.level) || 0, mask = maskOf(r);
      if (!prev || level > prev.level) pairs.set(key, { level, mask }); else if (prev && level === prev.level) prev.mask |= mask;
      kept++;
    });
    console.log("  [" + n + "/" + wanted.size + "]", drugs[id], "—", rows.length, "interactions,", kept, "with the catalogue");
  }

  // 4) the data file
  const out = {
    source: "DDInter 2.0 — https://ddinter2.scbdd.com — CC BY-NC-SA 4.0",
    generated: new Date().toISOString().slice(0, 10),
    terms, drugs,
    pairs: Array.from(pairs.entries()).map(([k, v]) => k + "|" + v.level + "|" + v.mask).sort()
  };
  const file = DATA_FILE;
  fs.writeFileSync(file, "/* Imported from DDInter 2.0 (CC BY-NC-SA 4.0) by scripts/import-ddinter.js — do not edit by hand. */\nwindow.PharmacyDDInterData = " + JSON.stringify(out) + ";\n");
  const byLevel = { 3: 0, 2: 0, 1: 0, 0: 0 };
  out.pairs.forEach(s => { byLevel[s.split("|")[2]]++; });
  console.log("\nwritten", file, "\nsubstances found:", Object.keys(terms).length, "| not found:", missing.join(", ") || "none", "\npairs:", out.pairs.length, "(Major " + byLevel[3] + ", Moderate " + byLevel[2] + ", Minor " + byLevel[1] + ", Unknown " + byLevel[0] + ")");
})().catch(e => { console.error("STOPPED:", e.message); process.exit(1); });
