'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),M=require('./analysis-metrics.js');
const date=n=>new Date(Date.UTC(2020,0,1+n)).toISOString().slice(0,10);
const phase=(id,days)=>({period_id:id,measure_type:'operational_spell',kind:'closed_interval',contested:false,
 complete_operational:true,exact_complete_operational:true,observed_reopening:'Yes',endpoint_status:'observed',
 start_earliest:date(0),start_latest:date(0),end_earliest:date(days),end_latest:date(days),
 minimum_days:days,maximum_days:days,temporal_display_rule:'scoped_interval_with_endpoint_uncertainty'});
const record=(id,periods,coverage={operational_complete:true,operational_exact_complete:true})=>({
 id,title:id,inclusion_status:'Included',rationales:['A'],duration_periods:periods,timing_coverage:coverage});
const short=phase('one-day',1),long=phase('two-days',2);
assert.equal(M.durationMatch(record('one',[short]),'over1'),false,'one day is excluded; the test is >1, not >=1');
assert.equal(M.durationMatch(record('two',[long]),'over1'),true);
assert.equal(M.durationMatch(record('inclusive',[{...short,end_inclusive:true}]),'over1'),false,'inclusive endpoints never add a day');
const bounded={...long,period_id:'bounded',kind:'bounded_interval',exact_complete_operational:false,
 start_latest:date(2),end_earliest:date(5),end_latest:date(8),minimum_days:3,maximum_days:8};
assert.equal(M.operationalMinimumDays(bounded),3);
assert(M.durationMatch(record('bounded',[bounded]),'over1'),'a lower bound above one qualifies without pretending the length is exact');
assert(!M.durationMatch(record('straddling',[{...bounded,start_latest:date(4),minimum_days:1}]),'over1'),'a range spanning the cutoff is not assigned its midpoint or upper bound');
const censored={...long,period_id:'censored',kind:'confirmed_through',complete_operational:false,exact_complete_operational:false,
 observed_reopening:'No',endpoint_status:'last_confirmed',end_earliest:date(6),end_latest:date(6),last_confirmed:date(6),
 minimum_days:6,maximum_days:null,temporal_display_rule:'censored_interval_stop_at_last_confirmation_unknown_afterward'};
assert.equal(M.operationalMinimumDays(censored),6);
assert(M.durationMatch(record('censored',[censored]),'over1'));
assert.equal(M.durationRows([record('censored',[censored])],'over1').length,0,'a lower bound is not an exact reopened duration');
for(const change of [
 {contested:true},{measure_type:'formal_policy_period'},{measure_type:'ordered_window'},{measure_type:'intermittent_regime'},
 {complete_operational:false},{kind:'same_day'},{minimum_days:null},{minimum_days:3},{maximum_days:3},
 {start_latest:null},{end_earliest:null},{start_latest:'2020-02-30'},
 {temporal_display_rule:'dated_evidence_only_no_continuity_inference'},
 {temporal_display_rule:'held_evidence_do_not_animate_as_confirmed'},
 {temporal_display_rule:'intermittent_envelope_no_continuous_closed_state'}
])assert.equal(M.operationalMinimumDays({...long,...change}),null,JSON.stringify(change));
for(const change of [{last_confirmed:null},{last_confirmed:date(7)},{maximum_days:6},{endpoint_status:'observed'}])
 assert.equal(M.operationalMinimumDays({...censored,...change}),null,'invalid censored interval: '+JSON.stringify(change));
const mixed=record('mixed',[short,long]),boundedOnly=record('estimated',[bounded],{operational_complete:true,operational_exact_complete:false});
const mixedCensored=record('mixed-censored',[short,censored]);
const fixtures=[mixed,boundedOnly,mixedCensored,record('only-short',[short]),
 {...mixed,id:'excluded',inclusion_status:'Excluded'},{...mixed,id:'quarantined',quarantined:true}];
assert.deepEqual(M.filterRecords(fixtures,'all','over1').map(e=>e.id),['mixed','estimated','mixed-censored']);
assert.deepEqual(M.durationRows(M.filterRecords(fixtures,'all','over1'),'over1').map(p=>p.phase_id),['two-days'],'a qualifying long phase must not pull another short phase into the plot');
assert.equal(M.durationGroups(M.filterRecords(fixtures,'all','over1'),['A'],'over1')[0].total,3);
assert.equal(M.durationGroups(M.filterRecords(fixtures,'all','over1'),['A'],'over1')[0].records,1);

