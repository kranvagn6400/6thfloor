# 6th Floor — Internal Medicine, Baghdad Teaching Hospital (PWA)

THIS IS NOT THE WARD 5 APP. It started as a copy of it but is a separate product: its own repo
(github.com/kranvagn6400/6thfloor — GitHub account kranvagn6400, never cheny1000), its own Vercel
project (6thfloor.vercel.app), its own Supabase project (khbvyfchwtvdbrkdhfwz) and its own chart
accounts. Never touch, push to or mention the Ward 5 app / accounts here. Talk to the user in Arabic.

## 6th Floor specifics (these win over anything below inherited from Ward 5)
- Two units, both internal medicine (js/ward.js): الوحدة الأولى = women (room ids 1-12), الوحدة الثالثة = men
  (13-24). Each: 8 general rooms (1-5 six beds, 6-8 four beds) + 4 private rooms (one bed) = 46 beds, 92 in all.
  Bed keys stay room-N-bed-M with the floor-unique room id; room.title / PharmacyWard.roomTitle(id) is what
  users see ("غرفة 3 · الوحدة الأولى", "خاص 2 · …"); bedLabel numbers the general beds 1..42 inside each unit and the private beds 1..4. Gender comes
  from the unit (roomGender). No ICU room.
- Bottom nav (right → left): الوحدة الأولى · حبوب الأولى · المرضى · حبوب الثالثة · الوحدة الثالثة. A unit page has a عام / خاص
  switch (UI.setKind): general rooms or that unit's private rooms. The header «الطلبية» and chart-send buttons act on the open
  page + kind (flowPatientsMap / pickFlowUnit in app.js): general → that unit's chart, private → «ردهة الخاص» (both units
  accumulate in it; the order stays per unit); on pills / patients pages they say «اختر الوحدة أولاً». Pills page per unit
  (PharmacyPillsPage.open("1"|"3")). No تربيتي / الأخصائيون tabs, no handover (hidden by CSS).
- Accounts: only the admin Mustafa Hussein (username mustafa — supervises the app, not a pharmacist here), the floor
  manager Aya Thaer (username aya, role admin + profiles.limited_admin, features.sql §23: no medicine catalogue,
  print-all, occasions, greetings, new-medicine request/clear, TV mode, header ornament — hidden by html.limited-admin
  in theme.css) and the TV account. No pharmacists or doctors yet. Accounts are created in the Supabase dashboard
  (email <user>@ward5.local — the domain is only a mapping suffix in auth.js, kept so existing accounts still work)
  then a profiles row by SQL; there is no bootstrap screen.
- Name: app/icon = "6th Floor"; inside the app "الطابق السادس"; sheets / forms carry the patient's unit name.
- Default colours: white + sky blue (palette sky6, scripts/gen-palettes.js, also the login screen).
- Chart app: three targets (api/chart-sync.js WARDS): "1" الوحدة الأولى, "3" الوحدة الثالثة, "p" ردهة الخاص (the private
  rooms of both units together), floor 6, shared account CHART_USERNAME / CHART_PASSWORD in Vercel env vars (never in
  code). The send dialog has «الردهة الهدف»; the log keeps the unit. Past 41 patients a chart overflows into its own
  extra chart (existing logic). js/chart-sync.js PROD must stay https://6thfloor.vercel.app.
- Local preview: node .claude/serve.js (port 5174). Old tests (scripts/test-*.js) still assume the Ward 5 layout.

## Inherited from the Ward 5 code (modules still apply; layout / roles above override)
Arabic RTL PWA for the ward's clinical pharmacy: 10 rooms / 50 beds, patient meds,
labs + eGFR, printed A4 sheets, chart export, Supabase sync. Plain JS (no build step);
every file attaches a `window.Pharmacy*` global. Talk to the user in Arabic.

## Deploy
- Push to `main` → Vercel (`clinical-chart.vercel.app`) and GitHub Pages redeploy in 1–3 min.
  The site is served from the repo root (the old `download/pharmacy-ward/` copy is gone).
- On any JS/CSS change bump `?v=` on the script tags in `index.html`, the `sw.js?v=`
  registration, and `CACHE_VERSION` in `sw.js` (all the same number).
- `security.sql` is `skip-worktree`: the local copy holds the real setup code — never commit it.

