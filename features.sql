-- ============================================================
-- features.sql — الحساسية + سجل تغييرات المريض (يُشغّل بعد security.sql)
-- ============================================================
-- 1. عمود allergies في جدول patients.
-- 2. جدول patient_events: سجل تلقائي يكتبه الخادم نفسه (trigger)
--    عند كل دخول/خروج مريض، إضافة/إيقاف دواء، تغيير جرعة أو حساسية.
--    اسم المستخدم يُؤخذ من الجلسة، فلا يمكن تزويره من المتصفح.
--    يُستخدم في "سجل التغييرات" داخل صفحة المريض و"التقرير الشهري".
-- 3. جدول patient_archive: قوائم الخروج والوفيات (كانت على الجهاز فقط).
-- 4. عمود medications.available: توفر الدواء في المستشفى.
--    السجلات لا تُعدَّل بعد حفظها؛ الحذف للمسؤول فقط.
--
-- آمن لإعادة التشغيل (idempotent).
-- ============================================================

-- ---------- 1) الحساسية + المرضى المستضافون ----------
alter table public.patients add column if not exists allergies text not null default '';
-- القسم الأصلي للمريض المستضاف ('' = مريض الردهة) + ملاحظة اختيارية
alter table public.patients add column if not exists origin_ward text not null default '';
alter table public.patients add column if not exists origin_note text not null default '';

-- ---------- 2) سجل الأحداث ----------
create table if not exists public.patient_events (
  id           bigserial primary key,
  bed_key      text not null,
  patient_name text not null default '',
  event        text not null,                -- admitted | discharged | med_added | med_removed | med_changed | allergies
  med_id       text not null default '',
  med_name     text not null default '',
  detail       text not null default '',
  username     text not null default '',
  user_id      uuid,
  created_at   timestamptz not null default now()
);
create index if not exists patient_events_bed_idx  on public.patient_events (bed_key, created_at desc);
create index if not exists patient_events_time_idx on public.patient_events (created_at);

alter table public.patient_events enable row level security;
revoke all on public.patient_events from anon;
drop policy if exists "staff_read_patient_events" on public.patient_events;
create policy "staff_read_patient_events" on public.patient_events
  for select to authenticated
  using (public.app_role() is not null);
-- لا سياسات insert/update/delete: الكتابة من الـ trigger فقط.

