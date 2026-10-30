/* ============================================================
   api/ministry-send.js  —  Vercel function: sends a Ministry of Health «موقف» form
   ============================================================
   POST { form: "ivig", values: {...} } with the signed-in user's token (Authorization: Bearer …).
   Allowed: an active admin, or a pharmacist the admin gave «مواقف الوزارة» (profiles.can_ministry).
   The values are checked against the form's own lists (js/ministry-forms.js) and posted to THAT form only.
   ============================================================ */

const MF = require("../js/ministry-forms.js");

const SUPABASE_URL = "https://khbvyfchwtvdbrkdhfwz.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoYnZ5ZmNod3R2ZGJya2RoZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDQ5NzMsImV4cCI6MjEwODYyMDk3M30.shQzIsK2UueUCty79bj0fWFtZ6DGGDMlkJ0oKxhPcVk";
const ORIGINS = ["https://6thfloor.vercel.app", "https://kranvagn6400.github.io", "http://localhost:5174"];

function cors(req, res) {
  const o = req.headers.origin;
  if (ORIGINS.includes(o)) { res.setHeader("Access-Control-Allow-Origin", o); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
const fail = (res, status, message) => res.status(status).json({ ok: false, message });

async function appUser(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON, Authorization: auth } });
  return r.ok ? r.json() : null;
}
// role / active / can_ministry of the caller (their own profiles row — readable under RLS)
async function appProfile(req, user) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/profiles?select=role,active,can_ministry,limited_admin&id=eq." + encodeURIComponent(user.id), {
    headers: { apikey: SUPABASE_ANON, Authorization: req.headers.authorization }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : null;
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") return fail(res, 405, "method");

  const user = await appUser(req);
  if (!user) return fail(res, 401, "سجّل الدخول أولًا");
  const prof = await appProfile(req, user);
  // FOR NOW only the supreme admin (an admin who is not the limited floor manager); later: the admin + the pharmacists with can_ministry
  const allowed = prof && prof.active !== false && prof.role === "admin" && prof.limited_admin !== true;
  // const allowed = prof && prof.active !== false && (prof.role === "admin" || (prof.role === "pharmacist" && prof.can_ministry === true));
  if (!allowed) return fail(res, 403, "لا تملك صلاحية رفع مواقف الوزارة");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const formId = body && body.form, values = body && body.values;
  const form = MF.FORMS[formId];
  if (!form) return fail(res, 400, "نموذج غير معروف");
  const bad = MF.validate(formId, values);
  if (bad) return fail(res, 400, bad);

  // the meropenem register: one JSON row posted to its Google Apps Script (it answers nothing useful, so success = the post went through)
  if (form.kind === "script") {
    try {
      const r0 = await fetch(form.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(MF.toPayload(formId, values)) });
      if (!r0.ok) return fail(res, 502, "تعذّر الإرسال إلى سجل الميرونيم (" + r0.status + ")");
      return res.status(200).json({ ok: true, unverified: true });
    } catch (e) {
      return fail(res, 502, "تعذّر الوصول إلى سجل الميرونيم — حاول لاحقًا");
    }
  }

  // a form that collects an email address (the colistin one): the ward's address from the server settings — never in the code
  const email = form.needsEmail ? String(process.env.MINISTRY_EMAIL || "").trim() : "";
  if (form.needsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 412, "نموذج الكوليستين يطلب بريدًا إلكترونيًا ولم يُضبط بعد: أضف MINISTRY_EMAIL في إعدادات Vercel");

  let r, text = "";
  try {
    r = await fetch(MF.postUrl(form), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: MF.formUrl(form) },
      body: MF.toBody(formId, values, { email })
    });
    text = await r.text();
  } catch (e) {
    return fail(res, 502, "تعذّر الوصول إلى نموذج الوزارة — حاول لاحقًا");
  }
  // Google's confirmation page says the answer was recorded; anything else = not recorded
  const recorded = r.ok && /freebirdFormviewerViewResponseConfirmationMessage|تم تسجيل إجابتك|Your response has been recorded/i.test(text);
  if (!recorded) return fail(res, 502, "لم يؤكّد النموذج تسجيل الإجابة (" + r.status + ") — افتح النموذج وتأكد قبل المحاولة ثانية");
  res.status(200).json({ ok: true });
};