## Database (Supabase) — SQL is run by the user in the SQL editor
1. `schema.sql` — tables. 2. `security.sql` — Supabase Auth + RLS (anon has no access).
3. `features.sql` — `patients.allergies` + `patient_events` (server-side change log trigger).
- Auth: usernames map to `<user>@ward5.local` (`auth.js usernameToEmail`); role/active in `profiles`.
- Concurrent edits (features.sql §7): patients.version is bumped by the DB on every save; the app sends
  base_version and the DB refuses a save built on an older version. persistPatient saves ONE patient
  (SBSync.pushPatient); a refusal → 3-way merge (`patient-merge.js merge3`: base = patient._base,
  local edits, cloud row) and save again. pushPatients sends only _dirty copies. Realtime ignores
  echoes/older versions, merges with unsent edits, and never redraws the open card while a field is
  focused (renderCurrentPatientSafely) — and only when the open patient itself changed (else the meds blink). Storage.putPatient = store a cloud copy without marking it dirty.
  Tests: scripts/test-patient-merge.js, scripts/test-concurrency.js (two devices, fake guarded DB).
- Editing features.sql from a Node script: String.replace turns "$" into "$" in the replacement — use
  split/join or a replacer function, then grep for a lone "as $" / "end $;" (it broke §11 and §18 once).
- A bed that was reused (delete / move, then another patient in it) must never be overwritten by a device that missed it:
  leaving a card saves ONLY a real edit (app.js hasUnsavedEdits vs patient._base — a card merely opened and left is never written);
  opening a card checks that bed in the cloud (verifyOpenedBed → SBSync.fetchBed) and replaces a stale copy; a clean local copy with
  another name loses to the cloud in mergePatients even without a pid; the commit of a delete names the patient (pid filter) and
  runs in the bed's save queue, and opening a bed waiting for its delete commits it first. Tests: scripts/test-concurrency.js.
- `patientToRow` keys must be the real snake_case column names (optional columns are stripped
  on "column not found", so a wrong key silently drops data).

## Modules
- The medicines catalogue lives in the cloud (`medications`; edits push at once, every device pulls it).
  medications.js DEFAULT_MEDICATIONS = a copy of the cloud catalogue (178 meds, 2026-10-18) — only the seed /
  offline fallback; never trust it over the cloud, and refresh it from the cloud (read-only) when asked.
- `clinical.js` matches GENERIC names; catalog trade names / spellings ("Ceftrixone", "Amoxil",
  "Ciprodar", "Voltarin"…) map to generics in `GENERIC_ALIASES` — add new catalog names there.
- `clinical.js` — eGFR, antibiotic detection + per-med course day (`med.startDate`), renal /
  allergy / duplicate / duration alerts, interactions. Pure logic; tests in `scripts/test-clinical.js`.
- `med-availability.js` — "توفر الأدوية" list (admin + pharmacists, shows the dosage form); `med.available` (medications.available,
  features.sql). A toggle pushes ONLY its row (SBSync.pushMedicationRows) and the realtime catalogue pull is held while it is pending
  (PharmacyMedAvailability.busy) — pushing all 178 rows flooded realtime and the pulls undid the first toggle. Unavailable meds are tagged "غير متوفر" in the picker but still selectable.
- Unavailable meds: `clinical.js availableAlternatives` suggests available ones — same substance
  (`genericKey`) first, then a `SUBSTITUTE_CLASSES` group (routine switches only, never e.g. a
  carbapenem for a cephalosporin). Shown as chips under the med in the picker — to doctors + admin, NOT to
  pharmacists (the user asked).