-- medications قد تُخزَّن كمصفوفة JSON أو كنص JSON — نوحّدها كمصفوفة
create or replace function public._meds_array(j jsonb)
returns jsonb
language plpgsql immutable
as $$
begin
  if j is null then return '[]'::jsonb; end if;
  if jsonb_typeof(j) = 'string' then
    begin
      j := (j #>> '{}')::jsonb;
    exception when others then
      return '[]'::jsonb;
    end;
  end if;
  if jsonb_typeof(j) <> 'array' then return '[]'::jsonb; end if;
  return j;
end $$;

create or replace function public._med_label(m jsonb)
returns text
language sql immutable
as $$
  select coalesce(nullif(m->>'nameEn', ''), nullif(m->>'nameTrade', ''), nullif(m->>'nameAr', ''), m->>'id', '')
$$;

create or replace function public._med_regimen(m jsonb)
returns text
language sql immutable
as $$
  select trim(coalesce(m->>'dose', '') || ' ' || coalesce(m->>'frequency', ''))
$$;

create or replace function public.patients_log_events()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_user     text := coalesce((select username from public.profiles where id = auth.uid()), '');
  v_uid      uuid := auth.uid();
  v_bed      text;
  v_name     text;
  v_old_name text := '';
  v_new_name text := '';
  v_old      jsonb := '[]'::jsonb;
  v_new      jsonb := '[]'::jsonb;
  m          jsonb;
  o          jsonb;
  v_recent   bigint;
begin
  -- A bed move (app_move_patient) logs its own 'moved' event
  if current_setting('app.moving', true) = '1' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_name := coalesce(old.name, '');
    v_old      := public._meds_array(old.medications);
    v_bed      := old.bed_key;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_name := coalesce(new.name, '');
    v_new      := public._meds_array(new.medications);
    v_bed      := new.bed_key;
  end if;
  v_name := coalesce(nullif(trim(v_new_name), ''), v_old_name);

  -- ----- discharge (bed emptied or row deleted) -----
  if trim(v_old_name) <> '' and (tg_op = 'DELETE' or trim(v_new_name) = '') then
    insert into public.patient_events (bed_key, patient_name, event, username, user_id)
    values (v_bed, v_old_name, 'discharged', v_user, v_uid);
    return null;
  end if;

  -- ----- admission (bed becomes occupied) -----
  if trim(v_new_name) <> '' and trim(v_old_name) = '' then
    insert into public.patient_events (bed_key, patient_name, event, username, user_id)
    values (v_bed, v_new_name, 'admitted', v_user, v_uid);
  elsif trim(v_new_name) <> '' and v_new_name <> v_old_name then
    -- name still being typed / corrected: keep the latest name on this stay's events
    update public.patient_events e
       set patient_name = v_new_name
     where e.bed_key = v_bed
       and e.created_at > coalesce((select max(created_at) from public.patient_events
                                    where bed_key = v_bed and event = 'admitted'), now() - interval '1 day');
  end if;

  if trim(v_new_name) = '' then
    return null;  -- empty bed: medication noise is not logged
  end if;

  -- ----- boarder origin (القسم الأصلي) set / changed -----
  if coalesce(new.origin_ward, '') <> (case when tg_op = 'UPDATE' then coalesce(old.origin_ward, '') else '' end) then
    insert into public.patient_events (bed_key, patient_name, event, detail, username, user_id)
    values (v_bed, v_name, 'origin', coalesce(new.origin_ward, ''), v_user, v_uid);
  end if;

  -- ----- medications added / changed -----
  for m in select * from jsonb_array_elements(v_new) loop
    select x into o from jsonb_array_elements(v_old) x where x->>'id' = m->>'id' limit 1;
    if o is null then
      insert into public.patient_events (bed_key, patient_name, event, med_id, med_name, detail, username, user_id)
      values (v_bed, v_name, 'med_added', coalesce(m->>'id', ''), public._med_label(m), public._med_regimen(m), v_user, v_uid);
    elsif public._med_regimen(o) <> public._med_regimen(m) then
      -- typing a dose fires many updates: merge into the same event for a few minutes
      select id into v_recent from public.patient_events
       where bed_key = v_bed and event = 'med_changed' and med_id = coalesce(m->>'id', '')
         and username = v_user and created_at > now() - interval '3 minutes'
       order by id desc limit 1;
      if v_recent is not null then
        update public.patient_events
           set detail = split_part(detail, ' → ', 1) || ' → ' || public._med_regimen(m),
               patient_name = v_name
         where id = v_recent;
      else
        insert into public.patient_events (bed_key, patient_name, event, med_id, med_name, detail, username, user_id)
        values (v_bed, v_name, 'med_changed', coalesce(m->>'id', ''), public._med_label(m),
                public._med_regimen(o) || ' → ' || public._med_regimen(m), v_user, v_uid);
      end if;
    end if;
  end loop;

  -- ----- medications removed -----
  for o in select * from jsonb_array_elements(v_old) loop
    if not exists (select 1 from jsonb_array_elements(v_new) x where x->>'id' = o->>'id') then
      insert into public.patient_events (bed_key, patient_name, event, med_id, med_name, detail, username, user_id)
      values (v_bed, v_name, 'med_removed', coalesce(o->>'id', ''), public._med_label(o), public._med_regimen(o), v_user, v_uid);
    end if;
  end loop;

  -- ----- allergies -----
  if tg_op = 'UPDATE' and coalesce(old.allergies, '') <> coalesce(new.allergies, '') then
    select id into v_recent from public.patient_events
     where bed_key = v_bed and event = 'allergies' and username = v_user
       and created_at > now() - interval '3 minutes'
     order by id desc limit 1;
    if v_recent is not null then
      update public.patient_events set detail = coalesce(new.allergies, '') where id = v_recent;
    else
      insert into public.patient_events (bed_key, patient_name, event, detail, username, user_id)
      values (v_bed, v_name, 'allergies', coalesce(new.allergies, ''), v_user, v_uid);
    end if;
  end if;

  return null;
end $$;

drop trigger if exists patients_log_events on public.patients;
create trigger patients_log_events
  after insert or update or delete on public.patients
  for each row execute function public.patients_log_events();

-- ---------- 3) أرشيف الخروج والوفيات ----------
create table if not exists public.patient_archive (
  id          text primary key,                 -- generated by the app (uuid)
  kind        text not null check (kind in ('discharged', 'dead')),
  name        text not null default '',
  record      jsonb not null default '{}'::jsonb, -- full patient record at discharge / death
  event_at    timestamptz not null default now(),
  created_by  text not null default '',
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists patient_archive_kind_idx on public.patient_archive (kind, event_at desc);

alter table public.patient_archive enable row level security;
revoke all on public.patient_archive from anon;
drop policy if exists "staff_read_archive"   on public.patient_archive;
drop policy if exists "staff_insert_archive" on public.patient_archive;
drop policy if exists "admin_delete_archive" on public.patient_archive;
create policy "staff_read_archive" on public.patient_archive
  for select to authenticated using (public.app_role() is not null);
create policy "staff_insert_archive" on public.patient_archive
  for insert to authenticated with check (public.app_role() is not null);
create policy "admin_delete_archive" on public.patient_archive
  for delete to authenticated using (public.app_role() = 'admin');
-- لا سياسة update: السجل المحفوظ لا يُعدَّل.

create or replace function public.patient_archive_stamp()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.user_id    := auth.uid();
  new.created_by := coalesce((select username from public.profiles where id = auth.uid()), '');
  new.created_at := now();
  return new;
end $$;
drop trigger if exists patient_archive_stamp on public.patient_archive;
create trigger patient_archive_stamp before insert on public.patient_archive
  for each row execute function public.patient_archive_stamp();

-- ---------- 4) النقل: إلى قسم آخر (أرشيف) + بين الأسرّة ----------
alter table public.patient_archive drop constraint if exists patient_archive_kind_check;
alter table public.patient_archive add constraint patient_archive_kind_check
  check (kind in ('discharged', 'dead', 'transferred'));

