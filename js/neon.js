/* Press effects (CSS in theme.css, the colours follow the theme):
   - neon glow (slow) on whatever button / option is tapped;
   - fire on the log-out buttons;
   - a light sweep on a medicine option when it is ticked in the «إضافة علاج» sheet;
   - a rainbow border (5 s) around the bed whose patient just got a new medicine (shown when the rooms are drawn);
   - a cyan / pink glitch on a deleted bed during the undo window (the patient stays shown).
   For everyone who is signed in (the trial on the admin account is over — the user asked). */
(function (global) {
  "use strict";
  var TARGET = 'button, [role="button"], .settings-row, .nav-item, .bed-btn, .palette-swatch, .orn-chip, summary';
  var FIRE = "#settings-logout-btn, #logout-btn";
  var pendingBed = null, pendingAt = 0;

  function allowed() {
    var A = global.PharmacyAuth;
    return !!(A && A.isLoggedIn && A.isLoggedIn());
  }
  function flash(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;                       // restart the animation on a quick second tap
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  document.addEventListener("pointerdown", function (e) {
    if (!allowed()) return;
    var t = e.target && e.target.closest ? e.target.closest(TARGET) : null;
    if (!t || t.disabled || t.hidden) return;
    flash(t, t.matches(FIRE) ? "fx-fire" : "neon-hit", t.matches(FIRE) ? 950 : 1550);
  }, true);

  // a medicine ticked in the «إضافة علاج» sheet → a light sweep over its row
  document.addEventListener("change", function (e) {
    if (!allowed()) return;
    var cb = e.target;
    if (!cb || cb.type !== "checkbox" || !cb.checked || !cb.closest || !cb.closest("#med-options")) return;
    var id = cb.dataset ? cb.dataset.medId : "";
    setTimeout(function () {                   // the list is redrawn right after the change
      var rows = document.querySelectorAll("#med-options .med-option");
      Array.prototype.forEach.call(rows, function (r) {
        var input = r.querySelector('input[type="checkbox"]');
        if (input && input.dataset.medId === id) flash(r, "fx-shine", 900);
      });
    }, 30);
  }, true);

  // a rainbow border (5 s) on the bed that just got a medicine. The rooms are redrawn now and then
  // (sync, poll), which would drop the ring — so it is re-attached to the new bed element until it ends.
  var RING_MS = 5000, ringKey = null, ringStart = 0;
  function ensureRing() {
    if (!pendingBed && !ringKey) return;
    var grid = document.getElementById("rooms-grid");
    if (!grid || !grid.offsetParent) return;                    // the rooms view is not showing yet
    if (pendingBed && Date.now() - pendingAt > 60000) pendingBed = null;
    if (pendingBed && grid.querySelector('.bed-btn[data-key="' + pendingBed + '"]')) {
      ringKey = pendingBed; ringStart = Date.now(); pendingBed = null;
    }
    if (!ringKey) return;
    var elapsed = Date.now() - ringStart;
    if (elapsed > RING_MS) { ringKey = null; return; }
    var bed = grid.querySelector('.bed-btn[data-key="' + ringKey + '"]');
    if (!bed || bed.querySelector(".fx-laser-ring") || !allowed()) return;
    var r = document.createElement("i");
    r.className = "fx-laser-ring";
    r.setAttribute("aria-hidden", "true");
    r.style.animationDelay = "-" + elapsed + "ms";              // carry on where the redrawn one stopped
    bed.appendChild(r);
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, Math.max(100, RING_MS - elapsed));
  }
  // a deleted patient's bed glitches (cyan / pink) from the delete until the undo window ends
  var glitchKey = null, glitchUntil = 0;
  function ensureGlitch() {
    var grid = document.getElementById("rooms-grid");
    if (!grid) return;
    if (glitchKey && Date.now() > glitchUntil) glitchKey = null;
    Array.prototype.forEach.call(grid.querySelectorAll(".fx-holo-live"), function (b) {
      if (b.dataset.key !== glitchKey) { b.classList.remove("fx-holo-live"); var o = b.querySelector(".fx-holo-box"); if (o) o.remove(); }
    });
    if (!glitchKey || !allowed()) return;
    var bed = grid.querySelector('.bed-btn[data-key="' + glitchKey + '"]');
    if (!bed || bed.classList.contains("fx-holo-live")) return;
    bed.classList.add("fx-holo-live");
    var box = document.createElement("i");
    box.className = "fx-holo-box";
    box.setAttribute("aria-hidden", "true");
    bed.appendChild(box);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.getElementById("rooms-grid");
    if (grid) {
      new MutationObserver(function () { ensureRing(); ensureGlitch(); }).observe(grid, { childList: true, subtree: true });
    }
    document.addEventListener("visibilitychange", function () { ensureRing(); ensureGlitch(); });
  });

  global.PharmacyFx = {
    glitchBed: function (key, ms) {
      glitchKey = key; glitchUntil = Date.now() + (ms || 9500);
      setTimeout(ensureGlitch, 0); setTimeout(ensureGlitch, 400);
      setTimeout(ensureGlitch, (ms || 9500) + 50);                 // failsafe: stop by itself
    },
    glitchEnd: function () { glitchKey = null; ensureGlitch(); },
    markBed: function (key) {
      pendingBed = key; pendingAt = Date.now();
      var n = 0, iv = setInterval(function () { ensureRing(); if ((!pendingBed && !ringKey) || ++n > 130) clearInterval(iv); }, 500);
    },
    allowed: allowed,
    // saved effects (theme.css): plasma | ice | rainbow | gold | scan | double — not wired to anything yet
    play: function (el, name) { if (el) flash(el, "fx-" + name, 1300); }
  };
})(window);
