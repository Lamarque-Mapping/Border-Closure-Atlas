'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../dist/core.js'),D=require('../dist/duration.js');
const phase=(id,start,end,days)=>({period_id:id,kind:'closed_interval',measure_type:'operational_spell',complete_operational:true,start_earliest:start,start_latest:start,end_earliest:end,end_latest:end,minimum_days:days,maximum_days:days,temporal_display_rule:'scoped_interval_with_endpoint_uncertainty'});
const long=phase('long','2020-01-01','2020-01-11',10),short=phase('short','2020-02-01','2020-02-02',1);
const event={id:'mixed',duration_periods:[long,short],phase_onsets:[{phase_id:'long',month:'2020-01'},{phase_id:'short',month:'2020-02'}]};
const feature=id=>({type:'Feature',properties:{location_id:id},geometry:{type:'Point',coordinates:[0,0]}});
const data={events:[event],locations:{features:[feature('long-site'),feature('short-site')]},crossing_map:{phases:{long:{record_id:'mixed',phase_id:'long',site_ids:['long-site']},short:{record_id:'mixed',phase_id:'short',site_ids:['short-site']}},undated:{}}};
const state={duration:'over1',mode:'intervals',month:C.monthOrdinal('2020-02')};
assert.equal(C.filterEvents(data,state).length,0,'a long January phase cannot qualify a one-day February phase');
assert.equal(C.filterEvents(data,{...state,duration:'all'}).length,1);
assert.equal(C.filterEvents(data,{...state,mode:'onsets'}).length,0,'short phase onsets remain excluded');
assert.deepEqual(C.mapLocationsFor(event,data,{...state,mode:'all'}),['long-site'],'short-phase geometry cannot leak into the map');
const unresolved={map_status:true,status:'unresolved',source_phase_id:'long',period_id:'later',last_confirmed:'2020-01-11',end_latest:'2026-10-25'};
const later={...event,map_status_periods:[unresolved]};data.events=[later];state.month=C.monthOrdinal('2026-10');
const visible=C.filterEvents(data,state);assert.equal(visible.length,1);
const scoped=C.recordsForLocation(visible,'long-site',data,state)[0];
assert.equal(C.periodsForView(scoped,state)[0].status,'unresolved','popup retains the qualified historical bound without calling its unknown later age a duration');
assert(!D.qualifies({...unresolved,source_phase_id:'short'},event));
const policy={...long,measure_type:'formal_policy_period',complete_operational:false,temporal_display_rule:'legal_policy_layer_only_not_operational_closure'};
assert(D.qualifies(policy));assert(!D.qualifies({...policy,minimum_days:null}));assert(!D.qualifies({...policy,temporal_display_rule:'dated_evidence_only_no_continuity_inference'}));
const readGlobal=(name,key)=>{const context={window:{}};vm.runInNewContext(fs.readFileSync('dist/'+name,'utf8'),context);return context.window[key];};
const statuses=require('../dist/status.js').compile(readGlobal('status-data.js','ATLAS_STATUS_REVIEW'));
const statusData={events:statuses};
const ids=month=>C.filterEvents(statusData,{duration:'over1',mode:'intervals',month:C.monthOrdinal(month)}).map(e=>e.id);
assert(ids('2022-03').includes('STATUS-RUS-UKR-202610'));assert(!ids('2022-01').includes('STATUS-RUS-UKR-202610'));
for(const id of ['STATUS-RUS-UKR-202610','STATUS-KOR-PRK-202610','STATUS-RAFAH-202610'])assert(ids('2026-10').includes(id));
assert(!ids('2026-10').includes('STATUS-AUDIT-REC50-R08-004-20261025'),'repeated overnight closures are not a continuous >24h restriction');
const narva=C.filterEvents(statusData,{duration:'over1',mode:'intervals',month:C.monthOrdinal('2026-10')}).find(e=>e.id==='STATUS-AUDIT-REC50-R08-002-20261025');
assert.equal(narva.map_status_periods.length,1);assert(narva.map_status_periods[0].scope.startsWith('All road vehicles'));
const national=require('../dist/national.js').compile(readGlobal('national-data.js','ATLAS_NATIONAL_DATA'));
const nationalShown=C.filterEvents({events:national},{duration:'over1',mode:'intervals',month:C.monthOrdinal('2020-04')});
for(const code of ['AUS','NZL'])assert(nationalShown.some(e=>e.national_map_country===code),'broad entry ban retained for '+code);
console.log('Map duration passed: phase-specific time and geography, strict >24h, unknown endings, Ukraine chronology, Korea/Rafah, overnight exclusions, Australia/NZ entry bans.');

