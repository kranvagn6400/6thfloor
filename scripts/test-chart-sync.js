// Tests for api/chart-sync.js against a fake chart server (no network)
const assert = require("assert");

let state, calls;
function reset() {
  calls = [];
  state = { extra: { version: 1, chart: null, lock: { held: false, holder: null, mine: false }, saved: null }, version: 3, chart: null, lock: { held: false, holder: null, mine: false }, conflictOnce: false, loginOk: true, appUserOk: true, role: "pharmacist", lastLogin: null };
  process.env.CHART_USERNAME = "ward5"; process.env.CHART_PASSWORD = "shared-secret";
}
const json = (status, body, headers) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (headers || {})[k.toLowerCase()] || null, getSetCookie: () => (headers && headers["set-cookie"]) ? [headers["set-cookie"]] : [] },
  json: async () => body
});
global.fetch = async (url, init) => {
  init = init || {};
  calls.push((init.method || "GET") + " " + url.replace(/\?.*/, ""));
  if (url.endsWith("/auth/v1/user")) return state.appUserOk ? json(200, { id: "u1" }) : json(401, {});
  if (url.includes("/rest/v1/profiles")) return json(200, state.role ? [{ role: state.role, active: true }] : []);
  if (url.endsWith("/auth/login")) state.lastLogin = JSON.parse(init.body);
  if (url.endsWith("/auth/login")) return state.loginOk ? json(200, { user: {} }, { "set-cookie": "sid=abc; Path=/; HttpOnly" }) : json(401, { message: "بيانات الدخول غير صحيحة" });
  if (url.endsWith("/auth/logout")) return json(200, {});
  if (url.endsWith("/api/medicines")) return json(200, { medicines: state.medicines || [{ name: "Paracetamol 500mg Tab" }, { name: "Omeprazole 20mg cap" }] });
  if (url.includes("/api/chart") && (init.method || "GET") === "GET" && new URL(url).searchParams.get("slot") === "extra") {
    const x = state.extra;
    return json(200, { chart: x.chart ? Object.assign({ version: x.version }, x.chart) : null, lock: x.lock });
  }
  if (url.includes("/api/chart") && (init.method || "GET") === "GET") {
    assert.strictEqual(init.headers.Cookie, "sid=abc");
    return json(200, { chart: state.chart ? Object.assign({ version: state.version }, state.chart) : null, lock: state.lock });
  }
  if (url.endsWith("/api/chart") && init.method === "PUT") {
    if (init.headers.Origin !== "https://clinical-pharmacy-app.onrender.com") return json(403, { message: "طلب غير موثوق" });
    const b = JSON.parse(init.body);
    if (b.slot === "extra") {
      const x = state.extra;
      if (b.expectedVersion !== (x.chart ? x.version : 0)) return json(409, { message: "stale" });
      x.saved = b; x.version = (x.chart ? x.version : 0) + 1;
      const known = ["paracetamol 500mg tab", "omeprazole 20mg cap"];
      x.chart = {
        patients: b.patients.map(p => ({ row_number: p.rowNumber, patient_name: p.name, patient_id: p.patientId })),
        columns: b.columns.filter(c => known.includes(String(c.medicineName).toLowerCase())).map(c => ({ column_number: c.columnNumber, medicine_name: c.medicineName })),
        quantities: b.quantities.map(q => ({ row_number: q.rowNumber, column_number: q.columnNumber, quantity: q.quantity }))
      };
      return json(200, {});
    }
    if (state.conflictOnce) { state.conflictOnce = false; state.version++; return json(409, { message: "تغيّر" }); }
    if (b.expectedVersion !== (state.chart ? state.version : 0)) return json(409, { message: "stale" });
    state.saved = b;
    const known = ["paracetamol 500mg tab", "omeprazole 20mg cap"];
    state.version = (state.chart ? state.version : 0) + 1;
    state.chart = {
      patients: b.patients.map(p => ({ row_number: p.rowNumber, patient_name: p.name, patient_id: p.patientId })),
      columns: b.columns.filter(c => known.includes(String(c.medicineName).toLowerCase())).map(c => ({ column_number: c.columnNumber, medicine_name: c.medicineName })),
      quantities: b.quantities.filter(q => b.columns.some(c => c.columnNumber === q.columnNumber && known.includes(String(c.medicineName).toLowerCase())))
        .map(q => ({ row_number: q.rowNumber, column_number: q.columnNumber, quantity: q.quantity }))
    };
    return json(200, {});
  }
  throw new Error("unexpected " + url);
};
const handler = require("../api/chart-sync.js");
async function call(body, headers) {
  const res = { code: 0, out: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.out = o; return this; }, end() { return this; } };
  await handler({ method: "POST", headers: Object.assign({ origin: "https://clinical-chart.vercel.app", authorization: "Bearer t" }, headers || {}), body }, res);
  return res;
}
const TSV = "\t\tParacetamol 500mg Tab\nتجربة 1\t9001\t6";
const base = { action: "send", date: "2026-12-31", tsv: TSV };   // shared account (env)

