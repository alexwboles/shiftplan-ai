#!/usr/bin/env bash
# ShiftPlan AI — end-to-end logic flows in Node against js/logic.js.
set -u

LOGIC="/home/hatch/workspace/shiftplan-ai/js/logic.js"
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS: $1"; }
bad() { fail=$((fail+1)); echo "FAIL: $1"; }

run() { # $1 = description, rest = node script (stdin)
  local desc="$1"; shift
  if node "$@" < /dev/null; then ok "$desc"; else bad "$desc"; fi
}

# Flow 1: build a full week -> detect gaps -> resolve gaps -> hours check
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const wk='2026-09-28';
const ids={};
['Ava|Manager','Ben|Cashier','Cara|Cook','Dan|Server','Eli|Cleaner'].forEach(x=>{
  const [n,r]=x.split('|');
  ids[n]=SP.addStaff(s,{name:n,role:r,maxHours:40,availability:[0,1,2,3,4]}).staff.id;
});
if(!ids.Ava||!ids.Ben||!ids.Cara||!ids.Dan||!ids.Eli) throw new Error('staff add failed');
// understaff Monday morning on purpose
SP.assign(s,wk,0,0,ids.Ava);
let g=SP.detectGaps(s,wk);
if(!g.understaffed.some(u=>u.day===0&&u.shift===0)) throw new Error('expected gap Mon AM');
// resolve: add two more staff to the slot
SP.assign(s,wk,0,0,ids.Ben); SP.assign(s,wk,0,0,ids.Cara);
g=SP.detectGaps(s,wk);
if(g.understaffed.some(u=>u.day===0&&u.shift===0)) throw new Error('gap not resolved');
// hours check
const h=SP.weekHours(s,wk);
if(h[ids.Ava]!==4) throw new Error('expected 4h for Ava, got '+h[ids.Ava]);
console.log('flow1 ok');
" && ok "e2e flow 1: build week -> gaps -> resolve -> hours" || bad "e2e flow 1: build week -> gaps -> resolve -> hours"

# Flow 2: template apply to another week keeps staff pattern
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',0,0,a); SP.assign(s,'2026-09-28',0,0,b); SP.assign(s,'2026-09-28',4,2,b);
const t=SP.saveTemplate(s,'Standard','2026-09-28');
if(!t.ok) throw new Error('save failed');
if(SP.applyTemplate(s,t.template.id,'2026-10-12').ok!==true) throw new Error('apply failed');
const slot=SP.getSlot(s,'2026-10-12',0,0);
if(slot.length!==2||!slot.some(x=>x.staffId===a)) throw new Error('pattern mismatch');
if(SP.getSlot(s,'2026-09-28',4,2).length!==1) throw new Error('source week mutated');
console.log('flow2 ok');
" && ok "e2e flow 2: template apply to another week" || bad "e2e flow 2: template apply to another week"

