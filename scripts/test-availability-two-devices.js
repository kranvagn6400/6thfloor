// Two devices running the real storage.js + supabase-sync.js + med-availability.js against a fake cloud.
// node scripts/test-availability-two-devices.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SPEED = 40;                         // the app's timers run this many times faster
const rows = new Map();                   // the fake `medications` table
let online = true;
const subscribers = [];                   // realtime
let realtime = false;

function publish(row) { if (realtime) subscribers.forEach((f) => f(row)); }
function fakeClient() {
  return {
    from() {
      return {
        select() {
          const all = () => Promise.resolve(online
            ? { data: Array.from(rows.values()).map((r) => Object.assign({}, r)), error: null }
            : { data: null, error: { message: "Failed to fetch" } });
          return { order: all, then: (a, b) => all().then(a, b) };
        },
        upsert(list) {
          if (!online) return Promise.resolve({ error: { message: "Failed to fetch" } });
          list.forEach((r) => {
            // like the database: a column left out keeps its value, a new row takes the default
            const next = Object.assign({ available: true }, rows.get(r.id) || {}, r);
            rows.set(r.id, next);
            publish(next);
          });
          return Promise.resolve({ error: null });
        },
        delete() { return { not: () => Promise.resolve({ error: null }), neq: () => Promise.resolve({ error: null }) }; }
      };
    }
  };
}

function fakeEl() {
  const e = { dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, listeners: {}, children: [], value: "", hidden: false,
    set innerHTML(v) { e.children = []; }, get innerHTML() { return ""; }, set textContent(v) {}, get textContent() { return ""; },
    setAttribute() {}, appendChild(c) { e.children.push(c); }, addEventListener(t, f) { e.listeners[t] = f; }, closest: () => null };
  return e;
}