-- نقل مريض إلى سرير فارغ داخل الردهة، في عملية واحدة:
-- ينقل الصف + سجل التغييرات لهذه الإقامة إلى السرير الجديد، ويسجّل حدث 'moved'
-- (لا يُحسب خروجاً ودخولاً في التقرير).
create or replace function public.app_move_patient(p_from text, p_to text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_row   public.patients%rowtype;
  v_since timestamptz;
  v_room  int;
  v_bed   int;
begin
  if public.app_role() is null or public.app_role() = 'tv' then
    raise exception 'forbidden';
  end if;
  if p_from = p_to then
    raise exception 'same_bed';
  end if;
  select * into v_row from public.patients where bed_key = p_from for update;
  if not found or trim(coalesce(v_row.name, '')) = '' then
    raise exception 'source_empty';
  end if;
  if exists (select 1 from public.patients where bed_key = p_to and trim(coalesce(name, '')) <> '') then
    raise exception 'target_occupied';
  end if;
  v_room := substring(p_to from 'room-(\d+)-')::int;
  v_bed  := substring(p_to from '-bed-(\d+)$')::int;
  if v_room is null or v_bed is null then
    raise exception 'bad_target';
  end if;

  perform set_config('app.moving', '1', true);   -- silence the logging trigger
  delete from public.patients where bed_key = p_to; -- empty leftover row, if any
  update public.patients
     set bed_key = p_to, room_id = v_room, bed_number = v_bed, updated_at = now()
   where bed_key = p_from;

  -- this stay's history follows the patient: events since the latest
  -- admission — or, when this stay has no admission event (patients
  -- entered before the log existed), since the previous patient left.
  -- The previous patients' events stay on the old bed.
  select max(created_at) into v_since from public.patient_events
   where bed_key = p_from and event in ('admitted', 'discharged');
  update public.patient_events set bed_key = p_to
   where bed_key = p_from and event <> 'discharged'
     and created_at >= coalesce(v_since, '-infinity'::timestamptz);

  insert into public.patient_events (bed_key, patient_name, event, detail, username, user_id)
  values (p_to, v_row.name, 'moved',
          'من غرفة ' || v_row.room_id || ' سرير ' || v_row.bed_number,
          coalesce((select username from public.profiles where id = auth.uid()), ''), auth.uid());
  perform set_config('app.moving', '0', true);
end $$;
revoke all on function public.app_move_patient(text, text) from public, anon;
grant execute on function public.app_move_patient(text, text) to authenticated;

-- ---------- 5) توفر الأدوية في المستشفى ----------
-- false = غير متوفر حالياً (يعدّله المسؤول من «توفر الأدوية»)
alter table public.medications add column if not exists available boolean not null default true;

