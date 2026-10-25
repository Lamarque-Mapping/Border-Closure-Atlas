/* Supported phase starts must remain distinct from historical parent onsets. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),C=require(path.join(root,'dist/core.js'));
const reference=require('./release-verification-reference.cjs').load();
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const raw=reference.tables['Chronology phases'],byParent=new Map();
for(const p of raw){if(!byParent.has(p['Parent record ID']))byParent.set(p['Parent record ID'],[]);byParent.get(p['Parent record ID']).push(p);}
let onsetCount=0,newParentsVisible=0;
for(const e of data.events){
 const expected=[];
 if(!e.quarantined&&!e.excluded_from_map)for(const p of byParent.get(e.id)||[]){
  const a=p['Start earliest'],b=p['Start latest'];
  if(p['Contested / held (1=yes)']||!/^\d{4}-\d{2}-\d{2}$/.test(a||'')||!/^\d{4}-\d{2}-\d{2}$/.test(b||''))continue;
  if(a<=b&&a.slice(0,7)===b.slice(0,7))expected.push({phase_id:p['Phase ID'],month:a.slice(0,7),measure_type:p['Evidence category']});
 }
 assert.deepEqual(e.phase_onsets,expected,e.id+' phase onsets survive the lean map projection');
 const months=[...new Set(expected.map(p=>p.month))].sort();assert.deepEqual(e.onset_months,months);
 assert.equal(e.onset_month,months[0]||null,'compatibility scalar is not a fabricated parent date');
 for(const onset of expected){
  const month=C.monthOrdinal(onset.month),state={mode:'onsets',month,measureType:onset.measure_type};
  assert(C.matchesTime(e,'onsets',month,onset.measure_type));
  const phases=C.periodsForView(e,state);
  assert(phases.some(p=>p.period_id===onset.phase_id),'a matching start retains its own phase');
  assert(phases.every(p=>expected.some(q=>q.phase_id===p.period_id&&q.month===onset.month&&q.measure_type===onset.measure_type)),'onset mapping never borrows another date or evidence category');
 }
 if(e.id.startsWith('REC50-')&&expected.length)newParentsVisible++;
 onsetCount+=expected.length;
}
assert(newParentsVisible>0,'REC50 additions with no historical Original start remain visible by their supported phase starts');
const fixture={quarantined:false,excluded_from_map:false,phase_onsets:[{phase_id:'OBS',month:'2020-01',measure_type:'operational_spell'},{phase_id:'PLAN',month:'2021-02',measure_type:'ordered_window'}],duration_periods:[{period_id:'OBS',measure_type:'operational_spell'},{period_id:'PLAN',measure_type:'ordered_window'}]};
assert.equal(C.matchesTime(fixture,'onsets',C.monthOrdinal('2021-02'),'operational_spell'),false,'an announced start cannot satisfy an observed-closure filter');
assert.deepEqual(C.periodsForView(fixture,{mode:'onsets',month:C.monthOrdinal('2021-02'),measureType:'ordered_window'}).map(p=>p.period_id),['PLAN']);
console.log(`Phase-onset checks passed: ${onsetCount} supported phase starts; ${newParentsVisible} REC50 parents discoverable; held/uncertain-month exclusion and evidence-specific geography preserved.`);
