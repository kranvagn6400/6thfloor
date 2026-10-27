/* ============================================================
   api/chart-sync.js  —  Vercel function: fills the chart app
   ============================================================
   The chart app (clinical-pharmacy-app.onrender.com) has no import and
   can't be scripted from another site, so this function does what the
   pharmacist would do by hand, with the pharmacist's own chart account:
     1. log in to the chart app (POST /api/auth/login)
     2. read the ward's chart for the day (GET /api/chart)
     3. merge our table into it (js/chart-merge.js — reuses rows /
        columns already there, never touches other cells)
     4. save it (PUT /api/chart with expectedVersion; a 409 from a
        change made meanwhile → read + merge again, once)
     5. log out
   Chart account: the ward's shared account from the Vercel environment
   variables CHART_USERNAME / CHART_PASSWORD (never in the code), or a
   personal one sent with the request (kept on that device). Callers must
   be signed in to our app as an active pharmacist or admin.

   POST { action: "send" | "test" | "nodouble", username?, password?, date, tsv, names? }
   "nodouble": which of our medicine names (names[]) the chart app does NOT double on
   Thursdays (its «لا يُضاعف يوم الخميس» flag) — used by «الطلبية».
   ============================================================ */

const Merge = require("../js/chart-merge.js");

const CHART_SITE = "https://clinical-pharmacy-app.onrender.com";
const CHART_API = CHART_SITE + "/api";
// The chart's server rejects saves / sign-out without its own Origin
// ("طلب غير موثوق") — send what its own page sends.
const SITE_HEADERS = { Origin: CHART_SITE, Referer: CHART_SITE + "/" };
const WARD = { floor: 6, ward: "الطابق السادس", slot: "main" };
const SUPABASE_URL = "https://khbvyfchwtvdbrkdhfwz.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoYnZ5ZmNod3R2ZGJya2RoZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDQ5NzMsImV4cCI6MjEwODYyMDk3M30.shQzIsK2UueUCty79bj0fWFtZ6DGGDMlkJ0oKxhPcVk";
const ORIGINS = ["https://clinical-chart.vercel.app", "https://cheny1000.github.io", "http://localhost:5173"];

function cors(req, res) {
  const o = req.headers.origin;
  if (ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function fail(res, status, message) {
  res.status(status).json({ ok: false, message });
}

// Our app's signed-in user (the same check the database uses)
async function appUser(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON, Authorization: auth } });
  return r.ok ? r.json() : null;
}

// Their role in our app (profiles row — readable by its own user under RLS)
async function appRole(req, user) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/profiles?select=role,active&id=eq." + encodeURIComponent(user.id), {
    headers: { apikey: SUPABASE_ANON, Authorization: req.headers.authorization }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  const p = Array.isArray(rows) ? rows[0] : null;
  return p && p.active !== false ? p.role : null;
}

function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=)/);
  return list.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function chartFetch(path, cookie, init) {
  const r = await fetch(CHART_API + path, Object.assign({}, init, {
    headers: Object.assign({ Cookie: cookie, "Content-Type": "application/json" }, SITE_HEADERS, (init && init.headers) || {})
  }));
  let body = null;
  try { body = await r.json(); } catch (e) { /* empty */ }
  return { status: r.status, ok: r.ok, body };
}

const chartQuery = (slot, date) => "?" + new URLSearchParams({ floor: WARD.floor, ward: WARD.ward, slot, date });