function device(storage) {
  const els = {};
  const ctx = {
    console, JSON, Math, Date, Array, Set, Map, Object, String, Number, Boolean, Promise, RegExp, Error,
    setTimeout: (f, ms) => setTimeout(f, ms / SPEED), clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } },
    document: { readyState: "complete", addEventListener() {}, createElement: fakeEl, querySelectorAll: () => [],
      getElementById: (id) => els[id] || (els[id] = fakeEl()) },
    addEventListener() {},
    PharmacyMedications: { DEFAULT_MEDICATIONS: [] },
    PharmacySupabase: { isConfigured: () => true, getClient: fakeClient },
    PharmacyAuth: { isLoggedIn: () => true, isAdmin: () => true, isPharmacist: () => false },
    PharmacyUI: { showView() {} }
  };
  ctx.window = ctx.global = ctx;
  vm.createContext(ctx);
  for (const f of ["storage", "supabase-sync", "med-availability"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  }
  ctx.PharmacyApp = { state: { medications: [] }, flashHint() {}, refreshMedSheet() {} };
  ctx.PharmacyMedAvailability.init();
  const d = {
    ctx, storage,
    async boot() { const r = await ctx.PharmacySupabaseSync.pullCatalog(); ctx.PharmacyApp.state.medications = ctx.PharmacyStorage.loadMedications(); return r; },
    toggle(id) { els["avail-list"].listeners.click({ target: { closest: () => ({ dataset: { id } }) } }); },
    poll: () => ctx.PharmacyMedAvailability.refreshFromCloud(),
    on(id) { return ctx.PharmacyApp.state.medications.find((m) => m.id === id).available !== false; },
    busy: () => ctx.PharmacyMedAvailability.busy()
  };
  subscribers.push((row) => ctx.PharmacyMedAvailability.applyCloud([row]));   // what app.js does with a realtime event
  return d;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// after a push a device waits 4 s (real time) before it reads again
const settle = async (d) => { for (let i = 0; i < 600 && d.busy(); i++) await wait(10); };
const cloudOn = (id) => rows.get(id).available !== false;
const passed = [];
const ok = (name) => { passed.push(name); console.log("  ok  " + name); };

(async () => {
  ["lasix", "albumin", "meronem", "omez", "vanco", "tazo"].forEach((id, i) => rows.set(id, { id, name_trade: id, form: "vial", default_dose: "", default_frequency: "", available: true, sort_order: i }));
  const A = device({}), B = device({});
  await A.boot(); await B.boot();
  assert(A.on("lasix") && B.on("lasix"));

  // 1. realtime dead: the 15 s poll carries it
  A.toggle("lasix");
  assert.strictEqual(A.on("lasix"), false, "the toggle shows at once on A");
  await settle(A);
  assert.strictEqual(cloudOn("lasix"), false, "A's change reached the cloud");
  assert.strictEqual(B.on("lasix"), true, "B has not heard yet");
  await B.poll();
  assert.strictEqual(B.on("lasix"), false, "B got it from the poll");
  ok("الجهاز الثاني يستلم التغيير من القراءة الدورية، حتى لو فاته إشعار التغيير");

  // 2. realtime alive: arrives without a poll, and the way back too
  realtime = true;
  A.toggle("albumin");
  await settle(A);
  assert.strictEqual(B.on("albumin"), false);
  B.toggle("albumin");
  await settle(B);
  assert.strictEqual(A.on("albumin"), true);
  realtime = false;
  ok("التغيير يصل فوراً عبر الإشعار، وفي الاتجاهين");

  // 3. A has no connection: nothing is lost, it goes by itself when the connection is back
  online = false;
  A.toggle("meronem");
  await wait(120);
  assert.strictEqual(cloudOn("meronem"), true, "still not in the cloud");
  assert.strictEqual(A.on("meronem"), false, "A keeps its own value");
  await A.poll();
  assert.strictEqual(A.on("meronem"), false);
  online = true;
  for (let i = 0; i < 100 && cloudOn("meronem"); i++) await wait(10);
  assert.strictEqual(cloudOn("meronem"), false, "sent by itself");
  await settle(A); await settle(B);
  await B.poll();
  assert.strictEqual(B.on("meronem"), false);
  ok("عند انقطاع الاتصال لا يضيع التغيير، ويُرسل وحده عند عودته");

  // 4. no connection and the app is closed: the next start sends it
  online = false;
  A.toggle("omez");
  await wait(120);
  online = true;
  const A2 = device(A.storage);
  await A2.boot();
  A2.ctx.PharmacyApp.state.medications = A2.ctx.PharmacyStorage.loadMedications();
  for (let i = 0; i < 300 && cloudOn("omez"); i++) await wait(10);
  assert.strictEqual(cloudOn("omez"), false, "sent after the restart");
  await settle(A2);
  await B.poll();
  assert.strictEqual(B.on("omez"), false);
  ok("إذا أُغلق التطبيق قبل الإرسال، يُرسل التغيير عند فتحه من جديد");

  // 5. B has unsent catalogue edits (its full pulls are blocked): availability still arrives
  const unsent = B.ctx.PharmacyStorage.hasUnsyncedLocalEdits();
  B.ctx.PharmacyStorage.saveMedications(B.ctx.PharmacyApp.state.medications);
  await wait(5);
  B.ctx.localStorage.setItem("pharma.medications.modified.v1", String(Date.now() + 100000));
  assert.strictEqual(B.ctx.PharmacyStorage.hasUnsyncedLocalEdits(), true);
  const full = await B.ctx.PharmacySupabaseSync.pullCatalog();
  assert.strictEqual(full.ok, false, "the full pull refuses");
  A2.toggle("vanco");
  await settle(A2);
  await B.poll();
  assert.strictEqual(B.on("vanco"), false);
  assert.strictEqual(unsent, false);
  ok("الجهاز الذي فيه تعديلات كتالوج غير مرفوعة يستلم التوفر أيضاً");

  // 6. a device that is behind pushes the whole catalogue: it does not undo the change
  const C = device({});
  await C.boot();
  A2.toggle("tazo");
  await settle(A2);
  assert.strictEqual(C.on("tazo"), true, "C is behind");
  await C.ctx.PharmacySupabaseSync.pushCatalog();
  assert.strictEqual(cloudOn("tazo"), false, "the cloud keeps it unavailable");
  await C.poll();
  assert.strictEqual(C.on("tazo"), false);
  ok("جهاز متأخر يرفع الكتالوج كاملاً لا يُرجع الدواء متوفراً");

  // 7. two users at once on different medicines: both stand, everywhere
  realtime = false;
  A2.toggle("lasix"); B.toggle("meronem");
  await settle(A2); await settle(B);
  await A2.poll(); await B.poll();
  for (const d of [A2, B]) { assert.strictEqual(d.on("lasix"), true); assert.strictEqual(d.on("meronem"), true); }
  ok("مستخدمان يغيّران دواءين في الوقت نفسه: يبقى التغييران عند الجميع");

  // 8. a poll that comes while A's own push is under way cannot undo A
  A2.toggle("albumin");
  await A2.poll();
  assert.strictEqual(A2.on("albumin"), false, "the poll did not bring the old value back");
  await settle(A2);
  await A2.poll();
  assert.strictEqual(A2.on("albumin"), false);
  ok("القراءة الدورية أثناء الإرسال لا تلغي تغيير المستخدم");

  console.log(passed.length + " scenarios passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