# Flow 3: full swap board flow (request -> accept -> decline another -> board states)
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40}).staff.id;
const c=SP.addStaff(s,{name:'Cara',role:'Cook',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',2,1,a); SP.assign(s,'2026-09-28',3,0,c);
const r1=SP.requestSwap(s,{staffId:a,week:'2026-09-28',day:2,shift:1,targetStaffId:b});
if(!r1.ok) throw new Error('request failed: '+r1.error);
// wrong claimant must be rejected (proposed to Ben)
const wrong=SP.acceptSwap(s,r1.swap.id,c);
if(wrong.ok) throw new Error('wrong claimant accepted');
const acc=SP.acceptSwap(s,r1.swap.id,b);
if(!acc.ok) throw new Error('accept failed: '+acc.error);
if(!SP.getSlot(s,'2026-09-28',2,1).some(x=>x.staffId===b)) throw new Error('assignment not transferred');
const r2=SP.requestSwap(s,{staffId:c,week:'2026-09-28',day:3,shift:0});
if(!r2.ok) throw new Error('open request failed');
if(!SP.declineSwap(s,r2.swap.id).ok) throw new Error('decline failed');
const open=s.swaps.filter(x=>x.status==='open');
const done=s.swaps.filter(x=>x.status!=='open');
if(open.length!==0||done.length!==2) throw new Error('board state wrong');
console.log('flow3 ok');
" && ok "e2e flow 3: swap board request/accept/decline" || bad "e2e flow 3: swap board request/accept/decline"

# Flow 4: printable schedule shape
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',0,0,a);
const p=SP.printableSchedule(s,'2026-09-28');
if(p.week!=='2026-09-28') throw new Error('week key wrong');
if(p.rows.length!==7) throw new Error('expected 7 rows');
if(p.rows[0].day!=='Monday'||p.rows[0].shifts.length!==3) throw new Error('row shape wrong');
if(p.rows[0].shifts[0].assignments[0].name!=='Ava') throw new Error('assignment missing');
if(!p.rows[0].date.match(/2026-09-28/)) throw new Error('date wrong');
console.log('flow4 ok');
" && ok "e2e flow 4: printable schedule shape" || bad "e2e flow 4: printable schedule shape"

# Flow 5: empty-week edge cases
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const g=SP.detectGaps(s,'2026-09-28');
if(g.understaffed.length===0) throw new Error('empty week should be understaffed');
if(g.doubleBooked.length||g.overMaxHours.length||g.unavailable.length) throw new Error('no staff => no per-staff issues expected');
const tips=SP.heuristicTips(s,'2026-09-28');
if(!tips.length) throw new Error('tips should not be empty');
const t=SP.saveTemplate(s,'Empty','2026-09-28');
if(!t.ok) throw new Error('saving empty week template should work');
console.log('flow5 ok');
" && ok "e2e flow 5: empty-week edge cases" || bad "e2e flow 5: empty-week edge cases"

# Flow 6: persistence shape round-trip (staff + weeks + templates + swaps + settings)
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',0,0,a);
SP.saveTemplate(s,'T1','2026-09-28');
SP.requestSwap(s,{staffId:a,week:'2026-09-28',day:0,shift:0});
s.settings.openaiKey='sk-test';
const d=SP.deserialize(SP.serialize(s));
if(!d.ok) throw new Error('deserialize failed');
const r=d.state;
if(r.staff.length!==1||r.templates.length!==1||r.swaps.length!==1) throw new Error('collections lost');
if(r.settings.openaiKey!=='sk-test') throw new Error('settings lost');
if(!r.weeks['2026-09-28']) throw new Error('weeks lost');
if(SP.deserialize('not json').ok) throw new Error('bad json accepted');
if(SP.deserialize('{}').ok) throw new Error('invalid store accepted');
console.log('flow6 ok');
" && ok "e2e flow 6: persistence shape round-trip" || bad "e2e flow 6: persistence shape round-trip"

# Flow 7: wages persist and labor cost estimates a full week
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40,wage:22}).staff.id;
const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40,wage:15.5}).staff.id;
SP.assign(s,'2026-09-28',0,0,a); SP.assign(s,'2026-09-28',1,0,a); SP.assign(s,'2026-09-28',1,0,b);
const c=SP.laborCost(s,'2026-09-28');
if(c.perStaff[a]!==176) throw new Error('Ava cost wrong: '+c.perStaff[a]);
if(c.perStaff[b]!==62) throw new Error('Ben cost wrong: '+c.perStaff[b]);
if(c.total!==238) throw new Error('total wrong: '+c.total);
const d=SP.deserialize(SP.serialize(s));
if(d.state.staff.find(x=>x.id===a).wage!==22) throw new Error('wage lost in persistence');
console.log('flow7 ok');
" && ok "e2e flow 7: wages persist, labor cost estimates the week" || bad "e2e flow 7: wages persist, labor cost estimates the week"

