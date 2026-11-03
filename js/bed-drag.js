/* ============================================================
   bed-drag.js  —  Move a patient by dragging their bed
   ============================================================
   On the rooms view, drag an occupied bed onto an empty bed:
     - touch: long-press (350 ms) then drag — a quick swipe still
       scrolls the page as usual
     - mouse: press and drag
   While dragging, empty beds light up as drop targets and the page
   scrolls when the finger nears the top / bottom edge. Dropping calls
   PharmacyApp.moveBed (server-side move, no confirmation dialog). A tap without a
   drag still opens the patient.
   Touch and mouse events are used instead of pointer events because
   only a non-passive touchmove can stop the page from scrolling once
   the drag has started.
   ============================================================ */

(function (global) {
  "use strict";

  const HOLD_MS = 350;   // touch long-press before a drag starts
  const MOVE_TOL = 8;    // px of movement that cancels a long-press / starts a mouse drag
  const EDGE = 100;      // px from the viewport edge where auto-scroll kicks in

  let pending = null;    // { bed, x, y, touch, timer }
  let drag = null;       // { fromKey, source, ghost, offX, offY, x, y, target, raf }
  let suppressClick = false;

  function isOccupied(bed) {
    return !!bed && bed.classList.contains("bed-btn") && !bed.classList.contains("state-empty");
  }

  function cancelPending() {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null;
  }

  function startDrag(x, y) {
    if (!pending) return;
    const source = pending.bed;
    cancelPending();
    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.classList.add("bed-drag-ghost");
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    document.body.appendChild(ghost);
    drag = {
      fromKey: source.dataset.key, source, ghost,
      offX: x - rect.left, offY: y - rect.top, x, y, target: null, raf: 0
    };
    source.classList.add("is-drag-source");
    document.body.classList.add("bed-dragging");
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { /* ignore */ } }
    moveTo(x, y);
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function setTarget(bed) {
    if (drag.target === bed) return;
    if (drag.target) drag.target.classList.remove("is-drop-target", "is-drop-invalid");
    drag.target = bed;
    if (bed) bed.classList.add("is-drop-target");   // empty → move, occupied → swap
  }

  function moveTo(x, y) {
    drag.x = x;
    drag.y = y;
    drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px) scale(1.06) rotate(-2deg)`;
    const under = document.elementFromPoint(x, y);
    const bed = under && under.closest("#rooms-grid .bed-btn");
    setTarget(bed && bed !== drag.source ? bed : null);
  }

  // Scroll while the finger sits near the top / bottom edge
  function autoScroll() {
    if (!drag) return;
    const h = window.innerHeight;
    let dy = 0;
    if (drag.y < EDGE) dy = -Math.ceil((EDGE - drag.y) / 6);
    else if (drag.y > h - EDGE) dy = Math.ceil((drag.y - (h - EDGE)) / 6);
    if (dy) {
      // the page scrolls inside <body> (window.scrollBy does nothing there)
      if (global.PharmacyUI && global.PharmacyUI.setScrollY) global.PharmacyUI.setScrollY(global.PharmacyUI.getScrollY() + dy);
      else window.scrollBy(0, dy);
      moveTo(drag.x, drag.y);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(drop) {
    if (!drag) return;
    const { fromKey, source, ghost, target, raf } = drag;
    cancelAnimationFrame(raf);
    ghost.remove();
    source.classList.remove("is-drag-source");
    if (target) target.classList.remove("is-drop-target", "is-drop-invalid");
    document.body.classList.remove("bed-dragging");
    drag = null;
    // The click that follows mouseup / touchend must not open the patient
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (!drop || !target) return;
    // onto another patient → the two swap beds; onto an empty bed → move
    if (isOccupied(target)) {
      global.PharmacyApp.swapBeds(fromKey, target.dataset.key);
      return;
    }
    global.PharmacyApp.moveBed(fromKey, target.dataset.key);
  }

  function init() {
    const grid = document.getElementById("rooms-grid");
    if (!grid) return;

    // ---- touch: long-press, then drag ----
    grid.addEventListener("touchstart", (e) => {
      if (drag || e.touches.length !== 1) return;
      const bed = e.target.closest(".bed-btn");
      if (!isOccupied(bed)) return;
      const t = e.touches[0];
      cancelPending();
      pending = { bed, x: t.clientX, y: t.clientY, touch: true };
      pending.timer = setTimeout(() => startDrag(pending.x, pending.y), HOLD_MS);
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      if (drag) {
        e.preventDefault();               // the drag owns the gesture: no scrolling
        moveTo(t.clientX, t.clientY);
        return;
      }
      if (pending && pending.touch &&
          Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > MOVE_TOL) {
        cancelPending();                  // a swipe: let the page scroll
      }
    }, { passive: false });

    document.addEventListener("touchend", () => { cancelPending(); endDrag(true); });
    document.addEventListener("touchcancel", () => { cancelPending(); endDrag(false); });

    // Long-press would otherwise open the browser's context menu / callout
    grid.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".bed-btn")) e.preventDefault();
    });

    // ---- mouse: press and drag ----
    grid.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || drag) return;
      const bed = e.target.closest(".bed-btn");
      if (!isOccupied(bed)) return;
      pending = { bed, x: e.clientX, y: e.clientY, touch: false };
    });
    document.addEventListener("mousemove", (e) => {
      if (drag) { moveTo(e.clientX, e.clientY); return; }
      if (pending && !pending.touch &&
          Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOVE_TOL) {
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      }
    });
    document.addEventListener("mouseup", () => { cancelPending(); endDrag(true); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") endDrag(false); });

    // A finished drag must not also count as a tap on the bed
    grid.addEventListener("click", (e) => {
      if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  global.PharmacyBedDrag = { init };
})(window);
