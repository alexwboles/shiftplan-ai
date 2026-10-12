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

# wage validation
node_assert "addStaff rejects negative wage" \
  "SP.addStaff(SP.createStore(),{name:'Ava',role:'Manager',maxHours:40,wage:-2}).ok===false"
node_assert "addStaff accepts wage, stored on staff" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,wage:18.5});return r.ok&&r.staff.wage===18.5;})()"
node_assert "addStaff defaults wage to 0 when omitted" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});return r.ok&&r.staff.wage===0;})()"

# labor cost
node_assert "laborCost estimates weekly cost from wages" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,wage:20});const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40,wage:15});SP.assign(s,'2026-09-28',0,0,a.staff.id);SP.assign(s,'2026-09-28',1,0,a.staff.id);SP.assign(s,'2026-09-28',1,0,b.staff.id);const c=SP.laborCost(s,'2026-09-28');return c.perStaff[a.staff.id]===160&&c.perStaff[b.staff.id]===60&&c.total===220;})()"
node_assert "laborCost is 0 with no wages set" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});SP.assign(s,'2026-09-28',0,0,a.staff.id);return SP.laborCost(s,'2026-09-28').total===0;})()"

# near-max-hours warnings
node_assert "detectGaps warns near-max (90%+) hours" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Cara',role:'Cook',maxHours:40});SP.assign(s,'2026-09-28',0,0,r.staff.id);SP.assign(s,'2026-09-28',1,0,r.staff.id);SP.assign(s,'2026-09-28',2,0,r.staff.id);SP.assign(s,'2026-09-28',3,0,r.staff.id);SP.assign(s,'2026-09-28',4,0,r.staff.id);SP.assign(s,'2026-09-28',5,0,r.staff.id);SP.assign(s,'2026-09-28',6,0,r.staff.id);SP.assign(s,'2026-09-28',0,1,r.staff.id);SP.assign(s,'2026-09-28',1,1,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.nearMaxHours.some(n=>n.staffId===r.staff.id&&n.hours===36)&&g.overMaxHours.length===0;})()"
node_assert "detectGaps does not double-flag over-max as near-max" \
  "(()=>{const s=SP.createStore();const r=SP.addStaff(s,{name:'Dan',role:'Server',maxHours:4});SP.assign(s,'2026-09-28',0,0,r.staff.id);SP.assign(s,'2026-09-28',1,0,r.staff.id);const g=SP.detectGaps(s,'2026-09-28');return g.overMaxHours.length===1&&g.nearMaxHours.length===0;})()"

# copyWeek
node_assert "copyWeek clones last week's assignments" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});SP.assign(s,'2026-09-28',0,0,a.staff.id,'Manager');const r=SP.copyWeek(s,'2026-09-28','2026-10-05');return r.ok&&r.copied===1&&SP.getSlot(s,'2026-10-05',0,0).some(x=>x.staffId===a.staff.id);})()"
node_assert "copyWeek skips staff no longer on the roster" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});SP.assign(s,'2026-09-28',0,0,a.staff.id);SP.removeStaff(s,a.staff.id);const r=SP.copyWeek(s,'2026-09-28','2026-10-05');return r.ok&&r.copied===0&&SP.getSlot(s,'2026-10-05',0,0).length===0;})()"
node_assert "copyWeek fails cleanly with no source week" \
  "SP.copyWeek(SP.createStore(),'2026-09-28','2026-10-05').ok===false"

# slot notes
node_assert "slot notes round-trip and clear" \
  "(()=>{const s=SP.createStore();SP.setSlotNote(s,'2026-09-28',0,0,'Holiday rush');const a=SP.getSlotNote(s,'2026-09-28',0,0)==='Holiday rush';SP.setSlotNote(s,'2026-09-28',0,0,'');return a&&SP.getSlotNote(s,'2026-09-28',0,0)==='';})()"
node_assert "slot note trims and caps length" \
  "(()=>{const s=SP.createStore();SP.setSlotNote(s,'2026-09-28',1,2,'  x'.repeat(200));return SP.getSlotNote(s,'2026-09-28',1,2).length===120;})()"

# schedule CSV
node_assert "scheduleCSV exports header + assignment rows" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40});SP.assign(s,'2026-09-28',0,0,a.staff.id,'Manager');const csv=SP.scheduleCSV(s,'2026-09-28');const lines=csv.split('\n');return lines.length===2&&lines[0].indexOf('\"Day\",\"Date\",\"Shift\",\"Staff\",\"Role\",\"Hours\"')===0&&lines[1].indexOf('\"Ava\"')>0&&lines[1].indexOf('Monday')>0;})()"

# new UI hooks exist (incl. time-off card + fill-gaps button)
node_assert "index.html has new UI hooks" \
  "(()=>{const fs=require('fs');const h=fs.readFileSync(require('path').join('$DIR'.replace(/\\$/,''),'index.html'),'utf8');return ['btn-copy-week','btn-export-csv','sf-wage','ad-note','btn-fill-gaps','timeoff-form','to-staff','to-date','timeoff-list'].every(id=>h.includes('id=\"'+id+'\"'));})()"

# time-off management
node_assert "requestTimeOff validates staff + date" \
  "SP.requestTimeOff(SP.createStore(),{staffId:'nope',date:'2026-10-12'}).ok===false"