- `tarbeet.js` — التربيت (daily filing round): admin assigns rooms → pharmacists (tarbeet_assignments),
  and single beds when needed (tarbeet_bed_assignments, §10 — a bed's pharmacist wins: ownerOf),
  the "تربيتي" bottom-nav tab (no button in the patient card) (pharmacists + admin: their beds room by room,
  ✓ / crossed-out file ("الملف غير موجود") per bed = tarbeet_log.status not_done, features.sql §14; the lit one clears) writes tarbeet_log (day + bed_key unique,
  undo = delete own); ✓ on done beds; excludes 7th-floor hematology; doctors see nothing (features.sql §9).
- `pills-page.js` — «الحبوب» bottom-nav tab (pharmacists + admin): patients with tablets split الرجال / النساء
  (PharmacyWard.roomGender: rooms 1-4 men, 5 + 7-10 women, 6 = ICU → the patient's gender); edits dose,
  frequency, med.time and med.usage (empty = automatic), which the pills form prints. One section at a time
  (tabs الرجال / النساء — never both on one page). No hematology (orderingState).
  Tests: scripts/test-pills-page.js.
- Patient search (name / plate / doctor / diagnosis, `patient-search.js`) is on the «المرضى» page, not the rooms view.
- `print-sheets.js` — A4 sheets (single + all), shown in an in-app preview first (preview → print), with zoom −/+/ملاءمة.
  Pharmacists get a small view-only «📄 ورقة العلاج» button in the patient card (preview(entries, {viewOnly})) —
  no sign-off / tracking (the user asked for just viewing). `patient-search.js`, `patient-history.js`,
  `monthly-report.js` — use `window.PharmacyApp` (exported by `app.js`).
- `app.js` — state, events, sync; `ui.js` — rendering; `theme.css` — visual theme on top of `styles.css`.

## Ward rules (Baghdad Teaching Hospital, 8th floor, internal medicine ward 5)
- Rooms 1-4 are men's, 5 and 7-10 women's, room 6 is the ICU (both): an unset patient gender is filled
  from the room (app.js ensurePatient → PharmacyWard.roomGender).
- Boarders come only from other medical wards or oncology (`boarders.js`). Our doctors don't
  print their sheets (excluded from "print all"). Pharmacists order their meds as usual, except
  7th-floor hematology patients: never ordered — every ordering path must use
  `orderedPatientsMap()` / `orderingState()` in `app.js`.
- Origin is chosen by floor: مريض الردهة / ط10 / ط9 / ط7 (hematology, never ordered) / ط6; bed badge
  "طابق 9" (badge shown to everyone; the origin field is hidden for doctors — entering
  boarders is the pharmacists' + admin's job). No boarder banners or notes in the patient view (the user asked for none).
- Pharmacist patient header: only name, plate number, specialist (= the attending-doctor
  field, labelled "اسم الأخصائي" for pharmacists) and origin floor (`html.role-pharmacist` CSS).
  Plate number = exactly 6 digits (input keeps digits only, max 6; Arabic-Indic → 0-9); mandatory (blocks adding meds) for
  pharmacists only; OPTIONAL for doctors and the admin (the user confirmed) — but a number they write must be 6 digits.
  Pharmacist header order: name, specialist, plate number, from another floor (CSS order, theme.css).
- Doctor patient card (CSS order, html.role-doctor): three sections — «معلومات المريض» (name, specialist =
  "اسم الأخصائي", plate, age + sex, weight + height, diagnosis, allergy), «التحاليل», then العلاج.
- Lab cells (everyone who can edit labs): name · the recorded result with its date (labs._dates[key]) · a field for
  a NEW result + ✓ (Enter too). Doctors: the lab cells + history are folded until «عرض التحاليل» (setLabsOpen; closed
  on every patient open; the eGFR card stays visible) → app.js recordLabs: the previous result
  moves to labHistory with its own date, the new one is current. Typing alone changes nothing (doctors pressed
  the old «+» thinking it saved). No origin field for doctors.
- Doctor account: settings subtitle "إعدادات المستخدم للطبيب", no monthly report (rows hidden,
  open() guarded).
- Colour themes: each user picks one in settings («ألوان التطبيق», swatches under the dark-mode row) — kept on the device
  (localStorage pharma.palette → html[data-palette]; emerald = none). `css/palettes.css` is GENERATED by
  `node scripts/gen-palettes.js` (edit the script, not the CSS); `js/palettes.js` applies + draws the swatches. The patient-card buttons (discharge / died / return-to-floor / print / pills / view sheet), the «مشغول n/m» chip and the
  bed cards with meds (accent bar + dark-mode fill) follow the theme (color-mix on --primary / --pal-accent); emerald = unchanged.
  Palettes: violet, pink, cyan, charcoal, teal, purple, lilac, skyblue, classic (the original blue app), black. Success/danger/
  "done" greens and the albumin/meronem dots keep their meaning and do not change with the theme.
- Header / login ornament: each user picks one in settings («زخرفة الشريط», chips under the colours) — localStorage
  pharma.ornament → html[data-ornament]; stars = none. `css/ornaments.css` + the chip list in `js/ornaments.js` are GENERATED by
  `node scripts/gen-ornaments.js`; `img/header-art.webp` = the user's own flowing-line drawing (inverted + screen-blended, so its lines turn light).
- Bed lock (`js/presence.js`, Realtime Presence — nothing stored): a bed whose card someone else has open cannot be opened, moved or swapped
  by anyone else until he leaves (app.js blockedByLock → PharmacyPresence.lockedBy); two entering together → the earlier `at` keeps it, the
  other is taken out (leaveBedLocked); the admin may force it after a confirmation (he then goes first, at = 0); a hidden page lets go after 90 s.
- Personal greetings (`js/greetings.js`): a card for the named colleague on her day (welcome-back window / yearly birthday), a toast for the rest.
  The ADMIN manages them on his page («التهاني والترحيب»: add / edit / delete / preview) — app_settings key `greetings` = { events } shared live;
  the built-in DEFAULTS (Hanin, Noor) apply until he saves. The duty roster's name list includes the admin (he is a pharmacist too).
- Press effects (`js/neon.js` + the end of theme.css; every signed-in user): slow neon
  on any tapped button, fire on the log-out buttons, a light sweep on a ticked medicine in the add-medicine sheet, a spinning border on
  the bed that just got a medicine as a rainbow border for 5 s (PharmacyFx.markBed), and a deleted bed that keeps the patient
  shown, cyan/pink glitching, for the 8 s undo window (PharmacyFx.glitchBed + the ghost in app.js deferExit). Saved for later, unused: plasma / ice / rainbow / gold / scan / double —
  `PharmacyFx.play(el, name)` (the user asked to keep them).
- There is NO notification sound (the system was removed at the user's request) — the bell only.
- Specialists list (`specialists-admin.js`, admin page «أسماء الأخصائيين»): the admin edits / deletes / adds / clears the names;
  app_settings key `specialists` = { list } shared live; a rename also renames the patients carrying the old spelling.
- Settings page (⚙) for pharmacists + admin, in this order: مراقبة الأدوية الحرجة, التسليم والاستلام, جدول الخفارات,
  التداخلات الدوائية, توفر الأدوية, المرضى السابقون, (سجل الإرسال إلى الجارت), تغيير كلمة المرور, الوضع الليلي, تسجيل الخروج.
  The admin has a SECOND header button (shield) → his own settings page (#view-admin): أدوات المسؤول (ward display, print all
  sheets, request a new medicine), theme, tarbeet, catalogue, users, quotes, audit… The sections the settings page already
  has are `hidden` there.
- Notifications are shared through the `notifications` table (features.sql §8, RLS by role): a doctor's
  action → doctors + pharmacists + admin; a pharmacist's / the admin's → pharmacists + admin; never the
  actor. pushNotification inserts, realtime INSERT + catch-up on start (pullCloudNotifications) add them
  locally once (Storage.addCloudNotification by cloudId). med_request keeps its own admin path.
  Pharmacists + admin see two parts: "إشعارات الأطباء — مهمة" (actorRole doctor) and the pharmacy's.
- TV account (role `tv`, "تلفاز"): created by the admin; after login it goes straight into the ward display
  (display mode) and can't leave it — its button signs out. Only the admin and the TV account can open the display
  (settings row + header button hidden / guarded for pharmacists and doctors). The DB refuses all its writes
  (features.sql §15: app_staff(), split patients policies — run §15 after security.sql). Auth.isTv().
- Ward display header shows a saying (`daily-quotes.js`). The admin manages them on the admin page
  («مقولات شاشة العرض»: pick one to keep / «تلقائي» = one a day, add, delete) — app_settings key
  display_quotes = { list, pinned } (features.sql §17). QUOTES = the built-in list until the admin saves.
  Only sayings the user provides — never add our own. Tests: scripts/test-daily-quotes.js.
  Header button «حكمة اليوم» (✦ icon, everyone) shows today's saying in a popup (showPopup).
  A verse: in the popup ALWAYS two lines (one per half); on the TV ONE line (both halves side by side, the
  user asked); no separator star; whatever doesn't fit gets a smaller font (renderInto / fit).
- Ward display layout: all 10 rooms on one screen (5 × 2 grid sized in vh, no scrolling; portrait → 2 a row),
  beds in each room laid out like the ward / rooms view (2 columns: right then left per row). Albumin / meronem
  beds keep the normal colour — only the yellow / red dots.
- Ward display = notification board (`tv-alerts.js`, display mode for the TV and the admin): a bed is lit
  for an hour after a new admission (patient_events admitted → green; writing that patient's medicines
  stays green), a medicine change of a patient already there (med_* → orange), a discharge
  (patient_archive discharged → pink; a return to the floor is not lit) or a death (black); newest wins. A medicine alert shows only the time (no drug name). Realtime (§16) + 30 s poll. Tests:
  scripts/test-tv-alerts.js.
- Catalogue editing for chosen pharmacists: profiles.can_edit_catalog (features.sql §19), toggled by the admin in
  user management («الكتالوج»); Auth.canEditCatalog(); such a pharmacist gets settings «إدارة كتالوج الأدوية» → the
  admin view with only the medicines list + form (#view-admin.catalog-only). The flag is read at login. (RLS already
  lets every pharmacist write medications — availability / chart names need it — so this is a UI permission.)
- Everyone can change their own password (settings → Auth.changeOwnPassword: re-checks the current one).
- Deleting a patient / emptying a bed: admin + pharmacists (doctors cannot: button hidden, handler guarded, and erasing a saved
  patient's name is reverted for them).
- Discharge / death: NOT for pharmacists at all (the user asked: they delete the bed instead; the delete button is shown to
  pharmacists + admin). Doctors + admin discharge. Pharmacists see only the S. Creatinine + S. Albumin lab cells.
  (buttons hidden in ui.js renderOrigin, handlers guarded by exitAllowed in app.js).
- "رجوع المريض إلى طابقه" (archive kind `transferred`, tab "عادوا لطوابقهم"): boarders only,
  pharmacists + admin only — doctors don't see the button or the tab.
- Beds are numbered by column: LEFT column top→bottom, then right (6-bed: 1-2-3 | 4-5-6; 4-bed:
  1-2 | 3-4). Only the drawing changed — bed keys room-N-bed-M are unchanged.
- Bed number SHOWN everywhere = the ward-wide 1-50 (PharmacyWard.bedLabel / bedLabelOfKey / bedText): room by
  room, left column bottom→top then right column top→bottom (room 1: bed3=1, bed2=2, bed1=3, 4, 5, 6;
  room 2 bed3=7 …; room 6 bed2=31). Keys and bed.number keep the in-room number. Tests: scripts/test-ward.js.
- Bed moves: drag an occupied bed onto an empty one on the rooms view (`bed-drag.js`,
  long-press on touch) → `moveBed()` → `app_move_patient` RPC (history follows the patient);
  transfers out are archived as `transferred`, not discharges. Dropping onto an OCCUPIED bed swaps the two patients
  (confirm → swapBeds → `app_swap_patients` RPC, features.sql §18; both histories follow).
- «مراقبة الأدوية الحرجة» (renderAbxMonitor): the meronem / albumin counters are buttons → a table (name · plate ·
  meronem dose "1g×3" / albumin amount dispensed = chart-bridge dailyQuantity · day D…); a row opens creatinine +
  albumin and «تشخيص حالة المريض», kept in labs._critNote (labs JSON — no new column).
- Dots: albumin GREEN, meronem red, I.V.I.G orange (ui.js bedSpecialFlags.hasIvig) — patients list + TV.
- Duplicate plate number: warning under the plate field (app.js plateDuplicates / updatePlateDupWarning).
- «تحاليل الورقة» (doctor + admin, patient card): which labs print on the sheet — labs._print (absent = all);
  print-sheets.js filters labs + previous results by it.
- Delete / discharge / death are undoable for 8 s (app.js deferExit): the bed empties locally, the archive record,
  audit, notification and cloud delete wait (commit on timeout, a 2nd such action, pagehide / hidden);
  realtime ignores that bed meanwhile. Archived records keep medicines + labs + labHistory (shown under
  «العلاج والتحاليل» in the archive lists).
- Patient change log (`patient-history.js cutStay`): current stay only — never past a
  `discharged` event or another patient's name (tests: `scripts/test-history.js`).

- Sending to the chart app (clinical-pharmacy-app.onrender.com — no import, can't be framed or
  scripted cross-site): `chart-sync.js` → Vercel function `api/chart-sync.js` (needs our Supabase
  token; pharmacist/admin only) logs in with the ward's shared chart account — Vercel env vars
  CHART_USERNAME / CHART_PASSWORD, never in code — or a personal override kept on the device (asked only on
  412 = no shared account; cleared on logout),
  GETs /api/chart (floor 8, "الردهة الخامسة", slot main, the chosen day — «تاريخ الجارت» in the review footer,
  today by default; kept on the send-log entry so a re-send goes to the same day), merges with `chart-merge.js` (reuses
  rows by plate / columns by name, skips non-numeric qty, no room no.) and PUTs with expectedVersion
  (409 → re-read + merge once; 423 when someone else holds the edit lock). Tests:
  scripts/test-chart-merge.js, scripts/test-chart-sync.js (fake chart server).
  The chart DROPS medicine names not in its own list (silently) — names are matched to GET
  /api/medicines on the server; the sent name is nameChart ONLY — a medicine without «اسم الدواء في الجارت»
  is never sent (the user's rule; no warning); supplies use their nameChart or SUPPLY_CHART_NAMES. "اسم الدواء في الجارت" (nameChart) is filled
  automatically when the catalogue loads (app.js fillChartNames → `chart-names.js autoFill`, pharmacist /
  admin, pushes the catalogue once): by id (CHART_NAME_BY_ID, strength must agree with our name), else a
  sure name match; names already in the chart's list are kept, no match → left empty.
  CHART_MEDICINES = the chart's list as given by the user — do NOT replace it with a list read from the chart
  (the user said so). Tests: scripts/test-chart-names.js.
  Every send + its outcome is kept in `chart-send-log.js` (re-send / view / open chart).
  Live tests only on a far-future date with fake data, then cleared — never on a real day.
- Half tablets: N in "N×M" may be ½ / 1½ ("½×2"); parse with `PharmacyMedications.parseFreq` /
  `formatN` — never a plain digits regex. Pills form writes the tablets per dose in the usage column ("نصف حبة مع أو بدون طعام"); the chart gets
  whole tablets a day = ceil(N×M). No header «all pills forms» button any more (removed at the user's request). Per-patient "استمارة الحبوب" button in the patient view (admin +
  pharmacists except 7th-floor hematology; never doctors). Both pills buttons open a preview
  (previewPillsForms, with zoom −/+/ملاءمة) before the PDF. Footer: «الصيدلي السريري» + the printing user's display name under it. Tests: scripts/test-frequency.js.
- Quantity sent to the chart app (chart-bridge.js) = daily pieces = N × M of "N×M"
  ("1×3" → 3, "2×2" → 4); exceptions in CHART_QTY_EXCEPTIONS (heparin vial → 1); container forms
  (syrup-and-oral-drop = syrups / drops / ointments) always 1 (ONE_CONTAINER_FORMS); of the solutions ONLY
  Ventolin is one container a day (isVentolin) — every other solution is requested by its frequency. The review
  list before sending uses the same `dailyQuantity()`.

## Conventions
- The page scrolls inside <body>, not the window (window.scrollY stays 0): use UI.getScrollY / setScrollY.
  Leaving the rooms view remembers its position; coming back (after adding meds, back) restores it.
- Icons: duotone emerald/gold inline SVGs (`svg.ico`, parts use role classes f-em/s-au…; palette
  via `--ic-*` in theme.css per context: light tile, dark tile, header). No emoji icons in settings.
- Frequencies use the math sign `×` (U+00D7), never Latin `x`; dropdowns are `dir="ltr"` with LRM marks.
  Normalise with ui.js normFreq (spaces only around ×). "Infusion 24h" / "Bolus" are NOT frequencies but
  med.mode ("طريقة الإعطاء", ADMIN_MODES); read with Meds.medMode / medFrequency (old rows stored them as
  the frequency → mode + 1×1). The sheet prints the trade name (nameTrade); the pills form prints the Arabic name (nameAr), else the trade name.
- Medicine sheet on phones: kept above the on-screen keyboard (ui.js fitSheetAboveKeyboard, visualViewport).
  Dark mode sets color-scheme: dark and forces search-field colours (iOS paints type=search white).
- Dosage forms: vial, ampule, prefilled-syringe, tablet, effervescent (فوار), syrup-and-oral-drop, suppository, solution,
  supplies — the list is repeated in medications.js / storage.js / ui.js / app.js / print-sheets.js / index.html selects.
- Medicine picker: no search = the open tab's form; a search covers every form (open tab first,
  each result shows its form) — ui.js renderMedOptions.
- Escape any user text put into `innerHTML` (`escapeHtml`) or build nodes with `textContent`.
- Clinical rules are decision support for review against hospital protocols — alerts never block.

## Checks
```
node scripts/test-clinical.js
node --check js/<file>.js
node .claude/serve.js   # local preview on :5173
```
Dark mode: --primary is a light mint there (text colour); controls filled with it use --fill
(theme.css). After colour changes, re-run a contrast scan of every field / text in dark mode.
`node --check` misses runtime errors (an undefined variable in `applyRoleVisibility` once
aborted app start + logout in production). After UI changes, load the app in the browser for
each role (pharmacist / doctor / admin) and confirm start-up finishes (search works) and
logout reaches the login screen.

- Labs fold under «عرض التحاليل» for every role and pharmacists see all labs; pharmacists have discharge / died buttons (final diagnosis optional); the bed-delete button («تفريغ السرير وحذف المريض») is ADMIN only.
- Albumin + Lasix: the albumin medicine card has «لازكس مرافق (أمبول)» (med.lasixExtra, 0-8). chart-bridge `lasixExtraOf` adds it to the patient's Lasix 20mg amp quantity in the chart TSV (or sends it alone when the patient has no Lasix) and in the review / order tally; the Lasix order itself is never changed. Needs the Lasix medicine to have a chart name.
- التسليم والاستلام is back (settings + admin page); its printed title is «استمارة تسليم واستلام الخفر» with «الطابق السادس» under it. «تحاليل الورقة» is hidden for the floor managers (limited-admin CSS), kept for Mustafa.
- Handover print = a PDF made in the app (handover.js buildPdf: each page drawn off-screen, html2pdf/html2canvas -> jsPDF; iPhone share sheet via navigator.share, else a download) — no window.print, so no browser header/footer.
- «استمارة خروج الخاص» (js/private-form.js): every successful send to the private chart («ردهة الخاص») records per private patient what was sent that day (only medicines AVAILABLE at that moment; a re-send of the same day replaces it) in patient.labs._priv (no new column; it travels into the archive). The button «استمارة خروج الخاص» in a private-room patient card (pharmacists + admin) opens an editor: dates, per-day quantities (editable), manual rows (given by the night pharmacist), source شراء/كيماديا, unit price (optional). المجموع / الفراض الإدارية / الإجمالي are NOT ours (the accountant's): left blank on the paper (the user said so). PDF = landscape A4 drawn like the paper form (html2pdf -> jsPDF, same method as the handover).
- Private-form unit prices (سعر المفرد): PRICE_SOURCES in private-form.js, in PRIORITY order — the first is pharmacist24.github.io/drugprice (its public JSON API, cached 6 h). A medicine is priced by the FIRST source that has the same / a similar drug (same substance words, identical strength numbers, same kind of preparation); later lists are ignored for it (the user's rule). A repeated drug inside a source takes the lowest price. A price typed by hand (meta.hand) is never replaced. More lists the user sends later = more entries in PRICE_SOURCES after the site. NO ward (الردهة) field or cell at all — the user said the unit is already in the app; «أدوية أضافها الخفر» (labs._priv.extra) = medicines the night pharmacist added, typed with catalogue suggestions; name + plate come from the card (read-only), entry date from the patient log (admitted event), exit = today; dates + ward editable.
- Private-form «أدوية أضافها الخفر» suggestions: on a phone the list is sized to what is left above the keyboard (visualViewport) and the field is scrolled to the top of the visible area (fitSuggestions).
- «استمارات المرضى» (header button, every role; js/patient-forms.js): the storeroom (المذخر) forms drawn over the ward's own paper (img/forms/*.jpg = the user's PDFs). ALBUMIN: one form EVERY day per patient on albumin. MERONEM/IMIPENEM: first day, then next due = last form's day + dispensing period − 1 (period 7 → day 7, 14 → day 14); the meronem list shows ONLY patients who deserve a form (due / late) — a late one keeps showing on day 15, 16… until a new form is made («كل المرضى» shows everyone). Filled values (labs._forms[id] = vals, ticks, notes, culture, hist) are kept inside the patient; the chosen conditions are outlined on the paper; PDF/preview reuse private-form.js (renderPages, openViewer). Adding a form = one more entry in FORMS (picture + positions). Units are written «الوحدة الباطنية الأولى / الثالثة» (PharmacyWard.unitLongName / roomTitleLong) in the private archive lists and these forms; the chart targets keep their exact chart names.
- Meronem course rules (patient-forms.js courseOf / durationsAfter): first form on day 1 for 7 or 14 days; the next form is due on the LAST day of the period (day 7 / 14); a course is never longer than 21 days (after a 14-day period only 7 more days; after 21 days no more forms); patients already on the drug before the app (no record, day > 1) = dispensed for 14 days from day 1. hist entries = { date, day, dur, start, end }.
- The «استمارات المرضى» header button glows softly (CSS formsGlow, amber ring) and shows a count while forms are due (patient-forms.js refreshAlert: every 20 s, on tab return, after issuing / closing): albumin = everyone on it without a form today; meronem = due / late. It goes quiet by itself. Respects prefers-reduced-motion.
- «الطلبية» (#order-list-btn) glows (same formsGlow ring) after a SUCCESSFUL send to the chart (chart-bridge sendTsv → PharmacyFx.orderGlow(true), flag pharma.orderGlow in localStorage so a reload keeps it) and stays lit until the button is pressed (the order opens); it then stays off until the next successful send.
- Forms are "issued" only when printed: saving/sharing the PDF only makes the file (labs._forms[id].pending, state «أُنشئ الملف — بانتظار الطبع», still counted as required); the «تم الطبع» button (beside the card in the list — albumin any time, meronem once its file exists — and in the editor) moves pending into hist and takes the form off the list, with a «تراجع» toast. Cancelling the share sheet makes nothing. «الطلبية» uses the colour-switch effect (orderSwitch, amber ↔ blue); the forms button the ring (formsGlow).
- Forms page batch buttons (patient-forms.js printAll / printedAll): «طباعة كل استمارات الألبومين / الميرونيم (N)» makes ONE pdf for the open tab only (a page per required patient, in bed order) and puts them all in the waiting-for-print state; «تم طباعة الكل» marks every waiting one as printed (one «تراجع»). Meronem patients with no valid period chosen are skipped (a single allowed period is taken automatically).
- A printed form does NOT mean the drug was dispensed: the pharmacy division / the manager may refuse it. So the forms page says «طُبعت اليوم» (never «صُرفت»); the state only means the paper was printed.
- «رُفضت» on the ALBUMIN form only (labs._forms.albumin.rej = [{date, day}]): the pharmacy division / manager refused it → the patient is «Not indicated» for TODAY. Counted as not taken in: the albumin amount of the critical-drug monitor, today's private-ward record (and its Lasix extra), the handover paper status (ni). The ORDER and the CHART are never changed by it (the user: the approval takes longer than the chart is finished and printed). No refusal button on the meronem form. «إلغاء الرفض» / «تراجع» restore.
- «تحضير الأدوية الخاصة» (js/drug-prep.js, settings row, everyone but doctors): a button per medicine → animated SVG/CSS scenes, one per step, moved with previous / next only (no auto-play), the step text typed in inside the picture frame. All 12 medicines were reviewed and approved by the user; recipes and amounts only from the user. Data = DRUGS, scenes = SCENES.
- Friday albumin forms (patient-forms.js dueInfo, state covered): Thursday's order is doubled for the chart, so a Thursday form printed and not refused covers Friday; a patient with no such form (new on Friday, refused or not printed on Thursday) still needs one. Tests: scripts/test-forms-friday.js.
- Leaving the ward: pharmacists + admin discharge with a plain confirmation, no final-diagnosis form (doctors keep the form). Discharge, death and return to the floor all go through deferExit with { glitch: true, fx } and the 8 s undo of a deleted patient, each with its own bed effect (neon.js EXIT_FX + theme.css): delete = cyan / pink glitch, discharge = green glass sheen, died = grey + black band, return = indigo tint + arrow-up icon; archive, audit and notification wait for the commit.
