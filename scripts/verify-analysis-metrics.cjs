const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const M=require('./analysis-metrics.js');
const phase={period_id:'p1',measure_type:'operational_spell',kind:'closed_interval',contested:false,
 exact_complete_operational:true,observed_reopening:'Yes',start_earliest:'2020-02-28',start_latest:'2020-02-28',
 end_earliest:'2020-03-01',end_latest:'2020-03-01',endpoint_inclusion:'Exclusive',minimum_days:2,maximum_days:2};
assert.equal(M.exactDays(phase),2,'UTC date differences include leap days');
assert.equal(M.exactDays({...phase,endpoint_inclusion:'Inclusive'}),2,'inclusive endpoints never silently add a day');
for(const change of [
 {observed_reopening:'Unknown'},{observed_reopening:'No'},{contested:true},{exact_complete_operational:false},{analysis_included:false},
 {measure_type:'formal_policy_period'},{measure_type:'ordered_window'},{measure_type:'intermittent_regime'},
 {kind:'same_day'},{kind:'right_censored'},{start_earliest:null},{end_latest:null},
 {start_latest:'2020-02-29'},{end_earliest:'2020-02-29'},
 {start_earliest:'2020-02-30',start_latest:'2020-02-30'},
 {end_earliest:'2020-02-28',end_latest:'2020-02-28',minimum_days:0,maximum_days:0},
 {minimum_days:3},{maximum_days:3},{temporal_display_rule:'dated_evidence_only_no_continuity_inference'}
])assert.equal(M.exactDays({...phase,...change}),null,JSON.stringify(change));
assert.equal(M.quantile([], .5),null);assert.equal(M.quantile([11],.5),11);
assert.equal(M.quantile([20,1,10,2],.5),6);assert.equal(M.quantile([20,1,10,2],.25),1.75);assert.equal(M.quantile([20,1,10,2],.75),12.5);
const duplicate={id:'r1',title:'Example',inclusion_status:'Included',rationales:['A','B','A'],duration_periods:[phase,phase,{...phase,period_id:'p2'}]};
const fixture=M.durationRows([duplicate,{...duplicate,id:'excluded',quarantined:true}]);
assert.equal(fixture.length,2,'duplicate phase IDs removed; distinct overlapping phases retained separately');
assert.equal(M.durationRows([{...duplicate,id:'excluded-flag',inclusion_status:'Excluded',quarantined:false}]).length,0);
assert(fixture.every(p=>p.days===2),'overlapping phase durations are never summed');
const groups=M.durationGroups([duplicate],['A','B','C']);
assert.equal(groups[0].phases,2);assert.equal(groups[0].records,1);assert.equal(groups[0].median,2);
assert.equal(groups[1].phases,2,'nonexclusive rationale labels retain the shared phases');assert.equal(groups[2].median,null);
const uncertainEnd={...phase,period_id:'unknown-end',end_earliest:null,end_latest:null,minimum_days:null,maximum_days:null,exact_complete_operational:false,strictly_over_24_hours:true};
assert.equal(M.durationMatch({...duplicate,duration_periods:[uncertainEnd]},'over1'),true,'source-backed >24h finding remains eligible without an exact reopening');
assert.deepEqual(M.durationRows([{...duplicate,duration_periods:[uncertainEnd]}]),[],'>24h eligibility does not fabricate an exact duration sample');
const exactly24={...phase,period_id:'exactly24',start_earliest:'2020-02-28',start_latest:'2020-02-28',end_earliest:'2020-02-29',end_latest:'2020-02-29',minimum_days:1,maximum_days:1,strictly_over_24_hours:false};
assert.equal(M.durationMatch({...duplicate,duration_periods:[exactly24]},'over1'),false,'exactly 24 hours fails a strictly-greater-than-24h filter');
assert.deepEqual(M.durationRows([{...duplicate,duration_periods:[exactly24]}],'over1'),[]);
assert.equal(M.durationMatch({...duplicate,duration_periods:[{...phase,strictly_over_24_hours:false}]},'over1'),false,'an explicit false finding overrides earlier multi-day arithmetic');
const excludedRoad={...phase,period_id:'road-excluded',analysis_included:false,strictly_over_24_hours:true};
assert.equal(M.durationMatch({...duplicate,duration_periods:[excludedRoad]},'over1'),false,'included parent never promotes its excluded road phase');
assert.deepEqual(M.durationRows([{...duplicate,duration_periods:[excludedRoad]}]),[]);
assert.equal(M.durationMatch({...duplicate,duration_periods:[{...phase,strictly_over_24_hours:null,over_24_hours_basis:'Continuity unresolved'}]},'over1'),false,'an explicit unknown >24h finding cannot inherit older duration arithmetic');
const phaseRationales=M.durationRows([{...duplicate,duration_periods:[{...phase,rationales:['B']}]}]);
assert.deepEqual(phaseRationales[0].codes,['B'],'phase rationale scope does not inherit unrelated parent rationales');
const nativeFixture=require('./release-verification-reference.cjs').fromNative({tables:{
 Register:['open','24h','road','unknown'].map(ID=>({ID,'Analysis inclusion':'Included'})),
 Durations:['open','24h','road','unknown'].map(id=>({'Record ID':id,'Included (1=yes)':1})),
 'Chronology phases':[
  {'Parent record ID':'open','Phase ID':'open-p','Evidence category':'operational_spell','Strictly over 24 hours':true,'Over 24 hours basis':'Two-day continuing observation; reopening unknown'},
  {'Parent record ID':'24h','Phase ID':'24h-p','Evidence category':'ordered_window','Strictly over 24 hours':false,'Over 24 hours basis':'Exactly 24 hours'},
  {'Parent record ID':'road','Phase ID':'road-p','Evidence category':'operational_spell','Analysis included (1=yes)':0,'Strictly over 24 hours':true},
  {'Parent record ID':'unknown','Phase ID':'unknown-p','Evidence category':'operational_spell','Strictly over 24 hours':null,'Over 24 hours basis':'Continuity unresolved'}
 ],
 'Phase locations':['open','24h','road','unknown'].map(id=>({'Phase ID':id+'-p','Temporal display rule':'dated_evidence_only_no_continuity_inference'})),
 'Rationale coding':[]
}});
assert.deepEqual(nativeFixture.populationIDs('all','over1'),['open'],'independent native expectation honors true/false/unknown and phase exclusion');
assert.deepEqual(nativeFixture.exactPhases(),[],'independent native threshold check does not manufacture durations');
const root=path.resolve(__dirname,'../dist');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const full=read('data.js'),light=read('map-data.js');
const reference=require('./release-verification-reference.cjs').load();
const fullRows=M.durationRows(full.events),lightRows=M.durationRows(light.events);
const sa025=full.events.find(e=>e.id==='SA025');
assert.equal(sa025.inclusion_status,'Included');
assert.equal(sa025.timing_coverage.operational_complete,false,'admitted rail policy does not give SA025 a completed operational duration');
assert.equal(sa025.timing_coverage.operational_exact_complete,false);
assert.equal(M.durationMatch(sa025,'over1'),true,'SA025 remains eligible through its confirmed rail policy');
assert(!fullRows.some(row=>row.record_id==='SA025'),'neither excluded road nor incomplete rail policy enters exact-duration statistics');
const expectedRows=reference.exactPhases();
const phaseValues=rows=>rows.map(p=>[p.record_id,p.phase_id,p.start,p.end,p.days,[...p.codes].sort()]).sort((a,b)=>a[1].localeCompare(b[1]));
assert.deepEqual(phaseValues(fullRows),phaseValues(expectedRows),'exact sample reconciles to native source dates, inclusion and reopening evidence');
assert.deepEqual(lightRows,fullRows,'opening data yields the exact same eligible phases without loading the archive');
for(const population of ['all','complete','exact'])for(const duration of ['all','over1']){
 const expected=reference.populationIDs(population,duration).sort();
 assert.deepEqual(M.filterRecords(full.events,population,duration).map(e=>e.id).sort(),expected,population+'/'+duration+' population reconciles to native eligibility');
}
assert.deepEqual(phaseValues(M.durationRows(full.events,'over1')),phaseValues(reference.exactPhases(reference.includedIDs,'over1')),'filtered exact sample honors explicit duration findings and phase inclusion');
const expected=new Map(reference.groups(reference.includedIDs,full.meta.rationale_categories).map(group=>[group.code,group]));
for(const g of M.durationGroups(full.events,full.meta.rationale_categories)){
 assert.deepEqual(g,expected.get(g.code),g.code+' statistics reconcile to native tables');
 assert(g.records<=g.total);assert(g.phases>=g.records);
}
assert.equal(Math.min(...fullRows.map(p=>p.days)),Math.min(...expectedRows.map(p=>p.days)));assert.equal(Math.max(...fullRows.map(p=>p.days)),Math.max(...expectedRows.map(p=>p.days)));
assert.deepEqual(M.continents(full.events.filter(e=>!e.quarantined)),M.continents(light.events.filter(e=>!e.quarantined)),'full/light continent denominators agree');
assert(!M.CONTINENTS.includes('Unassigned'));
console.log('Analysis metrics passed: '+fullRows.length+' exact closure phases / '+new Set(fullRows.map(p=>p.record_id)).size+' records reconciled to native tables; observed reopening, UTC arithmetic, no inferred/summed spans, category statistics and full/light equivalence.');
