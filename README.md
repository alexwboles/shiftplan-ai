# ShiftPlan AI — Employee Shift Scheduler

A free, single-page static web app for small teams to build weekly staff schedules, spot coverage gaps, manage shift swaps, and reuse shift templates.

## What it does

- **Staff roster** — add/remove team members with name, role (editable role list), weekly availability, max hours/week, and optional phone.
- **Weekly schedule grid** — 7 days × 3 shifts (Morning / Afternoon / Evening). Navigate weeks, click any slot to assign staff.
- **Coverage-gap detector** — flags understaffed slots (configurable required headcount per role, e.g. 1 manager + 2 staff each morning), double-booked staff (two shifts in one day), staff over their max weekly hours, and assignments on unavailable days. A red "coverage issues" panel shows counts.
- **Shift templates** — save the current week's layout as a named template, apply it to any week, rename or delete templates.
- **Shift-swap board** — staff request to give up an assigned shift (open to anyone or proposed to a specific person); others can accept (assignment transfers automatically) or decline.
- **Printable schedule** — a "Print schedule" button plus `@media print` CSS produces a clean week grid without buttons/forms.
- **Coverage tips (AI optional)** — save an OpenAI API key in Settings for AI-generated tips. Without a key, the app shows built-in local heuristic tips and works 100%.

## How to run

Just open `index.html` in any modern browser. No build step, no server, no dependencies.

## Data & privacy

All data is stored locally in your browser (`localStorage`, key `shiftplan_v1`). Nothing is sent anywhere — except an optional OpenAI API call, and only if you enter your own key and click "Get coverage tips".

## Tests

```bash
bash test/smoke.sh   # fast checks: files, syntax, core logic assertions
bash test/e2e.sh     # end-to-end logic flows in Node
```

## File layout

- `index.html` — page structure
- `css/style.css` — theme + print styles
- `js/logic.js` — pure scheduling logic (works in browser as `window.ShiftPlan` and in Node via `require`)
- `js/app.js` — DOM glue (event handlers, rendering)
- `test/` — smoke and e2e tests