// Merge our table into ONE chart of the chart app (slot "main" or "extra") and
// save it; a 409 (someone changed it meanwhile) → read + merge once more.
// `got` = the GET of that chart. → { ok, summary, overflow, complete } | { ok: false, message }
async function saveSlot(slot, got, data, catalogue, cookie, date, mergeOpts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const chart = got.body.chart;
    const { body, summary, overflow } = Merge.merge(chart, data, catalogue, mergeOpts);
    const put = await chartFetch("/chart", cookie, {
      method: "PUT",
      body: JSON.stringify(Object.assign({ floor: WARD.floor, ward: WARD.ward, slot, date }, body,
        { expectedVersion: chart ? chart.version : 0 }))
    });
    if (put.ok) {
      // Read back: the chart drops what it doesn't accept without an error
      const back = await chartFetch("/chart" + chartQuery(slot, date), cookie);
      const missing = back.ok ? Merge.verify(back.body.chart, body) : null;
      if (missing) {
        missing.meds.forEach(m => summary.skipped.push("لم يحفظه الجارت: الدواء «" + m + "»"));
        missing.patients.forEach(p => summary.skipped.push("لم يحفظه الجارت: المريض «" + p + "»"));
        if (missing.cells) summary.skipped.push("لم يحفظ الجارت " + missing.cells + " من الكميات");
      }
      summary.verified = !!missing;
      const allIn = !!missing && !missing.meds.length && !missing.patients.length && !missing.cells;
      return { ok: true, summary, overflow, complete: allIn };
    }
    if (put.status !== 409 || attempt === 1) {
      return { ok: false, message: (put.body && put.body.message) || "تعذّر حفظ الجارت" };
    }
    got = await chartFetch("/chart" + chartQuery(slot, date), cookie);   // changed meanwhile → merge into the newer copy
    if (!got.ok) return { ok: false, message: "تعذّر قراءة الجارت" };
  }
  return { ok: false, message: "تعذّر حفظ الجارت" };
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") return fail(res, 405, "POST only");

  const user = await appUser(req).catch(() => null);
  if (!user) return fail(res, 401, "سجّل الدخول إلى تطبيق الردهة من جديد");
  const role = await appRole(req, user).catch(() => null);
  if (role !== "pharmacist" && role !== "admin") return fail(res, 403, "الإرسال إلى الجارت للصيادلة والمسؤول فقط");

  const { action, date, tsv } = req.body || {};
  // A personal account sent by the device wins; else the ward's shared one
  const personal = !!(req.body && req.body.username && req.body.password);
  const username = personal ? req.body.username : process.env.CHART_USERNAME;
  const password = personal ? req.body.password : process.env.CHART_PASSWORD;
  if (!username || !password) {
    return res.status(412).json({ ok: false, needAccount: true, message: "لم يُضبط حساب الجارت المشترك — أدخل حساب الجارت" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return fail(res, 400, "تاريخ غير صالح");
  const data = action === "send" ? Merge.parseTsv(tsv) : null;
  if (action === "send" && (!data || !data.rows.length)) return fail(res, 400, "لا توجد بيانات مرضى للإرسال");

  // 1) log in (the chart app may be waking up — first request can be slow)
  let cookie = "";
  try {
    const r = await fetch(CHART_API + "/auth/login", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, SITE_HEADERS),
      body: JSON.stringify({ username: String(username), password: String(password) })
    });
    if (!r.ok) {
      let msg = "";
      try { msg = (await r.json()).message || ""; } catch (e) { /* not json */ }
      if (r.status === 401 || r.status === 400) {
        return res.status(401).json({ ok: false, shared: !personal,
          message: personal ? (msg || "بيانات حساب الجارت غير صحيحة")
            : "حساب الجارت المشترك غير صحيح — حدّثه في إعدادات Vercel (" + (msg || "رفض الدخول") + ")" });
      }
      return fail(res, 502, msg || "تعذّر تسجيل الدخول إلى الجارت");
    }
    cookie = cookiesFrom(r);
    if (!cookie) return fail(res, 502, "الجارت لم يُرجع جلسة دخول");
  } catch (e) {
    return fail(res, 502, "تعذّر الوصول إلى موقع الجارت");
  }

  const q = chartQuery(WARD.slot, date);
  try {
    if (action === "nodouble") {
      const medsRes = await chartFetch("/medicines", cookie);
      if (!(medsRes.ok && medsRes.body && Array.isArray(medsRes.body.medicines))) return fail(res, 502, "تعذّر قراءة قائمة أدوية الجارت");
      const list = medsRes.body.medicines;
      const flagged = new Set(list.filter(m => m.no_thursday_double).map(m => Merge.norm(m.name)));
      const ours = (Array.isArray(req.body.names) ? req.body.names : []).slice(0, 400).map(String);
      // our names → the chart's names (same matching as the send), then the flag
      const known = Merge.matchCatalogue(ours, list.map(m => m.name));
      const noDouble = ours.filter(n => { const c = known.get(n); return c && flagged.has(Merge.norm(c)); });
      return res.status(200).json({ ok: true, noDouble });
    }
    let got = await chartFetch("/chart" + q, cookie);
    if (!got.ok) return fail(res, 502, (got.body && got.body.message) || "تعذّر قراءة الجارت");

    if (action === "test") {
      const chart = got.body.chart;
      return res.status(200).json({
        ok: true,
        patients: chart ? chart.patients.filter(p => p.patient_name && p.patient_name.trim()).length : 0,
        lock: got.body.lock || null
      });
    }

    const lock = got.body.lock;
    if (lock && lock.held && !lock.mine) {
      const who = lock.holder && (lock.holder.name || lock.holder.fullName || lock.holder.username || lock.holder);
      return fail(res, 423, "الجارت مفتوح للتعديل الآن" + (who && typeof who === "string" ? " عند " + who : "") + " — أعد الإرسال بعد قليل");
    }

    // The chart drops medicine names it doesn't know — match ours to its list
    const medsRes = await chartFetch("/medicines", cookie);
    const catalogue = medsRes.ok && medsRes.body && Array.isArray(medsRes.body.medicines)
      ? medsRes.body.medicines.map(m => m.name) : null;
    if (!catalogue) return fail(res, 502, "تعذّر قراءة قائمة أدوية الجارت");

    // The chart has 41 rows, the ward 50 beds: patients that do not fit go to the
    // chart app's «الجارت الإضافي» (slot "extra"). It is read first so that a patient
    // already living there is not added to the main chart as well.
    const gotExtra = await chartFetch("/chart" + chartQuery("extra", date), cookie);
    const extraChart = gotExtra.ok ? gotExtra.body.chart : null;
    const skipRow = (r) => gotExtra.ok && Merge.hasPatient(extraChart, r);

    const main = await saveSlot(WARD.slot, got, data, catalogue, cookie, date, { collectOverflow: true, skipRow });
    if (!main.ok) return fail(res, 502, main.message);
    const summary = main.summary;
    let complete = main.complete;

    if (main.overflow.length) {
      const names = main.overflow.map(r => r.name).join("، ");
      const extraLock = gotExtra.ok ? gotExtra.body.lock : null;
      if (!gotExtra.ok) {
        summary.skipped.push("تعذّر قراءة الجارت الإضافي — لم يُرسل: " + names);
        complete = false;
      } else if (extraLock && extraLock.held && !extraLock.mine) {
        summary.skipped.push("الجارت الإضافي مفتوح للتعديل عند آخر — أعد الإرسال لهؤلاء: " + names);
        complete = false;
      } else {
        const ex = await saveSlot("extra", gotExtra, Merge.subset(data, main.overflow), catalogue, cookie, date, {});
        if (!ex.ok) {
          summary.skipped.push("تعذّر الحفظ في الجارت الإضافي (" + ex.message + ") — لم يُرسل: " + names);
          complete = false;
        } else {
          summary.extra = { patients: ex.summary.patients, newPatients: ex.summary.newPatients, meds: ex.summary.meds, newMeds: ex.summary.newMeds, cells: ex.summary.cells };
          ex.summary.skipped.forEach(x => summary.skipped.push("الجارت الإضافي: " + x));
          complete = complete && ex.complete;
        }
      }
    }
    return res.status(200).json({ ok: true, complete: !!complete, summary });
  } catch (e) {
    return fail(res, 502, "انقطع الاتصال بموقع الجارت");
  } finally {
    if (cookie) fetch(CHART_API + "/auth/logout", { method: "POST", headers: Object.assign({ Cookie: cookie }, SITE_HEADERS) }).catch(() => {});
  }
};
