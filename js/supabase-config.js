/* ============================================================
   supabase-config.js  —  PRE-CONFIGURED for this hospital deployment
   ============================================================

   This file embeds the Supabase project URL and anon public key so
   that every device that opens the app is automatically connected
   to the same shared cloud catalog — no manual setup needed.

   SECURITY NOTE
   -------------
   The anon public key is designed to be exposed in client-side code.
   Supabase Row-Level-Security (RLS) is the real security boundary,
   not the key. As long as your RLS policies are correct, exposing the
   anon key is safe.

   Current RLS (see security.sql): anon has NO access to any table.
   Every read/write requires a signed-in Supabase Auth user with an
   active row in `profiles`; catalog writes are admin/pharmacist only.

   To override this config on a specific device (e.g. for testing
   against a different Supabase project), open the admin panel and
   save a different URL/key there. That local config takes precedence
   over this embedded one.
   ============================================================ */

(function (global) {
  "use strict";

  const EMBEDDED_CONFIG = {
    url:     "https://khbvyfchwtvdbrkdhfwz.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoYnZ5ZmNod3R2ZGJya2RoZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDQ5NzMsImV4cCI6MjEwODYyMDk3M30.shQzIsK2UueUCty79bj0fWFtZ6DGGDMlkJ0oKxhPcVk"
  };

  global.PharmacySupabaseConfig = {
    EMBEDDED_CONFIG
  };
})(window);
