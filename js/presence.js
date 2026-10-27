/* Who has a bed's card open — Supabase Realtime Presence — and the bed LOCK built on it.
   Every signed-in device announces which bed's patient card it has open (or none).
   - Every device draws a scanning line over a bed while SOMEONE ELSE has its card open.
   - A bed someone else has open cannot be opened, moved or swapped by anyone else until that person leaves
     (lockedBy → app.js blockedByLock). The admin may open it anyway after a confirmation (force) and then wins.
   - Two people entering within the same second: the one who entered first keeps the bed, the other is taken out
     (enforce, decided by the announced time `at`, then by device id).
   - A card left open in the background does not lock the bed for ever: after 90 s hidden the device lets go;
     a closed tab is dropped by presence itself.
   Nothing is stored in the database; the channel is "pharma-presence". */
(function (global) {
  "use strict";
  var myId = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  var channel = null, ready = false, lastBed = undefined, busy = {};   // busy: bedKey → name of who has it open
  var holders = {};                                                     // bedKey → [{ id, name, at }] (others only)
  var myAt = 0, claimNext = false, hiddenSince = 0;
  var HIDDEN_RELEASE_MS = 90000;

  function client() {
    var SB = global.PharmacySupabase;
    return SB && SB.isConfigured() ? SB.getClient() : null;
  }
  function myName() {
    var A = global.PharmacyAuth, u = A && A.getCurrentUser ? A.getCurrentUser() : null;
    return u && u.displayName ? String(u.displayName) : "";
  }
  // the bed whose card this device is showing now, or null
  function openBed() {
    var app = global.PharmacyApp, s = app && app.state;
    var key = s && s.currentBed && s.currentBed.key;
    var view = document.getElementById("view-patient");
    return key && view && !view.hidden ? key : null;
  }
  // the bed this device announces: the open card, unless the page has been hidden too long
  function announcedBed() {
    var bed = openBed();
    if (bed && document.hidden && hiddenSince && Date.now() - hiddenSince > HIDDEN_RELEASE_MS) return null;
    return bed;
  }

  // ---- drawing ----
  function drawBed(bed) {
    var who = busy[bed.dataset.key];
    var box = bed.querySelector(".fx-scan-box");
    if (who === undefined) { if (box) box.remove(); bed.removeAttribute("data-scanned-by"); return; }
    if (!box) {
      box = document.createElement("i");
      box.className = "fx-scan-box";
      box.setAttribute("aria-hidden", "true");
      box.innerHTML = '<b class="fx-scan-line"></b>';
      bed.appendChild(box);
    }
    if (who) bed.setAttribute("data-scanned-by", who);
  }
  var drawing = false;
  function draw() {
    if (drawing) return;
    drawing = true;
    try {
      var grid = document.getElementById("rooms-grid");
      if (grid) Array.prototype.forEach.call(grid.querySelectorAll(".bed-btn"), drawBed);
    } finally { drawing = false; }
  }

  // ---- the lock ----
  // who has this bed open (other than this device), the one who came first — or null when nobody
  function earliest(key) {
    var list = holders[key];
    if (!list || !list.length) return null;
    return list.slice().sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); })[0];
  }
  function lockedBy(key) {
    var h = earliest(key);
    return h ? (h.name || "شخص آخر") : null;
  }
  // I entered a bed and somebody who came before me is in it: I step out
  function enforce() {
    if (!lastBed) return;
    var h = earliest(lastBed);
    if (!h) return;
    if (h.at < myAt || (h.at === myAt && h.id < myId)) {
      var app = global.PharmacyApp;
      if (app && app.leaveBedLocked) app.leaveBedLocked(h.name);
    }
  }

  function sync() {
    if (!channel) return;
    var st = channel.presenceState(), next = {}, hold = {};
    Object.keys(st).forEach(function (k) {
      if (k === myId) return;                                  // my own device is not "someone else"
      (st[k] || []).forEach(function (m) {
        if (!m || !m.bed) return;
        next[m.bed] = m.name || "";
        (hold[m.bed] = hold[m.bed] || []).push({ id: k, name: m.name || "", at: Number(m.at) || 0 });
      });
    });
    busy = next;
    holders = hold;
    draw();
    enforce();
  }

  function announce(force) {
    if (!channel || !ready) return;
    var bed = announcedBed();
    if (!force && bed === lastBed) return;
    if (bed && bed !== lastBed) { myAt = claimNext ? 0 : Date.now(); claimNext = false; }   // 0 = the admin's override: first in line
    lastBed = bed;
    try { channel.track({ bed: bed, name: myName(), at: myAt }); } catch (e) { /* offline */ }
    enforce();
  }

  function start() {
    var c = client();
    if (!c || channel) return;
    try {
      channel = c.channel("pharma-presence", { config: { presence: { key: myId } } });
      channel.on("presence", { event: "sync" }, sync);
      channel.subscribe(function (status) {
        if (status === "SUBSCRIBED") { ready = true; announce(true); }
      });
    } catch (e) { channel = null; return; }
    setInterval(function () { announce(false); }, 600);        // the open card changes in many places: just watch it
    document.addEventListener("visibilitychange", function () {
      hiddenSince = document.hidden ? Date.now() : 0;
      if (!document.hidden) announce(false);
    });
    var grid = document.getElementById("rooms-grid");
    if (grid) new MutationObserver(draw).observe(grid, { childList: true, subtree: true });   // redrawn rooms keep the effect
    window.addEventListener("pagehide", function () { try { if (channel) channel.untrack(); } catch (e) { /* closing */ } });
  }

  global.PharmacyPresence = {
    start: start,
    busy: function () { return busy; },
    lockedBy: lockedBy,                                         // name of who has the bed open, or null
    force: function () { claimNext = true; }                    // the admin opens a locked bed anyway: he goes first
  };
})(window);