-- ---------- 6) اسم الدواء في الجارت ----------
-- الاسم الذي يُرسَل إلى تطبيق الجارت (يملؤه التطبيق تلقائياً من قائمة الجارت)
alter table public.medications add column if not exists name_chart text;

-- ---------- 7) حماية التعديل المتزامن على المرضى ----------
-- لكل مريض رقم إصدار تزيده قاعدة البيانات مع كل حفظ. الجهاز يرسل رقم الإصدار
-- الذي بنى عليه تعديله (base_version)؛ إذا كان أقدم من الموجود يُرفض الحفظ
-- (لا تمحو نسخة قديمة نسخة أحدث) فيدمج التطبيق التعديلين ويحفظ من جديد.
alter table public.patients add column if not exists version integer not null default 0;
alter table public.patients add column if not exists base_version integer;

create or replace function public.patients_version_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.base_version is not null and new.base_version < old.version then
      return null;                         -- نسخة قديمة: يبقى الأحدث
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.base_version := null;
  return new;
end $$;

drop trigger if exists patients_version_guard on public.patients;
create trigger patients_version_guard
  before insert or update on public.patients
  for each row execute function public.patients_version_guard();

-- ---------- 8) الإشعارات المشتركة بين الأجهزة ----------
-- من يرى ماذا:
--   ما يفعله الطبيب      → الأطباء + الصيادلة + المسؤول
--   ما يفعله الصيدلاني   → الصيادلة + المسؤول
--   ما يفعله المسؤول     → المسؤول + الصيادلة
-- (صاحب الفعل لا يُشعَر بفعله — يتجاهله التطبيق)
-- الجدول قد يكون موجوداً من schema.sql القديم (id نصّي بلا قيمة افتراضية،
-- لم يكن التطبيق يستعمله) — نكمله بدل إنشاء جديد.
create table if not exists public.notifications (
  id           text primary key default gen_random_uuid()::text,
  type         text not null default '',
  message      text not null default '',
  patient_name text not null default '',
  room         text not null default '',
  created_at   timestamptz not null default now()
);
alter table public.notifications alter column id set default gen_random_uuid()::text;
alter table public.notifications add column if not exists actor_id   uuid default auth.uid();
alter table public.notifications add column if not exists actor_name text not null default '';
alter table public.notifications add column if not exists actor_role text not null default '';
alter table public.notifications add column if not exists audience   text[] not null default '{}';
create index if not exists notifications_time_idx on public.notifications (created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, insert, delete on public.notifications to authenticated;

-- الصلاحية القديمة من security.sql كانت تسمح للجميع بقراءة كل شيء — تُحذف
-- (شغّل features.sql دائماً بعد security.sql)
drop policy if exists "staff_all_notifications" on public.notifications;

drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications
  for select to authenticated
  using (public.app_role() = any (audience));

drop policy if exists "notifications_send" on public.notifications;
create policy "notifications_send" on public.notifications
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and actor_role = public.app_role()
    and audience <@ (case public.app_role()
                       when 'doctor' then array['doctor', 'pharmacist', 'admin']
                       else array['pharmacist', 'admin'] end)
  );

drop policy if exists "notifications_admin_delete" on public.notifications;
create policy "notifications_admin_delete" on public.notifications
  for delete to authenticated
  using (public.app_role() = 'admin');

-- البث الفوري للأجهزة الأخرى
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;   -- already there, or the publication covers all tables
end $$;

-- ---------- 9) التربيت ----------
-- المسؤول يوزّع الغرف على الصيادلة؛ الصيدلاني يسجّل إنهاء تربيت ملف كل مريض يومياً.
create table if not exists public.tarbeet_assignments (
  room_id         integer primary key,
  pharmacist_id   uuid,
  pharmacist_name text not null default '',
  updated_at      timestamptz not null default now()
);
create table if not exists public.tarbeet_log (
  id              bigint generated always as identity primary key,
  day             date not null,
  bed_key         text not null,
  patient_name    text not null default '',
  pharmacist_id   uuid not null default auth.uid(),
  pharmacist_name text not null default '',
  done_at         timestamptz not null default now(),
  unique (day, bed_key)
);