const read=name=>JSON.parse(fs.readFileSync(path.join(root,'dist',name),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const full=read('data.js'),light=read('map-data.js'),data=read('analysis-data.json');
const counts={all:[697,250],complete:[252,215],exact:[163,144]};
for(const population of Object.keys(counts))for(const duration of ['all','over1']){
 const selected=M.filterRecords(data.events,population,duration),expected=counts[population][duration==='over1'?1:0];
 assert.equal(selected.length,expected,population+' / '+duration+' parent population');
 const phases=M.durationRows(selected,duration);
 assert.equal(phases.length,duration==='over1'?142:164);
 assert.equal(new Set(phases.map(p=>p.record_id)).size,duration==='over1'?140:160);
 if(duration==='over1')assert(phases.every(p=>p.days>1));
 for(const source of [full,light]){
  const other=M.filterRecords(source.events,population,duration);
  assert.deepEqual(other.map(e=>e.id),selected.map(e=>e.id),'full/map/analysis parent selections agree');
  assert.deepEqual(M.durationRows(other,duration),phases,'full/map/analysis duration selections agree');
 }
 for(const group of M.durationGroups(selected,data.meta.rationale_categories,duration)){
  assert.equal(group.total,selected.filter(e=>e.rationales.includes(group.code)).length,'coverage denominator equals rationale count');
  assert.equal(group.records,new Set(phases.filter(p=>p.codes.includes(group.code)).map(p=>p.record_id)).size);
  assert.equal(group.phases,phases.filter(p=>p.codes.includes(group.code)).length);
  assert(group.records<=group.total);
 }
}
const selected=M.filterRecords(data.events,'all','over1'),selectedIDs=new Set(selected.map(e=>e.id));
for(const id of ['AM010','CC004','CC028','GL14','ME034','NP-COV-EUR-006'])assert(selectedIDs.has(id),id+' has a supported long operational interval');
for(const id of ['CC022','H14','EA030'])assert(!selectedIDs.has(id),id+' has only a one-day or threshold-uncertain interval');
const plotted=M.durationRows(selected,'over1');
for(const id of ['GL14-R1','ME034-R1','NP-COV-EUR-006-P02'])assert(!plotted.some(p=>p.phase_id===id),'real short phase cannot leak: '+id);
const expectedMedians={Security:9,'Health and biosecurity':141,'Trade and protectionism':3,Migration:26,'Electoral politics':3,'Interstate disputes and pressure':22,'Power and regime politics':16,'Policy and socioeconomic demands':2,'Administration and service operation':null,'Environment and resource management':null};
for(const group of M.durationGroups(selected,data.meta.rationale_categories,'over1'))assert.equal(group.median,expectedMedians[group.code]);

// Execute the real chart, Dataset drill-through and export handlers with a small
// DOM surface, so both selectors and every chart population share the same gate.
const ui=fs.readFileSync(path.join(__dirname,'analysis-ui.js'),'utf8'),template=fs.readFileSync(path.join(__dirname,'analysis-template.html'),'utf8');
const nodes=new Map();
function node(id){
 if(!nodes.has(id))nodes.set(id,{id,value:'',innerHTML:'',textContent:'',hidden:false,events:{},scrollIntoView(){},
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);},emit(type){return Promise.all((this.events[type]||[]).map(fn=>fn()));}});
 return nodes.get(id);
}
for(const id of ['chartPopulation','chartDuration','durationFilter'])node(id).value='all';
node('sortRecords').value='id';
node('filters').reset=()=>{for(const id of ['query','continentFilter','regionFilter','codeFilter','statusFilter','auditFilter'])node(id).value='';node('durationFilter').value='all';};
const events=data.events.map(e=>({...e,codes:e.rationales,searchText:(e.search_text||'').toLowerCase()}));
const downloads=[];
const context={$:node,METRICS:M,EVENTS:events,INCLUDED:events.filter(e=>!e.quarantined),CODES:data.meta.rationale_categories,
 DATA:{meta:data.meta},AUDIT_BY_ID:new Map(),currentCharts:{},filtered:[],page:0,PAGE_SIZE:12,
 pct:(n,d)=>d?(100*n/d).toFixed(1)+'%':'0.0%',escapeHTML:String,norm:value=>String(value).toLowerCase(),
 frequencies:(list,key)=>list.reduce((out,e)=>(out[key(e)]=(out[key(e)]||0)+1,out),{}),
 populationMatch:(e,value)=>value==='complete'?e.timing_coverage.operational_complete:value==='exact'?e.timing_coverage.operational_exact_complete:true,
 openDataset(){},withResearch:(id,action)=>action(full),
 exportRecordRows:(source,rows,filename)=>downloads.push({filename,recordIDs:rows.map(e=>e.id)}),
 downloadCSV:(filename,rows)=>downloads.push({filename,rows})};