(async () => {
  let n = 0;
  const t = async (name, fn) => { reset(); await fn(); n++; };

  await t("send to an empty chart saves and logs out", async () => {
    const r = await call(base);
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.strictEqual(r.out.summary.newPatients, 1);
    assert.strictEqual(state.saved.patients[0].name, "تجربة 1");
    assert.strictEqual(state.saved.ward, "الردهة الخامسة");
    assert.strictEqual(r.headers["Access-Control-Allow-Origin"], "https://clinical-chart.vercel.app");
    await new Promise(s => setTimeout(s, 0));
    assert.ok(calls.includes("POST https://clinical-pharmacy-app.onrender.com/api/auth/logout"));
  });
  await t("not signed in to our app → 401, chart never contacted", async () => {
    state.appUserOk = false;
    const r = await call(base);
    assert.strictEqual(r.code, 401);
    assert.ok(!calls.some(c => c.includes("onrender")));
  });
  await t("shared account from the environment is used; a personal one overrides it", async () => {
    await call(base);
    assert.deepStrictEqual(state.lastLogin, { username: "ward5", password: "shared-secret" });
    await call(Object.assign({}, base, { username: "me", password: "mine" }));
    assert.deepStrictEqual(state.lastLogin, { username: "me", password: "mine" });
  });
  await t("no shared account and none sent → 412 needAccount", async () => {
    delete process.env.CHART_USERNAME; delete process.env.CHART_PASSWORD;
    const r = await call(base);
    assert.strictEqual(r.code, 412);
    assert.strictEqual(r.out.needAccount, true);
  });
  await t("doctors (or no role) can't send", async () => {
    state.role = "doctor";
    const r = await call(base);
    assert.strictEqual(r.code, 403);
    assert.ok(!calls.some(c => c.includes("onrender")));
  });
  await t("wrong personal chart password → 401 with the chart's message", async () => {
    state.loginOk = false;
    const r = await call(Object.assign({}, base, { username: "me", password: "bad" }));
    assert.strictEqual(r.code, 401);
    assert.strictEqual(r.out.message, "بيانات الدخول غير صحيحة");
  });
  await t("wrong shared password → 401 says to fix it on Vercel", async () => {
    state.loginOk = false;
    const r = await call(base);
    assert.strictEqual(r.out.shared, true);
    assert.ok(/Vercel/.test(r.out.message));
  });
  await t("someone else editing the chart → 423, nothing saved", async () => {
    state.chart = { patients: [], columns: [], quantities: [] };
    state.lock = { held: true, mine: false, holder: { name: "صيدلي آخر" } };
    const r = await call(base);
    assert.strictEqual(r.code, 423);
    assert.ok(/صيدلي آخر/.test(r.out.message));
    assert.strictEqual(state.saved, undefined);
  });
  await t("a change made meanwhile (409) → read again and save once more", async () => {
    state.chart = { patients: [], columns: [], quantities: [] };
    state.conflictOnce = true;
    const r = await call(base);
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.ok(state.saved);
  });
  await t("test action only reads", async () => {
    state.chart = { patients: [{ row_number: 1, patient_name: "أ", patient_id: "1" }], columns: [], quantities: [] };
    const r = await call({ action: "test", date: "2026-10-16" });
    assert.strictEqual(r.out.patients, 1);
    assert.ok(!calls.some(c => c.startsWith("PUT")));
  });
  await t("bad table → 400", async () => {
    const r = await call(Object.assign({}, base, { tsv: "x" }));
    assert.strictEqual(r.code, 400);
  });
  await t("names are mapped to the chart's list; unknown ones reported, everything verified", async () => {
    const r = await call(Object.assign({}, base, { tsv: "\t\tparacetamol 500 mg tablet\tZzz Unknown 5mg\nتجربة 1\t9001\t6\t2" }));
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.strictEqual(state.saved.columns[0].medicineName, "Paracetamol 500mg Tab");
    assert.ok(r.out.summary.skipped.some(x => /Zzz Unknown/.test(x)));
    assert.strictEqual(r.out.summary.verified, true);
    assert.strictEqual(r.out.complete, true);
  });
  // ---- 41 rows, 50 beds: the patients that do not fit go to «الجارت الإضافي» ----
  const fullMain = () => ({
    patients: Array.from({ length: 41 }, (_, k) => ({ row_number: k + 1, patient_name: "مريض " + (k + 1), patient_id: String(100000 + k) })),
    columns: [], quantities: []
  });
  await t("main chart full → the new patient is saved in the extra chart (slot extra), nothing lost", async () => {
    state.chart = fullMain();
    const r = await call(base);
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.strictEqual(state.extra.saved.slot, "extra");
    assert.strictEqual(state.extra.saved.patients[0].name, "تجربة 1");
    assert.strictEqual(state.extra.saved.columns[0].medicineName, "Paracetamol 500mg Tab");
    assert.strictEqual(state.extra.saved.quantities[0].quantity, 6);
    assert.strictEqual(r.out.summary.extra.patients, 1);
    assert.strictEqual(r.out.complete, true);
    // the main chart still holds its 41 patients and not the new one
    assert.ok(!state.saved.patients.some(p => p.name === "تجربة 1"));
    assert.ok(!r.out.summary.skipped.some(x => /صفوف فارغة/.test(x)));
  });
  await t("a patient already in the extra chart is updated there, not added to the main chart", async () => {
    state.chart = { patients: [], columns: [], quantities: [] };   // the main chart has room
    state.extra.chart = { patients: [{ row_number: 1, patient_name: "تجربة 1", patient_id: "9001" }], columns: [], quantities: [] };
    const r = await call(base);
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.ok(!state.saved.patients.some(p => p.name === "تجربة 1"), "not duplicated in the main chart");
    assert.strictEqual(state.extra.saved.patients.filter(p => p.name === "تجربة 1").length, 1);
    assert.strictEqual(state.extra.saved.quantities[0].quantity, 6);
  });
  await t("extra chart open for editing by someone else → main saved, the others reported", async () => {
    state.chart = fullMain();
    state.extra.lock = { held: true, mine: false, holder: { name: "صيدلي آخر" } };
    const r = await call(base);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.out.complete, false);
    assert.ok(r.out.summary.skipped.some(x => /الجارت الإضافي مفتوح/.test(x) && /تجربة 1/.test(x)));
    assert.strictEqual(state.extra.saved, null);
  });
  await t("main chart with room → no extra chart is written", async () => {
    state.chart = { patients: [], columns: [], quantities: [] };
    await call(base);
    assert.strictEqual(state.extra.saved, null);
  });
  await t("nodouble: which of our names the chart app does not double on Thursdays (mapped like the send)", async () => {
    state.medicines = [{ name: "Cannula", no_thursday_double: true }, { name: "Paracetamol 500mg Tab" }, { name: "Nystatin Susp", no_thursday_double: true }];
    const r = await call({ action: "nodouble", date: "2026-10-22", names: ["Cannula", "paracetamol 500 mg tablet", "Nystatin Susp", "Zzz Unknown 5mg"] });
    assert.strictEqual(r.code, 200, JSON.stringify(r.out));
    assert.deepStrictEqual(r.out.noDouble.slice().sort(), ["Cannula", "Nystatin Susp"]);
    assert.ok(!calls.some(c => c.startsWith("PUT")));
  });
  await t("nodouble: signed-in pharmacists only", async () => {
    state.role = "doctor";
    const r = await call({ action: "nodouble", date: "2026-10-22", names: ["Cannula"] });
    assert.strictEqual(r.code, 403);
  });
  console.log(n + " tests passed");
})().catch(e => { console.error(e); process.exit(1); });