alter table public.tarbeet_assignments enable row level security;
alter table public.tarbeet_log enable row level security;
revoke all on public.tarbeet_assignments from anon;
revoke all on public.tarbeet_log from anon;
grant select, insert, update, delete on public.tarbeet_assignments to authenticated;
grant select, insert, delete on public.tarbeet_log to authenticated;

drop policy if exists "tarbeet_assign_read" on public.tarbeet_assignments;
create policy "tarbeet_assign_read" on public.tarbeet_assignments
  for select to authenticated using (public.app_role() in ('pharmacist', 'admin'));
drop policy if exists "tarbeet_assign_admin" on public.tarbeet_assignments;
create policy "tarbeet_assign_admin" on public.tarbeet_assignments
  for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

drop policy if exists "tarbeet_log_read" on public.tarbeet_log;
create policy "tarbeet_log_read" on public.tarbeet_log
  for select to authenticated using (public.app_role() in ('pharmacist', 'admin'));
drop policy if exists "tarbeet_log_insert" on public.tarbeet_log;
create policy "tarbeet_log_insert" on public.tarbeet_log
  for insert to authenticated
  with check (public.app_role() in ('pharmacist', 'admin') and pharmacist_id = auth.uid());
drop policy if exists "tarbeet_log_delete" on public.tarbeet_log;
create policy "tarbeet_log_delete" on public.tarbeet_log
  for delete to authenticated
  using (pharmacist_id = auth.uid() or public.app_role() = 'admin');

do $$
begin
  alter publication supabase_realtime add table public.tarbeet_assignments;
exception when others then null;   -- already there, or the publication covers all tables
end $$;
do $$
begin
  alter publication supabase_realtime add table public.tarbeet_log;
exception when others then null;   -- already there, or the publication covers all tables
end $$;

-- ---------- 10) التربيت: أسرّة محددة داخل الغرف ----------
-- صيدلاني السرير يتقدّم على صيدلاني الغرفة.
create table if not exists public.tarbeet_bed_assignments (
  bed_key         text primary key,
  pharmacist_id   uuid,
  pharmacist_name text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.tarbeet_bed_assignments enable row level security;
revoke all on public.tarbeet_bed_assignments from anon;
grant select, insert, update, delete on public.tarbeet_bed_assignments to authenticated;
drop policy if exists "tarbeet_bed_read" on public.tarbeet_bed_assignments;
create policy "tarbeet_bed_read" on public.tarbeet_bed_assignments
  for select to authenticated using (public.app_role() in ('pharmacist', 'admin'));
drop policy if exists "tarbeet_bed_admin" on public.tarbeet_bed_assignments;
create policy "tarbeet_bed_admin" on public.tarbeet_bed_assignments
  for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
do $$
begin
  alter publication supabase_realtime add table public.tarbeet_bed_assignments;
exception when others then null;   -- already there, or the publication covers all tables
end $$;

-- ---------- 11) المزامنة الفورية لجداول المرضى والأدوية ----------
-- بدونها لا يصل إضافة / تعديل مريض إلى الأجهزة الأخرى إلا بالفحص الدوري.
do $$
begin
  alter publication supabase_realtime add table public.patients;
exception when others then null;   -- already there, or the publication covers all tables
end $$;
do $$
begin
  alter publication supabase_realtime add table public.medications;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.med_requests;
exception when others then null;
end $$;

-- ---------- 12) مسح سجل النشاط الحساس (المسؤول فقط) ----------
grant delete on public.audit_log to authenticated;
drop policy if exists "admin_delete_audit" on public.audit_log;
create policy "admin_delete_audit" on public.audit_log
  for delete to authenticated
  using (public.app_role() = 'admin');

-- ---------- 14) التربيت: ✓ تم / ✗ لم يتم ----------
alter table public.tarbeet_log add column if not exists status text not null default 'done';
do $$
begin
  alter table public.tarbeet_log add constraint tarbeet_log_status_check check (status in ('done', 'not_done'));
exception when others then null;   -- already there
end $$;