vm.createContext(context);
const start=ui.indexOf('const durationExplanation='),end=ui.indexOf('function field(');
assert(start>=0&&end>start);vm.runInContext(ui.slice(start,end),context);
const exportStart=ui.indexOf('$("exportRows").addEventListener'),exportEnd=ui.indexOf('$("exportSnapshot").addEventListener');
assert(exportStart>=0&&exportEnd>exportStart);vm.runInContext(ui.slice(exportStart,exportEnd),context);
const csvActions=['exportCodes','exportRegions','exportContinents','exportDuration','exportDurationCoverage'];
for(const population of Object.keys(counts))for(const duration of ['all','over1']){
 node('chartPopulation').value=population;node('chartDuration').value=duration;
 context.renderCharts();
 const expectedRecords=M.filterRecords(events,population,duration),expectedCount=counts[population][duration==='over1'?1:0];
 assert.equal(context.currentCharts.codes[0][2],expectedCount);
 assert.equal(node('chartDurationNote').hidden,duration!=='over1');
 assert.equal(node('chartPopulationNote').textContent.includes('more than 1 day'),duration==='over1');
 if(duration==='over1'){
  assert(node('chartDurationNote').textContent.includes('date differences, not hour-by-hour measurements'));
  assert(node('chartDurationNote').textContent.includes('at least one documented closure period'));
  assert(node('chartDurationNote').textContent.includes('last confirmed date, without implying a reopening or later duration'));
 }
 for(const row of context.currentCharts.codes){
  const expected=expectedRecords.filter(e=>row[0]==='No code assigned'?!e.codes.length:e.codes.includes(row[0])).length;
  assert.equal(row[1],expected);assert.equal(row[2],expectedCount);
 }
 assert.equal(context.currentCharts.regions.reduce((n,row)=>n+row[1],0),expectedCount);
 for(const row of context.currentCharts.continents)assert.equal(row[1],expectedRecords.filter(e=>e.continents.includes(row[0])).length);
 for(const group of context.currentCharts.durationGroups)assert.equal(group.total,context.currentCharts.codes.find(row=>row[0]===group.code)[1]);
 assert(context.currentCharts.durationRows.every(p=>duration==='all'||p.days>1));
 for(const [kind,value] of [['code','Security'],['region','Americas'],['continent','Asia']]){
  context.filterFromChart(kind,value);
  assert.equal(node('durationFilter').value,duration,'drill-through preserves duration threshold');
  const expected=expectedRecords.filter(e=>kind==='code'?e.codes.includes(value):kind==='region'?e.region===value:e.continents.includes(value));
  assert.deepEqual(Array.from(context.filtered,e=>e.id).sort(),expected.map(e=>e.id).sort(),population+' / '+duration+' / '+kind+' drill-through');
 }
 for(const id of csvActions){
  node(id).emit('click');
  const download=downloads.at(-1);
  assert.equal(download.filename.includes('-over-1-day.csv'),duration==='over1',id+' identifies active filter');
  if(id==='exportCodes')assert.equal(download.filename,duration==='over1'?'rationale-counts-over-1-day.csv':'rationale-counts.csv');
  const header=download.rows[0],populationColumn=header.indexOf('Population');
  assert(populationColumn>=0);
  assert(download.rows.slice(1).every(row=>String(row[populationColumn]).includes('>1 day')===(duration==='over1')));
  if(duration==='over1')assert(download.rows.slice(1).every(row=>String(row[populationColumn]).includes('minimum date difference >1 day in at least one operational phase')));
  if(id==='exportDuration'){
   assert.equal(download.rows.length,duration==='over1'?143:165);
   assert(download.rows.slice(1).every(row=>duration==='all'||row[6]>1),'phase CSV applies the same phase cutoff');
  }
 }
}
node('chartPopulation').value='all';node('chartDuration').value='over1';context.renderCharts();context.filterFromChart('code','Security');
node('exportRows').emit('click');
assert.equal(downloads.at(-1).recordIDs.length,121);assert(downloads.at(-1).filename.endsWith('-over-1-day.csv'));
node('exportAllRows').emit('click');
assert.equal(downloads.at(-1).recordIDs.length,697,'full included-record export remains full while charts/Dataset are filtered');
assert.equal(downloads.at(-1).filename,'border-closures-included-records.csv');
assert(template.includes('All {{INCLUDED}} included records; unaffected by filters'));
node('filters').reset();context.renderRecords();assert.equal(context.filtered.length,697,'reset restores unfiltered Dataset');
node('chartDuration').value='all';context.renderCharts();assert.equal(context.currentCharts.durationRows.length,164,'Any duration restores the original exact distribution');
assert(ui.includes('$("chartDuration").addEventListener("change",renderCharts)'));
for(const id of ['chartDuration','durationFilter'])assert(template.includes('id="'+id+'" aria-describedby='));
console.log('Analysis duration filter passed: all697→250 / complete252→215 / exact163→144; exact phases164→142 (160→140 parents); conservative bounds, explicit censoring, no short-phase leakage, all chart denominators, Dataset drill-through, filtered CSV metadata, and full697-record export preserved.');
