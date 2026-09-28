#!/usr/bin/env bash
# ShiftPlan AI — smoke tests. Fails fast, counts PASS/FAIL.
set -u

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGIC="/home/hatch/workspace/shiftplan-ai/js/logic.js"
pass=0; fail=0

ok()  { pass=$((pass+1)); echo "PASS: $1"; }
bad() { fail=$((fail+1)); echo "FAIL: $1"; }

check_file() { if [ -f "$1" ]; then ok "file exists: $1"; else bad "missing file: $1"; fi; }

check_file "$DIR/index.html"
check_file "$DIR/css/style.css"
check_file "$DIR/js/logic.js"
check_file "$DIR/js/app.js"
check_file "$DIR/README.md"

if node --check "$DIR/js/logic.js" 2>/dev/null; then ok "node --check logic.js"; else bad "node --check logic.js"; fi
if node --check "$DIR/js/app.js" 2>/dev/null; then ok "node --check app.js"; else bad "node --check app.js"; fi

node_assert() { # $1 = description, $2 = JS expression that must be truthy
  if node -e "const SP=require('$LOGIC'); if(!($2)) { console.error('assertion false'); process.exit(1); }"; then
    ok "$1"
  else
    bad "$1"
  fi
}

# addStaff validation
node_assert "addStaff rejects empty name" \
  "SP.addStaff(SP.createStore(),{name:'',role:'Cashier',maxHours:40}).ok===false"
node_assert "addStaff rejects bad maxHours" \
  "SP.addStaff(SP.createStore(),{name:'Ava',role:'Cashier',maxHours:-5}).ok===false"
node_assert "addStaff rejects bad availability day" \
  "SP.addStaff(SP.createStore(),{name:'Ava',role:'Cashier',maxHours:40,availability:[7]}).ok===false"
node_assert "addStaff accepts valid staff" \
  "SP.addStaff(SP.createStore(),{name:'Ava',role:'Manager',maxHours:40}).ok===true"

# detectGaps: understaffed slot
node_assert "detectGaps flags understaffed slot" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});SP.assign(s,'2026-09-28',0,0,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.understaffed.some(u=>u.day===0&&u.shift===0);})()"

# double-booking
node_assert "detectGaps flags double-booked staff" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40});SP.assign(s,'2026-09-28',1,0,r.staff.id);SP.assign(s,'2026-09-28',1,2,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.doubleBooked.some(d=>d.staffId===r.staff.id&&d.day===1);})()"

# max hours exceeded
node_assert "detectGaps flags max-hours exceeded" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Cara',role:'Cook',maxHours:4});SP.assign(s,'2026-09-28',0,0,r.staff.id);SP.assign(s,'2026-09-28',1,0,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.overMaxHours.some(o=>o.staffId===r.staff.id);})()"

# unavailable day
node_assert "detectGaps flags unavailable-day assignment" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Dan',role:'Server',maxHours:40,availability:[0,1]});SP.assign(s,'2026-09-28',5,1,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.unavailable.some(u=>u.staffId===r.staff.id&&u.day===5);})()"

# template save/apply round-trip
node_assert "template save/apply round-trips" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Eli',role:'Cleaner',maxHours:40});SP.assign(s,'2026-09-28',2,1,r.staff.id);const t=SP.saveTemplate(s,'Week A','2026-09-28');if(!t.ok)return false;const a=SP.applyTemplate(s,t.template.id,'2026-10-05');if(!a.ok)return false;return SP.getSlot(s,'2026-10-05',2,1).some(x=>x.staffId===r.staff.id);})()"

# swap lifecycle
node_assert "swap request/accept lifecycle" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Fay',role:'Cashier',maxHours:40});const b=SP.addStaff(s,{name:'Gus',role:'Cashier',maxHours:40});SP.assign(s,'2026-09-28',3,0,a.staff.id);const q=SP.requestSwap(s,{staffId:a.staff.id,week:'2026-09-28',day:3,shift:0});if(!q.ok)return false;const ac=SP.acceptSwap(s,q.swap.id,b.staff.id);if(!ac.ok)return false;const slot=SP.getSlot(s,'2026-09-28',3,0);return slot.some(x=>x.staffId===b.staff.id)&&!slot.some(x=>x.staffId===a.staff.id)&&q.swap.status==='accepted';})()"

# serialize/deserialize round-trip
node_assert "serialize/deserialize round-trips" \
  "(()=>{const s=SP.createStore();SP.addStaff(s,{name:'Hal',role:'Manager',maxHours:40});const d=SP.deserialize(SP.serialize(s));return d.ok&&d.state.staff.length===1&&d.state.staff[0].name==='Hal';})()"

# weekMonday correctness (2026-09-28 is a Monday)
node_assert "weekMonday returns the Monday" \
  "SP.weekMonday('2026-09-30')==='2026-09-28'&&SP.shiftWeekKey('2026-09-28',1)==='2026-10-05'"

# heuristic tips mention understaffed slots
node_assert "heuristicTips reports understaffed slots" \
  "(()=>{const s=SP.createStore();const tips=SP.heuristicTips(s,'2026-09-28');return tips.some(t=>/understaffed/i.test(t));})()"

echo "----"
echo "smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
