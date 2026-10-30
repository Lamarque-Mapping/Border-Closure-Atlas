/* Geographic scope must not inflate a named crossing into a whole-frontier closure.
 * This check uses the real release and independently asserts its known mixed,
 * disputed and open-ended cases. It also protects the unchanged Analysis inputs. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
const C=require(path.join(dist,'core.js')),K=require(path.join(dist,'cartography.js'));
const X=require(path.join(dist,'crossing-geography.js'));
const plain=v=>JSON.parse(JSON.stringify(v));
const read=name=>fs.readFileSync(path.join(dist,name),'utf8');
const original=JSON.parse(read('map-data.js').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
function unpack(value){
 const data=plain(value);
 if(data.geometry_pool){for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of data[key].features)f.geometry=data.geometry_pool[f.geometry];delete data.geometry_pool;}
 return data;
}
const before=unpack(original),data=X.attach(unpack(original));
const reviews=JSON.parse(fs.readFileSync(path.join(root,'source/crossings/scope-review.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(root,'source/crossings/locations.json'),'utf8'));
const included=data.events.filter(e=>!C.excluded(e)),byID=new Map(data.events.map(e=>[e.id,e]));
const features=new Map(C.locationFeatures(data).map(f=>[f.properties.location_id,f]));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source/current-release-manifest.json'),'utf8'));
const includedCount=manifest.counts.included,recordCount=manifest.counts.records;
const state={mode:'all',measureType:'',rationale:''};
const ids=(e,s=state)=>C.mapLocationsFor(e,data,s);
const phaseRecord=(e,p)=>({...e,duration_periods:[p]});
const types=locationIDs=>locationIDs.map(id=>{assert(features.has(id),'mapped reference exists: '+id);return features.get(id).geometry.type;});
const at=iso=>({mode:'intervals',month:C.monthOrdinal(iso),measureType:''});
const sortedIDs=events=>events.map(e=>e.id).sort();
assert.equal(included.length,includedCount,'all included core land records remain available');
assert.equal(data.events.length,recordCount,'excluded parents and phase-level evidence remain in the archive');
assert.deepEqual(data.events,before.events,'attaching geography must not rewrite records, dates, duration or rationale coding');
assert.deepEqual(data.meta,before.meta,'the statistical release metadata is unchanged');
assert.deepEqual(JSON.parse(read('analysis-data.json')).events,data.events,'Analysis retains precisely the original land records');
assert.equal(reviews.source_sha256,data.meta.source_sha256,'scope review applies to this release');
assert.equal(source.source_sha256,reviews.source_sha256,'location source applies to the same release');
assert.equal(X.review.phases['REC50-R01-002-P1'].partial,true,'Moyale point does not locate nearby unauthorised routes');
const expectedKeys=included.flatMap(e=>e.duration_periods.length?e.duration_periods.filter(p=>p.analysis_included!==false).map(p=>e.id+'|'+p.period_id):[e.id+'|']);
assert.equal(reviews.rows.length,expectedKeys.length,'all analysis-included phases and undated records');
const actualKeys=reviews.rows.map(r=>r.record_id+'|'+(r.phase_id||''));
assert.deepEqual([...actualKeys].sort(),[...expectedKeys].sort(),'every included phase, and only included phases, has one scope decision');
assert.equal(new Set(actualKeys).size,actualKeys.length,'phase scope decisions are unique');
const singles=reviews.rows.filter(r=>r.category==='single_site');
assert(singles.length>0,'explicit single-crossing scope decisions are present');
let singleMapped=0,singlePending=0;
for(const row of singles){
 const e=byID.get(row.record_id),p=e.duration_periods.find(p=>p.period_id===row.phase_id),one=phaseRecord(e,p),mapped=ids(one);
 assert(mapped.length<=1,row.phase_id+' must not silently become multiple crossing positions');
 const refs=X.review.phases[row.phase_id]?.reference_border_ids||[];
 assert(mapped.every(id=>refs.includes(id)||features.get(id).geometry.type==='Point'),row.phase_id+' line requires explicit border-reference review');
 const status=C.mappingStatus(one,data,state);
 assert.deepEqual(status.ids,mapped,row.phase_id+' status and drawing use the same geography');
 if(mapped.length)singleMapped++;else{singlePending++;assert.equal(status.pending,true,row.phase_id+' without coordinates remains visibly awaiting mapping');}
}
assert(singleMapped>0,'reviewed single-crossing points are enabled');
assert(singlePending>0,'uncertain coordinates are not invented to fill coverage gaps');
for(const row of reviews.rows.filter(r=>r.category==='wider_border')){
 const e=byID.get(row.record_id),p=e.duration_periods.find(p=>p.period_id===row.phase_id);
 assert(types(ids(phaseRecord(e,p))).every(t=>t!=='Point'),row.phase_id+' must not borrow a point from another stage');
}
for(const row of reviews.rows.filter(r=>r.category==='needs_review')){
 const e=byID.get(row.record_id),p=e.duration_periods.find(p=>p.period_id===row.phase_id),one=p?phaseRecord(e,p):e;
 assert.deepEqual(ids(one),(X.review.phases[row.phase_id]?.reference_border_ids||[]),row.phase_id||row.record_id+' unresolved scope requires explicitly reviewed border reference');
 assert.equal(C.mappingStatus(one,data,state).pending,true,'unresolved scope is declared');
}
// A geography-only update must preserve every unfiltered/filtered record set,
// including months in which the location itself is not yet known.
for(const s of [state,{...state,includeExcluded:true},...['China','Gatuna','Ecuador','Rwanda','Mazongshan'].map(query=>({...state,query})),...data.meta.rationale_categories.map(rationale=>({...state,rationale})),...C.availableContinents(data).map(continent=>({...state,continent}))]){
 assert.deepEqual(sortedIDs(C.filterEvents(data,s)),sortedIDs(C.filterEvents(before,s)),'search/statistical filters are independent of coordinate coverage');
}
for(let month=C.monthOrdinal(data.meta.window_start);month<=C.monthOrdinal(data.meta.window_end);month++){
 assert.deepEqual(sortedIDs(C.filterEvents(data,{mode:'intervals',month})),sortedIDs(C.filterEvents(before,{mode:'intervals',month})),'dated record population is unchanged in '+C.monthISO(month));
}
for(const e of data.events.filter(C.excluded))assert.deepEqual(ids(e),[],'excluded records never acquire symbols');
for(const e of included)for(const p of e.duration_periods.filter(p=>p.analysis_included===false)){
 assert.deepEqual(ids(phaseRecord(e,p)),[],p.period_id+' excluded phase cannot borrow its included parent geography');
 assert(!reviews.rows.some(row=>row.phase_id===p.period_id),p.period_id+' excluded phase has no map-scope approval');
}
// Ecuador moves between national passenger rules and an observed reopening at
// Rumichaca. Reading the broad parent must not expand the later single site.
const ec=byID.get('AM018'),ecEarly=ids(ec,at('2020-03')),ecLate=ids(ec,at('2021-12'));
assert(ecEarly.length&&types(ecEarly).every(t=>t!=='Point'),'March 2020 retains the national passenger-rule geography');
assert(types(ecLate).every(t=>t==='Point'),'December 2021 is Rumichaca only');
assert.deepEqual(ids(ec,at('2021-11')),[],'an isolated reopening observation does not imply the preceding month was closed');
for(const id of [...ecEarly,...ecLate]){
 const records=C.recordsForLocation([ec],id,data,state);
 assert.equal(records.length,1,'location retains its parent record');
 const actual=records[0].duration_periods.map(p=>p.period_id).sort();
 assert.deepEqual(actual,ecLate.includes(id)?['AM018-D1']:['AM018-C7P1','AM018-C7P2'],'the popup/export receives only stages applying to its geometry');
 const complete={...ec,sources:[{title:'Full source',url:'https://example.org/evidence'}],duration_periods:ec.duration_periods.map(p=>({...p,basis:'Full retained evidence'}))};
 const detail=C.recordsForLocation([complete],id,data,state)[0];
 assert.equal(detail.sources[0].title,'Full source','phase filtering does not discard asynchronously loaded full sources');
 assert(detail.duration_periods.every(p=>p.basis==='Full retained evidence'),'full phase evidence survives geographic filtering');
}
// Contested Gatuna dates remain isolated evidence, never a continuous dot.
const gatuna=byID.get('GL01');
assert.deepEqual(ids(gatuna,at('2019-04')),[],'held February–June Gatuna dates do not animate intervening months');
assert(ids(gatuna,at('2019-02')).length>0,'the dated held evidence stays discoverable');
assert(types(ids(gatuna)).every(t=>t==='Point'),'Gatuna phases do not reinstate the full Rwanda–Uganda frontier');
const janPhases=C.periodsForView(gatuna,at('2020-01'));
assert.deepEqual(janPhases.map(p=>p.period_id),['GL01-C7RWP3'],'January evidence names Gatuna and Kagitumba only in its own phase');
for(const id of ids(gatuna,at('2020-01')))assert.deepEqual(C.recordsForLocation([gatuna],id,data,at('2020-01'))[0].duration_periods.map(p=>p.period_id),['GL01-C7RWP3']);
// The motivating example is an approximate post location, not 4,600 km of line.
const maz=byID.get('FU-COV-EAS-003'),mazIDs=ids(maz,at('2021-08'));
assert.equal(mazIDs.length,1,'Mazongshan has its reviewed crossing-area position');
assert.equal(features.get(mazIDs[0]).geometry.type,'Point');
assert(/mazongshan|naran/i.test(features.get(mazIDs[0]).properties.label||features.get(mazIDs[0]).properties.name),'Mazongshan does not borrow another Mongolia post');
assert.deepEqual(ids(maz,at('2021-09')),[],'last-confirmed date does not imply closure to the present');
assert.deepEqual(ids(maz,at('2020-06')),[],'seasonal-port observations do not establish an intervening continuous policy interval');
assert.equal(C.phaseTemporalState(maz.duration_periods[0],C.monthOrdinal('2021-08')),'observation','dated formal-policy evidence does not become operational continuity');
const horo=byID.get('R5-AES-003');
const horoPhase=horo.duration_periods.find(p=>p.period_id==='R5-AES-003-R1');
assert(horoPhase&&/Horohoro/.test(horoPhase.scope),'the original Horohoro phase remains explicit');
assert.deepEqual(ids(phaseRecord(horo,horoPhase)),['post-horohoro-lunga-lunga'],'Horohoro phase never uses the rejected Namanga location');
const namangaPhase=horo.duration_periods.find(p=>p.period_id==='REC50-R01-PH001');
assert(namangaPhase&&/Namanga/.test(namangaPhase.scope),'the later accepted Namanga rule has its own phase');
assert.deepEqual(ids(phaseRecord(horo,namangaPhase)),['post-namanga-road'],'Namanga does not overwrite or inherit the Horohoro phase location');
// Clicking an individual point selects only records whose active phase applies.
for(const id of mazIDs){
 const s={...at('2021-08'),location:id};
 const selected=C.filterEvents(data,s);
 assert(selected.some(e=>e.id===maz.id),'point click finds the source record');
 assert(selected.every(e=>ids(e,s).includes(id)),'point filter respects the active geography');
 assert(!C.filterEvents(data,{...at('2021-09'),location:id}).some(e=>e.id===maz.id),'point filter cannot revive expired phase evidence');
}
// No site without provenance, invalid coordinates or foreign phase can enter
// the compiled location layer. The source remains reusable for later reviews.
assert.equal(new Set(source.sites.map(s=>s.id)).size,source.sites.length,'crossing IDs are unique');
const siteIDs=new Set(source.sites.map(s=>s.id)),phaseOwners=new Map(included.flatMap(e=>e.duration_periods.filter(p=>p.analysis_included!==false).map(p=>[p.period_id,e.id])));
for(const site of source.sites){
 assert(Array.isArray(site.coordinates)&&site.coordinates.length===2&&site.coordinates.every(Number.isFinite),site.id+' has numeric lon/lat');
 assert(Math.abs(site.coordinates[0])<=180&&Math.abs(site.coordinates[1])<=90,site.id+' has valid lon/lat');
 assert(site.source_urls?.length&&site.source_urls.every(u=>/^https?:\/\//.test(u)),site.id+' carries location sources');
 assert(site.precision&&site.source_note,site.id+' declares positional limits');
}
for(const b of source.bindings){assert(siteIDs.has(b.site_id),'binding site exists');assert.equal(phaseOwners.get(b.phase_id),b.record_id,'binding belongs to the named phase and parent');}
for(const b of source.border_bindings||[]){
 assert.equal(phaseOwners.get(b.phase_id),b.record_id,'wider binding belongs to its phase');
 assert(/^(Multi)?LineString$/.test(features.get(b.location_id)?.geometry?.type||''),'wider binding is a line');
 assert(X.review.phases[b.phase_id].border_ids.includes(b.location_id),'explicit wider geometry survives compilation');
}
// A reviewed phase-level line replaces unrelated legacy parent links; it does
// not broaden another phase, convert a point to a line, or alter chronology.
const wideFixture={...data,crossing_map:{...data.crossing_map,phases:{...data.crossing_map.phases}}};
const portugal=byID.get('EU025'),portugalPhase=portugal.duration_periods.find(p=>p.analysis_included!==false);
wideFixture.crossing_map.phases[portugalPhase.period_id]={...X.review.phases[portugalPhase.period_id],border_ids:['frontier-portugal-spain']};
assert.deepEqual(C.mapLocationsFor(phaseRecord(portugal,portugalPhase),wideFixture,state),['frontier-portugal-spain'],'reviewed explicit phase geography works without parent links');
assert.deepEqual(C.mapLocationsFor(phaseRecord(portugal,portugalPhase),wideFixture,at('2019-01')),[],'new geometry does not create earlier evidence');
wideFixture.crossing_map.phases[portugalPhase.period_id].border_ids=[source.sites[0].id];
assert.deepEqual(C.mapLocationsFor(phaseRecord(portugal,portugalPhase),wideFixture,state),[],'wider geometry cannot borrow a crossing point');
const twice=X.attach(data);
assert.equal(C.locationFeatures(twice).length,C.locationFeatures(data).length,'attachment is idempotent');
assert.throws(()=>X.attach({...unpack(original),meta:{...original.meta,source_sha256:'wrong-release'}}),/release|version|match/i,'another workbook must not inherit this geography');
const missingPhase=unpack(original);missingPhase.events.find(e=>e.id==='EA003').duration_periods=[];
assert.throws(()=>X.attach(missingPhase),/incomplete|phase|match/i,'missing phases block an out-of-date overlay');
const foreignPhase=unpack(original);foreignPhase.events.find(e=>e.id==='EA003').duration_periods[0].period_id='AM018-D1';
assert.throws(()=>X.attach(foreignPhase),/incomplete|phase|match/i,'foreign phase IDs cannot inherit another record location');
const duplicateSite=unpack(original);duplicateSite.locations.features.push(plain(X.review.sites[0]));
assert.throws(()=>X.attach(duplicateSite),/duplicat/i,'reviewed crossing IDs cannot overwrite existing features');
// Crossing marks match one round-capped dash of an existing dotted border.
// Their screen dimensions stay fixed at every zoom and never encode counts.
const rationaleRecords=[{scope:'One specified crossing only',rationales:['Security']}];
const limitedLine=K.symbolStyle({display_role:'frontier_context'},{records:rationaleRecords});
assert.deepEqual(limitedLine.dash,[1,7],'the existing dotted-border pattern is unchanged');
assert.equal(limitedLine.width,2.7,'the existing dotted-border stroke is unchanged');
for(const zoom of [.25,1,3.75,4,6.75,7,14]){
 assert.equal(K.pointDiameter(zoom),limitedLine.width,'crossing mark height matches the dotted-border stroke at every zoom');
 const a=K.symbolStyle({display_role:'crossing_reference'},{zoom,count:1,records:rationaleRecords}),b=K.symbolStyle({display_role:'crossing_reference'},{zoom,count:200,records:rationaleRecords});
 assert.equal(a.radius,b.radius,'record counts must not inflate crossing marks');
 assert.equal(a.radius*2,limitedLine.width,'crossing mark height stays 2.7 CSS pixels');
 assert.equal(a.pointLength,limitedLine.dash[0],'crossing mark centreline matches one 1px border dash');
 assert.equal(a.pointLength+a.radius*2,3.7,'round caps produce the same 3.7px outer dash length');
 assert.equal(a.colour,limitedLine.colour,'crossing marks use exactly the same rationale colour as border lines');
 assert.equal(a.pointStrokeWidth||0,0,'normal crossing marks have no white outline');
 assert.equal(a.hitRadius*2,44,'the invisible interaction area stays easy to tap');
 const selectedMark=K.symbolStyle({display_role:'crossing_reference'},{zoom,count:200,selected:true,records:rationaleRecords});
 assert.equal(selectedMark.radius,a.radius,'selection does not enlarge the coloured mark itself');
 assert.equal(selectedMark.pointLength,a.pointLength,'selection does not lengthen the coloured mark itself');
}
// Spreadsheet export retains every matching record, including those awaiting
// coordinates. The optional mapping-status column must not disturb old callers
// or any of the evidence fields (including quoted, multiline source text).
const CSV=require(path.join(dist,'record-export.js'));
function parseCSV(content){
 const rows=[];let row=[],value='',quoted=false;
 const input=content.replace(/^\ufeff/,'');
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(c==='"'){if(quoted&&input[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(value);value='';}
  else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
  else value+=c;
 }
 assert.equal(quoted,false,'CSV quoted fields close');
 if(row.length||value){row.push(value);rows.push(row);}
 return rows;
}
const completeSource=JSON.parse(read(byID.get('AM002').details_file)).record;
assert.equal(completeSource.id,'AM002','full-evidence fixture matches its catalogue record');
const csvRecords=included.map(e=>e.id===completeSource.id?completeSource:e);
const withMapping=CSV.build({records:csvRecords,state,mappingStatus:e=>C.mappingStatus(e,data,state).label});
const withoutMapping=CSV.build({records:csvRecords,state});
assert.equal(withMapping.count,includedCount,'CSV contains all matching records irrespective of mapping coverage');
const csv=parseCSV(withMapping.content),legacyCSV=parseCSV(withoutMapping.content),headers=csv[0],csvIndex=new Map(csv.slice(1).map(row=>[row[headers.indexOf('Record ID')],row]));
assert.equal(csv.length,includedCount+1,'one header and the exact included population of correctly parsed data rows');
assert.equal(csvIndex.size,includedCount,'no CSV record IDs are lost or duplicated');
assert(csv.every(row=>row.length===headers.length),'multiline evidence never breaks the CSV column layout');
const mappingColumn=headers.indexOf('Map location status');assert(mappingColumn>=0);assert(headers.includes('Later-status evidence'));assert.equal(headers.at(-1),'Case description');
assert.equal(csvIndex.get(maz.id)[mappingColumn],'Crossing mapped','mapped named crossing is described accurately');
const awaiting=singles.map(row=>byID.get(row.record_id)).find(e=>!ids(e).length);
assert(awaiting,'at least one explicitly unresolved whole record is available for the CSV check');
assert.equal(csvIndex.get(awaiting.id)[mappingColumn],'Location awaiting mapping','unmapped record remains exported with clear status');
for(let i=1;i<csv.length;i++){
 assert.deepEqual(csv[i].filter((_,j)=>j!==mappingColumn),legacyCSV[i].filter((_,j)=>j!==mappingColumn),'the mapping field does not modify evidence columns');
 assert.equal(legacyCSV[i][mappingColumn],'','callers that omit the optional callback get a safe empty status');
}
const sourceRow=csvIndex.get('AM002'),sourceURLs=sourceRow[headers.indexOf('Source links')].split('\n'),sourceNames=sourceRow[headers.indexOf('Source names and titles')];
assert(completeSource.source_urls.every(url=>sourceURLs.includes(typeof url==='string'?url:url.url)),'CSV preserves the complete source URLs');
assert(sourceNames.includes(completeSource.sources[0].publisher)&&sourceNames.includes(completeSource.sources[0].title),'source publisher and title are retained');
assert.equal(sourceRow[headers.indexOf('Record ID')],completeSource.id,'full-record identity is preserved');
assert(sourceRow[headers.indexOf('Documented dates')].includes(completeSource.duration_periods[0].period_id),'full-record phase IDs survive export');
assert(withMapping.content.startsWith('\ufeff'),'UTF-8 spreadsheet compatibility marker retained');
// Save-view capture must share the same phases and contain real points while
// still retaining unlocated records in the accompanying evidence selection.
const window={BorderCore:C,BorderCartography:K,BorderPublic:{text:v=>String(v??'')}};
vm.runInNewContext(read('export.js'),{window,structuredClone,URL,Date,Map,Set});
const locationEvents=new Map();
for(const e of included)for(const id of ids(e)){if(!locationEvents.has(id))locationEvents.set(id,[]);locationEvents.get(id).push(e);}
const map={getSize:()=>({x:1200,y:700}),getZoom:()=>3,getPixelBounds:()=>({min:{x:0,y:0}}),containerPointToLatLng:([x,y])=>({lng:x/10-180,lat:80-y/10}),distance:()=>100000};
const snapshot=window.BorderExport.capture({map,data,visible:included,locationEvents,state});
assert.equal(snapshot.events.length,includedCount,'PNG evidence selection retains unlocated records');
assert(snapshot.references.some(r=>r.feature.geometry.type==='Point'),'PNG capture includes crossing dots');
assert.deepEqual(plain(snapshot.references.map(r=>r.feature.properties.location_id).sort()),[...locationEvents.keys()].sort(),'PNG and live map use the same references');
const mazRef=snapshot.references.find(r=>r.feature.properties.location_id===mazIDs[0]);
assert(mazRef.phases.some(p=>p.record_id===maz.id&&p.phase_ids.includes('FU-COV-EAS-003-FU1')),'PNG preserves the Mazongshan phase binding');
assert.equal(mazRef.rationale.colour,K.rationaleStyle([maz]).colour,'PNG preserves Mazongshan rationale colour');
for(const id of ecLate){const ref=snapshot.references.find(r=>r.feature.properties.location_id===id);assert.deepEqual(plain(ref.phases.find(p=>p.record_id===ec.id).phase_ids),['AM018-D1'],'PNG does not attribute national Ecuador phases to Rumichaca');}
const note=window.BorderExport.notes(snapshot,'Crossing test');
assert(note.includes('FU-COV-EAS-003-FU1')&&note.includes('GEOGRAPHIC REFERENCES'),'saved notes include phase and location provenance');
// A missing geography script must fail the map clearly, never silently
// restore the old whole-frontier fallback. Direct Analysis remains usable.
function loaderHarness(mapLoaded=false){
 const requests=[],scripts=[],analysis=JSON.parse(read('analysis-data.json'));
 const context={Promise,setTimeout,clearTimeout,AbortController,location:{protocol:'https:'},
  document:{currentScript:{dataset:{mapSrc:'map-data.js',analysisSrc:'analysis-data.json',sourceSha:original.meta.source_sha256,crossingReview:'required'}},createElement:()=>({remove(){}}),head:{appendChild(script){scripts.push(script.src);queueMicrotask(()=>{context.BORDER_DATA=plain(original);script.onload();});}}},
  fetch:async file=>{requests.push(file);assert.equal(file,'analysis-data.json');return {ok:true,json:async()=>plain(analysis)};}};
 context.window=context;if(mapLoaded)context.BORDER_DATA=plain(original);
 vm.runInNewContext(read('data-loader.js'),context);
 return {context,api:context.AtlasData,requests,scripts,analysis};
}
(async()=>{
 assert(/data-crossing-review="required"/.test(read('index.html')),'production map requires the reviewed crossing overlay');
 const missing=loaderHarness(true);
 await assert.rejects(missing.api.ready(),/Crossing locations could not be loaded/i,'missing overlay cannot display superseded geography');
 missing.context.AtlasCrossings=X;
 const recovered=await missing.api.ready();assert.equal(recovered.crossing_map,X.review,'map can recover once the reviewed overlay is available');
 assert(types(C.mapLocationsFor(recovered.events.find(e=>e.id===maz.id),recovered,state)).every(t=>t==='Point'),'recovered map uses point geography');
 const direct=loaderHarness();
 const analysis=await direct.api.getAnalysisData();
 assert.deepEqual(plain(analysis),direct.analysis,'Analysis data stays unchanged without the map overlay');
 assert.deepEqual(direct.requests,['analysis-data.json'],'direct Analysis requests only its smaller dataset');
 assert.equal(direct.scripts.length,0,'direct Analysis never requests map geometry');
 await assert.rejects(direct.api.ready(),/Crossing locations could not be loaded/i,'a cold map request also fails safely without the overlay');
 assert.equal(direct.scripts.length,1,'only one map load was attempted');
 direct.context.AtlasCrossings=X;
 const retry=await direct.api.ready();assert.equal(retry.crossing_map,X.review,'cold map load recovers without an obsolete fallback');
 console.log(`Crossing map passed: ${includedCount} records unchanged; ${singles.length} single-site phases use points or explicitly reviewed border references (${singleMapped} displayed, ${singlePending} awaiting location); all monthly populations unchanged; mixed/held/last-confirmed phases, source bindings, point filters, ${includedCount}-row CSV, PNG phase capture and constant border-matched crossing marks and safe loading failure checked.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
