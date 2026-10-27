/* ============================================================
   archive-sync.js  —  Discharged / dead lists in the cloud
   ============================================================
   Cloud table: public.patient_archive (features.sql). Records are
   immutable once saved; only admins can delete.

   The local lists (Storage.loadDischarged / loadDead) remain as a
   cache so the views and the "previous admission" banner work offline.
   Each local record carries an `id`; `pending: true` marks records not
   yet uploaded (offline, or created before this feature existed — every
   device uploads its old local records once, so the lists merge).

   window.PharmacyArchive:
     add(kind, record)   save locally + upload        kind: "discharged" | "dead" | "transferred"
     sync()              upload pending, then replace the cache with the cloud
     remove(kind, id)    admin: delete one record
     clearAll(kind)      admin: delete all records of a kind
     pendingCount()      records not uploaded yet
   ============================================================ */

(function (global) {
  "use strict";

  const Storage = () => global.PharmacyStorage;
  const client = () => {
    const SB = global.PharmacySupabase;
    return SB && SB.isConfigured && SB.isConfigured() ? SB.getClient() : null;
  };

  const LISTS = {
    discharged: { load: () => Storage().loadDischarged(), save: (a) => Storage().saveDischarged(a), dateKey: "dischargedAt" },
    dead:       { load: () => Storage().loadDead(),       save: (a) => Storage().saveDead(a),       dateKey: "diedAt" },
    transferred: { load: () => Storage().loadTransferred(), save: (a) => Storage().saveTransferred(a), dateKey: "transferredAt" }
  };

  function newId() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "a-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function eventDate(kind, r) {
    const d = r[LISTS[kind].dateKey];
    return d && !isNaN(Date.parse(d)) ? d : new Date().toISOString();
  }

  function toRow(kind, r) {
    const record = Object.assign({}, r);
    delete record.pending;
    delete record.id;
    return { id: r.id, kind, name: r.name || "", record, event_at: eventDate(kind, r) };
  }

  function fromRow(row) {
    return Object.assign({}, row.record || {}, { id: row.id });
  }

  // Give legacy records (saved before cloud sync) an id + pending flag.
  function adoptLegacy(kind) {
    const list = LISTS[kind].load();
    let changed = false;
    list.forEach(r => {
      if (r && !r.id) { r.id = newId(); r.pending = true; changed = true; }
    });
    if (changed) LISTS[kind].save(list);
    return list;
  }

  function friendlyError(error) {
    const msg = (error && error.message) || String(error || "");
    if (/patient_archive/.test(msg)) return "الأرشيف غير مُفعّل بعد — شغّل features.sql في Supabase";
    if (/jwt/i.test(msg)) return "انتهت الجلسة — سجّل الدخول من جديد";
    return msg;
  }

  async function uploadPending(kind) {
    const c = client();
    const list = adoptLegacy(kind);
    const pending = list.filter(r => r && r.pending);
    if (!c || pending.length === 0) return { ok: !!c || pending.length === 0 };
    // ON CONFLICT DO NOTHING: a retried upload of the same id is harmless
    const { error } = await c.from("patient_archive")
      .upsert(pending.map(r => toRow(kind, r)), { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: friendlyError(error) };
    const uploaded = new Set(pending.map(r => r.id));
    const fresh = LISTS[kind].load();
    fresh.forEach(r => { if (r && uploaded.has(r.id)) delete r.pending; });
    LISTS[kind].save(fresh);
    return { ok: true };
  }

  async function fetchAll() {
    const c = client();
    const rows = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 100000; offset += PAGE) {
      const { data, error } = await c.from("patient_archive")
        .select("id, kind, record, event_at")
        .order("event_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  let syncing = null;
  // Upload pending records, then mirror the cloud into the local cache
  // (keeping anything still pending). Concurrent calls share one run.
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        if (!client()) return { ok: false, error: "غير متصل بالسحابة" };
        for (const kind of Object.keys(LISTS)) {
          const up = await uploadPending(kind);
          if (!up.ok) return up;
        }
        const rows = await fetchAll();
        for (const kind of Object.keys(LISTS)) {
          const cloud = rows.filter(r => r.kind === kind).map(fromRow);
          const cloudIds = new Set(cloud.map(r => r.id));
          const stillPending = LISTS[kind].load().filter(r => r && r.pending && !cloudIds.has(r.id));
          const merged = stillPending.concat(cloud);
          const dk = LISTS[kind].dateKey;
          merged.sort((a, b) => (Date.parse(b[dk]) || 0) - (Date.parse(a[dk]) || 0));
          LISTS[kind].save(merged);
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: friendlyError(e) };
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  // Saves locally first (never lost), then uploads in the background.
  function add(kind, record) {
    const r = Object.assign({ id: newId() }, record, { pending: true });
    const list = LISTS[kind].load();
    list.unshift(r);
    LISTS[kind].save(list);
    uploadPending(kind).then(res => {
      if (!res.ok) console.warn("[Archive] upload deferred:", res.error);
    });
    return r;
  }

  async function remove(kind, id) {
    const c = client();
    const local = LISTS[kind].load();
    const target = local.find(r => r && r.id === id);
    if (c && target && !target.pending) {
      const { error } = await c.from("patient_archive").delete().eq("id", id);
      if (error) return { ok: false, error: friendlyError(error) };
    } else if (!c && target && !target.pending) {
      return { ok: false, error: "الحذف يحتاج اتصالاً بالسحابة" };
    }
    LISTS[kind].save(local.filter(r => !r || r.id !== id));
    return { ok: true };
  }

  async function clearAll(kind) {
    const c = client();
    if (!c) return { ok: false, error: "الحذف يحتاج اتصالاً بالسحابة" };
    const { error } = await c.from("patient_archive").delete().eq("kind", kind);
    if (error) return { ok: false, error: friendlyError(error) };
    LISTS[kind].save([]);
    return { ok: true };
  }

  function pendingCount() {
    return Object.keys(LISTS).reduce((n, kind) =>
      n + LISTS[kind].load().filter(r => r && (r.pending || !r.id)).length, 0);
  }

  global.PharmacyArchive = { add, sync, remove, clearAll, pendingCount };
})(window);