-- ---------- 15) حساب التلفاز (tv): يعرض الردهة فقط ----------
-- يقرأ المرضى والكتالوج للعرض، ولا يكتب أي شيء.
-- (شغّل هذا القسم بعد security.sql دائماً — security.sql يعيد السياسات القديمة)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'pharmacist', 'doctor', 'tv'));

-- العاملون فعلاً (كل الأدوار عدا التلفاز)
create or replace function public.app_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.app_role() in ('admin', 'pharmacist', 'doctor'), false)
$$;
revoke all on function public.app_staff() from public, anon;
grant execute on function public.app_staff() to authenticated;

-- المرضى: القراءة لكل الأدوار، والكتابة للعاملين فقط
drop policy if exists "staff_all_patients" on public.patients;
drop policy if exists "read_patients" on public.patients;
create policy "read_patients" on public.patients
  for select to authenticated using (public.app_role() is not null);
drop policy if exists "staff_insert_patients" on public.patients;
create policy "staff_insert_patients" on public.patients
  for insert to authenticated with check (public.app_staff());
drop policy if exists "staff_update_patients" on public.patients;
create policy "staff_update_patients" on public.patients
  for update to authenticated using (public.app_staff()) with check (public.app_staff());
drop policy if exists "staff_delete_patients" on public.patients;
create policy "staff_delete_patients" on public.patients
  for delete to authenticated using (public.app_staff());

-- طلبات الأدوية، السجل، الأرشيف: العاملون فقط
drop policy if exists "staff_all_med_requests" on public.med_requests;
create policy "staff_all_med_requests" on public.med_requests
  for all to authenticated using (public.app_staff()) with check (public.app_staff());
drop policy if exists "staff_insert_audit" on public.audit_log;
create policy "staff_insert_audit" on public.audit_log
  for insert to authenticated with check (public.app_staff());
drop policy if exists "staff_insert_archive" on public.patient_archive;
create policy "staff_insert_archive" on public.patient_archive
  for insert to authenticated with check (public.app_staff());

-- الإشعارات: التلفاز لا يرسل
drop policy if exists "notifications_send" on public.notifications;
create policy "notifications_send" on public.notifications
  for insert to authenticated
  with check (
    public.app_staff()
    and actor_id = auth.uid()
    and actor_role = public.app_role()
    and audience <@ (case public.app_role()
                       when 'doctor' then array['doctor', 'pharmacist', 'admin']
                       else array['pharmacist', 'admin'] end)
  );

-- ---------- 16) التلفاز مركز إشعارات: إضاءة الأسرّة فوراً ----------
-- (تغيير علاج من patient_events، خروج / وفاة من patient_archive)
do $$
begin
  alter publication supabase_realtime add table public.patient_events;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.patient_archive;
exception when others then null;
end $$;

-- ---------- 17) إعدادات عامة (مقولات شاشة العرض) ----------
-- key 'display_quotes' = { list: [...], pinned: '' } — الكل يقرأ، المسؤول فقط يكتب
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
grant select, insert, update, delete on public.app_settings to authenticated;
drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings
  for select to authenticated using (public.app_role() is not null);
drop policy if exists "settings_admin" on public.app_settings;
create policy "settings_admin" on public.app_settings
  for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when others then null;
end $$;