node_assert "requestTimeOff records entry" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;const r=SP.requestTimeOff(s,{staffId:id,date:'2026-10-12',reason:'vacation'});return r.ok&&r.entry.reason==='vacation'&&SP.isOnTimeOff(s,id,'2026-10-12')&&!SP.isOnTimeOff(s,id,'2026-10-13');})()"
node_assert "requestTimeOff rejects duplicates + bad dates" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;SP.requestTimeOff(s,{staffId:id,date:'2026-10-12'});return !SP.requestTimeOff(s,{staffId:id,date:'2026-10-12'}).ok&&!SP.requestTimeOff(s,{staffId:id,date:'nope'}).ok;})()"
node_assert "cancelTimeOff removes entry" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;const r=SP.requestTimeOff(s,{staffId:id,date:'2026-10-12'});return SP.cancelTimeOff(s,r.entry.id).ok&&!SP.isOnTimeOff(s,id,'2026-10-12');})()"
node_assert "timeOff flagged in detectGaps as timeOff unavailable" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,availability:[0]}).staff.id;SP.assign(s,'2026-09-28',0,0,id);SP.requestTimeOff(s,{staffId:id,date:'2026-09-28'});const g=SP.detectGaps(s,'2026-09-28');return g.unavailable.some(u=>u.staffId===id&&u.timeOff===true);})()"
node_assert "weekTimeOff lists the week" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;SP.requestTimeOff(s,{staffId:id,date:'2026-10-01'});SP.requestTimeOff(s,{staffId:id,date:'2026-10-20'});const w=SP.weekTimeOff(s,'2026-09-28');return w.length===1&&w[0].date==='2026-10-01';})()"
node_assert "removeStaff drops time-off entries" \
  "(()=>{const s=SP.createStore();const id=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;SP.requestTimeOff(s,{staffId:id,date:'2026-10-12'});SP.removeStaff(s,id);return s.timeOff.length===0;})()"

# auto-fill coverage suggestions
node_assert "suggestCoverage proposes eligible staff, fewest hours first" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,availability:[0,1]}).staff.id;const c=SP.addStaff(s,{name:'Cara',role:'Manager',maxHours:40,availability:[0,1]}).staff.id;SP.assign(s,'2026-09-28',1,0,a);const sg=SP.suggestCoverage(s,'2026-09-28');const mon=sg.find(x=>x.day===0&&x.shift===0&&x.role==='Manager');return sg.length>0&&mon&&mon.staffId===c;})()"
node_assert "suggestCoverage skips time-off staff" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,availability:[0]}).staff.id;SP.requestTimeOff(s,{staffId:a,date:'2026-09-28'});const sg=SP.suggestCoverage(s,'2026-09-28');return !sg.some(x=>x.day===0&&x.staffId===a);})()"
node_assert "suggestCoverage never double-books a day" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,availability:[0]}).staff.id;const sg=SP.suggestCoverage(s,'2026-09-28');const days={};for(const x of sg){if(x.staffId===a){if(days[x.day])return false;days[x.day]=1;}}return true;})()"
node_assert "applySuggestions fills slots" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,availability:[0]}).staff.id;const sg=SP.suggestCoverage(s,'2026-09-28');const r=SP.applySuggestions(s,'2026-09-28',sg);return r.applied===sg.length&&r.skipped===0&&SP.getSlot(s,'2026-09-28',0,0).length>0;})()"

# overtime report
node_assert "overtimeReport flags past-threshold staff with premium" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:60,wage:20}).staff.id;for(let d=0;d<6;d++)for(let sh=0;sh<2;sh++)SP.assign(s,'2026-09-28',d,sh,a);const ot=SP.overtimeReport(s,'2026-09-28',40);return ot.length===1&&ot[0].overtimeHours===8&&ot[0].premium===80;})()"
node_assert "overtimeReport empty under threshold" \
  "(()=>{const s=SP.createStore();SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,wage:20});return SP.overtimeReport(s,'2026-09-28',40).length===0;})()"
node_assert "overtimeReport custom threshold" \
  "(()=>{const s=SP.createStore();const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:60,wage:10}).staff.id;for(let d=0;d<5;d++)SP.assign(s,'2026-09-28',d,0,a);const ot=SP.overtimeReport(s,'2026-09-28',16);return ot.length===1&&ot[0].overtimeHours===4&&ot[0].premium===20;})()"

# app.js wires the new features
node_assert "app.js wires time-off + fill + overtime" \
  "(()=>{const fs=require('fs');const a=fs.readFileSync('$DIR/js/app.js','utf8');return ['renderTimeOff','btn-fill-gaps','timeoff-form','suggestCoverage','applySuggestions','overtimeReport','requestTimeOff'].every(fn=>a.includes(fn));})()"

# no rounded rectangles
node_assert "no rounded rectangles in css" \
  "(()=>{const fs=require('fs');const css=fs.readFileSync('$DIR/css/style.css','utf8');const bad=[...css.matchAll(/border-radius:\\s*([^;}]+)/g)].map(m=>m[1].trim()).filter(v=>!/^(0|50%|var\\(--radius\\))$/.test(v));return bad.length===0;})()"

echo "----"
echo "smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
