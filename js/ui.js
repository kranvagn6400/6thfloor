/* ============================================================
   ui.js
   Pure rendering helpers. No state of its own — everything
   pulls from PharmacyStorage or is passed in by app.js.
   ============================================================ */

(function (global) {
  "use strict";

  // "1 x 3" → "1×3": Latin x → math ×, spaces around the × removed.
  // Word frequencies keep their spaces ("Infusion 24h", "كل يومين").
  function normFreq(f) {
    return String(f || "").trim().replace(/(\d|½)\s*[xX×]\s*(\d)/g, "$1×$2").replace(/\s+/g, " ");
  }

  const h = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "attrs") for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    if (Array.isArray(children)) {
      children.forEach(c => {
        if (c == null) return;
        if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
        else el.appendChild(c);
      });
    } else if (typeof children === "string") {
      el.textContent = children;
    }
    return el;
  };

  // ---------- Icon helper ----------
  // If the icon value starts with "img:", render an <img> element.
  // Otherwise, render a <span> with the emoji text.
  function makeIcon(iconValue) {
    if (typeof iconValue === "string" && iconValue.indexOf("img:") === 0) {
      const src = iconValue.slice(4);
      return h("img", {
        src: src,
        alt: "",
        class: "sheet-tab-icon-img"
      });
    }
    return h("span", { class: "sheet-tab-icon", "aria-hidden": "true" }, iconValue);
  }

  // ---------- Display name helpers ----------
  // PRIMARY name = nameTrade (falls back to nameAr then nameEn then "—")
  function primaryName(m) {
    if (!m) return "—";
    return m.nameTrade || m.nameAr || m.nameEn || "—";
  }
  // SECONDARY name = scientific (nameEn). Always shown when set,
  // even if it happens to equal the trade name. This is intentional:
  // the user wants the scientific name visible at all times so they
  // can confirm the active substance on the printed patient list.
  function scientificName(m) {
    if (!m) return "";
    const en = m.nameEn || "";
    return en;
  }

  // ---------- Dashboard stats ----------
  function renderStats(patientsMap) {
    let patientCount = 0;
    let albuminCount = 0;
    let meronemCount = 0;
    for (const p of Object.values(patientsMap)) {
      if (p && p.name && p.name.trim()) {
        patientCount++;
        const flags = bedSpecialFlags(p);
        if (flags.hasAlbumin) albuminCount++;
        if (flags.hasMeronem) meronemCount++;
      }
    }
    // Update patients-count in the patients view (if visible)
    const pcEl = document.getElementById("patients-count");
    if (pcEl) pcEl.textContent = patientCount;
    // Update the stats bar in the header
    const sPatients = document.getElementById("stat-patients");
    const sBeds     = document.getElementById("stat-beds-total");
    const sAlbumin  = document.getElementById("stat-albumin");
    const sMeronem  = document.getElementById("stat-meronem");
    if (sPatients) sPatients.textContent = patientCount;
    // Count total beds from the Ward layout
    const Ward = global.PharmacyWard;
    let totalBeds = 0;
    if (Ward && Ward.ROOMS) {
      Ward.ROOMS.forEach(r => { totalBeds += (r.bedCount || r.beds.length); });
    }
    if (sBeds) sBeds.textContent = totalBeds;
    if (sAlbumin) sAlbumin.textContent = albuminCount;
    if (sMeronem) sMeronem.textContent = meronemCount;
  }

  // ---------- Bed status helper ----------
  function bedStatus(patient) {
    if (!patient || !patient.name || !patient.name.trim()) return "empty";
    const hasMeds = Array.isArray(patient.medications) && patient.medications.length > 0;
    return hasMeds ? "meds" : "occupied";
  }

  // Detect if a patient has Albumin and/or Meronem prescribed.
  // Used to color the bed button with a split gradient (yellow/red/green)
  // per the user's clinical rule:
  //   - Meronem only    → half red + half green
  //   - Albumin only    → half yellow + half green
  //   - Albumin+Meronem → thirds yellow + red + green
  // Match by id OR by name (case-insensitive) so any user-added
  // variant like 'meronem-500mg' or 'Albumin 25%' is detected.
  function bedSpecialFlags(patient) {
    const flags = { hasAlbumin: false, hasMeronem: false, hasIvig: false };
    if (!patient || !Array.isArray(patient.medications)) return flags;
    for (const pm of patient.medications) {
      if (!pm) continue;
      const id = (pm.id || "").toLowerCase();
      const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
      // Albumin: match id or name contains 'albumin' or 'ألبومين'
      if (id.indexOf("albumin") >= 0 || name.indexOf("albumin") >= 0 || name.indexOf("ألبومين") >= 0) {
        flags.hasAlbumin = true;
      }
      // Meronem/Meropenem: match id or name contains 'meronem' or 'meropenem' or 'ميرونيم' or 'ميروبينيم'
      if (
        id.indexOf("meronem") >= 0 || id.indexOf("meropenem") >= 0 ||
        name.indexOf("meronem") >= 0 || name.indexOf("meropenem") >= 0 ||
        name.indexOf("ميرونيم") >= 0 || name.indexOf("ميروبينيم") >= 0
      ) {
        flags.hasMeronem = true;
      }
      // I.V.I.G (intravenous immunoglobulin) → orange dot
      const bare = (id + " " + name).replace(/[.\s-]/g, "");
      if (bare.indexOf("ivig") >= 0 || name.indexOf("immunoglobulin") >= 0) flags.hasIvig = true;
    }
    return flags;
  }

  // ---------- Rooms grid ----------
  // Renders room cards in a simple grid (no corridor, no entrance,
  // no connector dots — just clean room cards).
  // The unit whose rooms the home view shows ("1" = الوحدة الأولى, "3" = الثالثة) and the
  // unit whose pills page is open; the bottom nav lights the matching tab.
  let currentUnit = "1", pillsUnit = "1", currentKind = "general";
  function setKind(k) { currentKind = k === "private" ? "private" : "general"; }
  function setUnit(u) { currentUnit = u === "3" ? "3" : "1"; }
  function setPillsUnit(u) { pillsUnit = u === "3" ? "3" : "1"; markNav(); }
  function navKey(name) {
    const v = name || showView._lastView;
    if (v === "home") return currentUnit === "3" ? "unit3" : "home";
    if (v === "pills") return pillsUnit === "3" ? "pills3" : "pills1";
    return v;
  }
  function markNav(name) {
    const k = navKey(name);
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.nav === k));
  }

  function renderRooms(patientsMap) {
    const container = document.getElementById("rooms-grid");
    // The rooms slide in on the first drawing only — a redraw (sync, poll)
    // must not replay it, or the grid blinks every few seconds.
    if (container.dataset.drawn) container.classList.add("rooms-redraw");
    container.dataset.drawn = "1";
    // Built off-screen and swapped in at once (the grid never collapses)
    const out = document.createDocumentFragment();

    // The unit's heading with the عام / خاص switch: one kind of rooms at a time
    {
      const unit = global.PharmacyWard.UNITS.find(u => u.id === currentUnit);
      const sw = h("span", { class: "kind-toggle", role: "group", "aria-label": "عام / خاص" },
        [["general", "عام"], ["private", "خاص"]].map(([k, t]) =>
          h("button", { type: "button", class: "kind-btn" + (currentKind === k ? " is-on" : ""), dataset: { kind: k } }, t)));
      out.appendChild(h("div", { class: "unit-head" }, [h("span", {}, unit.name + " (" + unit.label + ")"), sw]));
    }
    global.PharmacyWard.ROOMS.filter(r => r.unit === currentUnit && r.kind === currentKind).forEach(room => {
      const occupied = room.beds.filter(b => {
        const p = patientsMap[global.PharmacyWard.bedKey(room.id, b.number)];
        return p && p.name && p.name.trim();
      }).length;

      // Build the beds grid per room layout.
      // Layout is either "grid-2x3" (rooms 1-5, 6 beds in 3 rows × 2 cols)
      // or "grid-2x2" (rooms 6-10, 4 beds in 2 rows × 2 cols).
      // In both layouts, the bed `side` field tells which row (top/
      // middle/bottom) the bed belongs to and `column` which side of it
      // (ward.js numbers the left column first). Each row has 2 beds;
      // in RTL the first child sits on the right.
      let bedsArea;
      if (room.layout === "grid-2x3" || room.layout === "grid-2x2") {
        const rows = [];
        const sides = room.layout === "grid-2x3"
          ? ["top", "middle", "bottom"]
          : ["top", "bottom"];
        const colRank = (b) => (b.column === "left" ? 1 : 0);
        sides.forEach(side => {
          const rowBeds = room.beds.filter(b => b.side === side)
            .sort((a, b) => colRank(a) - colRank(b));
          rows.push(
            h("div", { class: "beds-row" },
              rowBeds.map(b => bedButton(room, b, patientsMap)))
          );
        });
        bedsArea = h("div", { class: "room-beds " + room.layout }, rows);
      } else {
        // Fallback (legacy layouts) — render all beds in one container
        bedsArea = h("div", { class: "room-beds " + room.layout },
          room.beds.map(b => bedButton(room, b, patientsMap)));
      }

      const roomCard = h("div", {
        class: "room-card layout-" + room.layout,
        dataset: { roomId: room.id }
      }, [
        h("div", { class: "room-head" }, [
          h("div", { class: "room-title" }, [
            h("span", { class: "room-num" }, room.title),
            h("span", { class: "room-beds-count" }, room.bedCount + " أسرّة")
          ]),
          h("span", { class: "room-occ" }, occupied + " / " + room.bedCount + " مشغول")
        ]),
        bedsArea
      ]);
      out.appendChild(roomCard);
    });
    // The occupied-bed dots keep pulsing in step across redraws instead of
    // all restarting together (which reads as a blink).
    const phase = -(Date.now() % 2200) + "ms";
    out.querySelectorAll(".bed-icon").forEach(el => { el.style.animationDelay = phase; });
    container.replaceChildren(out);
  }

  // Helper: build a single bed button
  function bedButton(room, bed, patientsMap) {
    const key = global.PharmacyWard.bedKey(room.id, bed.number);
    const patient = patientsMap[key] || null;
    const status = bedStatus(patient);
    // Bed content layout (per user request):
    //   - For empty beds: "سرير N" (the bed number, unchanged)
    //   - For occupied beds: patient name (top) + attending doctor
    //     (bottom, in a smaller muted text). The bed number is no
    //     longer shown when the bed is occupied — the patient's name
    //     replaces it. The attending physician is the specialist who
    //     manages the patient's care (stored as patient.doctor field).
    const bedNum = "سرير " + global.PharmacyWard.bedLabel(room.id, bed.number);
    if (patient && patient.name && patient.name.trim()) {
      // Occupied bed — show patient name + attending doctor (if any)
      const children = [
        h("span", { class: "bed-icon" }),
        h("span", { class: "bed-name" }, patient.name.trim())
      ];
      if (patient.doctor && patient.doctor.trim()) {
        children.push(h("span", { class: "bed-doctor" }, patient.doctor.trim()));
      }
      // …then the plate number, when there is one (not for patients whose
      // details are hidden on this account — 7th floor for pharmacists)
      const plate = patient.plateNumber && String(patient.plateNumber).trim();
      const hidden = global.PharmacyBoarders && global.PharmacyBoarders.hidesDetails(patient);
      if (plate && !hidden) {
        children.push(h("span", { class: "bed-plate" }, plate));
      }
      // Small red marker when any med has a "danger" clinical alert
      let alertClass = "";
      const Clinical = global.PharmacyClinical;
      if (Clinical && status === "meds") {
        const res = Clinical.medAlerts(patient);
        let danger = res.interactions.some(a => a.severity === "danger");
        res.byMed.forEach(l => { if (l.some(a => a.level === "danger")) danger = true; });
        if (danger) {
          alertClass = " has-clinical-alert";
          children.push(h("span", { class: "bed-alert-dot", title: "تنبيه سريري" }, "!"));
        }
      }
      // التربيت done today (pharmacists + admin)
      const T = global.PharmacyTarbeet;
      if (T && T.showMarks() && T.isDone(key)) {
        children.push(h("span", { class: "bed-tarbeet-mark", title: "تم التربيت اليوم" }, "✓"));
      } else if (T && T.showMarks() && T.isNotDone && T.isNotDone(key)) {
        const mark = h("span", { class: "bed-tarbeet-mark is-not", title: "الملف غير موجود اليوم" });
        mark.innerHTML = T.FILE_OFF_SVG;     // static icon markup
        children.push(mark);
      }
      // Boarder badge (القسم الأصلي)
      let boarderClass = "";
      const B = global.PharmacyBoarders;
      if (B && B.isBoarder(patient)) {
        boarderClass = " is-boarder" + (B.isNoOrder(patient) ? " is-no-order" : "");
        children.push(h("span", { class: "bed-boarder-badge", title: B.label(patient) }, B.badge(patient)));
      }
      return h("button", {
        class: `bed-btn state-${status}${alertClass}${boarderClass}`,
        dataset: { roomId: room.id, bed: bed.number, key: key },
        type: "button"
      }, children);
    }
    // Empty bed — show "سرير N" (the bed number)
    return h("button", {
      class: `bed-btn state-${status}`,
      dataset: { roomId: room.id, bed: bed.number, key: key },
      type: "button"
    }, [
      h("span", { class: "bed-icon" }),
      h("span", { class: "bed-num" }, bedNum),
      h("span", { class: "bed-state" })
    ]);
  }

  // Helper: convert lab key to input ID (creatinine → lab-creatinine)
  function labFieldIdFromKey(key) {
    const map = {
      creatinine: "creatinine", albumin: "albumin", wbc: "wbc",
      hb: "hb", plt: "plt", na: "na", k: "k",
      glucose: "glucose", crp: "cr"
    };
    return map[key] || key;
  }

  // Helper: format ISO date string to short Arabic date
  function formatDateShort(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("ar", { day: "numeric", month: "short" });
    } catch (e) { return dateStr; }
  }

  // ---------- Patient view ----------
  function renderPatientView(patient, roomId, bedNumber) {
    document.getElementById("loc-room").textContent = global.PharmacyWard.roomTitle(roomId);
    document.getElementById("loc-bed").textContent  = "سرير " + global.PharmacyWard.bedLabel(roomId, bedNumber);

    // IMPORTANT: Don't reset the name input value if it's currently
    // FOCUSED. Otherwise, when Supabase Realtime broadcasts the
    // patient update back to this same device (echo from our own push),
    // the renderPatientView call would overwrite the user's in-progress
    // typing with the value they JUST typed (effectively losing any
    // characters typed between the input event and the realtime echo,
    // typically 100-400ms). On slow phones this looks like characters
    // being auto-erased while typing fast.
    const nameInput = document.getElementById("patient-name-input");
    const isNameFocused = document.activeElement === nameInput;
    if (!isNameFocused) {
      nameInput.value = (patient && patient.name) ? patient.name : "";
    }

    // Same logic for plate input.
    const plateInput = document.getElementById("patient-plate-input");
    const isPlateFocused = document.activeElement === plateInput;
    if (!isPlateFocused) {
      plateInput.value = (patient && patient.plateNumber) ? String(patient.plateNumber) : "";
    }

    // Age input — same focus-guard logic.
    const ageInput = document.getElementById("patient-age-input");
    const isAgeFocused = document.activeElement === ageInput;
    if (!isAgeFocused) {
      ageInput.value = (patient && patient.age) ? String(patient.age) : "";
    }

    // Weight / height (stored in labs) — same focus guard
    const pLabs = (patient && patient.labs) ? patient.labs : {};
    [["patient-weight-input", "weight"], ["patient-height-input", "height"]].forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = pLabs[key] ? String(pLabs[key]) : "";
    });

    // Gender toggle — sync the .is-active class on the two buttons
    // (male / female). An unset gender shows the room's (rooms 1-4 men,
    // 5 + 7-10 women — ensurePatient stores it with the first edit); room 6
    // (ICU) stays un-highlighted.
    if (window._syncGenderButtons) {
      const roomG = global.PharmacyWard.roomGender ? global.PharmacyWard.roomGender(roomId) : "";
      window._syncGenderButtons((patient && patient.gender) ? patient.gender : roomG);
    }

    // GFR card — recompute using the loaded patient's age + gender +
    // S. Creatinine. The card hides itself if any of the three is
    // missing or invalid (handled inside _renderGFRCard).
    if (window._renderGFRCard) {
      window._renderGFRCard();
    }

    // Previous admission banner — if this patient's name matches a
    // previously discharged patient, show their last final diagnosis
    // so the doctor can see prior history at a glance. Handled by
    // app.js (which has access to Storage + Auth + state).
    if (window._renderPreviousAdmissionBanner) {
      window._renderPreviousAdmissionBanner(patient);
    }

    // Same logic for doctor (الطبيب المعالج) input — don't reset the
    // value if the input is currently focused (avoids Supabase Realtime
    // echo loop erasing characters while typing fast).
    const doctorInput = document.getElementById("patient-doctor-input");
    const isDoctorFocused = document.activeElement === doctorInput;
    if (!isDoctorFocused) {
      doctorInput.value = (patient && patient.doctor) ? String(patient.doctor) : "";
    }

    // Diagnosis (التشخيص) — same focus-guard logic.
    // Editable only by doctors + admins. For pharmacists, the input
    // is disabled (read-only). The access control is done in app.js
    // openPatient() which toggles the disabled attribute.
    const diagnosisInput = document.getElementById("patient-diagnosis-input");
    const isDiagnosisFocused = document.activeElement === diagnosisInput;
    if (!isDiagnosisFocused) {
      diagnosisInput.value = (patient && patient.diagnosis) ? String(patient.diagnosis) : "";
    }

    // Allergies — button summary + list (the "other" field holds only
    // what isn't in the list; same focus guard)
    renderAllergyChips(patient);

    // Lab values — rendered dynamically as a grid of lab inputs with
    // '+' buttons for adding new entries. Each lab field stores its
    // current value in p.labs[key] (the latest), and all previous
    // values are stored in p.labHistory (array of {date, key, value}).
    // When a '+' button is pressed, the current value is archived with
    // today's date into labHistory, and the input is cleared for the
    // new value.
    const labsContainer = document.getElementById("patient-labs-row");
    const labsHistoryEl = document.getElementById("patient-labs-history");
    const labs = (patient && patient.labs) ? patient.labs : {};
    const labHistory = (patient && patient.labHistory) ? patient.labHistory : [];
    const labDefs = [
      ["S. Creatinine", "creatinine"],
      ["S. Albumin",    "albumin"],
      ["WBC",           "wbc"],
      ["Hb",            "hb"],
      ["PLT",           "plt"],
      ["Na+",           "na"],
      ["K+",            "k"],
      ["Glucose",       "glucose"],
      ["CRP",           "crp"]
    ];

    // Pharmacists see only creatinine + albumin
    const AuthL = global.PharmacyAuth;
    if (AuthL && AuthL.isPharmacist && AuthL.isPharmacist() && !(AuthL.isAdmin && AuthL.isAdmin())) {
      for (let i = labDefs.length - 1; i >= 0; i--) if (labDefs[i][1] !== "creatinine" && labDefs[i][1] !== "albumin") labDefs.splice(i, 1);
    }

    if (labsContainer) {
      labsContainer.innerHTML = "";
      labsContainer.style.display = "grid";
      labsContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(80px, 1fr))";
      labsContainer.style.gap = "6px";
      labsContainer.style.marginTop = "8px";

      // Each lab: its name, the recorded result under it (with its date),
      // then a field for a NEW result + ✓ to record it (app.js recordLab).
      // The field never shows the recorded value — it is only for new ones.
      const dates = (labs && labs._dates) || {};
      labDefs.forEach(([label, key], i) => {
        const wrapper = document.createElement("div");
        wrapper.className = "lab-cell";
        wrapper.appendChild(h("div", { class: "lab-cell-name" }, label));
        const cur = labs[key] ? String(labs[key]) : "";
        wrapper.appendChild(h("div", { class: "lab-cell-value" + (cur ? "" : " is-empty") },
          cur ? [h("strong", {}, cur), dates[key] ? h("span", { class: "lab-cell-date" }, formatDateShort(dates[key])) : null] : "—"));
        const row = h("div", { class: "lab-cell-entry" });
        const input = document.createElement("input");
        input.type = "text";
        input.id = "lab-" + labFieldIdFromKey(key);
        input.className = "lab-input";
        input.placeholder = "نتيجة";
        input.inputMode = "decimal";
        input.dataset.labKey = key;
        input.dataset.labLabel = label;
        // Access control (disabled state set later by app.js openPatient)
        row.appendChild(input);
        const addBtn = document.createElement("button");
        addBtn.className = "lab-add-btn";
        addBtn.type = "button";
        addBtn.textContent = "✓";
        addBtn.title = "تسجيل النتيجة";
        addBtn.setAttribute("aria-label", "تسجيل نتيجة " + label);
        addBtn.dataset.labKey = key;
        addBtn.dataset.labLabel = label;
        row.appendChild(addBtn);
        wrapper.appendChild(row);
        labsContainer.appendChild(wrapper);
      });
    }

    // Render lab history (previous entries, newest first)
    if (labsHistoryEl) {
      labsHistoryEl.innerHTML = "";
      if (labHistory.length > 0) {
        const title = document.createElement("div");
        title.className = "lab-history-title";
        title.textContent = "التحاليل السابقة";
        labsHistoryEl.appendChild(title);

        // Group by date
        const byDate = {};
        labHistory.forEach(h => {
          const d = h.date || "—";
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(h);
        });
        Object.keys(byDate).sort().reverse().forEach(date => {
          const row = document.createElement("div");
          row.className = "lab-history-row";
          const entries = byDate[date];
          const dateStr = formatDateShort(date);
          const parts = entries.map(e => `${e.label}: ${e.value}`).join(" · ");
          row.appendChild(h("span", { class: "lab-history-date" }, dateStr));
          row.appendChild(document.createTextNode(" "));
          row.appendChild(h("span", { class: "lab-history-vals" }, parts));
          labsHistoryEl.appendChild(row);
        });
      }
    }

    renderMedsSection(patient);
    renderOrigin(patient);
  }

  // Meds list + clinical alerts. Separate so lab / age / gender edits
  // can refresh the renal alerts without rebuilding the whole view.
  function renderMedsSection(patient) {
    const medsList = document.getElementById("meds-list");
    const emptyMeds = document.getElementById("empty-meds");
    medsList.innerHTML = "";

    const meds = (patient && Array.isArray(patient.medications)) ? patient.medications : [];
    const Clinical = global.PharmacyClinical;
    const alerts = (Clinical && patient) ? Clinical.medAlerts(patient) : null;
    renderClinicalAlerts(alerts);

    if (meds.length === 0) {
      medsList.hidden = true;
      // 7th-floor patients get the "no meds ordered" note instead
      const B = global.PharmacyBoarders;
      emptyMeds.hidden = !!(B && B.isNoOrder(patient));
    } else {
      medsList.hidden = false;
      emptyMeds.hidden = true;
      meds.forEach((m, idx) => medsList.appendChild(
        renderMedCard(m, idx, alerts ? (alerts.byMed.get(idx) || []) : [], patient)
      ));
    }
  }

  // Origin floor selector (مريض الردهة / ط10 / ط9 / ط8 / ط7)
  function renderOrigin(patient) {
    const B = global.PharmacyBoarders;
    const select = document.getElementById("patient-origin-select");
    if (!B || !select) return;
    if (document.activeElement !== select) select.value = (patient && patient.originWard) || "";
    // "Return to own floor": boarders only, pharmacists + admin only
    const returnBtn = document.getElementById("transfer-ward-btn");
    if (returnBtn) {
      const Auth = global.PharmacyAuth;
      const isDoctor = !!(Auth && Auth.isDoctor && Auth.isDoctor());
      returnBtn.hidden = !B.isBoarder(patient) || isDoctor;
    }
    // Discharge / death: pharmacists only for boarders (other floors)
    const Auth2 = global.PharmacyAuth;
    const pharm = !!(Auth2 && Auth2.isPharmacist && Auth2.isPharmacist());
    ["discharge-patient-btn", "died-patient-btn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.hidden = pharm && !(Auth2.canExitPatients && Auth2.canExitPatients());
    });

    // The "missing plate number" highlight is set only by the add-med attempt
    const plate = document.getElementById("patient-plate-input");
    if (plate) plate.classList.remove("is-required-missing");

    const view = document.getElementById("view-patient");
    if (view) {
      // Pharmacist + 7th-floor patient: only name + doctor stay visible
      view.classList.toggle("is-restricted", B.hidesDetails(patient));
      // No meds are ordered for 7th-floor patients → no meds section
      view.classList.toggle("is-no-order", B.isNoOrder(patient));
    }
  }

  // Allergies: the button shows the current list ("لا يوجد" when
  // empty); its panel lists the allergy classes as tick rows (toggled
  // in app.js) + a field for any other allergy.
  function renderAllergyChips(patient) {
    const box = document.getElementById("allergy-chips");
    const Clinical = global.PharmacyClinical;
    if (!box || !Clinical) return;
    const text = (patient && patient.allergies) ? String(patient.allergies) : "";
    const parts = Clinical.splitAllergies(text);
    box.innerHTML = "";
    Clinical.ALLERGY_OPTIONS.forEach(label => {
      const on = parts.known.indexOf(label) !== -1;
      box.appendChild(h("button", {
        type: "button",
        class: "allergy-chip" + (on ? " is-on" : ""),
        dataset: { allergy: label },
        role: "checkbox",
        "aria-checked": on ? "true" : "false"
      }, [h("span", { class: "allergy-check", "aria-hidden": "true" }, on ? "✓" : ""), label]));
    });
    const input = document.getElementById("patient-allergies-input");
    if (input && document.activeElement !== input) input.value = parts.other.join("، ");

    const toggle = document.getElementById("allergy-toggle");
    const summary = document.getElementById("allergy-summary");
    if (summary) summary.textContent = text.trim() ? text.trim() : "لا يوجد";
    if (toggle) toggle.classList.toggle("has-value", !!text.trim());
  }

  // Summary panel above the meds list: drug-drug interactions (they
  // involve two meds, so they don't belong to a single card) + count.
  function renderClinicalAlerts(alerts) {
    const box = document.getElementById("clinical-alerts");
    if (!box) return;
    box.innerHTML = "";
    if (!alerts || alerts.count === 0) { box.hidden = true; return; }
    box.hidden = false;
    const perMed = alerts.count - alerts.interactions.length;
    box.appendChild(h("div", { class: "clinical-alerts-head" }, [
      h("span", { class: "clinical-alerts-icon", "aria-hidden": "true" }, "⚠"),
      h("span", {}, "تنبيهات سريرية للتحقق"),
      perMed > 0 ? h("span", { class: "clinical-alerts-count" }, perMed + " على الأدوية أدناه") : null
    ]));
    alerts.interactions.forEach(a => {
      box.appendChild(h("div", { class: "clinical-alert level-" + (a.severity === "danger" ? "danger" : "warning") }, a.msg));
    });
  }

  // med card (in patient view) — editable dose + frequency
  function renderMedCard(med, index, alerts, patient) {
    const Clinical = global.PharmacyClinical;
    const freqOptions = global.PharmacyMedications.FREQUENCIES;
    // Normalize the med's frequency to math × for matching. Old
    // patient data may have Latin "x" which would not match any
    // option in the dropdown.
    const MedsMod = global.PharmacyMedications;
    // an old prescription with "Infusion 24h" as its frequency shows as mode + 1×1
    const normalizedMedFreq = normFreq(MedsMod.medFrequency ? MedsMod.medFrequency(med) : med.frequency);
    const curMode = MedsMod.medMode ? MedsMod.medMode(med) : "";
    const modeSelect = h("select", { dir: "ltr", dataset: { medIndex: index, field: "mode" } },
      [h("option", { value: "", selected: !curMode ? "selected" : undefined }, "—")].concat(
        (MedsMod.ADMIN_MODES || []).map(m => h("option", { value: m, selected: m === curMode ? "selected" : undefined }, "\u200E" + m + "\u200E"))));
    const isCustomFreq = !freqOptions.includes(normalizedMedFreq);

    const doseInput = h("input", {
      type: "text",
      value: med.dose || "",
      placeholder: "الجرعة",
      dataset: { medIndex: index, field: "dose" },
      autocomplete: "off"
    });

    // LRM (U+200E) marks force LTR rendering of the option text
    // regardless of the surrounding RTL context. Without these,
    // some browsers (especially mobile Safari + older Android)
    // apply BiDi reordering to the option text and visually flip
    // "1×3" to "3×1" even when the <select> has dir="ltr".
    // We wrap each option's text with LRM marks on both ends.
    function lrmWrap(text) {
      return "\u200E" + text + "\u200E";
    }

    let freqSelect;
    if (isCustomFreq) {
      // include the custom value as a first option
      freqSelect = h("select", { dir: "ltr", dataset: { medIndex: index, field: "frequency" } }, [
        h("option", { value: normalizedMedFreq, selected: "selected" }, lrmWrap(normalizedMedFreq)),
        ...freqOptions.map(f => h("option", { value: f }, lrmWrap(f)))
      ]);
    } else {
      freqSelect = h("select", { dir: "ltr", dataset: { medIndex: index, field: "frequency" } },
        freqOptions.map(f => h("option", { value: f, selected: f === normalizedMedFreq ? "selected" : undefined }, lrmWrap(f)))
      );
    }

    const sci = scientificName(med);
    // Antibiotic course day — tap to correct it (e.g. started before admission)
    let dayChip = null;
    if (Clinical && Clinical.isAntibiotic(med)) {
      const d = Clinical.abxDay(med, patient);
      const tone = !d ? "" : d >= 14 ? " is-long" : d >= 7 ? " is-review" : "";
      dayChip = h("button", {
        type: "button",
        class: "abx-day-chip" + tone,
        dataset: { medIndex: index, action: "abx-day" },
        title: "يوم المضاد الحيوي — اضغط للتعديل"
      }, [d ? "D" + d : "D?", h("span", { class: "abx-day-edit", "aria-hidden": "true" }, "✎")]);
    }
    const nameBlock = h("div", { class: "med-name-block" }, [
      h("div", { class: "med-name" }, [primaryName(med), dayChip ? " " : null, dayChip]),
      sci ? h("div", { class: "med-name-en" }, sci) : null
    ]);

    const list = Array.isArray(alerts) ? alerts : [];
    const worst = list.some(a => a.level === "danger") ? "danger" : (list.length ? "warning" : "");
    const alertsBlock = list.length
      ? h("div", { class: "med-alerts" }, list.map(a =>
          h("div", { class: "med-alert level-" + a.level }, a.msg)))
      : null;

    return h("div", { class: "med-card" + (worst ? " has-alert-" + worst : ""), dataset: { medIndex: index } }, [
      h("div", { class: "med-card-head" }, [
        nameBlock,
        h("button", {
          class: "med-del",
          type: "button",
          dataset: { medIndex: index, action: "delete-med" },
          title: "حذف"
        }, "✕")
      ]),
      alertsBlock,
      h("div", { class: "med-fields" }, [
        h("div", { class: "med-field" }, [
          h("label", {}, "الجرعة"),
          doseInput
        ]),
        h("div", { class: "med-field" }, [
          h("label", {}, "التكرار"),
          freqSelect
        ]),
        h("div", { class: "med-field" }, [
          h("label", {}, "طريقة الإعطاء"),
          modeSelect
        ])
      ])
    ]);
  }

  // ---------- Patients list view ----------
  function renderPatientsList(patientsMap) {
    const container = document.getElementById("patients-list");
    const empty = document.getElementById("empty-patients");
    container.innerHTML = "";

    const all = Object.entries(patientsMap)
      .map(([key, p]) => ({ key, ...p }))
      .filter(p => p && p.name && p.name.trim())
      // by bed number (the ward-wide 1-50)
      .sort((a, b) => (global.PharmacyWard.bedLabelOfKey(a.key) || 999) - (global.PharmacyWard.bedLabelOfKey(b.key) || 999));

    if (all.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    all.forEach(p => {
      const match = p.key.match(/room-(\d+)-bed-(\d+)/) || [];
      const roomId = match[1] ? parseInt(match[1], 10) : null;
      const bedNum = match[2] ? parseInt(match[2], 10) : null;
      const hasMeds = Array.isArray(p.medications) && p.medications.length > 0;
      const initial = (p.name || "").trim().charAt(0) || "؟";
      // Detect Albumin (green dot), Meronem (red dot) and IVIG (orange) for visual
      // triage in the patients list.
      const flags = bedSpecialFlags(p);
      const hasAlbumin = flags.hasAlbumin;
      const hasMeronem = flags.hasMeronem;
      const hasIvig = flags.hasIvig;
      // Plate number (optional field, shown under the room/bed line
      // if the patient has one)
      const plateNumber = p.plateNumber && String(p.plateNumber).trim()
        ? String(p.plateNumber).trim()
        : "";

      const nameChildren = [p.name];
      if (hasAlbumin) {
        // Small green dot next to the name to mark Albumin
        nameChildren.push(h("span", {
          class: "pr-albumin-dot",
          title: "Albumin — يحتاج متابعة"
        }, "●"));
      }
      if (hasMeronem) {
        // Small red dot next to the name to mark Meronem (500mg or 1g)
        nameChildren.push(h("span", {
          class: "pr-meronem-dot",
          title: "Meronem — يحتاج متابعة"
        }, "●"));
      }
      if (hasIvig) {
        nameChildren.push(h("span", {
          class: "pr-ivig-dot",
          title: "I.V.I.G — يحتاج متابعة"
        }, "●"));
      }

      const restricted = !!(global.PharmacyBoarders && global.PharmacyBoarders.hidesDetails(p));
      const locChildren = [`${global.PharmacyWard.roomTitle(roomId)} · سرير ${global.PharmacyWard.bedLabel(roomId, bedNum)}`];
      if (restricted) {
        // Pharmacist + 7th-floor patient: name + attending doctor only
        if (p.doctor) locChildren.push(h("span", { class: "pr-demo" }, " · " + p.doctor));
      } else if (plateNumber) {
        locChildren.push(h("span", { class: "pr-plate" }, " · طبلة " + plateNumber));
      }
      // Append age + gender to the location line if present, so the
      // patients list shows them at a glance.
      const ageStr = (p.age && String(p.age).trim()) ? String(p.age).trim() : "";
      const genderStr = (p.gender === "male")
        ? "ذكر"
        : (p.gender === "female")
          ? "أنثى"
          : "";
      const demoParts = [];
      if (ageStr) demoParts.push("العمر " + ageStr);
      // (no sex in the list — the user asked)
      if (demoParts.length > 0 && !restricted) {
        locChildren.push(h("span", { class: "pr-demo" }, " · " + demoParts.join(" · ")));
      }

      const rowCls =
        "patient-row" +
        (hasMeds ? " has-meds" : "") +
        (hasAlbumin ? " has-albumin" : "") +
        (hasMeronem ? " has-meronem" : "");
      const row = h("div", {
        class: rowCls,
        dataset: { roomId: roomId, bed: bedNum, key: p.key }
      }, [
        h("div", { class: "pr-info" }, [
          h("div", { class: "pr-name" }, nameChildren),
          h("div", { class: "pr-loc" }, locChildren)
        ])
      ]);
      container.appendChild(row);
    });
  }

  // ---------- Medication bottom-sheet ----------
  // Renders ONLY medications matching the active tab's form (no section header).
  // The caller passes `activeTab` ("vial" | "tablet") to choose which form to show.
  // Tab counts for both forms are also updated so the user sees totals at all times.
  function renderMedOptions(meds, selectedIds, filterText, activeTab) {
    const container = document.getElementById("med-options");
    container.innerHTML = "";

    // Update tab counts on every render (across all tabs)
    updateTabCounts(meds);

    // Resolve the active tab — must be one of the known forms, else "vial"
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
    const tab = VALID_FORMS.indexOf(activeTab) !== -1 ? activeTab : "vial";

    const q = (filterText || "").trim().toLowerCase();
    // No search: the active tab's form. A search looks in EVERY form
    // (vials, ampoules, tablets …) — each result shows its form; the open
    // tab's form comes first, then the usual form order.
    const FORM_ORDER_ALL = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || VALID_FORMS;
    const FORM_LABELS_ALL = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    let filtered;
    if (q) {
      const rank = (m) => {
        const f = m.form || "vial";
        if (f === tab) return -1;
        const i = FORM_ORDER_ALL.indexOf(f);
        return i === -1 ? 99 : i;
      };
      filtered = meds
        .map((m, i) => ({ m, i }))
        .filter(({ m }) =>
          (m.nameTrade || "").toLowerCase().includes(q) ||
          (m.nameAr || "").toLowerCase().includes(q) ||
          (m.nameEn || "").toLowerCase().includes(q))
        .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
        .map(x => x.m);
    } else {
      filtered = meds.filter(m => (m.form || "vial") === tab);
    }

    if (filtered.length === 0) {
      // Find another form that has meds to suggest as an alternative
      const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
      const FORM_LABELS = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
      const otherFormsWithMeds = FORM_ORDER
        .filter(f => f !== tab)
        .filter(f => meds.some(m => (m.form || "vial") === f));
      const curTabLabel = FORM_LABELS[tab] || tab;

      const hintChildren = [
        h("div", { style: "font-size:28px;margin-bottom:8px;color:var(--text-faint);font-weight:800;" }, "⌕"),
        h("div", {}, q
          ? "لا توجد نتائج مطابقة في أي قسم."
          : `لا توجد أدوية في ${curTabLabel}.`)
      ];
      if (q) {
        // the search already covers every form: no "try another tab" links
        container.appendChild(h("div", {
          style: "text-align:center;padding:24px 16px;color:var(--text-muted);font-weight:600;font-size:13px;line-height:1.6;"
        }, hintChildren));
        return;
      }

      // Show one clickable link per alternative form
      otherFormsWithMeds.forEach(otherKey => {
        const otherLabel = FORM_LABELS[otherKey] || otherKey;
        hintChildren.push(h("div", {
          style: "margin-top:8px;color:var(--primary);font-weight:800;cursor:pointer;text-decoration:underline;",
          onclick: () => {
            const otherBtn = document.querySelector(`.sheet-tab[data-tab="${otherKey}"]`);
            if (otherBtn) otherBtn.click();
          }
        }, `جرّب ${otherLabel} ←`));
      });

      const hintEl = h("div", {
        style: "text-align:center;padding:24px 16px;color:var(--text-muted);font-weight:600;font-size:13px;line-height:1.6;"
      }, hintChildren);
      container.appendChild(hintEl);
      return;
    }

    // Render meds (no section header — the tab itself is the header)
    filtered.forEach(m => {
      const id = "med-opt-" + m.id;
      const checked = selectedIds.has(m.id);
      const sci = scientificName(m);
      const metaParts = [];
      if (q) metaParts.push(FORM_LABELS_ALL[m.form || "vial"] || (m.form || "vial"));   // searching all forms: which one
      if (sci) metaParts.push(sci);
      if (m.defaultDose) metaParts.push(m.defaultDose);
      if (m.defaultFrequency) metaParts.push(m.defaultFrequency);
      // Not available in the hospital (set by the admin in "توفر الأدوية")
      const unavailable = m.available === false;
      container.appendChild(
        h("label", { class: "med-option" + (unavailable ? " is-unavailable" : ""), for: id }, [
          h("input", {
            type: "checkbox",
            id: id,
            dataset: { medId: m.id },
            checked: checked ? "checked" : undefined
          }),
          h("div", { class: "med-option-body" }, [
            h("div", { class: "med-option-name" }, [
              h("span", {
                class: "med-avail-dot " + (unavailable ? "is-off" : "is-on"),
                title: unavailable ? "غير متوفر في المستشفى" : "متوفر في المستشفى",
                "aria-label": unavailable ? "غير متوفر" : "متوفر"
              }),
              primaryName(m),
              unavailable ? h("span", { class: "med-unavailable-tag" }, "غير متوفر") : null
            ]),
            h("div", { class: "med-option-meta" },
              metaParts.length ? metaParts.join(" · ") : "—")
          ])
        ])
      );
      // Unavailable → suggest available alternatives (outside the label
      // so tapping one doesn't toggle the unavailable med)
      // (not shown to pharmacists — the user asked; doctors + the admin see them)
      const isPharmacist = !!(global.PharmacyAuth && global.PharmacyAuth.isPharmacist && global.PharmacyAuth.isPharmacist());
      if (unavailable && !isPharmacist && global.PharmacyClinical && global.PharmacyClinical.availableAlternatives) {
        const alts = global.PharmacyClinical.availableAlternatives(m, meds, 3);
        if (alts.length) {
          container.appendChild(h("div", { class: "med-alt-row" }, [
            h("span", { class: "med-alt-label" }, "بديل متوفر:")
          ].concat(alts.map(a => h("button", {
            type: "button",
            class: "med-alt-chip" + (selectedIds.has(a.med.id) ? " is-selected" : "") + (a.kind === "class" ? " is-class" : ""),
            dataset: { altId: a.med.id },
            title: a.label
          }, [
            h("span", { class: "med-avail-dot is-on" }),
            primaryName(a.med),
            a.kind === "class" ? h("span", { class: "med-alt-note" }, a.label) : null
          ])))));
        }
      }
    });
  }

  // Render the form tab buttons dynamically based on FORM_ORDER.
  // Only show tabs for forms that actually have medications (skip empty).
  // The first non-empty form (in FORM_ORDER) becomes the default active tab.
  function renderSheetTabs(meds, activeTab) {
    const container = document.getElementById("sheet-tabs");
    if (!container) return;
    container.innerHTML = "";

    const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
    const FORM_LABELS = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    const FORM_ICONS = (global.PharmacyMedications && global.PharmacyMedications.FORM_ICONS) || {};

    // Count meds per form
    const counts = {};
    meds.forEach(m => {
      const f = m.form || "vial";
      counts[f] = (counts[f] || 0) + 1;
    });

    // Filter FORM_ORDER to forms that have at least 1 med (always show
    // all 5 if user wants, but with empty count = 0 we still show them
    // so the user can switch to see "no meds" hint)
    const formsToShow = FORM_ORDER.filter(f => counts[f] > 0);
    if (formsToShow.length === 0) formsToShow.push(FORM_ORDER[0] || "vial");

    // Decide active tab: keep current if it's in the list, otherwise
    // use the first non-empty form.
    let active = (activeTab && formsToShow.indexOf(activeTab) !== -1)
      ? activeTab
      : formsToShow[0];

    formsToShow.forEach(form => {
      const isActive = (form === active);
      container.appendChild(h("button", {
        class: "sheet-tab" + (isActive ? " active" : ""),
        type: "button",
        role: "tab",
        "aria-selected": isActive ? "true" : "false",
        dataset: { tab: form }
      }, [
        makeIcon(FORM_ICONS[form] || "•"),
        h("span", { class: "sheet-tab-label" }, FORM_LABELS[form] || form),
        h("span", { class: "sheet-tab-count", dataset: { formCount: form } }, String(counts[form] || 0))
      ]));
    });

    return active;  // Return the resolved active tab so caller knows
  }

  // Update the small counter on each tab button (# per form)
  function updateTabCounts(meds) {
    const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
    const counts = {};
    FORM_ORDER.forEach(f => counts[f] = 0);
    meds.forEach(m => {
      const f = m.form || "vial";
      counts[f] = (counts[f] || 0) + 1;
    });
    document.querySelectorAll(".sheet-tab-count").forEach(el => {
      const f = el.dataset.formCount;
      if (f && f in counts) el.textContent = String(counts[f]);
    });
  }

  // Update active tab styling on the tab buttons
  function setActiveTabUI(activeTab) {
    document.querySelectorAll(".sheet-tab").forEach(btn => {
      const isActive = btn.dataset.tab === activeTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  // selected meds visual-only list inside the sheet.
  // Each row shows:
  //   - medication name (display only — NOT editable)
  //   - 6 squares visualizing the dose frequency
  //     (filled = dose time, empty = no dose, special = custom freq like 'حسب القياس')
  //   - dose text + frequency text
  //   - delete button (to remove from selection)
  // The user can still edit dose + frequency AFTER adding the med
  // to the patient (in the patient view).
  function parseFrequencyCount(freq) {
    if (!freq) return 0;
    // Match patterns like "1×3", "1x4", "1 × 2", "2×3", etc.
    const m = freq.match(/×\s*(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return isNaN(n) ? 0 : n;
    }
    // Custom / non-numeric frequencies ("حسب القياس", "حسب البروتوكول", ...)
    return -1;
  }

  // Renders a -/+ stepper to control the dose frequency (1×N).
  // Behavior:
  //   - tap "+"  → frequency increases by 1 (max 12)
  //   - tap "-"  → frequency decreases by 1 (min 1, can't go to 1×0)
  //   - if frequency is custom (e.g. "حسب القياس"), the number cell shows
  //     "مخصص" instead of N, and tapping + or - switches to numeric (1×1 / 1×2)
  // The +/- buttons and the number are all in one row.
  function renderFreqStepper(freq) {
    const count = parseFrequencyCount(freq);
    const isCustom = (count === -1);
    // Display: numeric count (e.g. 3 → shown as "1×3" → just "3" here) or "مخصص"
    const displayNumber = isCustom ? "مخصص" : String(count || 0);

    return h("div", {
      class: "freq-stepper",
      role: "group",
      "aria-label": `التكرار: ${freq || "—"}`,
      title: `التكرار: ${freq || "—"} — اضغط + أو - للتعديل`
    }, [
      h("button", {
        type: "button",
        class: "freq-step-btn minus",
        dataset: { action: "freq-decrement" },
        title: "تقليل التكرار بمقدار 1",
        "aria-label": "تقليل التكرار"
      }, "−"),
      h("span", {
        class: "freq-step-number" + (isCustom ? " is-custom" : ""),
        "aria-live": "polite"
      }, displayNumber),
      h("button", {
        type: "button",
        class: "freq-step-btn plus",
        dataset: { action: "freq-increment" },
        title: "زيادة التكرار بمقدار 1",
        "aria-label": "زيادة التكرار"
      }, "+")
    ]);
  }

  function renderSelectedList(selected) {
    const container = document.getElementById("selected-list");
    container.innerHTML = "";
    if (selected.length === 0) return;

    selected.forEach((m, idx) => {
      container.appendChild(
        h("div", { class: "sel-item", dataset: { selIndex: idx } }, [
          // Single row: name | dose | -/+ | delete — all on one line
          h("div", { class: "sel-item-row" }, [
            h("div", { class: "sel-item-name" }, primaryName(m)),
            h("span", { class: "sel-item-dose" }, m.dose || "—"),
            renderFreqStepper(m.frequency),
            h("button", {
              class: "sel-item-del",
              type: "button",
              dataset: { selIndex: idx, action: "del-selected" },
              title: "حذف"
            }, "✕")
          ])
        ])
      );
    });
  }

  // ---------- Sheet visibility ----------
  function openSheet() {
    const sheet = document.getElementById("med-sheet");
    const overlay = document.getElementById("sheet-overlay");
    overlay.hidden = false;
    sheet.hidden = false;
    // force reflow to ensure transition fires
    void sheet.offsetWidth;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    fitSheetAboveKeyboard();
  }
  // Phones: the on-screen keyboard covers the bottom of the page, and the
  // sheet sits at the bottom — so the search results were hidden behind it.
  // While the sheet is open, keep it inside the visible area (above the
  // keyboard) using the visual viewport.
  function fitSheetAboveKeyboard() {
    const sheet = document.getElementById("med-sheet");
    const vv = window.visualViewport;
    if (!sheet) return;
    if (!vv || !sheet.classList.contains("open")) {
      sheet.style.bottom = "";
      sheet.style.maxHeight = "";
      return;
    }
    const covered = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    // keyboard up: the sheet gets compact (see .kb-open in theme.css) so the search field stays in view
    sheet.classList.toggle("kb-open", covered > 80);
    sheet.style.setProperty("--sheet-vh", Math.round(vv.height) + "px");
    sheet.style.bottom = covered ? covered + "px" : "";
    sheet.style.maxHeight = covered ? Math.max(200, vv.height - 8) + "px" : "";
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fitSheetAboveKeyboard);
    window.visualViewport.addEventListener("scroll", fitSheetAboveKeyboard);
  }
  function closeSheet() {
    const sheet = document.getElementById("med-sheet");
    const overlay = document.getElementById("sheet-overlay");
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    sheet.style.bottom = "";
    sheet.style.maxHeight = "";
    sheet.classList.remove("kb-open");
    setTimeout(() => {
      sheet.hidden = true;
      overlay.hidden = true;
    }, 260);
    document.body.style.overflow = "";
  }

  // ---------- View switching ----------
  // The page scrolls inside <body> (html/body are 100% high, body
  // overflow-y: auto), not the window: window.scrollY stays 0 there.
  function getScrollY() {
    return document.body.scrollTop || document.documentElement.scrollTop || window.scrollY || 0;
  }
  function setScrollY(y) {
    document.body.scrollTop = y;
    document.documentElement.scrollTop = y;
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  function showView(name) {
    // Leaving the rooms: remember where the user was (room 7, 9 …) so
    // coming back — after adding medicines, the back button — lands there
    if (showView._lastView === "home" && name !== "home") showView._homeY = getScrollY();
    const views = document.querySelectorAll(".view");
    views.forEach(v => {
      v.hidden = v.dataset.view !== name;
    });
    markNav(name);
    // Only scroll to top when switching to a DIFFERENT view.
    // If we're already on this view (e.g. returning to 'home' after
    // adding meds), don't scroll — preserve the user's scroll
    // position so they don't lose their place in the rooms grid.
    if (showView._lastView !== name) {
      const y = name === "home" ? (showView._homeY || 0) : 0;
      setScrollY(y);
      // again after the redraw that usually follows (rooms re-rendered)
      if (y) requestAnimationFrame(() => setScrollY(y));
    }
    showView._lastView = name;
  }

  // ---------- Admin: medication catalog list ----------
  function renderAdminMedList(meds, selectedId) {
    const container = document.getElementById("admin-med-list");
    container.innerHTML = "";
    document.getElementById("admin-count").textContent = String(meds.length);

    if (meds.length === 0) {
      container.appendChild(h("div", {
        style: "text-align:center;padding:20px;color:var(--text-muted);font-weight:600;font-size:13px;"
      }, "لا توجد أدوية. اضغط «دواء جديد» للبدء."));
      return;
    }

    // Group meds by their form (vial / ampule / tablet / syrup / ...).
    // We use the FORM_ORDER from medications.js so the sections appear
    // in a fixed, predictable order (the same order as the sheet tabs).
    // Within each section, the meds keep their original relative order
    // from the `meds` array — this preserves the catalog's sort_order
    // so move-up/move-down still work as before.
    const Meds = global.PharmacyMedications || {};
    const FORM_LABELS = Meds.FORM_LABELS || {};
    const FORM_ORDER  = Meds.FORM_ORDER || ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

    // Group: bucket each med into its form group (using 'vial' as
    // fallback for unknown/legacy forms).
    const groups = {};
    FORM_ORDER.forEach(form => { groups[form] = []; });
    meds.forEach(m => {
      const formKey = (m.form && FORM_LABELS[m.form]) ? m.form : "vial";
      if (!groups[formKey]) groups[formKey] = []; // unknown form → its own bucket
      groups[formKey].push(m);
    });

    // Render each non-empty group with a section header.
    // We keep a running index across all groups so the "position"
    // badge on each row still reflects the med's position in the
    // full catalog (1-based), matching what the chart and the
    // bottom-sheet selection see. Move-up/move-down use the actual
    // index in the underlying `meds` array (passed via the med's id),
    // not the visible position, so they keep working.
    let runningIdx = 0;
    FORM_ORDER.forEach(form => {
      const bucket = groups[form];
      if (!Array.isArray(bucket) || bucket.length === 0) return;
      const formLabel = FORM_LABELS[form] || form;

      // Section header — sticky so it stays visible when scrolling
      // a long list of meds within one form.
      const header = h("div", {
        class: "admin-med-section-header admin-form-badge is-" + form
      }, [
        h("span", { class: "admin-med-section-name" }, formLabel),
        h("span", { class: "admin-med-section-count" }, bucket.length + " دواء")
      ]);
      container.appendChild(header);

      // Compute the first and last RUNNING INDEX for this form group
      // (used for logging/debug only — the disabled state for ⤒/↑/↓/⤓
      // buttons uses the FLAT catalog position, since move-top and
      // move-bottom move across the entire flat list).
      const firstIdxInGroup = runningIdx;
      const lastIdxInGroup = runningIdx + bucket.length - 1;

      bucket.forEach((m) => {
        const idx = runningIdx;
        const sci = scientificName(m);
        const metaParts = [];
        if (sci) metaParts.push(sci);
        if (m.defaultDose) metaParts.push(m.defaultDose);
        if (m.defaultFrequency) metaParts.push(m.defaultFrequency);

        const formKey = (m.form && FORM_LABELS[m.form]) ? m.form : "vial";
        const formLabelInner = FORM_LABELS[formKey] || formKey;
        const formClass = "admin-form-badge is-" + formKey;

        const row = h("div", {
          class: "admin-med-row" + (selectedId === m.id ? " selected" : ""),
          dataset: { medId: m.id },
          draggable: "true"  // enable HTML5 drag-and-drop for reordering
        }, [
          h("div", { class: "admin-med-pos", title: "ترتيب الظهور في قائمة الاختيار" }, String(idx + 1)),
          h("div", { class: "admin-med-info" }, [
            h("div", { class: "admin-med-name" }, [
              primaryName(m),
              h("span", { class: formClass, title: "الشكل الدوائي" }, formLabelInner)
            ]),
            h("div", { class: "admin-med-meta" },
              metaParts.length ? metaParts.join(" · ") : "—")
          ]),
          h("div", { class: "admin-med-actions" }, [
            h("div", {
              class: "admin-ico-btn drag-handle",
              title: "اسحب لإعادة الترتيب",
              "aria-label": "اسحب لإعادة الترتيب"
            }, "⠿"),
            h("button", {
              class: "admin-ico-btn edit",
              type: "button",
              dataset: { medId: m.id, action: "edit-med" },
              title: "تعديل"
            }, "✎"),
            h("button", {
              class: "admin-ico-btn del",
              type: "button",
              dataset: { medId: m.id, action: "del-med" },
              title: "حذف"
            }, "✕")
          ])
        ]);
        container.appendChild(row);
        runningIdx++;
      });
    });
  }

  // ---------- Admin: show/hide editor form ----------
  function showAdminForm(med, isNew) {
    const card = document.getElementById("admin-form-card");
    const empty = document.getElementById("admin-empty");
    empty.hidden = true;
    card.hidden = false;
    document.getElementById("admin-form-title").textContent =
      isNew ? "إضافة دواء جديد" : "تعديل دواء";

    const nameTrade = document.getElementById("adm-name-trade");
    const nameAr = document.getElementById("adm-name-ar");
    const nameEn = document.getElementById("adm-name-en");
    const nameChart = document.getElementById("adm-name-chart");
    const form   = document.getElementById("adm-form");
    const dose   = document.getElementById("adm-dose");
    const freq   = document.getElementById("adm-freq");
    const freqWrap = document.getElementById("adm-freq-custom-wrap");
    const freqCustom = document.getElementById("adm-freq-custom");

    nameTrade.value = med.nameTrade || "";
    nameAr.value    = med.nameAr || "";
    nameEn.value    = med.nameEn || "";
    nameChart.value = med.nameChart || "";
    // Set form dropdown: fall back to "vial" if form is unknown/empty
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
    const formVal = VALID_FORMS.indexOf(med.form) !== -1 ? med.form : "vial";
    form.value = formVal;
    dose.value      = med.defaultDose || "";

    // Normalize the stored frequency to the math "×" (U+00D7) form
    // because the dropdown options use "×" (U+00D7). Old catalog
    // entries may use Latin "x" (U+0078) — without this normalization,
    // freq.value = "1x1" wouldn't match any dropdown option, and the
    // browser would render it with RTL text shaping that visually
    // flips the digits (e.g. "1×3" appearing as "3×1").
    const normalizedFreq = normFreq(med.defaultFrequency);
    const freqOptions = global.PharmacyMedications.FREQUENCIES;
    const isStandard = freqOptions.includes(normalizedFreq);
    if (isStandard || !normalizedFreq) {
      freq.value = normalizedFreq || "1×1";
      freqWrap.hidden = true;
      freqCustom.value = "";
    } else {
      freq.value = "custom";
      freqWrap.hidden = false;
      freqCustom.value = normalizedFreq;
    }
  }
  function hideAdminForm() {
    document.getElementById("admin-form-card").hidden = true;
    document.getElementById("admin-empty").hidden = false;
    ["adm-name-trade", "adm-name-ar", "adm-name-en", "adm-name-chart", "adm-dose", "adm-freq-custom"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    document.getElementById("adm-form").value = "vial";
    document.getElementById("adm-freq").value = "1×1";
    document.getElementById("adm-freq-custom-wrap").hidden = true;
  }
  function toggleAdminFreqCustom() {
    const freq = document.getElementById("adm-freq").value;
    document.getElementById("adm-freq-custom-wrap").hidden = freq !== "custom";
  }

  // ---------- Admin: read form into med object ----------
  function readAdminForm() {
    const nameTrade = document.getElementById("adm-name-trade").value.trim();
    const nameAr = document.getElementById("adm-name-ar").value.trim();
    const nameEn = document.getElementById("adm-name-en").value.trim();
    const nameChart = document.getElementById("adm-name-chart").value.trim();
    const form   = document.getElementById("adm-form").value;
    const dose   = document.getElementById("adm-dose").value.trim();
    const freqSel = document.getElementById("adm-freq").value;
    const freqCustom = document.getElementById("adm-freq-custom").value.trim();
    // Normalize the frequency: convert any Latin "x" (U+0078) to the
    // math "×" (U+00D7) form used by the dropdown + the rest of the
    // app. This ensures consistency in storage + future reads.
    const rawFreq = freqSel === "custom" ? freqCustom : freqSel;
    const frequency = normFreq(rawFreq);
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "effervescent", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

    return {
      nameTrade: nameTrade,
      nameAr:    nameAr,
      nameEn:    nameEn,
      nameChart: nameChart,
      form:      VALID_FORMS.indexOf(form) !== -1 ? form : "vial",
      defaultDose:      dose,
      defaultFrequency: frequency
    };
  }

  // ---------- Print Chart (التشارت) ----------
  // Auto-pagination: 35 patients per page, header + med columns repeat.
  function buildChartReport(patientsMap, meds, supplyDistribution) {
    const root = document.getElementById("chart-print-root");
    root.innerHTML = "";

    if (!Array.isArray(meds) || meds.length === 0) {
      root.appendChild(h("div", {
        style: "text-align:center;padding:40px;color:#999;font-size:14px;"
      }, "لا توجد أدوية في الكتالوج"));
      return;
    }

    const PATIENTS_PER_PAGE = 35;
    const MED_COLS = 50;

    const Ward = global.PharmacyWard;
    const occupiedRows = [];
    if (patientsMap && typeof patientsMap === "object") {
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = patientsMap[key];
          if (p && p.name && p.name.trim()) {
            // IMPORTANT: deep-copy the patient's medications array so
            // the random-supply injection below doesn't mutate the
            // actual stored data. The chart only sees a temporary
            // snapshot; localStorage and state.patients stay clean.
            //
            // ALSO: filter out any legacy 'syringe-5cc' entries that
            // might still be on the patient from before this update
            // (when 5cc was auto-managed + stored on the patient).
            // They're now injected at print-time only, so we drop the
            // stale stored copies here to avoid duplicates.
            const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
              .filter(pm => pm && pm.id !== "syringe-5cc") // drop legacy 5cc
              .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
            occupiedRows.push({
              name: p.name.trim(),
              medications: medsCopy
            });
          }
        });
      });
    }

    // -------- Supply distribution (from the Supply Order modal) --------
    // The caller (app.js supply-order-submit) passes a
    // supplyDistribution map: supplyId → { bedKey: freq }.
    // We inject each supply into the corresponding patient's
    // medication list (on the deep-copy, not the stored data).
    // Supplies with no entry in supplyDistribution (or freq=0) are
    // simply not added.
    if (supplyDistribution && typeof supplyDistribution === "object") {
      occupiedRows.forEach(row => {
        // Find this patient's bedKey by matching the name+medications
        // — actually we need the bedKey. Let's store it on the row.
      });
    }

    // We need the bedKey to look up supplyDistribution. Let's
    // re-do the occupiedRows build to include the bedKey.
    // (The original loop above didn't store it. We need to redo
    //  the supply injection using the bedKey.)
    //
    // Actually, let's restructure: pass bedKey into the row.

    // Re-build occupiedRows with bedKey included
    const occupiedRowsWithKey = [];
    {
      const Ward2 = global.PharmacyWard;
      Ward2.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward2.bedKey(room.id, bed.number);
          const p = patientsMap[key];
          if (p && p.name && p.name.trim()) {
            const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
              .filter(pm => pm && pm.id !== "syringe-5cc")
              .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
            occupiedRowsWithKey.push({
              bedKey: key,
              name: p.name.trim(),
              medications: medsCopy
            });
          }
        });
      });
    }

    // Inject supplies from supplyDistribution
    if (supplyDistribution && typeof supplyDistribution === "object") {
      // For each supplyId in the distribution, look up the catalog
      // entry (for display name/dose). Fall back to hardcoded defaults.
      const findOrDefaults = (id, fallback) => {
        const m = meds.find(x => x && x.id === id);
        return m || fallback;
      };
      const supplyDefaults = {
        "dextrose-saline":   { nameTrade: "G/S", nameAr: "ديكستروز سالين", nameEn: "Glucose Saline", defaultDose: "500 ml" },
        "ringers-lactate":    { nameTrade: "R/L", nameAr: "رينجر لاكتات", nameEn: "Ringer Lactate", defaultDose: "500 ml" },
        "glucose-5":          { nameTrade: "G/W", nameAr: "مغذي سكري 5%", nameEn: "Glucose 5%", defaultDose: "500 ml" },
        "sodium-chloride-09": { nameTrade: "N/S", nameAr: "مغذي ملح 500مل", nameEn: "Normal Saline 500ml", defaultDose: "500 ml" },
        "nacl-100ml":         { nameTrade: "N/S 100ml", nameAr: "مغذي ملح 100مل", nameEn: "NaCl 0.9% 100ml", defaultDose: "100 ml" },
        "iv-set":             { nameTrade: "I.V. Set", nameAr: "خط الإعطاء", nameEn: "I.V. Set", defaultDose: "1 خط" },
        "blood-iv-set":       { nameTrade: "Blood I.V. Set", nameAr: "خط دم", nameEn: "Blood I.V. Set", defaultDose: "1 خط" },
        "cannula":            { nameTrade: "Cannula", nameAr: "كانيولا", nameEn: "Cannula", defaultDose: "1 قطعة" },
        "syringe-5cc":        { nameTrade: "5cc Syringe", nameAr: "سرنجة 5 سي سي", nameEn: "5cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-1cc":        { nameTrade: "1cc Syringe", nameAr: "سرنجة 1 سي سي", nameEn: "1cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-10cc":       { nameTrade: "10cc Syringe", nameAr: "سرنجة 10 سي سي", nameEn: "10cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-20cc":       { nameTrade: "20cc Syringe", nameAr: "سرنجة 20 سي سي", nameEn: "20cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-50cc":       { nameTrade: "50cc Syringe", nameAr: "سرنجة 50 سي سي", nameEn: "50cc Syringe", defaultDose: "1 سرنجة" },
        "urine-bag":          { nameTrade: "Urine Bag", nameAr: "كيس إدرار", nameEn: "Urine Bag", defaultDose: "1 كيس" },
        "ng-tube-14":         { nameTrade: "NG Tube 14", nameAr: "أنبوب تغذية 14", nameEn: "NG Tube 14", defaultDose: "1 قطعة" },
        "floy-14":            { nameTrade: "Foley 14", nameAr: "قسطرة فولي 14", nameEn: "Foley 14", defaultDose: "1 قطعة" }
      };

      Object.keys(supplyDistribution).forEach(supplyId => {
        const dist = supplyDistribution[supplyId];
        if (!dist || typeof dist !== "object") return;
        const defaults = supplyDefaults[supplyId] || { nameTrade: supplyId, nameAr: "", nameEn: supplyId, defaultDose: "" };
        const med = findOrDefaults(supplyId, defaults);

        occupiedRowsWithKey.forEach(row => {
          const freq = dist[row.bedKey];
          if (freq && freq > 0) {
            row.medications.push({
              id:        supplyId,
              nameTrade: med.nameTrade || defaults.nameTrade,
              nameAr:    med.nameAr || defaults.nameAr || "",
              nameEn:    med.nameEn || defaults.nameEn || "",
              form:      "supplies",
              dose:      (med.defaultDose || defaults.defaultDose) || "",
              frequency: "1×" + freq
            });
          }
        });
      });
    }

    // Replace occupiedRows with the enriched version
    occupiedRows.length = 0;
    occupiedRowsWithKey.forEach(r => occupiedRows.push(r));

    const prescribedIds = new Set();
    occupiedRows.forEach(p => {
      p.medications.forEach(pm => {
        if (pm && pm.id) prescribedIds.add(pm.id);
      });
    });
    // prescribedMeds = catalog meds that are prescribed. PLUS any
    // injected random supplies that aren't in the catalog (e.g. user
    // deleted syringe-1cc / iv-set but we still injected them with
    // fallback defaults). We add those fallbacks so their columns
    // appear in the chart.
    const prescribedMeds = meds.filter(m => prescribedIds.has(m.id));
    // Find any prescribed ids that aren't in the catalog, and
    // synthesize catalog-like entries for them from the injected
    // rows (so they get a column header in the chart).
    const catalogIds = new Set(meds.map(m => m && m.id).filter(Boolean));
    const missingFromCatalog = [];
    prescribedIds.forEach(id => {
      if (!catalogIds.has(id)) {
        // Find the first injected row that has this id and use its
        // metadata as the column header source.
        for (const row of occupiedRows) {
          const found = (row.medications || []).find(pm => pm && pm.id === id);
          if (found) {
            missingFromCatalog.push({
              id:        found.id,
              nameTrade: found.nameTrade,
              nameAr:    found.nameAr    || "",
              nameEn:    found.nameEn    || "",
              form:      found.form      || "supplies"
            });
            break;
          }
        }
      }
    });
    const allPrescribedMeds = prescribedMeds.concat(missingFromCatalog);

    // Prioritize the auto-injected supplies so they always get a
    // column in the chart. Without this, a catalog with 50+
    // prescribed meds could fill the 50-column limit before reaching
    // the supplies at the end (and the user would see "NaCl 100ml"
    // and "Cannula" missing from the chart).
    //
    // The user asked for the supplies to appear at the END of the
    // chart (after all regular medications), not at the beginning.
    // So we take the first (MED_COLS - N_priority) regular meds,
    // then append the priority supplies. This guarantees:
    //   1. Supplies always get a column (reserved slots at the end)
    //   2. Supplies appear after all other meds
    const PRIORITY_SUPPLY_IDS = [
      "dextrose-saline", "ringers-lactate", "glucose-5", "sodium-chloride-09",
      "nacl-100ml", "iv-set", "blood-iv-set", "cannula",
      "syringe-5cc", "syringe-1cc", "syringe-10cc", "syringe-20cc", "syringe-50cc",
      "urine-bag", "ng-tube-14", "floy-14"
    ];
    // Split: priority supplies (for counting), then the rest in
    // catalog order.
    const priorityBucket = [];
    const restBucket = [];
    allPrescribedMeds.forEach(m => {
      if (m && PRIORITY_SUPPLY_IDS.indexOf(m.id) !== -1) {
        priorityBucket.push(m);
      } else {
        restBucket.push(m);
      }
    });
    // Sort priority bucket by the PRIORITY_SUPPLY_IDS order so they
    // appear in the chart in a predictable, stable order.
    priorityBucket.sort((a, b) => {
      return PRIORITY_SUPPLY_IDS.indexOf(a.id) - PRIORITY_SUPPLY_IDS.indexOf(b.id);
    });
    // Reserve the last N slots for priority supplies, fill the rest
    // with regular meds (up to MED_COLS - N_priority).
    const numPriority = priorityBucket.length;
    const maxRegular = Math.max(0, MED_COLS - numPriority);
    const regularToFit = restBucket.slice(0, maxRegular);
    const ordered = regularToFit.concat(priorityBucket);
    const orderedMeds = [];
    for (let i = 0; i < MED_COLS; i++) {
      orderedMeds.push(ordered[i] || null);
    }

    const numPages = Math.max(1, Math.ceil(occupiedRows.length / PATIENTS_PER_PAGE));

    for (let page = 0; page < numPages; page++) {
      const startIdx = page * PATIENTS_PER_PAGE;
      const pagePatients = occupiedRows.slice(startIdx, startIdx + PATIENTS_PER_PAGE);

      const pageDiv = h("div", { class: "chart-page" + (page > 0 ? " chart-page-break" : "") });
      const table = h("table", { class: "chart-matrix" });

      const thead = h("thead", {});
      const headRow = h("tr", {});
      headRow.appendChild(h("th", { class: "chart-patient-col-header" }, [
        h("center", {}, [
          h("div", {}, "الطابق السادس"),
          h("div", {}, "الباطنية")
        ])
      ]));
      orderedMeds.forEach(m => {
        if (!m) {
          headRow.appendChild(h("th", { class: "chart-med-col-header chart-med-empty" }, ""));
          return;
        }
        const label = m.nameTrade || m.nameAr || m.nameEn || m.id;
        headRow.appendChild(h("th", {
          class: "chart-med-col-header",
          title: label + (m.nameEn ? " (" + m.nameEn + ")" : "")
        }, [
          h("center", {}, [
            h("div", { class: "chart-med-label" }, label)
          ])
        ]));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = h("tbody", {});
      for (let i = 0; i < PATIENTS_PER_PAGE; i++) {
        const p = pagePatients[i];
        const tr = h("tr", {});

        const patientName = (p && p.name) ? p.name : "";
        tr.appendChild(h("td", { class: "chart-patient-cell" }, [
          h("center", {}, patientName)
        ]));

        let myMedCounts = null;
        if (p && Array.isArray(p.medications) && p.medications.length > 0) {
          myMedCounts = {};
          p.medications.forEach(pm => {
            const freq = pm.frequency || "";
            const match = freq.match(/×\s*(\d+)/);
            let n;
            if (match) {
              n = parseInt(match[1], 10);
            } else {
              // No '×' found — try parsing as a plain number
              // (e.g. "1" or "2" without the "1×" prefix)
              const plainNum = parseInt(freq, 10);
              n = isNaN(plainNum) ? 0 : plainNum;
            }
            myMedCounts[pm.id] = { count: n, freq: freq };
          });
        }

        orderedMeds.forEach(m => {
          let cellText = "";
          let cellClass = "chart-cell";
          if (!m) {
            tr.appendChild(h("td", { class: cellClass }, ""));
            return;
          }
          if (myMedCounts) {
            const entry = myMedCounts[m.id];
            if (entry) {
              if (entry.count > 0) {
                cellText = String(entry.count);
              } else {
                cellText = entry.freq || "؟";
                cellClass += " chart-cell-custom";
              }
            }
          }
          tr.appendChild(h("td", { class: cellClass }, [
            h("center", {}, cellText)
          ]));
        });

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      pageDiv.appendChild(table);
      root.appendChild(pageDiv);
    }
    // No return value — the user requested no flashHint message after
    // the random distribution, so we don't need to surface stats to
    // the caller.
  }

  global.PharmacyUI = {
    setUnit, setKind, getKind: () => currentKind, setPillsUnit, markNav, getUnit: () => currentUnit, currentView: () => showView._lastView,
    getScrollY,
    setScrollY,
    h,
    renderStats,
    renderRooms,
    renderPatientView,
    renderMedsSection,
    renderPatientsList,
    renderMedOptions,
    renderSelectedList,
    openSheet,
    closeSheet,
    showView,
    bedStatus,
    bedSpecialFlags,
    // admin
    renderAdminMedList,
    showAdminForm,
    hideAdminForm,
    toggleAdminFreqCustom,
    readAdminForm,
    // helpers
    primaryName,
    scientificName,
    // sheet tabs
    renderSheetTabs,
    updateTabCounts,
    setActiveTabUI,
    // chart
    buildChartReport
  };
})(window);
