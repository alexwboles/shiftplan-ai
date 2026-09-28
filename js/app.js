/* ShiftPlan AI — DOM glue. All pure logic lives in js/logic.js. */
(function () {
  "use strict";
  const SP = window.ShiftPlan;
  const $ = (id) => document.getElementById(id);

  let state = SP.createStore();
  let currentWeek = SP.weekMonday(new Date());
  let dialogCtx = null; // { day, shift }

  // ---------- persistence ----------
  function save() {
    try { localStorage.setItem(SP.STORAGE_KEY, SP.serialize(state)); } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SP.STORAGE_KEY);
      if (raw) {
        const r = SP.deserialize(raw);
        if (r.ok) state = r.state;
      }
    } catch (e) { /* start fresh */ }
  }

  // ---------- sample data ----------
  function loadSampleData() {
    if (state.staff.length && !confirm("This will add sample data on top of your existing data. Continue?")) return;
    const samples = [
      { name: "Ava", role: "Manager", availability: [0,1,2,3,4], maxHours: 40, phone: "" },
      { name: "Ben", role: "Cashier", availability: [0,1,2,3,4,5], maxHours: 32, phone: "" },
      { name: "Cara", role: "Cook", availability: [0,1,2,3,4,5,6], maxHours: 40, phone: "" },
      { name: "Dan", role: "Server", availability: [3,4,5,6], maxHours: 24, phone: "" },
      { name: "Eli", role: "Cleaner", availability: [0,1,2,3,4,5,6], maxHours: 20, phone: "" }
    ];
    const ids = {};
    samples.forEach(s => {
      const r = SP.addStaff(state, s);
      if (r.ok) ids[s.name] = r.staff.id;
    });
    const plan = [
      // [day, shift, staffName]
      [0,0,"Ava"],[0,0,"Ben"],[0,1,"Ava"],[0,1,"Cara"],[0,2,"Ava"],[0,2,"Dan"],
      [1,0,"Ava"],[1,0,"Ben"],[1,1,"Cara"],[1,1,"Ben"],[1,2,"Ava"],[1,2,"Eli"],
      [2,0,"Ava"],[2,0,"Ben"],[2,1,"Ava"],[2,1,"Cara"],[2,2,"Dan"],[2,2,"Cara"],
      [3,0,"Ava"],[3,0,"Ben"],[3,1,"Dan"],[3,1,"Cara"],[3,2,"Dan"],[3,2,"Eli"],
      [4,0,"Ava"],[4,0,"Cara"],[4,1,"Ben"],[4,1,"Dan"],[4,2,"Dan"],[4,2,"Eli"],
      [5,0,"Ben"],[5,0,"Cara"],[5,1,"Dan"],[5,1,"Cara"],[5,2,"Dan"],[5,2,"Eli"],
      [6,0,"Ben"],[6,0,"Cara"],[6,1,"Dan"],[6,2,"Eli"]
    ];
    plan.forEach(([d, s, name]) => {
      if (ids[name]) SP.assign(state, currentWeek, d, s, ids[name]);
    });
    save(); renderAll();
  }

  // ---------- coverage panel ----------
  function issueText(g) {
    const lines = [];
    g.understaffed.forEach(u => {
      lines.push(`Understaffed: ${SP.DAYS[u.day]} ${SP.SHIFTS[u.shift]} needs ${u.required} ${u.role}, has ${u.actual}.`);
    });
    g.doubleBooked.forEach(d => {
      lines.push(`Double-booked: ${d.name} works ${d.shifts.length} shifts on ${SP.DAYS[d.day]}.`);
    });
    g.overMaxHours.forEach(o => {
      lines.push(`Over max hours: ${o.name} scheduled ${o.hours}h (max ${o.maxHours}h).`);
    });
    g.unavailable.forEach(u => {
      lines.push(`Unavailable: ${u.name} assigned ${SP.DAYS[u.day]} ${SP.SHIFTS[u.shift]} but is off that day.`);
    });
    return lines;
  }

  function renderCoverage() {
    const g = SP.detectGaps(state, currentWeek);
    const panel = $("coverage-panel");
    if (g.totalIssues === 0) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    $("issue-count").textContent = g.totalIssues;
    $("issue-list").innerHTML = issueText(g).map(t => `<li>${escapeHtml(t)}</li>`).join("");
  }

  // ---------- grid ----------
  function renderGrid() {
    const g = SP.detectGaps(state, currentWeek);
    const gapSlots = new Set(g.understaffed.map(u => u.day + "-" + u.shift));
    const tbl = $("grid");
    const mon = new Date(currentWeek + "T12:00:00");
    let html = "<tr><th>Day</th>" + SP.SHIFTS.map(s => `<th>${s}</th>`).join("") + "</tr>";
    for (let d = 0; d < 7; d++) {
      const dt = new Date(mon); dt.setDate(dt.getDate() + d);
      const dateStr = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      html += `<tr><td class="daycol">${SP.DAYS[d]}<br><span class="meta">${dateStr}</span></td>`;
      for (let s = 0; s < 3; s++) {
        const asgs = SP.getSlot(state, currentWeek, d, s);
        const inner = asgs.length
          ? asgs.map(a => {
              const st = SP.findStaff(state, a.staffId);
              return `<div class="asg">${escapeHtml(st ? st.name : "?")} <span class="r">(${escapeHtml(a.role)})</span></div>`;
            }).join("")
          : `<div class="empty">— empty —</div>`;
        const flag = gapSlots.has(d + "-" + s) ? `<div class="gapflag">⚠ understaffed</div>` : "";
        html += `<td><div class="slot" data-day="${d}" data-shift="${s}">${inner}${flag}</div></td>`;
      }
      html += "</tr>";
    }
    tbl.innerHTML = html;
    tbl.querySelectorAll(".slot").forEach(el => {
      el.addEventListener("click", () => openDialog(+el.dataset.day, +el.dataset.shift));
    });
  }

  function renderWeekLabel() {
    const mon = new Date(currentWeek + "T12:00:00");
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    const fmt = (x) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    $("week-label").textContent = `Week of ${fmt(mon)} – ${fmt(sun)}`;
  }

  // ---------- staff ----------
  function renderStaffForm() {
    $("sf-role").innerHTML = state.roles.map(r => `<option>${escapeHtml(r)}</option>`).join("");
    $("sf-avail").innerHTML = SP.DAYS.map((d, i) =>
      `<label><input type="checkbox" value="${i}" checked><span>${d.slice(0,3)}</span></label>`).join("");
  }

  function renderStaffList() {
    const hours = SP.weekHours(state, currentWeek);
    $("staff-list").innerHTML = state.staff.map(st => {
      const h = hours[st.id] || 0;
      const over = h > st.maxHours ? ' style="color:var(--danger);font-weight:700"' : "";
      const avail = st.availability.map(a => SP.DAYS[a].slice(0,2)).join(" ");
      return `<li><div><strong>${escapeHtml(st.name)}</strong> <span class="meta">${escapeHtml(st.role)} · <span${over}>${h}h/${st.maxHours}h</span>${st.phone ? " · " + escapeHtml(st.phone) : ""}<br>Available: ${avail}</span></div>
        <div class="actions"><button class="btn small danger" data-remove="${st.id}">Remove</button></div></li>`;
    }).join("") || `<li class="meta">No staff yet.</li>`;
    $("staff-list").querySelectorAll("[data-remove]").forEach(b => {
      b.addEventListener("click", () => {
        if (confirm("Remove this staff member? Their assignments will be cleared.")) {
          SP.removeStaff(state, b.dataset.remove);
          save(); renderAll();
        }
      });
    });
  }

  // ---------- templates ----------
  function renderTemplates() {
    $("tpl-list").innerHTML = state.templates.map(t =>
      `<li><div><strong>${escapeHtml(t.name)}</strong> <span class="meta">saved ${new Date(t.savedAt).toLocaleDateString()}</span></div>
      <div class="actions">
        <button class="btn small ghost" data-apply="${t.id}">Apply to this week</button>
        <button class="btn small ghost" data-rename="${t.id}">Rename</button>
        <button class="btn small danger" data-del="${t.id}">Delete</button>
      </div></li>`).join("") || `<li class="meta">No templates yet.</li>`;
    $("tpl-list").querySelectorAll("[data-apply]").forEach(b => b.addEventListener("click", () => {
      if (confirm("Apply this template to the current week? Current assignments will be replaced.")) {
        SP.applyTemplate(state, b.dataset.apply, currentWeek);
        save(); renderAll();
      }
    }));
    $("tpl-list").querySelectorAll("[data-rename]").forEach(b => b.addEventListener("click", () => {
      const t = state.templates.find(x => x.id === b.dataset.rename);
      const name = prompt("Template name:", t ? t.name : "");
      if (name) { SP.renameTemplate(state, b.dataset.rename, name); save(); renderTemplates(); }
    }));
    $("tpl-list").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      if (confirm("Delete this template?")) { SP.deleteTemplate(state, b.dataset.del); save(); renderTemplates(); }
    }));
  }

  // ---------- swaps ----------
  function swapDesc(sw) {
    const st = SP.findStaff(state, sw.staffId);
    const tgt = sw.targetStaffId ? SP.findStaff(state, sw.targetStaffId) : null;
    const who = st ? st.name : "(removed)";
    const withWhom = tgt ? ` → ${tgt.name}` : " (open)";
    return `${who} gives up ${SP.DAYS[sw.day]} ${SP.SHIFTS[sw.shift]}${withWhom}`;
  }

  function renderSwaps() {
    const open = state.swaps.filter(s => s.status === "open");
    const closed = state.swaps.filter(s => s.status !== "open");
    $("swap-open").innerHTML = open.map(sw => {
      const claimOpts = state.staff.filter(st => st.id !== sw.staffId && (!sw.targetStaffId || st.id === sw.targetStaffId))
        .map(st => `<option value="${st.id}">${escapeHtml(st.name)}</option>`).join("");
      return `<li><div><span class="status-open">OPEN</span> ${escapeHtml(swapDesc(sw))}</div>
        <div class="actions"><select id="claim-${sw.id}">${claimOpts}</select>
        <button class="btn small" data-accept="${sw.id}">Accept</button>
        <button class="btn small ghost" data-decline="${sw.id}">Decline</button>
        ${""}</div></li>`;
    }).join("") || `<li class="meta">No open requests.</li>`;
    $("swap-closed").innerHTML = closed.map(sw => {
      const by = sw.acceptedBy ? (SP.findStaff(state, sw.acceptedBy) || {}).name : null;
      return `<li><div><span class="status-${sw.status}">${sw.status.toUpperCase()}</span> ${escapeHtml(swapDesc(sw))}${by ? ` — accepted by ${escapeHtml(by)}` : ""}</div></li>`;
    }).join("") || `<li class="meta">None.</li>`;

    $("swap-open").querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click", () => {
      const sel = $("claim-" + b.dataset.accept);
      const r = SP.acceptSwap(state, b.dataset.accept, sel ? sel.value : "");
      if (!r.ok) alert(r.error); else { save(); renderAll(); }
    }));
    $("swap-open").querySelectorAll("[data-decline]").forEach(b => b.addEventListener("click", () => {
      SP.declineSwap(state, b.dataset.decline); save(); renderAll();
    }));

    const staffOpts = state.staff.map(st => `<option value="${st.id}">${escapeHtml(st.name)}</option>`).join("");
    $("sw-staff").innerHTML = staffOpts;
    $("sw-target").innerHTML = `<option value="">Open to anyone</option>` + staffOpts;
    $("sw-day").innerHTML = SP.DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("");
    $("sw-shift").innerHTML = SP.SHIFTS.map((s, i) => `<option value="${i}">${s}</option>`).join("");
  }

  // ---------- assignment dialog ----------
  function openDialog(day, shift) {
    dialogCtx = { day, shift };
    $("ad-title").textContent = `Assign — ${SP.DAYS[day]} ${SP.SHIFTS[shift]}`;
    $("ad-staff").innerHTML = state.staff.map(st =>
      `<option value="${st.id}">${escapeHtml(st.name)} (${escapeHtml(st.role)})</option>`).join("");
    $("ad-role").innerHTML = state.roles.map(r => `<option>${escapeHtml(r)}</option>`).join("");
    $("assign-dialog").showModal();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- AI tips ----------
  async function getTips() {
    const local = SP.heuristicTips(state, currentWeek);
    const key = (state.settings.openaiKey || "").trim();
    if (!key) { renderTips(local, "Built-in local tips (no API key set)."); return; }
    renderTips(["Contacting AI…"], "Working…");
    const summary = summarizeWeek();
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a shift-scheduling advisor for a small business. Give 3-5 short, practical coverage tips as a plain list, no fluff." },
            { role: "user", content: "Here is this week's schedule summary:\n" + summary }
          ],
          max_tokens: 300
        })
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : "";
      const tips = text.split(/\n+/).map(t => t.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
      renderTips(tips.length ? tips : local, "AI tips (OpenAI).");
    } catch (e) {
      renderTips(local, "AI unreachable (" + e.message + ") — showing local tips instead.");
    }
  }

  function summarizeWeek() {
    const g = SP.detectGaps(state, currentWeek);
    const hours = SP.weekHours(state, currentWeek);
    const lines = [`Week of ${currentWeek}.`];
    lines.push(`Understaffed slots: ${g.understaffed.length}, double-bookings: ${g.doubleBooked.length}, over max hours: ${g.overMaxHours.length}, unavailable-day assignments: ${g.unavailable.length}.`);
    state.staff.forEach(st => {
      lines.push(`${st.name} (${st.role}): ${hours[st.id] || 0}h scheduled, max ${st.maxHours}h, available ${st.availability.map(a => SP.DAYS[a].slice(0,3)).join(",")}.`);
    });
    return lines.join("\n");
  }

  function renderTips(tips, note) {
    $("tips-list").innerHTML = `<li class="meta">${escapeHtml(note)}</li>` +
      tips.map(t => `<li>${escapeHtml(t)}</li>`).join("");
  }

  // ---------- render all ----------
  function renderAll() {
    renderWeekLabel(); renderGrid(); renderCoverage();
    renderStaffForm(); renderStaffList();
    renderTemplates(); renderSwaps();
  }

  // ---------- events ----------
  function wire() {
    $("btn-prev").addEventListener("click", () => { currentWeek = SP.shiftWeekKey(currentWeek, -1); renderAll(); });
    $("btn-next").addEventListener("click", () => { currentWeek = SP.shiftWeekKey(currentWeek, 1); renderAll(); });
    $("btn-print").addEventListener("click", () => window.print());
    $("btn-sample").addEventListener("click", loadSampleData);

    $("staff-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const availability = [...$("sf-avail").querySelectorAll("input:checked")].map(i => +i.value);
      const r = SP.addStaff(state, {
        name: $("sf-name").value, role: $("sf-role").value,
        maxHours: +$("sf-hours").value, phone: $("sf-phone").value, availability
      });
      if (!r.ok) { alert(r.errors.join("\n")); return; }
      $("sf-name").value = ""; $("sf-phone").value = "";
      save(); renderAll();
    });

    $("btn-add-role").addEventListener("click", () => {
      const r = SP.addRole(state, $("new-role").value);
      if (!r.ok) { alert(r.error); return; }
      $("new-role").value = ""; save(); renderAll();
    });

    $("btn-save-tpl").addEventListener("click", () => {
      const name = $("tpl-name").value || prompt("Template name:");
      if (!name) return;
      const r = SP.saveTemplate(state, name, currentWeek);
      if (!r.ok) { alert(r.error); return; }
      $("tpl-name").value = ""; save(); renderTemplates();
    });

    $("swap-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const r = SP.requestSwap(state, {
        staffId: $("sw-staff").value,
        week: currentWeek,
        day: +$("sw-day").value,
        shift: +$("sw-shift").value,
        targetStaffId: $("sw-target").value || null
      });
      if (!r.ok) { alert(r.error); return; }
      save(); renderSwaps();
    });

    $("ad-save").addEventListener("click", () => {
      if (!dialogCtx) return;
      const staffId = $("ad-staff").value, role = $("ad-role").value;
      if (!staffId) { alert("Add staff to the roster first."); return; }
      const r = SP.assign(state, currentWeek, dialogCtx.day, dialogCtx.shift, staffId, role);
      if (!r.ok) alert(r.error);
      $("assign-dialog").close();
      save(); renderAll();
    });
    $("ad-clear").addEventListener("click", () => {
      if (!dialogCtx) return;
      const asgs = SP.getSlot(state, currentWeek, dialogCtx.day, dialogCtx.shift);
      asgs.map(a => a.staffId).forEach(id => SP.unassign(state, currentWeek, dialogCtx.day, dialogCtx.shift, id));
      $("assign-dialog").close();
      save(); renderAll();
    });
    $("ad-close").addEventListener("click", () => $("assign-dialog").close());

    $("btn-save-key").addEventListener("click", () => {
      state.settings.openaiKey = $("set-key").value.trim();
      $("set-key").value = "";
      save();
      alert(state.settings.openaiKey ? "API key saved locally." : "Key cleared.");
    });
    $("btn-clear-key").addEventListener("click", () => {
      state.settings.openaiKey = ""; $("set-key").value = ""; save();
      alert("API key cleared.");
    });
    $("btn-tips").addEventListener("click", getTips);
  }

  load();
  wire();
  renderAll();
})();