-- ---------- 18) تبديل سريري مريضين (سحب مريض وإفلاته على مريض آخر) ----------
-- في عملية واحدة: يتبادل المريضان السريرين، وسجل كل منهما (لهذه الإقامة) يتبعه،
-- ويُسجَّل حدث 'moved' لكل منهما.
create or replace function public.app_swap_patients(p_a text, p_b text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_a       public.patients%rowtype;
  v_b       public.patients%rowtype;
  v_since_a timestamptz;
  v_since_b timestamptz;
  v_user    text;
  v_tmp     text := '__swap__' || p_a;
begin
  if public.app_role() is null or public.app_role() = 'tv' then
    raise exception 'forbidden';
  end if;
  if p_a = p_b then
    raise exception 'same_bed';
  end if;
  select * into v_a from public.patients where bed_key = p_a for update;
  select * into v_b from public.patients where bed_key = p_b for update;
  if not found or v_a.bed_key is null
     or trim(coalesce(v_a.name, '')) = '' or trim(coalesce(v_b.name, '')) = '' then
    raise exception 'not_two_patients';
  end if;
  v_user := coalesce((select username from public.profiles where id = auth.uid()), '');

  -- each stay's events (since its admission, or since the previous patient left)
  select max(created_at) into v_since_a from public.patient_events
   where bed_key = p_a and event in ('admitted', 'discharged');
  select max(created_at) into v_since_b from public.patient_events
   where bed_key = p_b and event in ('admitted', 'discharged');

  perform set_config('app.moving', '1', true);   -- silence the logging trigger
  update public.patients set bed_key = v_tmp where bed_key = p_a;
  update public.patients
     set bed_key = p_a, room_id = v_a.room_id, bed_number = v_a.bed_number, updated_at = now()
   where bed_key = p_b;
  update public.patients
     set bed_key = p_b, room_id = v_b.room_id, bed_number = v_b.bed_number, updated_at = now()
   where bed_key = v_tmp;

  update public.patient_events set bed_key = v_tmp
   where bed_key = p_a and event <> 'discharged' and created_at >= coalesce(v_since_a, '-infinity'::timestamptz);
  update public.patient_events set bed_key = p_a
   where bed_key = p_b and event <> 'discharged' and created_at >= coalesce(v_since_b, '-infinity'::timestamptz);
  update public.patient_events set bed_key = p_b where bed_key = v_tmp;

  insert into public.patient_events (bed_key, patient_name, event, detail, username, user_id) values
    (p_b, v_a.name, 'moved', 'من غرفة ' || v_a.room_id || ' سرير ' || v_a.bed_number || ' (تبديل)', v_user, auth.uid()),
    (p_a, v_b.name, 'moved', 'من غرفة ' || v_b.room_id || ' سرير ' || v_b.bed_number || ' (تبديل)', v_user, auth.uid());
  perform set_config('app.moving', '0', true);
end $$;
revoke all on function public.app_swap_patients(text, text) from public, anon;
grant execute on function public.app_swap_patients(text, text) to authenticated;

-- ---------- 19) صلاحية تعديل كتالوج الأدوية لصيدلاني محدد ----------
-- المسؤول يمنحها من «إدارة المستخدمين» (زر «الكتالوج»)
alter table public.profiles add column if not exists can_edit_catalog boolean not null default false;

-- ---------- 20) ساعة الخادم بدل ساعة الهاتف ----------
-- ساعات الهواتف تختلف بثوانٍ أو دقائق، فكانت مقارنة «وقت الحذف» بـ«وقت المريض الجديد»
-- تُخفي مريضاً أُدخل بعد حذف السرير. الآن: (أ) القاعدة نفسها تضع updated_at مع كل حفظ،
-- (ب) دالة تعطي الجهاز وقت الخادم ليقيس فرق ساعته.
create or replace function public.patients_version_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.base_version is not null and new.base_version < old.version then
      return null;                         -- نسخة قديمة: يبقى الأحدث
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.base_version := null;
  new.updated_at := now();                 -- ساعة الخادم، لا ساعة الهاتف
  return new;
end $$;

create or replace function public.app_server_time() returns timestamptz
language sql stable as $$ select now() $$;
revoke all on function public.app_server_time() from public, anon;
grant execute on function public.app_server_time() to authenticated;

-- ---------- 21) هوية المريض (pid): مفتاح السرير يُعاد استعماله ----------
-- حالة حدثت: نُقل مريض من سرير 22 إلى 23 ودخل مريض جديد في 22. جهاز لم يصله النقل ظلّ يرى
-- القديم في 22 (رقم إصداره أعلى من إصدار الجديد فاعتُبرت نسخته «أحدث») أو أعاد حفظه فمحا الجديد.
-- لكل مريض الآن معرّف pid تضعه القاعدة عند الإدخال ويبقى معه عند النقل؛ نسخة مبنية على
-- مريض آخر (base_pid) تُرفض.
alter table public.patients add column if not exists pid uuid;
alter table public.patients add column if not exists base_pid uuid;
update public.patients set pid = gen_random_uuid() where pid is null;

