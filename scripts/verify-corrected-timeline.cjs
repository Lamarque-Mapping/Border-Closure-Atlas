/* Temporal regressions for the 23 October corrected workbook.
 * Tests exercise the meaning of incomplete and disputed evidence, rather than
 * treating the presence of two calendar dates as proof of a continuous closure.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../dist/core.js');
const month=C.monthOrdinal;
const phase=overrides=>({kind:'closed_interval',measure_type:'operational_spell',start_earliest:'2020-01-01',start_latest:'2020-01-01',end_earliest:'2020-04-01',end_latest:'2020-04-01',endpoint_inclusion:'Exclusive',observed_reopening:'Unknown',temporal_display_rule:'scoped_interval_with_endpoint_uncertainty',...overrides});
const state=(p,date)=>C.phaseTemporalState(p,month(date));
const event=p=>({id:'TEST',quarantined:false,duration_periods:Array.isArray(p)?p:[p]});

// A disputed two-year span is not a two-year confirmed restriction.
const held=phase({contested:true,end_earliest:'2022-04-01',end_latest:'2022-04-01',observed_reopening:'Yes'});
assert.equal(state(held,'2020-01'),'held');
assert.equal(state(held,'2022-04'),'held');
assert.equal(state(held,'2021-07'),'none');
assert.equal(C.intervalEligible(event(held)),true,'held dates must remain discoverable');

// Two observations must not silently interpolate the intervening months.
const observations=phase({temporal_display_rule:'dated_evidence_only_no_continuity_inference'});
assert.equal(state(observations,'2020-01'),'observation');
assert.equal(state(observations,'2020-04'),'observation');
assert.equal(state(observations,'2020-02'),'none');
const endpointOnly=phase({start_earliest:null,start_latest:null,end_earliest:'2021-12-17',end_latest:'2021-12-17',observed_reopening:'Yes'});
assert.equal(state(endpointOnly,'2021-12'),'observation');
assert.equal(state(endpointOnly,'2021-11'),'none');
assert.equal(state(endpointOnly,'2022-01'),'none');
const observationOnly=phase({start_earliest:null,start_latest:null,end_earliest:null,end_latest:null,last_confirmed:'2019-03-01',kind:'confirmed_through'});
assert.equal(state(observationOnly,'2019-03'),'observation');
assert.equal(state(observationOnly,'2019-02'),'none');
assert.equal(state(observationOnly,'2019-04'),'none');

// An order's start supplies no calculated expiry or inferred implementation.
const order=phase({kind:'ordered_window',measure_type:'ordered_window',start_earliest:'2020-03-15',start_latest:'2020-03-15',end_earliest:null,end_latest:null,temporal_display_rule:'announced_window_layer_only'});
assert.equal(state(order,'2020-03'),'ordered');
assert.equal(state(order,'2020-04'),'none');
const policy=phase({measure_type:'formal_policy_period',temporal_display_rule:'legal_policy_layer_only_not_operational_closure',end_inclusive:true});
assert.equal(state(policy,'2020-03'),'policy');
assert.equal(state(policy,'2020-04'),'none','explicit Exclusive overrides a legacy inclusion flag');
assert.equal(state({...policy,endpoint_inclusion:'Not recorded'},'2020-04'),'none','unknown inclusion does not add a day');

// A last observation cannot extend a record to today's date. End inclusion is
// an interval-display boundary, not an arithmetic +1 or reopening inference.
const censored=phase({kind:'confirmed_through',last_confirmed:'2020-04-01',end_earliest:null,end_latest:null,endpoint_inclusion:'Inclusive',temporal_display_rule:'censored_interval_stop_at_last_confirmation_unknown_afterward'});
assert.equal(state(censored,'2020-04'),'supported');
assert.equal(state(censored,'2020-05'),'none');
assert.equal(state({...censored,observed_reopening:'No'},'2020-05'),'none');
assert.equal(state({...censored,observed_reopening:'Yes'},'2020-05'),'none');
assert.equal(state({...censored,endpoint_inclusion:'Exclusive'},'2020-04'),'none');

// Intraday and recurring restrictions must not gain a continuous closed state.
const sameDay=phase({kind:'same_day',start_earliest:'2020-05-02',start_latest:'2020-05-02',end_earliest:'2020-05-02',end_latest:'2020-05-02',temporal_display_rule:'day_marker_no_whole_day_duration'});
assert.equal(state(sameDay,'2020-05'),'observation');
assert.equal(state(sameDay,'2020-06'),'none');
const intermittent=phase({kind:'intermittent_regime',measure_type:'intermittent_regime',temporal_display_rule:'intermittent_envelope_no_continuous_closed_state'});
assert.equal(state(intermittent,'2020-02'),'intermittent');
assert.equal(state(intermittent,'2020-04'),'none');
const uncertain=phase({start_earliest:'2020-01-20',start_latest:'2020-03-05',end_earliest:'2020-03-10',end_latest:'2020-05-04'});
assert.equal(state(uncertain,'2020-02'),'possible');
assert.equal(state(uncertain,'2020-03'),'supported');
assert.equal(state(uncertain,'2020-04'),'possible');
assert.equal(state(uncertain,'2020-06'),'none');
assert.deepEqual(C.temporalStates(event([phase(),held,policy,order]),month('2020-03')),['supported','policy','ordered']);
assert.equal(C.temporalState(event(phase()),null),'none');
assert.equal(C.day('2021-02-29'),null);

// Current inclusion overrides an explicitly historical quarantine assessment.
assert.equal(C.excluded({quarantined:false,evidence_status:'Historical quarantine recommendation'}),false);
assert.equal(C.excluded({quarantined:true}),true);
const dataset={events:[event(held),{...event(held),id:'EXCLUDED',quarantined:true}]};
assert.deepEqual(C.filterEvents(dataset,{mode:'intervals',month:month('2020-01')}).map(e=>e.id),['TEST']);
assert.equal(C.filterEvents(dataset,{mode:'intervals',month:month('2021-01')}).length,0);
assert.equal(C.filterEvents(dataset,{mode:'all',includeExcluded:true}).length,2);
console.log('Temporal rules passed: held and observation dates; unknown bounds; policy/order distinction; intermittent restrictions; endpoint inclusion; no inferred continuity or reopening.');

if(!process.argv.includes('--synthetic-only')){
 const raw=fs.readFileSync(path.resolve(__dirname,'../dist/data.js'),'utf8');
 const data=JSON.parse(raw.replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
 const get=id=>{const found=data.events.find(e=>e.id===id);assert(found,'Missing corrected record '+id);return found;};
 const rwanda=get('GL01');
 assert.equal(rwanda.duration_periods.filter(p=>/^GL01-C7RWP/.test(p.period_id)).length,6,'all six corrected passenger phases must be imported');
 for(const [date,expected] of [['2019-02','held'],['2019-03','observation'],['2019-04','none'],['2019-06','observation'],['2019-07','none'],['2020-01','observation'],['2020-02','none'],['2022-01','observation'],['2022-02','none'],['2022-03','observation'],['2022-04','none']]){
  assert.equal(C.temporalState(rwanda,month(date)),expected,'Rwanda '+date);
 }
 assert.deepEqual(C.temporalStates(rwanda,month('2019-06')),['observation','held'],'passenger evidence and held freight dates remain distinct');
 assert(C.filterEvents(data,{query:'Rwanda',mode:'intervals',month:month('2019-03')}).some(e=>e.id==='GL01'),'Rwanda search must find the corrected March 2019 passenger evidence');
 const allHeld=get('CC014');
 assert.equal(C.temporalState(allHeld,month('2020-03')),'held');
 assert.equal(C.temporalState(allHeld,month('2021-03')),'none');
 assert.equal(C.temporalState(allHeld,month('2022-06')),'held');
 const ecuador=get('AM018');
 assert.equal(C.temporalState(ecuador,month('2020-03'),'ordered_window'),'ordered');
 assert.equal(C.temporalState(ecuador,month('2020-04'),'ordered_window'),'none');
 assert.equal(C.temporalState(ecuador,month('2021-12'),'operational_spell'),'observation');
 assert.equal(C.temporalState(ecuador,month('2021-11'),'operational_spell'),'none');
 assert.equal(C.temporalState(get('CC027'),month('2018-03')),'policy','endpoint-only legal transition is searchable on its date');
 assert.equal(C.temporalState(get('CC027'),month('2018-02')),'none');
 assert.equal(C.temporalState(get('SC13'),month('2020-11')),'policy');
 assert.equal(C.temporalState(get('SC13'),month('2020-12')),'none','1 December exclusive endpoint is not a December closure');
 for(const e of data.events.filter(e=>!C.excluded(e))){
  for(const p of e.duration_periods.filter(p=>p.contested)){
   const recordedMonths=new Set([...(p.evidence_dates||[]),p.start_earliest,p.start_latest,p.end_earliest,p.end_latest,p.last_confirmed].filter(Boolean).map(month));
   for(let m=month(data.meta.window_start);m<=month(data.meta.window_end);m++)assert.equal(C.phaseTemporalState(p,m),recordedMonths.has(m)?'held':'none',p.period_id+' '+C.monthISO(m));
  }
 }
 console.log('Corrected workbook regressions passed: Rwanda passenger dates, all-held records, Ecuador ordered onsets and endpoint-only evidence, and every included held phase.');
}
