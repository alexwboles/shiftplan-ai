# ShiftPlan AI — Redesign Audit (2026-10-13)

## Competitors researched
- **When I Work** — blue/white scheduler; week grid with color-coded shift blocks per person; dashboard with assignments/time-off/swaps overview; shift trades; time-off requests with manager approval; team messaging.
- **Homebase** — dashboard-first with alerts; schedule grid; team roster with roles; labor cost tracking; time clock.
- **Deputy** — dark ops UI; day-column hour totals; coverage view; publish flow.

## Visual gaps (current state)
1. Brass/amber "ops wall" identity reads generic — scheduling tools are **blue/white with per-person color-coded shift blocks**. The current role-color chips are a start but not the category signature.
2. No **per-staff color coding** — When I Work's signature is spotting "who works when" by color at a glance.
3. Day columns show no totals — Deputy/When I Work show **hours per day in the column header**.
4. Roster has no color dots linking staff to their blocks on the grid.
5. Ops bar is a dark strip of raw stats — refine into a clean stats rail with clear labels.

## Functional gaps closed in this pass
1. **Per-staff color coding**: deterministic palette assigned by staff ID; shift blocks, roster rows, and swap board use the same colors; legend in roster.
2. **Day-column hour totals** in each day header (scheduled hours / day).
3. **Coverage count per day** badge on day headers when slots need coverage.
4. Staff add-form gets a **color preview** of the staffer's assigned color.

## Identity concept (implemented)
"Schedule board" — When I Work-grade: clean white workspace, deep workwear-blue accent, dark navy ops strip, per-staff color palette (8 saturated hues) on every shift block, day headers with date + hour totals, amber reserved strictly for coverage alerts. Sharp edges, tabular numerals, sticky day headers on horizontal scroll. No gradients.
