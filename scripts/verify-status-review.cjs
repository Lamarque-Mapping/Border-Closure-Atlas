'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../dist'),C=require(root+'/core.js'),S=require(root+'/status.js'),N=require(root+'/national.js'),K=require(root+'/cartography.js'),CSV=require(root+'/record-export.js');
const x={window:{}};vm.createContext(x);
for(const f of ['map-data.js','national-data.js','status-data.js','crossing-geography.js'])vm.runInContext(fs.readFileSync(root+'/'+f,'utf8'),x);
const d=x.window.BORDER_DATA,source=x.window.ATLAS_STATUS_REVIEW;
const original=new Map(d.events.map(e=>[e.id,JSON.stringify(e.duration_periods)]));
for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of d[key].features)f.geometry=d.geometry_pool[f.geometry];delete d.geometry_pool;
x.window.AtlasCrossings.attach(d);N.attach(d,x.window.ATLAS_NATIONAL_DATA);S.attach(d,source);S.attach(d,source);
assert.equal(d.events.filter(S.isStatus).length,source.observations.length);
assert.equal(new Set(d.events.map(e=>e.id)).size,d.events.length);
for(const e of d.events.filter(e=>!S.isSupplement(e)))assert.equal(JSON.stringify(e.duration_periods),original.get(e.id),'Historical duration unchanged: '+e.id);
const oct={mode:'intervals',month:C.monthOrdinal('2026-10')},sep={...oct,month:C.monthOrdinal('2026-09')};
const visible=C.filterEvents(d,oct),get=id=>d.events.find(e=>e.id===id),features=new Map(C.locationFeatures(d).map(f=>[f.properties.location_id,f]));
for(const [id,location,status] of [['STATUS-RUS-UKR-202610','context-frontier-rus-ukr','closed'],['STATUS-KOR-PRK-202610','context-frontier-kor-prk','closed'],['STATUS-RAFAH-202610','post-rafah','restricted']]){
 const e=get(id);assert(visible.includes(e));assert.equal(C.temporalState(e,oct.month),status);assert.equal(C.temporalState(e,sep.month),status,'Verified continuing regimes must not pop into existence in the check month');
 assert(C.mapLocationsFor(e,d,oct).includes(location));assert.equal(e.duration_periods.length,0);
 assert.equal(C.matchesTime(e,'onsets',oct.month),false,'No new closure onset invented');
 assert(e.sources.length&&e.status_review.qualification);
}
const at=(id,month)=>C.temporalState(get(id),C.monthOrdinal(month));
// Reopened Austrian minor routes must not linger as unresolved COVID markers.
const austria=get('R3-EU-012');
assert.notEqual(at(austria.id,'2020-03'),'none','Retain the historical Austrian restriction');
for(const month of ['2020-07','2021-06','2025-06','2026-10']){
 assert.equal(at(austria.id,month),'none','Austrian COVID suspension ended in 2020: '+month);
 assert.equal(C.statusPeriods(austria,{...oct,month:C.monthOrdinal(month)}).length,0);
}
assert.equal(austria.later_status_review.checked_at,'2026-10-29');
assert.equal(get('AM021').later_status_review.checked_at,'2026-10-26','A targeted follow-up must not restamp other reviews');
assert.deepEqual(Array.from(source.resolutions.filter(r=>r.record_id===austria.id),r=>[r.phase_id,r.from]),[['R3-EU-012-FU1','2020-06-26'],['R3-EU-012-R2','2020-06-16']]);
for(const id of ['STATUS-RUS-UKR-202610','STATUS-BLR-UKR-202610']){
 assert.equal(get(id).start,'2022-02-28','Use the operative date, not the order adoption, invasion or check date');
 assert.equal(at(id,'2022-01'),'none');
 for(const month of ['2022-02','2022-10','2023-11','2024-06','2025-06','2026-09'])assert.equal(at(id,month),'closed',id+' continuing in '+month);
 assert.equal(at(id,'2026-11'),'none','No future projection after evidence');
 assert(S.periodDates(get(id).map_status_periods[0]).includes('From 2022-02-28'));
}
for(const o of source.observations.filter(o=>o.timeline_periods.some(p=>p.start_precision==='pre_window'))){
 const e=get(o.id);assert.equal(e.start,null,'No invented exact onset for a pre-window regime');
 assert.notEqual(at(o.id,'2016-10'),'none');assert.equal(C.matchesTime(e,'onsets',C.monthOrdinal('2016-10')),false);
 assert(S.periodDates(e.map_status_periods[0]).startsWith('Already in force before October 2016'));
}
for(const [month,status] of [['2024-04','none'],['2024-06','closed'],['2025-01','closed'],['2025-02','restricted'],['2025-04','closed'],['2026-01','closed'],['2026-04','restricted']])assert.equal(at('STATUS-RAFAH-202610',month),status,'Rafah passenger phase in '+month);
assert.deepEqual(C.temporalStates(get('STATUS-RAFAH-202610'),C.monthOrdinal('2025-03')),['closed','restricted'],'Monthly view retains both sides of a within-month transition');
assert.equal(at('STATUS-FIN-RUS-202610','2023-11'),'none','Do not merge the renewed Finnish closure across the brief reopening');
assert.equal(at('STATUS-FIN-RUS-202610','2024-01'),'closed');
assert.equal(at('STATUS-BDI-RWA-202610','2023-12'),'none');assert.equal(at('STATUS-BDI-RWA-202610','2024-02'),'closed');
assert.equal(at('STATUS-AUDIT-REC50-R03-001-20261025','2022-01'),'none');
assert.equal(at('STATUS-AUDIT-REC50-R03-001-20261025','2022-03'),'restricted');
assert.equal(at('STATUS-AUDIT-REC50-R03-001-20261025','2025-07'),'restricted');
const exitRule=get('STATUS-AUDIT-REC50-R03-001-20261025');
assert(C.statusPeriods(exitRule,{mode:'intervals',month:C.monthOrdinal('2025-07')}).every(p=>p.scope.includes('18–60')),'Do not backdate the 23–60 age scope');
assert(C.statusPeriods(exitRule,{mode:'intervals',month:C.monthOrdinal('2025-09')}).every(p=>p.scope.includes('23–60')));
assert.equal(at('STATUS-AUDIT-REC50-R03-001-20261025','2025-09'),'restricted');
assert.equal(at('STATUS-AUDIT-EA024-20261001','2025-02'),'none','Rason’s brief reopening must remain distinct');
assert.equal(at('STATUS-AUDIT-EA024-20261001','2025-04'),'restricted');
const narva=get('STATUS-AUDIT-REC50-R08-002-20261025');
assert.equal(C.statusPeriods(narva,{mode:'intervals',month:C.monthOrdinal('2024-04')}).length,1,'Initial vehicle restriction only');
assert(C.statusPeriods(narva,{mode:'intervals',month:C.monthOrdinal('2025-10')}).some(p=>p.scope.includes('23:00')));
assert(!C.statusPeriods(narva,{mode:'intervals',month:C.monthOrdinal('2025-10')}).some(p=>p.scope.includes('19:00')));
assert(C.statusPeriods(narva,{mode:'intervals',month:C.monthOrdinal('2026-07')}).some(p=>p.scope.includes('19:00')));
const aze=get('STATUS-AUDIT-CC003-20261025'),feb2020={mode:'intervals',month:C.monthOrdinal('2020-02')};
assert.deepEqual(C.mapLocationsFor(aze,d,feb2020),['context-frontier-aze-irn'],'Do not backdate Georgia, Russia or Türkiye to Iran’s February closure');
assert.deepEqual(C.mapLocationsFor(get('CC003'),d,feb2020),['context-frontier-aze-irn'],'Historical staggered-onset geography must agree with the source-specific dates');
assert.equal(C.mapLocationsFor(aze,d,{...feb2020,month:C.monthOrdinal('2020-03')}).length,4);
assert(C.recordsForLocation([aze],'context-frontier-aze-irn',d,feb2020)[0].map_status_periods.every(p=>p.scope.endsWith('Iran')));
const snapshotSource=JSON.parse(JSON.stringify(source));snapshotSource.observations=[snapshotSource.observations[0]];delete snapshotSource.observations[0].timeline_periods;
const snapshot=S.compile(snapshotSource)[0];assert.equal(snapshot.start,null);assert.equal(C.temporalState(snapshot,sep.month),'none','A bare current check is still not continuity evidence');assert.equal(C.temporalState(snapshot,oct.month),'closed');
assert(S.periodDates(snapshot.map_status_periods[0]).includes('start not established'));
assert.equal(source.audit.chronology_followup.reviewed_observations,source.observations.length);
assert.equal(source.audit.chronology_followup.timeline_periods,source.observations.reduce((n,o)=>n+o.timeline_periods.length,0));
assert.equal(source.audit.chronology_followup.pre_window_regimes,source.observations.filter(o=>o.timeline_periods.some(p=>p.start_precision==='pre_window')).length);
for(const o of source.observations){
 const e=get(o.id);assert.equal(e.map_status_periods.length,o.timeline_periods.length);
 for(const p of e.map_status_periods){assert.equal(C.statusTemporalState(p,C.monthOrdinal(p.start_earliest)),p.status);assert.equal(C.statusTemporalState(p,C.monthOrdinal(p.start_earliest)-1),'none');}
 assert.equal(C.temporalState(e,C.monthOrdinal(o.observed_at)+1),'none');
 assert.equal(C.matchesTime(e,'onsets',oct.month),false);
}
for(const e of d.events.filter(S.isStatus))for(const id of C.mapLocationsFor(e,d,oct))assert(features.has(id),'Known geography '+id);
// The active ledger is regenerated from native phases, not the old inventory.
const plain=x=>JSON.parse(JSON.stringify(x));
const fullReview=JSON.parse(fs.readFileSync(root+'/downloads/border-status-review.json','utf8')),history=fullReview.historical_audit;
assert(history,'The original later-status review must remain available as dated history');
assert.equal(JSON.stringify(source.observations),JSON.stringify(history.observations),'No old observation or check date may be restamped');
assert(history.reviewed_at<source.reviewed_at);
assert.equal(source.historical_audit.records_reviewed,history.audit.records.length);
assert.equal(source.historical_audit.reviewed_at,history.reviewed_at);
assert(Buffer.byteLength(JSON.stringify(source))<Buffer.byteLength(JSON.stringify(fullReview)),'Runtime must remain smaller than the complete research archive');
assert.equal(history.audit.records.length,history.unresolved.length);
const raw={window:{}};vm.createContext(raw);vm.runInContext(fs.readFileSync(root+'/map-data.js','utf8'),raw);
const native=raw.window.BORDER_DATA,month=C.monthOrdinal(source.reviewed_at);
const eligible=e=>!C.excluded(e)&&C.temporalState(e,month)==='none'&&e.duration_periods.some(p=>p.analysis_included!==false&&p.endpoint_status==='last_confirmed');
const expected=native.events.filter(eligible);
assert.deepEqual(Array.from(source.unresolved,r=>r.record_id),Array.from(expected,e=>e.id));
for(const row of source.unresolved){
 const nativeRecord=native.events.find(e=>e.id===row.record_id);
 const phaseIds=nativeRecord.duration_periods.filter(p=>p.analysis_included!==false&&p.endpoint_status==='last_confirmed').map(p=>p.period_id);
 assert.deepEqual(Array.from(row.phases,p=>p.phase_id),Array.from(phaseIds));
 for(const p of row.phases){
  const period=nativeRecord.duration_periods.find(x=>x.period_id===p.phase_id);
  assert.equal(p.last_confirmed,period.last_confirmed||period.end_latest||period.start_latest);
  assert.notEqual(period.analysis_included,false);
 }
}
assert.equal(source.audit.records.length,expected.length);
assert.equal(new Set(source.audit.records.map(r=>r.record_id)).size,expected.length);
assert.equal(source.audit.phases_reviewed,source.unresolved.reduce((n,r)=>n+r.phases.length,0));
const resolutionIds=new Set(source.resolutions.map(r=>r.phase_id));
assert.equal(resolutionIds.size,source.resolutions.length);
const remaining=source.unresolved.filter(r=>r.phases.some(p=>!resolutionIds.has(p.phase_id)));
assert.equal(source.audit.counts.remaining_unverified_records,remaining.length);
assert.equal(d.events.filter(e=>!S.isSupplement(e)&&C.statusPeriods(e,oct).some(p=>p.status==='unresolved')).length,remaining.length);
for(const r of source.resolutions){
 const e=get(r.record_id),matches=month=>C.statusPeriods(e,{mode:'intervals',month}).some(p=>p.source_phase_id===r.phase_id);
 const from=r.timeline_from||r.from;
 assert(!matches(C.monthOrdinal(from)),'Matching uncertainty must end at the supported bound: '+r.phase_id);
 assert(!matches(oct.month),'Resolved phase must not linger in October 2026: '+r.phase_id);
 const p=source.unresolved.find(x=>x.record_id===r.record_id).phases.find(p=>p.phase_id===r.phase_id),previous=C.monthOrdinal(from)-1;
 if(previous>C.monthOrdinal(p.last_confirmed))assert(matches(previous),'A later bound does not fill the earlier gap: '+r.phase_id);
}
for(const e of d.events.filter(e=>!S.isSupplement(e))){
 const allowed=new Set(source.unresolved.find(r=>r.record_id===e.id)?.phases.map(p=>p.phase_id)||[]);
 for(const p of e.map_status_periods||[])if(p.status==='unresolved')assert(allowed.has(p.source_phase_id),'Retired native phase cannot retain a stale unknown marker: '+p.source_phase_id);
 for(const p of e.duration_periods.filter(p=>p.analysis_included===false))assert(!(e.map_status_periods||[]).some(s=>s.source_phase_id===p.period_id),'Excluded phase cannot create a status marker');
}
for(const a of fullReview.reconciliation.later_access_observations){
 if(a.applies_to_entire_phase!==true)continue;
 const p=source.unresolved.find(r=>r.record_id===a.record_id)?.phases.find(p=>p.phase_id===a.phase_id);
 if(!p||(a.date_latest||a.date)<p.last_confirmed)continue;
 const r=source.resolutions.find(r=>r.phase_id===a.phase_id);assert(r&&r.from<=(a.date_latest||a.date),'Explicit whole-phase access bound must be consumed: '+a.phase_id);
}
for(const o of source.observations){
 const e=get(o.id),checked=o.timeline_review?.checked_at||o.checked_at||o.observed_at;
 assert(e.current_timing.endsWith('checked '+checked),'Current ledger date must not restamp the source check');
 for(const p of e.map_status_periods)assert.equal(p.checked_at,checked);
 assert.equal(e.duration_periods.length,0,'Status evidence remains outside historical duration totals');
}
const unknown=d.events.find(e=>!S.isSupplement(e)&&C.statusPeriods(e,oct).some(p=>p.status==='unresolved')&&C.mapLocationsFor(e,d,oct).length);
if(unknown){
 assert.equal(C.temporalState(unknown,oct.month,'operational_spell'),'none','Later uncertainty is not measured operational closure');
 const id=C.mapLocationsFor(unknown,d,oct)[0],scoped=C.recordsForLocation([unknown],id,d,oct);
 const style=K.symbolStyle(features.get(id).properties,{records:scoped});assert(style.unresolved);assert.equal(style.colour,'#7d8884');assert.deepEqual(style.dash,[3,5]);
}
const unmapped=get('STATUS-AUDIT-C7-EU-002-20261025');assert.deepEqual(C.mapLocationsFor(unmapped,d,oct),[],'Named posts without approved points must not fall back to entire frontiers');
assert.equal(get('STATUS-AUDIT-EA024-20261001').map_status_periods[0].label,'Restriction reported by operator','Original operator evidence label must survive ledger reconciliation');
for(const r of source.audit.records)assert.equal(get(r.record_id).later_status_review.record_id,r.record_id);
const csv=CSV.build({records:[get('STATUS-RAFAH-202610'),get('STATUS-RUS-UKR-202610'),...(unknown?[unknown]:[])],state:oct});
assert(csv.content.includes('Later-status evidence'));assert(csv.content.includes('Not calculated: separately dated border-access status'));
assert(csv.content.includes('From 2022-02-28; confirmed through 2026-10-25'),'CSV separates effective dates and original checks');
assert(csv.content.includes('From 2025-02-01; until 2025-03-18'),'CSV retains limited reopening phases');
const app=fs.readFileSync(root+'/app.js','utf8'),index=fs.readFileSync(root+'/index.html','utf8'),auditHTML=fs.readFileSync(root+'/status-audit.html','utf8');
assert.equal((auditHTML.match(/class="record" id=/g)||[]).length,source.audit.records.length);
assert.equal((auditHTML.match(/class="historical-record" id=/g)||[]).length,history.audit.records.length);
assert.equal((auditHTML.match(/class="observation" id=/g)||[]).length,source.observations.length);
assert(auditHTML.includes('Download the complete review (JSON)'));
assert(auditHTML.includes('these historical totals are not the remaining workload'));
assert(auditHTML.includes('Earlier later-status review · '+history.reviewed_at));
assert(app.includes('Unmarked borders are not necessarily open.'));assert(!index.includes('id="last-month"'));assert(!app.includes("$('last-month')"));
assert(!d.events.some(e=>e.record_kind==='national_policy'&&e.countries.includes('United Kingdom')));
assert.equal(C.temporalState(get('NATIONAL-NAT-AUS-ENTRY-COVID'),C.monthOrdinal('2021-06')),'policy');
console.log(JSON.stringify({status_review:'passed',active_records:source.audit.records.length,remaining_unverified_records:remaining.length,historical_records:history.audit.records.length,status_observations:source.observations.length,timeline_periods:source.audit.chronology_followup.timeline_periods,original_check_dates_preserved:true,native_durations_unchanged:true}));