// Exercise the production lazy loader and popup renderer with delayed requests.
(async()=>{
 const app=fs.readFileSync('dist/app.js','utf8');
 const segment=app.slice(app.indexOf('  function openLocationCard('),app.indexOf('  function nearestPoint('));
 const requests=[],cards=[],popups=[],pending=new Map(),scroller={scrollTop:125};
 const element=()=>({innerHTML:'',className:'',children:[],setAttribute(){},append(child){this.children.push(child)},remove(){this.removed=true},addEventListener(){},querySelectorAll(selector){
  if(selector!=='[data-location-record-id]')return [];
  const owner=this;return [...this.innerHTML.matchAll(/<article data-location-record-id="([^"]+)">.*?<\/article>/g)].map(match=>({dataset:{locationRecordId:match[1]},set outerHTML(html){owner.innerHTML=owner.innerHTML.replace(match[0],html)}}));
 },querySelector(){return null}});
 const ctx={console,Promise,Map,Math,document:{createElement(){const el=element();cards.push(el);return el;}},data:{meta:{web_assets:true}},state:{},locations:new Map([['site',feature('site')]]),K:{symbolStyle:()=>({})},compact:()=>true,locationRecords:items=>items,
 C:{recordsForLocation:items=>items},locationRecordHTML:e=>'<article data-location-record-id="'+e.id+'">'+e.title+'</article>',locationTitle:()=> 'Shared crossing',escape:String,
 stop(){},renderLocations(){},setPanelOpen(){},viewPadding:()=>({paddingTopLeft:[0,10],paddingBottomRight:[0,120]}),$:()=>({getBoundingClientRect:()=>({height:600})}),
 map:{closePopup(){},hasLayer:()=>true},window:{innerWidth:390,AtlasData:{getRecord(id){requests.push(id);return new Promise(resolve=>pending.set(id,resolve));}}},
 L:{point:(x,y)=>[x,y],popup(options){const p={options,on(){return p},setLatLng(){return p},setContent(content){p.content=content;return p},openOn(){return p},getElement:()=>({querySelector:()=>scroller}),update(){scroller.scrollTop=0;}};popups.push(p);return p;}}};
 vm.createContext(ctx);vm.runInContext(segment,ctx);
 ctx.openLocationCard('site',[{id:'a',title:'Summary a'},{id:'b',title:'Summary b'},{id:'c',title:'Summary c'}],[0,0]);
 const popup=popups.at(-1),card=popup.content;
 assert.equal((card.innerHTML.match(/<article /g)||[]).length,3,'all summaries render synchronously before any fetch completes');
 assert.deepEqual(requests,['a','b','c']);assert(card.innerHTML.includes('Summary a'));
 assert(card.innerHTML.includes('3 matching records · scroll to read'));assert(!card.innerHTML.includes('View all'));
 pending.get('b')({id:'b',title:'Complete b'});await new Promise(resolve=>setImmediate(resolve));
 assert(card.innerHTML.includes('Complete b'));assert(card.innerHTML.includes('Summary a'),'one slow record cannot delay another');assert.equal(scroller.scrollTop,125,'detail hydration preserves reading position');
 for(const id of ['a','c'])pending.get(id)({id,title:'Complete '+id});
 await new Promise(resolve=>setImmediate(resolve));
 for(const id of ['a','b','c'])assert(card.innerHTML.includes('Complete '+id));
 assert(card.children.find(el=>el.className==='location-details-status').removed);
 assert(popup.options.maxHeight>0&&popup.options.maxHeight<=412,'bounded popup height enables the existing scroll container');
 console.log('Grouped popup passed: instant summaries, progressive detail loading without scroll jumps, every matching record in one scrolling panel.');
})().catch(error=>{console.error(error);process.exitCode=1;});