# Flow 8: repeat last week copies assignments + notes, skips departed staff
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',0,0,a); SP.assign(s,'2026-09-28',2,1,b);
SP.setSlotNote(s,'2026-09-28',0,0,'Training week');
const r=SP.copyWeek(s,'2026-09-28','2026-10-05');
if(!r.ok||r.copied!==2) throw new Error('copy failed: '+JSON.stringify(r));
if(!SP.getSlot(s,'2026-10-05',0,0).some(x=>x.staffId===a)) throw new Error('slot not copied');
if(SP.getSlotNote(s,'2026-10-05',0,0)!=='Training week') throw new Error('note not copied');
SP.removeStaff(s,b);
const r2=SP.copyWeek(s,'2026-09-28','2026-10-12');
if(r2.copied!==1) throw new Error('departed staff not skipped: '+r2.copied);
if(SP.getSlot(s,'2026-09-28',0,0).length!==1) throw new Error('source week mutated');
console.log('flow8 ok');
" && ok "e2e flow 8: repeat last week copies notes, skips departed staff" || bad "e2e flow 8: repeat last week copies notes, skips departed staff"

# Flow 9: slot note lifecycle on a live week
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
if(SP.getSlotNote(s,'2026-09-28',3,2)!=='') throw new Error('fresh slot should have no note');
SP.setSlotNote(s,'2026-09-28',3,2,'  Holiday rush  ');
if(SP.getSlotNote(s,'2026-09-28',3,2)!=='Holiday rush') throw new Error('note not trimmed/stored');
SP.setSlotNote(s,'2026-09-28',3,2,'');
if(SP.getSlotNote(s,'2026-09-28',3,2)!=='') throw new Error('note not cleared');
const d=SP.deserialize(SP.serialize(s));
if(SP.getSlotNote(d.state,'2026-09-28',3,2)!=='') throw new Error('notes should persist only when set');
console.log('flow9 ok');
" && ok "e2e flow 9: slot note set/get/clear" || bad "e2e flow 9: slot note set/get/clear"

# Flow 10: near-max warning appears in gaps, over-max does not double-count
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const c=SP.addStaff(s,{name:'Cara',role:'Cook',maxHours:40}).staff.id;
for(let d=0;d<7;d++) SP.assign(s,'2026-09-28',d,0,c);   // 28h
SP.assign(s,'2026-09-28',0,1,c); SP.assign(s,'2026-09-28',1,1,c); // 36h total
let g=SP.detectGaps(s,'2026-09-28');
if(!g.nearMaxHours.some(n=>n.staffId===c&&n.hours===36)) throw new Error('near-max missing');
if(g.overMaxHours.some(o=>o.staffId===c)) throw new Error('double-flagged as over-max');
const before=g.totalIssues;
SP.assign(s,'2026-09-28',2,1,c); SP.assign(s,'2026-09-28',3,1,c); // 44h > 40h
g=SP.detectGaps(s,'2026-09-28');
if(!g.overMaxHours.some(o=>o.staffId===c)) throw new Error('over-max missing');
if(g.nearMaxHours.some(n=>n.staffId===c)) throw new Error('still near-max after exceeding');
if(g.totalIssues<=before) throw new Error('issue count did not grow');
console.log('flow10 ok');
" && ok "e2e flow 10: near-max warning graduates to over-max" || bad "e2e flow 10: near-max warning graduates to over-max"

# Flow 11: schedule CSV covers every assignment with day/date/shift/staff/role/hours
node -e "
const SP=require('$LOGIC');
const s=SP.createStore();
const a=SP.addStaff(s,{name:'Ava',role:'Manager',maxHours:40}).staff.id;
const b=SP.addStaff(s,{name:'Ben',role:'Cashier',maxHours:40}).staff.id;
SP.assign(s,'2026-09-28',0,0,a,'Manager'); SP.assign(s,'2026-09-28',0,0,b,'Cashier'); SP.assign(s,'2026-09-28',6,2,b,'Cashier');
const csv=SP.scheduleCSV(s,'2026-09-28');
const lines=csv.split('\n');
if(lines.length!==4) throw new Error('want header + 3 rows, got '+lines.length);
const body=lines.slice(1).join('\n');
if(body.indexOf('\"Monday\",\"2026-09-28\",\"Morning\",\"Ava\",\"Manager\",\"4\"')<0) throw new Error('Ava row wrong');
if(body.indexOf('\"Sunday\",\"2026-10-04\",\"Evening\",\"Ben\"')<0) throw new Error('Ben Sunday row wrong');
console.log('flow11 ok');
" && ok "e2e flow 11: schedule CSV covers every assignment" || bad "e2e flow 11: schedule CSV covers every assignment"

echo "----"
echo "e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
