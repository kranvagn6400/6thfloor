-- شغّل هذا الملف كاملًا في Supabase ← SQL Editor (مرة واحدة؛ آمن لإعادة التشغيل). يتطلب القسم 23.
-- ---------- 24) إنشاء مستخدم من التطبيق (بدون signUp) ----------
-- signUp من المتصفح يرفض البريد الداخلي (@ward5.local) برسالة "email invalid"؛ هذه الدالة تنشئ المستخدم في الخادم.
-- المسؤول فقط؛ مسؤول الطابق (limited_admin) لا يستطيع إنشاء مسؤول ذي صلاحية قصوى (يمنعه الحارس في §25).
create or replace function public.admin_create_user(
  p_email text, p_username text, p_password text, p_display_name text, p_role text, p_limited boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare v_id uuid := gen_random_uuid(); v_email text := lower(trim(p_email));
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password_too_short'; end if;
  if p_role not in ('admin', 'pharmacist', 'doctor', 'tv') then raise exception 'bad_role'; end if;
  if v_email = '' or lower(trim(p_username)) = '' then raise exception 'bad_username'; end if;
  if exists (select 1 from auth.users where email = v_email) or exists (select 1 from public.profiles where username = lower(trim(p_username))) then
    raise exception 'duplicate user';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_email), 'email', v_id::text, now(), now(), now());
  insert into public.profiles (id, username, display_name, role, active, created_by, limited_admin)
  values (v_id, lower(trim(p_username)), p_display_name, p_role, true,
          coalesce((select username from public.profiles where id = auth.uid()), 'admin'), coalesce(p_limited, false));
  return v_id;
end $$;
revoke all on function public.admin_create_user(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_create_user(text, text, text, text, text, boolean) to authenticated;

-- ---------- 25) حماية المسؤول ذي الصلاحية القصوى ----------
-- المسؤول ذو الصلاحية القصوى = role 'admin' و limited_admin = false (مصطفى حسين). لا أحد غيره يستطيع تعديل حسابه أو حذفه
-- أو تعطيله أو تغيير كلمة مروره، ولا يستطيع مسؤول الطابق (آية، آمنة) رفع صلاحية نفسه أو غيره. أوامر SQL editor (بلا مستخدم) غير مقيّدة.
create or replace function public.app_is_super()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' and active is not false and limited_admin = false
                     from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.app_is_super() then
    if tg_op in ('UPDATE', 'DELETE') and old.role = 'admin' and old.limited_admin = false then
      raise exception 'protected_account';
    end if;
    if tg_op in ('INSERT', 'UPDATE') and new.role = 'admin' and new.limited_admin = false then
      raise exception 'protected_account';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard();

-- إعادة تعيين كلمة المرور: لا تُغيَّر كلمة مرور المسؤول الأعلى إلا منه
create or replace function public.admin_reset_password(p_user uuid, p_password text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'forbidden';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'password_too_short';
  end if;
  if not public.app_is_super()
     and exists (select 1 from public.profiles where id = p_user and role = 'admin' and limited_admin = false) then
    raise exception 'protected_account';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
end $$;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
