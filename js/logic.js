/* ShiftPlan AI — pure scheduling logic (no DOM). Works in browser and Node. */
(function (g) {
  "use strict";

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const SHIFTS = ["Morning", "Afternoon", "Evening"];
  const STORAGE_KEY = "shiftplan_v1";
  const VERSION = "1.0.0";

  const DEFAULT_ROLES = ["Manager", "Cashier", "Cook", "Server", "Cleaner"];
  const DEFAULT_SHIFT_HOURS = { Morning: 4, Afternoon: 4, Evening: 4 };
  // required headcount per shift; "*" = default for any role not listed
  const DEFAULT_REQUIREMENTS = {
    Morning: { Manager: 1, "*": 2 },
    Afternoon: { Manager: 1, "*": 2 },
    Evening: { Manager: 1, "*": 1 }
  };

  function uid() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

  function pad2(n) { return String(n).padStart(2, "0"); }

  // Monday of the week containing `d` (Date or "YYYY-MM-DD"), returned as "YYYY-MM-DD"
  function weekMonday(d) {
    const dt = typeof d === "string" ? new Date(d + "T12:00:00") : new Date(d);
    if (isNaN(dt.getTime())) throw new Error("Invalid date");
    const dow = (dt.getDay() + 6) % 7; // 0 = Monday
    dt.setDate(dt.getDate() - dow);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function shiftWeekKey(mondayKey, delta) {
    const dt = new Date(mondayKey + "T12:00:00");
    dt.setDate(dt.getDate() + delta * 7);
    return weekMonday(dt);
  }

  function dayLabel(mondayKey, dayIdx) {
    const dt = new Date(mondayKey + "T12:00:00");
    dt.setDate(dt.getDate() + dayIdx);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function createStore() {
    return {
      version: VERSION,
      staff: [],
      roles: deepCopy(DEFAULT_ROLES),
      shiftHours: deepCopy(DEFAULT_SHIFT_HOURS),
      requirements: deepCopy(DEFAULT_REQUIREMENTS),
      weeks: {},      // mondayKey -> { slots: { "dayIdx-shiftIdx": [ {staffId, role} ] } }
      templates: [],  // { id, name, savedAt, slots }
      swaps: [],      // { id, staffId, week, day, shift, targetStaffId, status, acceptedBy, createdAt }
      settings: { openaiKey: "" }
    };
  }

  function getWeek(state, mondayKey) {
    if (!state.weeks[mondayKey]) state.weeks[mondayKey] = { slots: {} };
    if (!state.weeks[mondayKey].notes) state.weeks[mondayKey].notes = {};
    return state.weeks[mondayKey];
  }

  function slotKey(day, shift) { return day + "-" + shift; }

  function getSlot(state, mondayKey, day, shift) {
    const week = getWeek(state, mondayKey);
    return week.slots[slotKey(day, shift)] || [];
  }

  function setSlot(state, mondayKey, day, shift, assignments) {
    const week = getWeek(state, mondayKey);
    week.slots[slotKey(day, shift)] = deepCopy(assignments);
  }

  function findStaff(state, staffId) {
    return state.staff.find(s => s.id === staffId) || null;
  }

  function validateStaffInput(input, roles) {
    const errors = [];
    const name = (input.name || "").trim();
    if (!name) errors.push("Name is required.");
    const role = (input.role || "").trim();
    if (!role) errors.push("Role is required.");
    else if (!roles.includes(role)) errors.push("Role must be one of: " + roles.join(", "));
    let availability = input.availability;
    if (availability === undefined || availability === null) availability = [0,1,2,3,4,5,6];
    if (!Array.isArray(availability)) errors.push("Availability must be an array of weekday numbers 0-6.");
    else {
      const bad = availability.some(a => !Number.isInteger(a) || a < 0 || a > 6);
      if (bad) errors.push("Availability days must be integers 0 (Monday) through 6 (Sunday).");
    }
    const maxHours = Number(input.maxHours);
    if (!Number.isFinite(maxHours) || maxHours <= 0) errors.push("Max hours/week must be a positive number.");
    // optional hourly wage ($/hr) — powers the labor-cost estimate; 0 = unpaid/unknown
    let wage = 0;
    if (input.wage !== undefined && input.wage !== null && input.wage !== "") {
      wage = Number(input.wage);
      if (!Number.isFinite(wage) || wage < 0) errors.push("Hourly wage must be 0 or more.");
    }
    return { errors, clean: { name, role, availability: deepCopy(availability), maxHours, wage, phone: (input.phone || "").trim() } };
  }

  function addStaff(state, input) {
    const v = validateStaffInput(input, state.roles);
    if (v.errors.length) return { ok: false, errors: v.errors };
    const staff = { id: uid(), ...v.clean };
    state.staff.push(staff);
    return { ok: true, staff };
  }

  function removeStaff(state, staffId) {
    const idx = state.staff.findIndex(s => s.id === staffId);
    if (idx === -1) return { ok: false, error: "Staff not found." };
    state.staff.splice(idx, 1);
    // remove from all slots everywhere
    Object.keys(state.weeks).forEach(k => {
      const week = state.weeks[k];
      Object.keys(week.slots).forEach(sk => {
        week.slots[sk] = week.slots[sk].filter(a => a.staffId !== staffId);
      });
    });
    // prune templates
    state.templates.forEach(t => {
      Object.keys(t.slots).forEach(sk => {
        t.slots[sk] = t.slots[sk].filter(a => a.staffId !== staffId);
      });
    });
    // mark swaps involving them as cancelled-ish (declined) so board stays clean
    state.swaps.forEach(s => {
      if (s.status === "open" && (s.staffId === staffId || s.targetStaffId === staffId)) s.status = "declined";
    });
    return { ok: true };
  }

  function addRole(state, role) {
    role = (role || "").trim();
    if (!role) return { ok: false, error: "Role name required." };
    if (state.roles.includes(role)) return { ok: false, error: "Role already exists." };
    state.roles.push(role);
    return { ok: true };
  }

  function removeRole(state, role) {
    const idx = state.roles.indexOf(role);
    if (idx === -1) return { ok: false, error: "Role not found." };
    if (state.staff.some(s => s.role === role)) return { ok: false, error: "Role is in use by staff." };
    state.roles.splice(idx, 1);
    return { ok: true };
  }

  function assign(state, mondayKey, day, shift, staffId, role) {
    if (day < 0 || day > 6) return { ok: false, error: "Day must be 0-6." };
    if (shift < 0 || shift > 2) return { ok: false, error: "Shift must be 0-2." };
    const staff = findStaff(state, staffId);
    if (!staff) return { ok: false, error: "Staff not found." };
    const assignments = getSlot(state, mondayKey, day, shift);
    if (assignments.some(a => a.staffId === staffId)) return { ok: false, error: "Staff already assigned to this slot." };
    assignments.push({ staffId, role: role || staff.role });
    setSlot(state, mondayKey, day, shift, assignments);
    return { ok: true };
  }

  function unassign(state, mondayKey, day, shift, staffId) {
    const assignments = getSlot(state, mondayKey, day, shift);
    const next = assignments.filter(a => a.staffId !== staffId);
    if (next.length === assignments.length) return { ok: false, error: "Assignment not found." };
    setSlot(state, mondayKey, day, shift, next);
    return { ok: true };
  }

  function staffHours(state, mondayKey, staffId) {
    let hours = 0;
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 3; s++) {
        if (getSlot(state, mondayKey, d, s).some(a => a.staffId === staffId)) {
          hours += state.shiftHours[SHIFTS[s]] || 0;
        }
      }
    }
    return hours;
  }

  function weekHours(state, mondayKey) {
    const out = {};
    state.staff.forEach(s => { out[s.id] = staffHours(state, mondayKey, s.id); });
    return out;
  }

  // ---------- Labor-cost estimate ----------
  // laborCost(state, mondayKey) -> { perStaff: {id: cost}, total } using each
  // staff member's hourly wage (staff without a wage contribute $0).
  function laborCost(state, mondayKey) {
    const perStaff = {};
    let total = 0;
    state.staff.forEach(st => {
      const wage = Number(st.wage) || 0;
      const cost = Math.round(staffHours(state, mondayKey, st.id) * wage * 100) / 100;
      perStaff[st.id] = cost;
      total = Math.round((total + cost) * 100) / 100;
    });
    return { perStaff, total };
  }

  // ---------- Copy a week ----------
  // copyWeek(state, fromKey, toKey) — clone the previous week's assignments
  // (staff still on the roster only) into the target week, replacing it.
  function copyWeek(state, fromKey, toKey) {
    const src = state.weeks[fromKey];
    if (!src) return { ok: false, error: "No schedule found for the source week." };
    const existing = new Set(state.staff.map(s => s.id));
    const slots = {};
    let copied = 0;
    Object.keys(src.slots || {}).forEach(sk => {
      const kept = deepCopy(src.slots[sk]).filter(a => existing.has(a.staffId));
      if (kept.length) { slots[sk] = kept; copied += kept.length; }
    });
    state.weeks[toKey] = { slots, notes: deepCopy(src.notes || {}) };
    return { ok: true, copied };
  }

  // ---------- Slot notes ----------
  function getSlotNote(state, mondayKey, day, shift) {
    const week = state.weeks[mondayKey];
    return (week && week.notes && week.notes[slotKey(day, shift)]) || "";
  }
  function setSlotNote(state, mondayKey, day, shift, note) {
    const week = getWeek(state, mondayKey);
    note = (note || "").trim();
    if (note) week.notes[slotKey(day, shift)] = note.slice(0, 120);
    else delete week.notes[slotKey(day, shift)];
    return { ok: true };
  }

  // ---------- Schedule CSV export ----------
  function csvCell(v) {
    return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  }
  // scheduleCSV(state, mondayKey) -> "Day,Date,Shift,Staff,Role,Hours" rows.
  function scheduleCSV(state, mondayKey) {
    const lines = [["Day", "Date", "Shift", "Staff", "Role", "Hours"].map(csvCell).join(",")];
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 3; s++) {
        const asgs = getSlot(state, mondayKey, d, s);
        asgs.forEach(a => {
          const st = findStaff(state, a.staffId);
          lines.push([
            DAYS[d], dayLabel(mondayKey, d), SHIFTS[s],
            st ? st.name : "(removed)", a.role,
            state.shiftHours[SHIFTS[s]] || 0
          ].map(csvCell).join(","));
        });
      }
    }
    return lines.join("\n");
  }

  // ---------- Coverage-gap detector ----------
  function detectGaps(state, mondayKey) {
    const understaffed = [];
    const doubleBooked = [];
    const overMaxHours = [];
    const nearMaxHours = [];
    const unavailable = [];

    // per-slot understaffing
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 3; s++) {
        const shiftName = SHIFTS[s];
        const req = state.requirements[shiftName] || {};
        const assignments = getSlot(state, mondayKey, d, s);
        const rolesNeeded = Object.keys(req);
        const perRole = {};
        assignments.forEach(a => { perRole[a.role] = (perRole[a.role] || 0) + 1; });

        // explicit role requirements
        rolesNeeded.filter(r => r !== "*").forEach(role => {
          const need = req[role];
          const have = perRole[role] || 0;
          if (have < need) understaffed.push({ day: d, shift: s, role, required: need, actual: have });
        });
        // default requirement covers all other assigned roles
        if (req["*"]) {
          const explicitRoles = rolesNeeded.filter(r => r !== "*");
          const explicitAssigned = assignments.filter(a => explicitRoles.includes(a.role)).length;
          const generalAssigned = assignments.length - explicitAssigned;
          if (generalAssigned < req["*"]) {
            understaffed.push({ day: d, shift: s, role: "Any", required: req["*"], actual: generalAssigned });
          }
        }
      }
    }

    // per-staff checks
    state.staff.forEach(st => {
      // double-booking: two shifts same day
      for (let d = 0; d < 7; d++) {
        const worked = [];
        for (let s = 0; s < 3; s++) {
          if (getSlot(state, mondayKey, d, s).some(a => a.staffId === st.id)) worked.push(s);
        }
        if (worked.length > 1) {
          doubleBooked.push({ staffId: st.id, name: st.name, day: d, shifts: worked });
        }
        // unavailable day
        worked.forEach(s => {
          if (!st.availability.includes(d)) {
            unavailable.push({ staffId: st.id, name: st.name, day: d, shift: s });
          }
        });
      }
      const hours = staffHours(state, mondayKey, st.id);
      if (hours > st.maxHours) {
        overMaxHours.push({ staffId: st.id, name: st.name, hours, maxHours: st.maxHours });
      } else if (st.maxHours > 0 && hours >= 0.9 * st.maxHours) {
        // warning, not a violation yet: within 10% of the weekly cap
        nearMaxHours.push({ staffId: st.id, name: st.name, hours, maxHours: st.maxHours });
      }
    });

    return {
      understaffed,
      doubleBooked,
      overMaxHours,
      nearMaxHours,
      unavailable,
      totalIssues: understaffed.length + doubleBooked.length + overMaxHours.length + nearMaxHours.length + unavailable.length
    };
  }

  // ---------- Templates ----------
  function saveTemplate(state, name, mondayKey) {
    name = (name || "").trim();
    if (!name) return { ok: false, error: "Template name required." };
    const week = getWeek(state, mondayKey);
    const t = { id: uid(), name, savedAt: new Date().toISOString(), slots: deepCopy(week.slots) };
    state.templates.push(t);
    return { ok: true, template: t };
  }

  function renameTemplate(state, templateId, name) {
    const t = state.templates.find(x => x.id === templateId);
    if (!t) return { ok: false, error: "Template not found." };
    name = (name || "").trim();
    if (!name) return { ok: false, error: "Template name required." };
    t.name = name;
    return { ok: true };
  }

  function deleteTemplate(state, templateId) {
    const idx = state.templates.findIndex(x => x.id === templateId);
    if (idx === -1) return { ok: false, error: "Template not found." };
    state.templates.splice(idx, 1);
    return { ok: true };
  }

  function applyTemplate(state, templateId, mondayKey) {
    const t = state.templates.find(x => x.id === templateId);
    if (!t) return { ok: false, error: "Template not found." };
    const existing = new Set(state.staff.map(s => s.id));
    const slots = {};
    Object.keys(t.slots).forEach(sk => {
      slots[sk] = deepCopy(t.slots[sk]).filter(a => existing.has(a.staffId));
    });
    state.weeks[mondayKey] = { slots };
    return { ok: true, dropped: 0 };
  }

  // ---------- Swap board ----------
  function requestSwap(state, input) {
    const { staffId, week, day, shift, targetStaffId } = input;
    const staff = findStaff(state, staffId);
    if (!staff) return { ok: false, error: "Staff not found." };
    if (day < 0 || day > 6) return { ok: false, error: "Day must be 0-6." };
    if (shift < 0 || shift > 2) return { ok: false, error: "Shift must be 0-2." };
    const assignments = getSlot(state, week, day, shift);
    if (!assignments.some(a => a.staffId === staffId)) {
      return { ok: false, error: "Staff is not assigned to that slot." };
    }
    if (targetStaffId) {
      const target = findStaff(state, targetStaffId);
      if (!target) return { ok: false, error: "Target staff not found." };
      if (targetStaffId === staffId) return { ok: false, error: "Cannot swap with yourself." };
    }
    const dup = state.swaps.find(s =>
      s.status === "open" && s.staffId === staffId && s.week === week && s.day === day && s.shift === shift);
    if (dup) return { ok: false, error: "An open swap request already exists for this slot." };
    const swap = {
      id: uid(),
      staffId,
      week,
      day,
      shift,
      targetStaffId: targetStaffId || null,
      status: "open",
      acceptedBy: null,
      createdAt: new Date().toISOString()
    };
    state.swaps.push(swap);
    return { ok: true, swap };
  }

  function acceptSwap(state, swapId, claimantStaffId) {
    const swap = state.swaps.find(s => s.id === swapId);
    if (!swap) return { ok: false, error: "Swap not found." };
    if (swap.status !== "open") return { ok: false, error: "Swap is not open." };
    if (claimantStaffId === swap.staffId) return { ok: false, error: "Cannot accept your own swap." };
    const claimant = findStaff(state, claimantStaffId);
    if (!claimant) return { ok: false, error: "Claiming staff not found." };
    if (swap.targetStaffId && swap.targetStaffId !== claimantStaffId) {
      return { ok: false, error: "This swap is proposed for a specific staff member." };
    }
    // transfer the assignment
    const assignments = getSlot(state, swap.week, swap.day, swap.shift);
    const mine = assignments.find(a => a.staffId === swap.staffId);
    const role = mine ? mine.role : claimant.role;
    const next = assignments.filter(a => a.staffId !== swap.staffId);
    if (!next.some(a => a.staffId === claimantStaffId)) {
      next.push({ staffId: claimantStaffId, role });
    }
    setSlot(state, swap.week, swap.day, swap.shift, next);
    swap.status = "accepted";
    swap.acceptedBy = claimantStaffId;
    return { ok: true, swap };
  }

  function declineSwap(state, swapId) {
    const swap = state.swaps.find(s => s.id === swapId);
    if (!swap) return { ok: false, error: "Swap not found." };
    if (swap.status !== "open") return { ok: false, error: "Swap is not open." };
    swap.status = "declined";
    return { ok: true, swap };
  }

  function cancelSwap(state, swapId, staffId) {
    const swap = state.swaps.find(s => s.id === swapId);
    if (!swap) return { ok: false, error: "Swap not found." };
    if (swap.status !== "open") return { ok: false, error: "Swap is not open." };
    if (swap.staffId !== staffId) return { ok: false, error: "Only the requester can cancel." };
    state.swaps = state.swaps.filter(s => s.id !== swapId);
    return { ok: true };
  }

  // ---------- Printable shape ----------
  function printableSchedule(state, mondayKey) {
    const rows = [];
    for (let d = 0; d < 7; d++) {
      const shifts = [];
      for (let s = 0; s < 3; s++) {
        const assignments = getSlot(state, mondayKey, d, s).map(a => {
          const st = findStaff(state, a.staffId);
          return { name: st ? st.name : "(removed)", role: a.role };
        });
        shifts.push({ shift: SHIFTS[s], assignments });
      }
      rows.push({ day: DAYS[d], date: dayLabel(mondayKey, d), shifts });
    }
    return { week: mondayKey, business: "", rows };
  }

  // ---------- Local heuristic tips ----------
  function heuristicTips(state, mondayKey) {
    const tips = [];
    const gaps = detectGaps(state, mondayKey);
    if (gaps.understaffed.length) {
      tips.push(gaps.understaffed.length + " understaffed slot" +
        (gaps.understaffed.length === 1 ? "" : "s") +
        " this week — check the coverage panel.");
    }
    const hours = weekHours(state, mondayKey);
    const nearMax = state.staff.filter(st => {
      const h = hours[st.id] || 0;
      return st.maxHours > 0 && h >= 0.9 * st.maxHours;
    });
    if (nearMax.length) {
      tips.push(nearMax.length + " staff near max hours (" +
        nearMax.map(st => st.name).join(", ") + ") — spread shifts to avoid burnout.");
    }
    if (gaps.doubleBooked.length) {
      tips.push(gaps.doubleBooked.length + " double-booking" +
        (gaps.doubleBooked.length === 1 ? "" : "s") + " detected — no one should work two shifts in a day.");
    }
    if (gaps.unavailable.length) {
      tips.push(gaps.unavailable.length + " assignment" +
        (gaps.unavailable.length === 1 ? "" : "s") + " on staff unavailable days — reassign them.");
    }
    if (state.staff.length === 0) {
      tips.push("No staff on the roster yet — add your team to start scheduling.");
    }
    if (!tips.length) tips.push("Coverage looks good. No understaffed slots or conflicts this week.");
    return tips;
  }

  // ---------- Persistence ----------
  function serialize(state) { return JSON.stringify(state); }

  function deserialize(json) {
    let parsed;
    try { parsed = JSON.parse(json); }
    catch (e) { return { ok: false, error: "Invalid JSON." }; }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.staff)) {
      return { ok: false, error: "Not a valid ShiftPlan store." };
    }
    const base = createStore();
    const merged = { ...base, ...parsed };
    merged.staff = Array.isArray(parsed.staff) ? parsed.staff : [];
    merged.roles = Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : deepCopy(DEFAULT_ROLES);
    merged.shiftHours = parsed.shiftHours || deepCopy(DEFAULT_SHIFT_HOURS);
    merged.requirements = parsed.requirements || deepCopy(DEFAULT_REQUIREMENTS);
    merged.weeks = parsed.weeks || {};
    merged.templates = Array.isArray(parsed.templates) ? parsed.templates : [];
    merged.swaps = Array.isArray(parsed.swaps) ? parsed.swaps : [];
    merged.settings = { ...(parsed.settings || {}) };
    return { ok: true, state: merged };
  }

  const ShiftPlan = {
    DAYS, SHIFTS, STORAGE_KEY, VERSION,
    uid, deepCopy,
    weekMonday, shiftWeekKey, dayLabel,
    createStore, getWeek, getSlot, slotKey,
    addStaff, removeStaff, findStaff, addRole, removeRole,
    assign, unassign, staffHours, weekHours,
    detectGaps,
    laborCost, copyWeek, getSlotNote, setSlotNote, scheduleCSV,
    saveTemplate, renameTemplate, deleteTemplate, applyTemplate,
    requestSwap, acceptSwap, declineSwap, cancelSwap,
    printableSchedule, heuristicTips,
    serialize, deserialize
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ShiftPlan;
  else g.ShiftPlan = ShiftPlan;
})(typeof window !== "undefined" ? window : globalThis);
