/* A neutral route into dated history must never become an active-closure claim. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),C=require(path.join(root,'dist/core.js'));
const H=require(path.join(root,'dist/border-history.js')),X=require(path.join(root,'dist/crossing-geography.js'));
const reference=require('./release-verification-reference.cjs').load();
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
for(const key of ['countries','borders','disputed','locations','context_locations'])for(const feature of data[key].features)feature.geometry=data.geometry_pool[feature.geometry];
delete data.geometry_pool;X.attach(data);
const before=JSON.stringify(data.events),state={mode:'intervals',month:C.monthOrdinal('2026-10')};
const originalActive=C.filterEvents(data,state).map(record=>record.id);
const index=H.buildIndex(data,C);
assert.equal(index.boundaries.length,295,'all existing bilateral reference features are available, including empty lookups');
const ukraine=H.lookup(index,'context-frontier-rus-ukr',state);
assert(ukraine.records.some(item=>item.record.id==='EU031'),'an unmapped named-crossing record remains discoverable from its explicit border reference');
const ukrainePolicy=reference.phasesByRecord.get('EU031').find(phase=>phase['Phase ID']==='EU031-R1');
assert.equal(ukrainePolicy['Start earliest'],'2022-02-28','the continuing policy retains its documented onset');
assert.equal(ukrainePolicy['Last confirmed (not reopening)'],'2026-10-26','current status is a later confirmation, not a new onset');
assert.equal(ukrainePolicy['Evidence category'],'formal_policy_period');
assert.equal(ukraine.records.find(item=>item.record.id==='EU031').datedThisMonth,true,'the audited policy is documented through the selected month');
assert.equal(ukraine.datedRecordCount,1,'the border lookup counts the sourced policy record once');
assert.deepEqual(ukraine.records.find(item=>item.record.id==='EU031').temporalStates,['policy'],'current policy is not relabelled as observed operational closure');
const ukraineEvent=data.events.find(record=>record.id==='EU031');
assert.deepEqual(C.mapLocationsFor(ukraineEvent,data,{mode:'all'}),['context-frontier-rus-ukr','context-frontier-blr-ukr','context-frontier-mda-ukr'],'separately reviewed border associations are displayed');
assert.equal(C.mappingStatus(ukraineEvent,data,{mode:'all'}).referenceOnly,true,'history lookup does not promote a dotted border reference to an approved closure footprint');
assert.equal(H.lookup(index,'context-frontier-rus-ukr',{...state,month:C.monthOrdinal('2023-09')}).records.find(item=>item.record.id==='EU031').temporalStates[0],'policy','dated formal policy remains distinct from an observed closure');
const history=H.priorCrossings(data,C,state,[]),rafah=history.find(entry=>entry.locationId==='post-rafah');
assert(rafah,'an approved Rafah location remains available for earlier records');
const recentRafah=rafah.records.find(item=>item.record.id==='NA016');
assert(recentRafah&&recentRafah.phases.every(phase=>phase.observed_reopening==='Yes'),'a scoped reopening remains a reopening in historical details');
assert.equal(recentRafah.latestEvidenceDate,'2026-03-19');
assert.equal(C.temporalState(recentRafah.record,state.month),'none','Rafah history is not counted as continuing restriction');
assert(!('ongoing' in rafah)&&!('status' in rafah),'the history reference makes no present-status classification');
assert(!H.priorCrossings(data,C,state,new Set(['post-rafah'])).some(entry=>entry.locationId==='post-rafah'),'a current marker suppresses the neutral history point');
assert.equal(H.priorCrossings(data,C,{...state,query:'no-record-can-match-this-phrase'},[]).length,0,'non-temporal search filters apply');
assert.equal(H.priorCrossings(data,C,{...state,mode:'onsets'},[]).length,0,'history does not alter the recorded-start view');
assert.deepEqual(C.filterEvents(data,state).map(record=>record.id),originalActive,'history does not alter active counts or selection');
assert.equal(JSON.stringify(data.events),before,'source records and phases are never mutated');

const point=id=>({type:'Feature',properties:{location_id:id,label:id},geometry:{type:'Point',coordinates:[0,0]}});
const border=(id,codes)=>({type:'Feature',properties:{location_id:id,label:id,display_role:'frontier_context',country_codes:codes},geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}});
const phase=(id,start,end)=>({period_id:id,kind:'closed_interval',measure_type:'operational_spell',start_earliest:start,start_latest:start,end_earliest:end,end_latest:end,observed_reopening:'Yes',endpoint_status:'observed',endpoint_inclusion:'Exclusive',temporal_display_rule:'scoped_interval_with_endpoint_uncertainty'});
const mixed={id:'MIXED',countries:['Alpha','Beta','Gamma'],location_ids:['border-ac'],rationales:['Security'],duration_periods:[phase('past','2020-01-01','2020-01-10'),phase('future','2030-01-01','2030-01-10')]};
const fixture={events:[mixed],links:[],crossing_contexts:[],locations:{type:'FeatureCollection',features:[point('past-site'),point('future-site'),border('border-ab',['AAA','BBB']),border('border-ac',['AAA','CCC'])]},context_locations:{type:'FeatureCollection',features:[]},crossing_map:{phases:{past:{record_id:'MIXED',category:'single_site',site_ids:['past-site']},future:{record_id:'MIXED',category:'single_site',site_ids:['future-site']}},undated:{}}};
const mixedHistory=H.priorCrossings(fixture,C,state,[]);
assert.deepEqual(mixedHistory.map(entry=>entry.locationId),['past-site'],'a future phase in a mixed parent cannot leak its site into earlier history');
assert.deepEqual(mixedHistory[0].records[0].phases.map(item=>item.period_id),['past']);
assert.equal(mixedHistory[0].latestEvidenceDate,'2020-01-10','future evidence is not described as the latest evidence before the selected month');
assert.equal(H.priorCrossings(fixture,C,{...state,month:C.monthOrdinal('2019-12')},[]).length,0,'no history appears before the first evidence');
assert.equal(H.priorCrossings(fixture,C,{...state,rationale:'Migration'},[]).length,0,'rationale filters apply');
assert.equal(H.priorCrossings(fixture,C,{...state,measureType:'formal_policy_period'},[]).length,0,'measure-type filters apply to each historical phase');
assert.equal(H.priorCrossings(fixture,C,{...state,location:'future-site'},[]).length,0,'a future-site filter cannot expose a different historical site');
const fixtureIndex=H.buildIndex(fixture,C);
assert.equal(H.lookup(fixtureIndex,'border-ab',state).recordCount,0,'many-country membership never invents an unassigned bilateral association');
assert.equal(H.lookup(fixtureIndex,'border-ac',state).recordCount,1,'the explicitly assigned reference remains discoverable');
assert.equal(H.lookup(fixtureIndex,'border-ac',state).latestEvidenceOnOrBeforeMonth,'2020-01-10');
assert.equal(H.lookup(fixtureIndex,'border-ac',state).datedRecordCount,0,'a historical lookup cannot invent dated activity between a past and future phase');
assert.equal(H.lookup(fixtureIndex,'border-ac',state).records[0].datedThisMonth,false,'historical discoverability does not assert current closure');
fixture.events.push({...mixed,id:'EXCLUDED',quarantined:true},{...mixed,id:'NATIONAL',record_kind:'national_policy'});
assert.deepEqual(H.lookup(H.buildIndex(fixture,C),'border-ac',state).records.map(item=>item.record.id),['MIXED'],'excluded and national-supplement records do not enter the core border history directory');
assert.equal(H.priorCrossings(fixture,C,state,[])[0].recordCount,1);

// At world zoom, invisible 44px targets overlap. Exercise the actual app routing:
// whichever marker receives the browser event, the nearest visible point wins.
// Keyboard activation instead retains its explicitly focused marker.
const app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');

// The optional reference layer starts off and must stay separate from dated
// records in the live renderer and the saved view. Exercise production state,
// control wiring and rendering functions rather than restating their gate.
const stateDeclaration=app.match(/const state=(\{[^\n]+\});/);
assert(stateDeclaration,'the production default map state is available');
const defaultState=vm.runInNewContext('('+stateDeclaration[1]+')',{window:{}});
assert.equal(defaultState.showHistory,false,'earlier crossing history is off by default');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const historyInput=html.match(/<input\b[^>]*\bid="show-history"[^>]*>/);
assert(historyInput&&!/\schecked(?:\s|=|>)/.test(historyInput[0]),'the initial history checkbox is unchecked');
function productionFunction(name,nextName){
  const start=app.indexOf('  function '+name+'('),end=app.indexOf('  function '+nextName+'(',start);
  assert(start>=0&&end>start,'production function is available: '+name);
  return app.slice(start,end);
}
const controls=new Map(),historyKeys=[{hidden:false},{hidden:false}],liveHistoryLayers=new Set();
function control(id){
  if(!controls.has(id))controls.set(id,{hidden:false,disabled:false,checked:false,value:'',textContent:'',
    min:C.monthOrdinal(data.meta.window_start),max:C.monthOrdinal(data.meta.window_end),
    style:{setProperty(){}},setAttribute(){},listeners:{},addEventListener(name,callback){this.listeners[name]=callback;}});
  return controls.get(id);
}
const viewMap={
  closePopup(){},removeLayer(layer){liveHistoryLayers.delete(layer);},
  getSize:()=>({x:1000,y:650}),getZoom:()=>2,getPixelBounds:()=>({min:{x:0,y:0}}),
  containerPointToLatLng:([x,y])=>({lng:x*.36-180,lat:80-y*.16}),
  distance:(a,b)=>Math.abs(b.lng-a.lng)*111320
};
const viewContext={
  data,C,state:{...defaultState},map:viewMap,visible:[],locationEvents:new Map(),historyLocations:[],historyLayer:null,selected:null,
  locations:new Map(C.locationFeatures(data).map(feature=>[feature.properties.location_id,feature])),
  window:{BorderHistory:H},$:control,document:{querySelectorAll(selector){assert.equal(selector,'[data-history-key]');return historyKeys;}},
  monthLabel:C.monthISO,escape:value=>String(value),
  updatePanelTitle(){},updateTabs(){},renderList(){},renderLocations(){},updateRecordsControls(){},showBrowse(){},resetList(){},
  L:{
    layerGroup(){return {markers:[],addTo(map){assert.strictEqual(map,viewMap);liveHistoryLayers.add(this);return this;}};},
    divIcon:options=>options,
    marker(coordinates,options){return {coordinates,options,addTo(layer){layer.markers.push(this);return this;},
      getElement:()=>null,bindTooltip(){return this;},on(){return this;}};}
  }
};
viewContext.mapLocationIDs=record=>C.mapLocationsFor(record,data,viewContext.state);
vm.createContext(viewContext);
vm.runInContext([
  productionFunction('resetFilters','applyData'),
  productionFunction('updateHistoryLocations','render'),
  productionFunction('render','renderListContent'),
  productionFunction('renderHistoryLocations','openLocationCard')
].join('\n'),viewContext);
const historyChange=app.split('\n').find(line=>line.includes("$('show-history').addEventListener('change'"));
assert(historyChange,'the real history checkbox change handler is wired');
vm.runInContext(historyChange,viewContext);
const changeHistory=checked=>{const checkbox=control('show-history');checkbox.checked=checked;checkbox.listeners.change({target:checkbox});};
const exportWindow={BorderCartography:require(path.join(root,'dist/cartography.js')),BorderCore:C};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/export.js'),'utf8'),{window:exportWindow,structuredClone,URL,Date,Map,Set});
const captureHistory=(extra={})=>exportWindow.BorderExport.capture({
  map:viewMap,data,visible:viewContext.visible,locationEvents:viewContext.locationEvents,
  historyLocations:viewContext.historyLocations,state:viewContext.state,...extra
});
const currentRecordIDs=()=>Array.from(viewContext.visible,record=>record.id);
for(const month of ['2020-06','2026-10']){
  Object.assign(viewContext.state,defaultState,{month:C.monthOrdinal(month)});
  viewContext.render();
  const datedIDs=currentRecordIDs(),displayedCount=control('record-count').textContent,offSnapshot=captureHistory();
  assert.equal(viewContext.historyLocations.length,0,month+' default view has no historical points');
  assert.equal(liveHistoryLayers.size,0,month+' default view creates no empty history layer');
  assert(historyKeys.every(key=>key.hidden),month+' desktop and mobile history keys are hidden while off');
  assert.equal(offSnapshot.historyReferences.length,0,month+' default saved view excludes historical points');
  changeHistory(true);
  const enabledHistory=[...viewContext.historyLocations],enabledLayer=viewContext.historyLayer,onSnapshot=captureHistory();
  const expected=H.priorCrossings(data,C,viewContext.state,[...viewContext.locationEvents.keys()]);
  assert(expected.length>0,month+' fixture has earlier eligible crossings');
  assert.equal(enabledHistory.length,expected.length,month+' enabling history uses the real eligible references');
  assert.equal(liveHistoryLayers.size,1,month+' enabling history creates one reference layer');
  assert.equal(enabledLayer.markers.length,expected.length,month+' actual marker rendering receives only the enabled references');
  assert(historyKeys.every(key=>!key.hidden),month+' both history keys are shown while enabled');
  assert.equal(onSnapshot.historyReferences.length,expected.length,month+' enabled saved view includes the displayed history');
  assert.deepEqual(currentRecordIDs(),datedIDs,month+' enabling history cannot inflate dated record selection');
  assert.equal(control('record-count').textContent,displayedCount,month+' enabling history cannot inflate the displayed count');
  assert.equal(onSnapshot.events.length,offSnapshot.events.length,month+' export active record count is unchanged');
  assert.equal(onSnapshot.references.length,offSnapshot.references.length,month+' export active map-reference count is unchanged');
  changeHistory(false);
  assert.equal(viewContext.historyLocations.length,0,month+' disabling clears cached historical references');
  assert.equal(viewContext.historyLayer,null,month+' disabling removes and clears the former history layer');
  assert(!liveHistoryLayers.has(enabledLayer)&&liveHistoryLayers.size===0,month+' former grey markers are removed from the map');
  assert(historyKeys.every(key=>key.hidden),month+' disabling hides both history keys');
  assert.equal(captureHistory().historyReferences.length,0,month+' disabling removes history from subsequent exports');
  assert.equal(captureHistory({historyLocations:enabledHistory}).historyReferences.length,0,month+' disabled export rejects even a stale supplied history array');
  assert.equal(onSnapshot.historyReferences.length,expected.length,month+' an already captured enabled view remains an immutable snapshot');
  assert.deepEqual(currentRecordIDs(),datedIDs,month+' disabling history cannot change the dated selection');
}
for(const mode of ['all','onsets']){
  Object.assign(viewContext.state,{mode,showHistory:true});viewContext.render();
  assert.equal(control('show-history').disabled,true,mode+' mode disables the history control');
  assert.equal(control('history-mode-note').hidden,false,mode+' mode explains the unavailable layer');
  assert.equal(viewContext.historyLocations.length,0,mode+' mode never feeds earlier markers into the renderer');
  assert.equal(liveHistoryLayers.size,0,mode+' mode leaves no historical markers on the map');
  assert.equal(captureHistory().historyReferences.length,0,mode+' saved view excludes the unavailable history layer');
}
Object.assign(viewContext.state,{mode:'intervals',showHistory:true});control('show-history').checked=true;
viewContext.resetFilters();viewContext.render();
assert.equal(viewContext.state.showHistory,false,'Reset restores the history-off default');
assert.equal(control('show-history').checked,false,'Reset unchecks the actual history control');
assert.equal(control('show-history').disabled,false,'the history control is available again in the default Border Restrictions view');
assert.equal(control('history-mode-note').hidden,true,'the unavailable-mode note is hidden in the default view');
assert.equal(liveHistoryLayers.size,0,'Reset cannot leave historical markers visible');

const interactionStart=app.indexOf('  function nearestPoint('),interactionEnd=app.indexOf('  function renderLocations(',interactionStart);
assert(interactionStart>=0&&interactionEnd>interactionStart,'the production point-interaction functions can be exercised');
const productionInteraction=app.slice(interactionStart,interactionEnd);
assert(productionInteraction.includes('function openPointCard('));
assert(productionInteraction.includes('function openPointRecord(')&&productionInteraction.includes('function overlappingPoints('),'the production cluster chooser and record dispatcher are included');
const pointFeatures=new Map(C.locationFeatures(data).map(feature=>[feature.properties.location_id,feature]));
const zalambessa=history.find(entry=>entry.locationId==='post-zalambessa-serha');
assert(zalambessa,'the observed overlapping historical target exists in the actual data');
const screenPositions=new Map([[rafah.locationId,{x:100,y:100}],[zalambessa.locationId,{x:115,y:110}]]);
const coordsToPixels=new Map([...screenPositions].map(([id,pixels])=>[pointFeatures.get(id).geometry.coordinates.slice().reverse().join(','),pixels]));
const opened=[];
const interactionContext={
  locations:pointFeatures,locationEvents:new Map(),historyLocations:[rafah,zalambessa],
  map:{mouseEventToContainerPoint:event=>({x:event.clientX,y:event.clientY}),latLngToContainerPoint:coordinates=>coordsToPixels.get(coordinates.join(','))},
  L:{latLng:(lat,lng)=>({lat,lng})},
  locationTitle:(properties,id)=>properties.label||properties.name||id,
  openHistoryCard:(entry,latlng,focus)=>opened.push({kind:'history',id:entry?.locationId,latlng,focus}),
  openLocationCard:(id,items,latlng,focus)=>opened.push({kind:'active',id,items,latlng,focus})
};
vm.createContext(interactionContext);vm.runInContext(productionInteraction,interactionContext);
// The chooser's DOM is browser-tested separately; capture only its dispatch.
const choices=[];interactionContext.openPointChoices=(ids,anchor)=>choices.push({ids:[...ids],anchor});
const clickAt=(x,y)=>({originalEvent:{type:'click',clientX:x,clientY:y}});
interactionContext.openPointCard(zalambessa.locationId,clickAt(100,100));
assert.equal(opened.at(-1).id,rafah.locationId,'a Zalambessa history hitbox must open Rafah when the pointer is nearest Rafah');
assert.equal(opened.at(-1).kind,'history');
assert.equal(opened.at(-1).latlng.lat,rafah.feature.geometry.coordinates[1],'popup anchor follows the selected point, not the overlapping hitbox');
interactionContext.locationEvents=new Map([[zalambessa.locationId,[zalambessa.records[0].record]]]);
interactionContext.historyLocations=[rafah];
interactionContext.openPointCard(zalambessa.locationId,clickAt(100,100));
assert.equal(opened.at(-1).id,rafah.locationId,'an active hitbox must also yield to a nearer historical point');
assert.equal(opened.at(-1).kind,'history');
interactionContext.openPointCard(rafah.locationId,clickAt(115,110));
assert.equal(opened.at(-1).id,zalambessa.locationId,'a historical hitbox must yield to the nearer active point');
assert.equal(opened.at(-1).kind,'active','dispatch follows the chosen point type');
assert.strictEqual(opened.at(-1).items,interactionContext.locationEvents.get(zalambessa.locationId));
interactionContext.openPointCard(rafah.locationId,{originalEvent:{type:'keydown',clientX:115,clientY:110}});
assert.equal(opened.at(-1).id,rafah.locationId,'keyboard selection keeps its explicitly focused historical marker');
assert.equal(opened.at(-1).kind,'history');
interactionContext.openPointCard(zalambessa.locationId,{originalEvent:{type:'keydown',clientX:100,clientY:100}});
assert.equal(opened.at(-1).id,zalambessa.locationId,'keyboard selection keeps its explicitly focused active marker');
assert.equal(opened.at(-1).kind,'active');
assert.equal(opened.at(-1).focus,true,'keyboard activation requests focus inside the selected card');
interactionContext.openPointCard(rafah.locationId,{});
assert.equal(opened.at(-1).id,rafah.locationId,'activation without pointer coordinates retains the explicit marker');

// Rafah and Kerem Shalom can land on the same pixel at world zoom. Rounding
// cannot reliably identify one: offer both names instead of guessing a record.
const kerem=history.find(entry=>entry.locationId==='post-kerem-shalom');
assert(kerem,'the adjacent Kerem Shalom history point exists in the actual data');
coordsToPixels.set(kerem.feature.geometry.coordinates.slice().reverse().join(','),{x:100,y:100});
interactionContext.historyLocations=[rafah,kerem];
let recordsOpened=opened.length,choicesOffered=choices.length;
interactionContext.openPointCard(rafah.locationId,clickAt(100,100));
assert.equal(choices.length,choicesOffered+1,'coincident historical crossing points open a chooser');
assert.deepEqual([...choices.at(-1).ids].sort(),[rafah.locationId,kerem.locationId].sort(),'the chooser includes both Rafah and Kerem Shalom, excluding a merely overlapping distant hitbox');
assert.equal(opened.length,recordsOpened,'pointer rounding must not automatically open the wrong crossing');
interactionContext.locationEvents=new Map([[kerem.locationId,[kerem.records[0].record]]]);
interactionContext.historyLocations=[rafah];
choicesOffered=choices.length;
interactionContext.openPointCard(rafah.locationId,clickAt(100,100));
assert.equal(choices.length,choicesOffered+1,'a coincident active/history pair also offers a chooser');
assert.deepEqual([...choices.at(-1).ids].sort(),[rafah.locationId,kerem.locationId].sort());
assert.equal(opened.length,recordsOpened,'active marker ordering does not bypass the chooser');
choicesOffered=choices.length;
interactionContext.openPointCard(rafah.locationId,{originalEvent:{type:'keydown',clientX:100,clientY:100}});
assert.equal(opened.at(-1).id,rafah.locationId,'keyboard focus selects Rafah directly even when Kerem Shalom occupies the same pixel');
assert.equal(opened.at(-1).kind,'history');
assert.equal(choices.length,choicesOffered,'explicit keyboard selection does not need a chooser');
interactionContext.openPointRecord(kerem.locationId,true);
assert.equal(opened.at(-1).id,kerem.locationId,'a named chooser selection opens that precise crossing');
assert.equal(opened.at(-1).kind,'active');
assert.equal(choices.length,choicesOffered,'a named chooser selection does not recurse into another chooser');
console.log(JSON.stringify({result:'Border history checks passed',...index.stats,neutralCrossingLocations:history.length,activeRecordsUnchanged:originalActive.length}));