create or replace function public.patients_version_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.base_version is not null and new.base_version < old.version then
      return null;                         -- نسخة قديمة: يبقى الأحدث
    end if;
    if new.base_pid is not null and old.pid is not null and new.base_pid <> old.pid then
      return null;                         -- النسخة لمريض سابق في هذا السرير
    end if;
    new.version := old.version + 1;
    new.pid := old.pid;                    -- المعرّف لا يُغيَّر من الجهاز
    new.base_version := null;
    new.base_pid := null;
  else
    -- ملاحظة: upsert ينفّذ هذا الفرع أولاً حتى لو وُجد الصف؛ لا نمسح base_* هنا
    -- وإلا وصلت فارغة إلى فرع التحديث وتعطّل الفحص.
    new.version := 1;
    new.pid := gen_random_uuid();
  end if;
  new.updated_at := now();                 -- ساعة الخادم، لا ساعة الهاتف
  return new;
end $$;

-- ---------- 22) صلاحيتان إضافيتان لصيدلاني محدد ----------
-- can_exit_patients: حذف المريض وتفريغ السرير والخروج (discharge) والوفاة لكل المرضى
-- can_edit_quotes:   إدارة مقولات شاشة العرض
-- يمنحهما المسؤول من «إدارة المستخدمين» (زرّا «الحذف والخروج» و«المقولات»).
alter table public.profiles add column if not exists can_exit_patients boolean not null default false;
alter table public.profiles add column if not exists can_edit_quotes   boolean not null default false;

-- كتابة المقولات (app_settings، المفتاح display_quotes فقط): المسؤول أو صيدلاني مسموح له
create or replace function public.app_can_edit_quotes()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.app_role() = 'admin', false)
      or exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'pharmacist' and active is not false
                    and can_edit_quotes = true)
$$;
revoke all on function public.app_can_edit_quotes() from public, anon;
grant execute on function public.app_can_edit_quotes() to authenticated;

drop policy if exists "settings_quotes_editor" on public.app_settings;
create policy "settings_quotes_editor" on public.app_settings
  for all to authenticated
  using (key = 'display_quotes' and public.app_can_edit_quotes())
  with check (key = 'display_quotes' and public.app_can_edit_quotes());

-- منح الصلاحيتين الآن: مريم أحمد عبد علي (الحذف والخروج) وولاء حيدر علي (المقولات).
-- الاسم يُطابَق تقريبياً؛ راجع الناتج: يجب أن يظهر صف واحد لكل اسم.
update public.profiles set can_exit_patients = true
 where role = 'pharmacist' and display_name ilike 'مريم%عبد%'
 returning username, display_name, can_exit_patients;
update public.profiles set can_edit_quotes = true
 where role = 'pharmacist' and display_name ilike 'ولاء%حيدر%'
 returning username, display_name, can_edit_quotes;

-- أعد تحميل مخطط الـ API حتى تظهر الجداول الجديدة فوراً للتطبيق
notify pgrst, 'reload schema';


-- ---------- 23) مسؤولة الطابق (مسؤول بصلاحيات أقل) ----------
-- limited_admin: يبقى role = 'admin' (فتعمل كل سياسات RLS) لكن الواجهة تخفي: كتالوج الأدوية، طباعة كل الأوراق،
-- مظهر المناسبات، التهاني والترحيب، طلب إضافة دواء، وضع التلفاز، زخرفة الشريط، مسح طلبات الأدوية.
alter table public.profiles add column if not exists limited_admin boolean not null default false;

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

-- ---------- 26) كتالوج الأدوية للمسؤول الأعلى وحده ----------
-- تُسحب صلاحية الكتالوج من كل الصيادلة؛ التطبيق لا يمنحها بعد الآن (Auth.canEditCatalog = المسؤول ذو الصلاحية القصوى فقط).
update public.profiles set can_edit_catalog = false where can_edit_catalog = true;

-- ---------- 27) ربط الدواء بموقع الأسعار ----------
-- price_ref = رقم الدواء في موقع الأسعار (mediprice-pharmacy.vercel.app)، وprice_seen = آخر سعر اعتمده المسؤول؛
-- إن تغيّر سعر الدواء في الموقع أو زال تظهر علامة صفراء عليه في الكتالوج.
alter table public.medications add column if not exists price_ref text;
alter table public.medications add column if not exists price_seen numeric;

-- ---------- 28) صلاحية «مواقف وزارة الصحة» ----------
-- المسؤول يمنحها لصيدلاني أو أكثر من إدارة المستخدمين؛ المسؤول نفسه يملكها دائمًا.
alter table public.profiles add column if not exists can_ministry boolean not null default false;
