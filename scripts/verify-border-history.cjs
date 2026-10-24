/* A neutral route into dated history must never become an active-closure claim. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),C=require(path.join(root,'dist/core.js'));
const H=require(path.join(root,'dist/border-history.js')),X=require(path.join(root,'dist/crossing-geography.js'));
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
for(const key of ['countries','borders','disputed','locations','context_locations'])for(const feature of data[key].features)feature.geometry=data.geometry_pool[feature.geometry];
delete data.geometry_pool;X.attach(data);
const before=JSON.stringify(data.events),state={mode:'intervals',month:C.monthOrdinal('2026-10')};
const originalActive=C.filterEvents(data,state).map(record=>record.id);
const index=H.buildIndex(data,C);
assert.equal(index.boundaries.length,295,'all existing bilateral reference features are available, including empty lookups');
const ukraine=H.lookup(index,'context-frontier-rus-ukr',state);
assert(ukraine.records.some(item=>item.record.id==='EU031'),'an unmapped named-crossing record remains discoverable from its explicit border reference');
assert.equal(ukraine.records.find(item=>item.record.id==='EU031').datedThisMonth,false);
assert.equal(ukraine.datedRecordCount,0,'historical lookup does not invent dated activity in October 2026');
assert.deepEqual(C.mapLocationsFor(data.events.find(record=>record.id==='EU031'),data,{mode:'all'}),[],'history lookup does not promote a contextual frontier to an approved closure footprint');
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
fixture.events.push({...mixed,id:'EXCLUDED',quarantined:true},{...mixed,id:'NATIONAL',record_kind:'national_policy'});
assert.deepEqual(H.lookup(H.buildIndex(fixture,C),'border-ac',state).records.map(item=>item.record.id),['MIXED'],'excluded and national-supplement records do not enter the core border history directory');
assert.equal(H.priorCrossings(fixture,C,state,[])[0].recordCount,1);

// At world zoom, invisible 44px targets overlap. Exercise the actual app routing:
// whichever marker receives the browser event, the nearest visible point wins.
// Keyboard activation instead retains its explicitly focused marker.
const app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
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
