-- شغّل في Supabase ← SQL Editor (مرة واحدة)
update public.profiles set can_edit_catalog = false where can_edit_catalog = true;
