const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const M=require('./analysis-metrics.js');
const phase={period_id:'p1',measure_type:'operational_spell',kind:'closed_interval',contested:false,
 exact_complete_operational:true,observed_reopening:'Yes',start_earliest:'2020-02-28',start_latest:'2020-02-28',
 end_earliest:'2020-03-01',end_latest:'2020-03-01',endpoint_inclusion:'Exclusive',minimum_days:2,maximum_days:2};
assert.equal(M.exactDays(phase),2,'UTC date differences include leap days');
assert.equal(M.exactDays({...phase,endpoint_inclusion:'Inclusive'}),2,'inclusive endpoints never silently add a day');
for(const change of [
 {observed_reopening:'Unknown'},{observed_reopening:'No'},{contested:true},{exact_complete_operational:false},
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
const root=path.resolve(__dirname,'../dist');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const full=read('data.js'),light=read('map-data.js');
const reference=require('./release-verification-reference.cjs').load();
const fullRows=M.durationRows(full.events),lightRows=M.durationRows(light.events);
const expectedRows=reference.exactPhases();
const phaseValues=rows=>rows.map(p=>[p.record_id,p.phase_id,p.start,p.end,p.days,[...p.codes].sort()]).sort((a,b)=>a[1].localeCompare(b[1]));
assert.deepEqual(phaseValues(fullRows),phaseValues(expectedRows),'exact sample reconciles to native source dates, inclusion and reopening evidence');
assert.deepEqual(lightRows,fullRows,'opening data yields the exact same eligible phases without loading the archive');
const expected=new Map(reference.groups(reference.includedIDs,full.meta.rationale_categories).map(group=>[group.code,group]));
for(const g of M.durationGroups(full.events,full.meta.rationale_categories)){
 assert.deepEqual(g,expected.get(g.code),g.code+' statistics reconcile to native tables');
 assert(g.records<=g.total);assert(g.phases>=g.records);
}
assert.equal(Math.min(...fullRows.map(p=>p.days)),Math.min(...expectedRows.map(p=>p.days)));assert.equal(Math.max(...fullRows.map(p=>p.days)),Math.max(...expectedRows.map(p=>p.days)));
assert.deepEqual(M.continents(full.events.filter(e=>!e.quarantined)),M.continents(light.events.filter(e=>!e.quarantined)),'full/light continent denominators agree');
assert(!M.CONTINENTS.includes('Unassigned'));
console.log('Analysis metrics passed: '+fullRows.length+' exact closure phases / '+new Set(fullRows.map(p=>p.record_id)).size+' records reconciled to native tables; observed reopening, UTC arithmetic, no inferred/summed spans, category statistics and full/light equivalence.');
