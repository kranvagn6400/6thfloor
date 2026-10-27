/* ============================================================
   auth.js  —  Multi-user auth for the clinical pharmacy app
   ============================================================

   Three roles (stored in the Supabase `profiles` table):
     - "admin"      : full access (catalog, users, audit log, settings)
     - "pharmacist" : ward workflow (rooms, patients, meds, charts)
     - "doctor"     : patient view + med requests

   Login flow (Supabase Auth — see security.sql):
     1. Username is mapped to a synthetic e-mail (usernameToEmail).
     2. supabase.auth.signInWithPassword() verifies the password on
        the server. Password hashes are never readable by the browser.
     3. The user's `profiles` row supplies role + active flag. No
        active profile → sign out and refuse.
     4. RLS on every table checks the signed-in user's profile, so
        the anon key alone gives no access to any data.

   The local session (pharma.session.v1) only drives the UI (which
   buttons to show). The server enforces the real permissions.
   ============================================================ */

(function (global) {
  "use strict";

  const SESSION_KEY = "pharma.session.v1";
  const EMAIL_DOMAIN = "ward5.local";
  const MIN_PASSWORD = 8;

  // ---------- Username ↔ e-mail ----------
  // Supabase Auth needs an e-mail. Plain ASCII usernames map directly;
  // anything else (e.g. Arabic) is hex-encoded so the mapping stays
  // deterministic and e-mail-safe.
  function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
  }
  function usernameToEmail(username) {
    const u = normalizeUsername(username);
    if (/^[a-z0-9._-]{1,64}$/.test(u)) return u + "@" + EMAIL_DOMAIN;
    const bytes = new TextEncoder().encode(u);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return "u-" + hex.slice(0, 62) + "@" + EMAIL_DOMAIN;
  }

  // ---------- Local UI session ----------
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && s.username && s.role) return s;
      return null;
    } catch (e) { return null; }
  }
  function saveSession(account) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        username:    account.username,
        role:        account.role,
        displayName: account.displayName,
        gender:      account.gender || "male",
        canEditCatalog: !!account.canEditCatalog,
        canExitPatients: !!account.canExitPatients,
        canEditQuotes: !!account.canEditQuotes,
        limitedAdmin: !!account.limitedAdmin
      }));
      return true;
    } catch (e) { return false; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); return true; }
    catch (e) { return false; }
  }

  function isLoggedIn()  { return !!loadSession(); }
  function getCurrentUser() { return loadSession(); }
  function isAdmin() {
    const s = loadSession();
    return !!(s && s.role === "admin");
  }
  function isPharmacist() {
    const s = loadSession();
    return !!(s && s.role === "pharmacist");
  }
  // TV account: shows the ward (display mode) and nothing else; the
  // database refuses its writes (features.sql §15)
  function isTv() {
    const s = loadSession();
    return !!(s && s.role === "tv");
  }
  function isDoctor() {
    const s = loadSession();
    return !!(s && s.role === "doctor");
  }

  // ---------- Helpers ----------
  function getClientOrError() {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured || !SB.isConfigured()) return { error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { error: "تعذّر إنشاء عميل Supabase" };
    return { client };
  }
  function errMsg(e) {
    return (e && e.message) ? e.message : String(e);
  }
  // Translate the server's error codes into Arabic for the UI.
  function translateError(message) {
    const m = String(message || "");
    if (/invalid login credentials/i.test(m)) return "اسم المستخدم أو كلمة المرور غير صحيحة";
    if (/already registered|already exists|duplicate/i.test(m)) return "اسم المستخدم موجود بالفعل";
    if (/email not confirmed/i.test(m)) return "الحساب غير مؤكد — أوقف Confirm email في إعدادات Supabase";
    if (/rate limit|too many/i.test(m)) return "محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة";
    if (/invalid_setup_code/.test(m)) return "رمز الإعداد غير صحيح";
    if (/admin_exists/.test(m)) return "يوجد مسؤول بالفعل — سجّل الدخول بحسابه";
    if (/forbidden/.test(m)) return "هذا الإجراء للمسؤول فقط";
    if (/protected_account/.test(m)) return "هذا الحساب محمي — لا يعدّله إلا المسؤول ذو الصلاحية القصوى";
    if (/bad_username/.test(m)) return "اسم الدخول غير صالح";
    if (/admin_create_user|could not find the function/i.test(m)) return "شغّل القسمين 24 و25 من features.sql في Supabase";
    if (/password_too_short|password should be/i.test(m)) return `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل`;
    if (/cannot_delete_self/.test(m)) return "لا يمكنك حذف حسابك";
    if (/failed to fetch|network/i.test(m)) return "تعذّر الاتصال بالخادم — تحقق من الإنترنت";
    return m;
  }

  const PERM_COLS = ", can_edit_catalog, can_exit_patients, can_edit_quotes, limited_admin";

  // Build the UI account from a profiles row. display_name may carry a
  // '|male' / '|female' suffix used by the welcome message.
  function profileToAccount(row) {
    const rawName = row.display_name || row.username;
    const parts = rawName.split("|");
    return {
      username:    row.username,
      role:        row.role || "pharmacist",
      displayName: (parts[0] || "").trim() || row.username,
      gender:      parts[1] === "female" ? "female" : "male",
      canEditCatalog: row.can_edit_catalog === true,     // features.sql §19
      canExitPatients: row.can_exit_patients === true,   // features.sql §22
      canEditQuotes: row.can_edit_quotes === true,       // features.sql §22
      limitedAdmin: row.limited_admin === true           // features.sql §23 (مسؤولة الطابق)
    };
  }

  async function fetchOwnProfile(client, userId) {
    // the permission columns come with features.sql §19 / §22 — read without them until then
    const base = "id, username, display_name, role, active";
    let res;
    for (const cols of [base + PERM_COLS, base + ", can_edit_catalog", base]) {
      res = await client.from("profiles").select(cols).eq("id", userId).maybeSingle();
      if (!res.error || !/can_edit_catalog|can_exit_patients|can_edit_quotes|limited_admin/.test(res.error.message || "")) break;
    }
    if (res.error) throw res.error;
    return res.data;
  }

  // ---------- Login ----------
  async function login(username, password) {
    if (!username || !password) {
      return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };
    }
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: usernameToEmail(username),
        password
      });
      if (error) return { ok: false, error: translateError(error.message) };
      const profile = await fetchOwnProfile(client, data.user.id);
      if (!profile || profile.active === false) {
        await client.auth.signOut();
        return { ok: false, error: "هذا الحساب غير مُفعّل — راجع المسؤول" };
      }
      const account = profileToAccount(profile);
      saveSession(account);
      return { ok: true, account };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // ---------- Change own password ----------
  // The current password is checked first (signing in again with it),
  // then the new one is set on the signed-in account.
  async function changeOwnPassword(currentPassword, newPassword) {
    const s = loadSession();
    if (!s || !s.username) return { ok: false, error: "سجّل الدخول من جديد" };
    if (!currentPassword) return { ok: false, error: "أدخل كلمة المرور الحالية" };
    if (!newPassword || newPassword.length < MIN_PASSWORD) {
      return { ok: false, error: "كلمة المرور الجديدة " + MIN_PASSWORD + " أحرف على الأقل" };
    }
    if (newPassword === currentPassword) return { ok: false, error: "كلمة المرور الجديدة مطابقة للحالية" };
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error: inErr } = await client.auth.signInWithPassword({
        email: usernameToEmail(s.username), password: currentPassword
      });
      if (inErr) return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: translateError(error.message) };
      auditLog("password_changed", "غيّر كلمة المرور الخاصة به");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // Called on boot when a local session exists. Confirms the Supabase
  // session is still valid and refreshes role/active from the server.
  // Returns false only when the user must log in again; network
  // failures keep the cached session so the app still opens offline.
  async function verifySession() {
    const { client } = getClientOrError();
    if (!client) return false;
    try {
      const { data } = await client.auth.getSession();
      const session = data && data.session;
      if (!session) { clearSession(); return false; }
      let profile;
      try {
        profile = await fetchOwnProfile(client, session.user.id);
      } catch (e) {
        return true; // offline / transient — keep the cached session
      }
      if (!profile || profile.active === false) {
        await logout();
        return false;
      }
      saveSession(profileToAccount(profile));
      return true;
    } catch (e) {
      return true;
    }
  }

  async function logout() {
    clearSession();
    const SB = global.PharmacySupabase;
    const client = SB && SB.getClient ? SB.getClient() : null;
    try { if (client) await client.auth.signOut({ scope: "local" }); }
    catch (e) { /* ignore */ }
    try { if (SB && SB.AUTH_STORAGE_KEY) localStorage.removeItem(SB.AUTH_STORAGE_KEY); }
    catch (e) { /* ignore */ }
  }

  // ---------- User management (admin only; enforced by RLS/RPC) ----------
  async function listUsers() {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id, username, display_name, role, active, created_by, created_at" + PERM_COLS)
        .order("created_at", { ascending: true });
      if (error && /can_exit_patients|can_edit_quotes/.test(error.message || "")) {
        const r1 = await client.from("profiles").select("id, username, display_name, role, active, created_by, created_at, can_edit_catalog").order("created_at", { ascending: true });
        if (!r1.error) return { ok: true, users: r1.data || [], noPermColumns: true };
      }
      if (error && /can_edit_catalog/.test(error.message || "")) {
        const r2 = await client.from("profiles").select("id, username, display_name, role, active, created_by, created_at").order("created_at", { ascending: true });
        if (r2.error) return { ok: false, error: translateError(r2.error.message) };
        return { ok: true, users: r2.data || [], noCatalogColumn: true };
      }
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true, users: data || [] };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // Signs the new user up on a throwaway client (so the admin stays
  // signed in), then the admin inserts the matching profile row.
  // role "floor-admin" = an admin with limited powers (profiles.limited_admin, features.sql §23)
  async function createUser(creatorUsername, username, password, displayName, role, gender) {
    const limited = role === "floor-admin";
    if (limited) role = "admin";
    if (!username || !password || !displayName) {
      return { ok: false, error: "أدخل جميع الحقول" };
    }
    if (role !== "admin" && role !== "pharmacist" && role !== "doctor" && role !== "tv") role = "pharmacist";
    if (gender !== "male" && gender !== "female") gender = "male";
    if (password.length < MIN_PASSWORD) {
      return { ok: false, error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل` };
    }
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    // The server creates the user (features.sql §24): the browser's signUp refuses the internal e-mail ("email invalid")
    try {
      const { data: newId, error: rErr } = await client.rpc("admin_create_user", {
        p_email: usernameToEmail(username), p_username: normalizeUsername(username), p_password: password,
        p_display_name: displayName.trim() + "|" + gender, p_role: role, p_limited: limited
      });
      if (!rErr) return { ok: true, user: { id: newId, username: normalizeUsername(username) } };
      if (!/could not find the function|admin_create_user|PGRST202/i.test(rErr.message || "")) {
        return { ok: false, error: translateError(rErr.message) };
      }
      // the function is not installed yet → fall back to signUp (needs a valid e-mail domain)
    } catch (e) { return { ok: false, error: translateError(errMsg(e)) }; }
    const temp = global.PharmacySupabase.createEphemeralClient();
    if (!temp) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { data, error } = await temp.auth.signUp({
        email: usernameToEmail(username),
        password
      });
      if (error) return { ok: false, error: translateError(error.message) };
      // Supabase returns a user with no identities when the e-mail is taken
      if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
        return { ok: false, error: "اسم المستخدم موجود بالفعل" };
      }
      const { data: rows, error: pErr } = await client
        .from("profiles")
        .insert([{
          id: data.user.id,
          username: normalizeUsername(username),
          display_name: displayName.trim() + "|" + gender,
          role,
          active: true,
          created_by: creatorUsername || "admin"
        }])
        .select("id, username, display_name, role, active, created_at");
      if (pErr) return { ok: false, error: translateError(pErr.message) };
      return { ok: true, user: rows && rows[0] };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  async function resetPassword(userId, newPassword) {
    if (!newPassword || newPassword.length < MIN_PASSWORD) {
      return { ok: false, error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل` };
    }
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client.rpc("admin_reset_password", { p_user: userId, p_password: newPassword });
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // Admin: let a pharmacist add / edit medicines in the catalogue
  async function setCatalogEditor(userId, allowed) {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client.from("profiles").update({ can_edit_catalog: !!allowed }).eq("id", userId);
      if (error) return { ok: false, error: /can_edit_catalog/.test(error.message || "") ? "شغّل القسم 19 من features.sql في Supabase" : translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }
  // Admin: give / take a permission flag (can_exit_patients, can_edit_quotes — features.sql §22)
  async function setUserFlag(userId, column, allowed) {
    if (column !== "can_exit_patients" && column !== "can_edit_quotes") return { ok: false, error: "صلاحية غير معروفة" };
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client.from("profiles").update({ [column]: !!allowed }).eq("id", userId);
      if (error) return { ok: false, error: new RegExp(column).test(error.message || "") ? "شغّل القسم 22 من features.sql في Supabase" : translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }
  // Delete a patient / empty a bed / discharge / record a death, for ward
  // patients too: the admin, or a pharmacist the admin allowed
  function canExitPatients() {
    const s = loadSession();
    return !!(s && (s.role === "admin" || (s.role === "pharmacist" && s.canExitPatients)));
  }
  // The ward-display sayings: the admin, or a pharmacist the admin allowed
  function canEditQuotes() {
    const s = loadSession();
    return !!(s && (s.role === "admin" || (s.role === "pharmacist" && s.canEditQuotes)));
  }
  // The supreme admin (مصطفى حسين): admin and not the limited floor manager. Only he can touch his own kind.
  function isSuperAdmin() {
    const s = loadSession();
    return !!(s && s.role === "admin" && !s.limitedAdmin);
  }
  // The floor manager (آية): an admin with fewer powers — no catalogue, print-all, TV mode, ornaments,
  // occasions, greetings, new-medicine requests (features.sql §23; the hiding is in theme.css)
  function isLimitedAdmin() {
    const s = loadSession();
    return !!(s && s.role === "admin" && s.limitedAdmin);
  }
  // The admin, or a pharmacist the admin allowed (features.sql §19)
  function canEditCatalog() {
    const s = loadSession();
    return !!(s && ((s.role === "admin" && !s.limitedAdmin) || (s.role === "pharmacist" && s.canEditCatalog)));
  }

  async function toggleUserActive(userId, currentActive) {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client
        .from("profiles")
        .update({ active: !currentActive })
        .eq("id", userId);
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  async function deleteUser(userId) {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client.rpc("admin_delete_user", { p_user: userId });
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // ---------- Audit log ----------
  // Best-effort. The server stamps username/user_id from the signed-in
  // user (trigger in security.sql), so it can't be forged.
  async function auditLog(action, details) {
    const { client } = getClientOrError();
    if (!client || !loadSession()) return;
    try {
      await client.from("audit_log").insert([{ action, details: details || null }]);
    } catch (e) {
      console.warn("[Auth] auditLog failed:", e);
    }
  }

  async function getAuditLog(limit) {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { data, error } = await client
        .from("audit_log")
        .select("id, username, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(limit || 200);
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true, entries: data || [] };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  // Admin only (RLS: features.sql §12). Deletes every row.
  async function clearAuditLog() {
    const { client, error: cErr } = getClientOrError();
    if (!client) return { ok: false, error: cErr };
    try {
      const { error } = await client.from("audit_log").delete().gt("id", 0);
      if (error) return { ok: false, error: translateError(error.message) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: translateError(errMsg(e)) };
    }
  }

  global.PharmacyAuth = {
    SESSION_KEY,
    MIN_PASSWORD,
    clearAuditLog,
    usernameToEmail,
    // session
    loadSession, saveSession, clearSession, verifySession,
    isLoggedIn, getCurrentUser, isAdmin, isPharmacist, isDoctor, isTv, isLimitedAdmin, isSuperAdmin, canEditCatalog, setCatalogEditor,
    canExitPatients, canEditQuotes, setUserFlag,
    // login / logout
    login, logout,
    changeOwnPassword,
    // user management (admin only)
    listUsers, createUser, resetPassword, toggleUserActive, deleteUser,
    // audit log
    auditLog, getAuditLog
  };
})(window);
