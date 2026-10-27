// LIVE test against the real chart app (clinical-pharmacy-app.onrender.com), EXTRA chart (slot "extra"):
// does the chart app accept a save into «الجارت الإضافي» and keep the patient + medicine?
//
// Safe by construction — it only ever touches 2099-12-31 (a day no ward will
// use), refuses to run if that day already holds anything, saves ONE fake
// patient + two medicine columns (52 and 60), reads back what survived, then
// empties the day again and checks that it is empty.
//
// Run it yourself (the chart password is never in the code):
//   PowerShell:  $env:CHART_USERNAME="..."; $env:CHART_PASSWORD="..."; node scripts/live-chart-extra.js
//   bash:        CHART_USERNAME=... CHART_PASSWORD=... node scripts/live-chart-extra.js
const SITE = "https://clinical-pharmacy-app.onrender.com";
const API = SITE + "/api";
const HEAD = { Origin: SITE, Referer: SITE + "/" };
const WARD = { floor: 8, ward: "الردهة الخامسة", slot: "extra" };
const DATE = "2099-12-31";          // far future — never a real day
const FAKE = "ZZ-TEST-DELETE-ME";

const user = process.env.CHART_USERNAME, pass = process.env.CHART_PASSWORD;
if (!user || !pass) { console.error("Set CHART_USERNAME and CHART_PASSWORD first."); process.exit(1); }

function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : (res.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=)/);
  return list.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
}
let cookie = "";
async function call(path, init) {
  const r = await fetch(API + path, Object.assign({}, init, { headers: Object.assign({ Cookie: cookie, "Content-Type": "application/json" }, HEAD, (init && init.headers) || {}) }));
  let body = null; try { body = await r.json(); } catch (e) { /* empty */ }
  return { status: r.status, ok: r.ok, body };
}
const q = "?" + new URLSearchParams(Object.assign({}, WARD, { date: DATE }));
const isEmpty = (c) => !c || (!(c.patients || []).some(p => (p.patient_name || "").trim()) &&
  !(c.columns || []).some(x => (x.medicine_name || "").trim()) && !(c.quantities || []).some(x => Number(x.quantity) > 0));

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, HEAD), body: JSON.stringify({ username: user, password: pass }) });
  if (!login.ok) { console.error("Login refused (" + login.status + ")."); process.exit(1); }
  cookie = cookiesFrom(login);
  try {
    const meds = await call("/medicines");
    const names = meds.ok && meds.body && Array.isArray(meds.body.medicines) ? meds.body.medicines.map(m => m.name) : [];
    if (names.length < 2) throw new Error("could not read the chart's medicine list");
    const [m52, m60] = [names[0], names[1]];

    const first = await call("/chart" + q);
    if (!first.ok) throw new Error("GET chart failed: " + first.status);
    if (!isEmpty(first.body.chart)) throw new Error(DATE + " is not empty — refusing to touch it");
    if (first.body.lock && first.body.lock.held && !first.body.lock.mine) throw new Error("chart is locked by someone else");
    let version = first.body.chart ? first.body.chart.version : 0;

    const COLS = 60;
    const build = (fill) => ({
      floor: WARD.floor, ward: WARD.ward, slot: WARD.slot, date: DATE,
      patients: Array.from({ length: 41 }, (_, k) => ({ rowNumber: k + 1, name: fill && k === 0 ? FAKE : "", patientId: fill && k === 0 ? "999999" : "" })),
      columns: Array.from({ length: COLS }, (_, k) => ({ columnNumber: k + 1, medicineName: fill && k + 1 === 52 ? m52 : fill && k + 1 === 60 ? m60 : "" })),
      quantities: fill ? [{ rowNumber: 1, columnNumber: 52, quantity: 1 }, { rowNumber: 1, columnNumber: 60, quantity: 2 }] : []
    });

    console.log("1) saving a fake patient with medicines in column 52 and column 60 on " + DATE + " …");
    const put = await call("/chart", { method: "PUT", body: JSON.stringify(Object.assign(build(true), { expectedVersion: version })) });
    console.log("   PUT →", put.status, put.ok ? "ok" : JSON.stringify(put.body));

    const back = await call("/chart" + q);
    const c = back.body && back.body.chart;
    const col = (n) => (c && (c.columns || []).find(x => x.column_number === n)) || null;
    const qty = (n) => (c && (c.quantities || []).find(x => x.row_number === 1 && x.column_number === n)) || null;
    console.log("2) read back:");
    console.log("   column 52:", col(52) && col(52).medicine_name ? "KEPT (" + col(52).medicine_name + "), quantity " + (qty(52) ? qty(52).quantity : "none") : "DROPPED");
    console.log("   column 60:", col(60) && col(60).medicine_name ? "KEPT (" + col(60).medicine_name + "), quantity " + (qty(60) ? qty(60).quantity : "none") : "DROPPED");
    console.log("   highest column number in the chart:", c ? Math.max(0, ...(c.columns || []).map(x => x.column_number)) : "-");
    version = c ? c.version : version;

    console.log("3) clearing the day …");
    const clear = await call("/chart", { method: "PUT", body: JSON.stringify(Object.assign(build(false), { expectedVersion: version })) });
    console.log("   PUT →", clear.status, clear.ok ? "ok" : JSON.stringify(clear.body));
    const after = await call("/chart" + q);
    console.log("4) " + DATE + " is now", isEmpty(after.body && after.body.chart) ? "EMPTY ✓" : "NOT EMPTY — open the chart for " + DATE + " and clear it by hand");
  } catch (e) {
    console.error("Stopped:", e.message);
  } finally {
    await fetch(API + "/auth/logout", { method: "POST", headers: Object.assign({ Cookie: cookie }, HEAD) }).catch(() => {});
  }
})();
