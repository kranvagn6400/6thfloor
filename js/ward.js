/* ============================================================
   ward.js
   Floor structure generator — 6th Floor.

   Two units, both internal medicine:
   - unit "1" (الوحدة الأولى, women): room ids 1-12
   - unit "3" (الوحدة الثالثة, men):  room ids 13-24
   Each unit has 8 general rooms and 4 private rooms:
   - general rooms 1-5: 6 beds (2×3 grid, "grid-2x3")
   - general rooms 6-8: 4 beds (2×2 grid, "grid-2x2")
   - private rooms 1-4: a single bed ("single")

   Room ids are unique across the floor so bed keys stay
   room-N-bed-M; `num` / `title` are what the user sees.
   ============================================================ */

(function (global) {
  "use strict";

  const UNITS = [
    { id: "1", name: "الوحدة الأولى", label: "نساء", gender: "female", first: 1 },
    { id: "3", name: "الوحدة الثالثة", label: "رجال", gender: "male", first: 13 }
  ];

  const ROOMS = [];
  UNITS.forEach(unit => {
    for (let i = 1; i <= 12; i++) {
      const id = unit.first + i - 1;
      const isPrivate = i > 8;
      const bedCount = isPrivate ? 1 : (i <= 5 ? 6 : 4);
      const layout = isPrivate ? "single" : (bedCount === 6 ? "grid-2x3" : "grid-2x2");
      const rows = bedCount === 6 ? ["top", "middle", "bottom"]
        : bedCount === 4 ? ["top", "bottom"] : ["top"];
      const beds = [];
      for (let n = 1; n <= bedCount; n++) {
        beds.push({
          number: n,
          side: rows[(n - 1) % rows.length],
          column: n <= rows.length ? "left" : "right"
        });
      }
      const num = isPrivate ? i - 8 : i;
      ROOMS.push({
        id, bedCount, layout, beds,
        unit: unit.id,
        kind: isPrivate ? "private" : "general",
        num,
        title: isPrivate ? "خاص " + num : "غرفة " + num
      });
    }
  });

  const TOTAL_BEDS = ROOMS.reduce((acc, r) => acc + r.bedCount, 0); // 92

  function bedKey(roomId, bedNumber) {
    return `room-${roomId}-bed-${bedNumber}`;
  }

  function roomById(roomId) { return ROOMS.find(r => r.id === Number(roomId)) || null; }
  // "غرفة 3 · الوحدة الأولى" — the full name used in texts, logs and sheets
  function roomTitle(roomId) {
    const r = roomById(roomId);
    if (!r) return "غرفة " + roomId;
    const u = UNITS.find(x => x.id === r.unit);
    return r.title + " · " + u.name;
  }
  function unitOf(roomId) {
    const r = roomById(roomId);
    return r ? UNITS.find(u => u.id === r.unit) : null;
  }

  // Unit 1 = women, unit 3 = men (general and private rooms alike).
  function roomGender(roomId) {
    const u = unitOf(roomId);
    return u ? u.gender : "";
  }

  // The number shown for a bed: general rooms 1..42 inside their unit, room by room (in a room the LEFT
  // column bottom → top, then the right column top → bottom); the private beds of each unit are their own
  // 1..4. Only what is SHOWN — keys and bed.number keep the in-room number.
  const BED_LABEL = {};
  (function () {
    UNITS.forEach(unit => {
      const count = { general: 0, private: 0 };
      ROOMS.filter(r => r.unit === unit.id).forEach(room => {
        const rows = room.bedCount === 6 ? 3 : room.bedCount === 4 ? 2 : 1;
        const order = [];
        for (let b = rows; b >= 1; b--) order.push(b);
        for (let b = rows + 1; b <= room.bedCount; b++) order.push(b);
        order.forEach(b => { BED_LABEL[bedKey(room.id, b)] = ++count[room.kind]; });
      });
    });
  })();
  function bedLabel(roomId, bedNumber) {
    return BED_LABEL[bedKey(roomId, bedNumber)] || bedNumber;
  }
  // "room-14-bed-3" → number shown
  function bedLabelOfKey(key) {
    const m = String(key || "").match(/room-(\d+)-bed-(\d+)/);
    return m ? bedLabel(+m[1], +m[2]) : "";
  }
  // "room-14-bed-3" → "غرفة 2 · سرير 7"
  function bedText(key) {
    const m = String(key || "").match(/room-(\d+)-bed-(\d+)/);
    return m ? roomTitle(m[1]) + " · سرير " + bedLabel(+m[1], +m[2]) : String(key || "");
  }

  global.PharmacyWard = {
    ROOMS,
    UNITS,
    TOTAL_BEDS,
    bedKey,
    roomById,
    roomTitle,
    unitOf,
    roomGender,
    bedLabel,
    bedLabelOfKey,
    bedText
  };
})(window);
