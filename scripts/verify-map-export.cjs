const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../dist'),K=require(root+'/cartography.js'),C=require(root+'/core.js');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-7,label+': '+actual+' != '+expected);
const plain=value=>JSON.parse(JSON.stringify(value));
const app=fs.readFileSync(root+'/app.js','utf8');
let mobile=false,canvas;
function canvasContext(){
 const scales=[],points=[],arcs=[],texts=[],strokes=[],fills=[],operations=[],rectFills=[],rectStrokes=[],stack=[];let matrix={x:1,y:1,left:0,top:0},currentPath=[],currentArcs=[],dash=[];
 const styleKeys=['globalAlpha','lineWidth','strokeStyle','fillStyle','lineCap','lineJoin','font','textAlign','textBaseline'];
 const api={scales,points,arcs,texts,strokes,fills,operations,rectFills,rectStrokes,globalAlpha:1,lineWidth:1,measureText:text=>({width:String(text).length*7}),
  save(){stack.push({matrix:{...matrix},dash:[...dash],style:Object.fromEntries(styleKeys.map(key=>[key,api[key]]))})},restore(){const saved=stack.pop();matrix=saved.matrix;dash=saved.dash;Object.assign(api,saved.style)},
  setLineDash(value){dash=[...value]},
  scale(x,y){scales.push([x,y]);matrix.x*=x;matrix.y*=y},
  translate(x,y){matrix.left+=x*matrix.x;matrix.top+=y*matrix.y},
  beginPath(){currentPath=[];currentArcs=[]},
  moveTo(x,y){const p=[matrix.left+x*matrix.x,matrix.top+y*matrix.y];points.push(p);currentPath.push(p)},
  lineTo(x,y){const p=[matrix.left+x*matrix.x,matrix.top+y*matrix.y];points.push(p);currentPath.push(p)},
  stroke(){const mark={points:currentPath.slice(),arcs:currentArcs.slice(),width:api.lineWidth*matrix.x,rawWidth:api.lineWidth,cap:api.lineCap,colour:api.strokeStyle,opacity:api.globalAlpha,dash:[...dash]};strokes.push(mark);operations.push({type:'stroke',mark})},
  fill(){const mark={points:currentPath.slice(),arcs:currentArcs.slice(),colour:api.fillStyle};fills.push(mark);operations.push({type:'fill',mark})},
  fillRect(x,y,width,height){rectFills.push({x:matrix.left+x*matrix.x,y:matrix.top+y*matrix.y,width:width*matrix.x,height:height*matrix.y,rawWidth:width,rawHeight:height,colour:api.fillStyle})},
  strokeRect(x,y,width,height){rectStrokes.push({x:matrix.left+x*matrix.x,y:matrix.top+y*matrix.y,width:width*matrix.x,height:height*matrix.y,rawWidth:width,rawHeight:height,lineWidth:api.lineWidth*matrix.x,rawLineWidth:api.lineWidth,colour:api.strokeStyle})},
  arc(x,y,radius){const mark={x:matrix.left+x*matrix.x,y:matrix.top+y*matrix.y,radius:radius*matrix.x,rawRadius:radius};arcs.push(mark);currentArcs.push(mark)},
  fillText(text){texts.push(String(text))}};
 return new Proxy(api,{get:(target,key)=>key in target?target[key]:()=>{}});
}
const w={BorderCartography:K,BorderCore:C,matchMedia:()=>({matches:mobile})};
vm.runInNewContext(fs.readFileSync(root+'/export.js','utf8'),{window:w,structuredClone,URL,Date,Map,Set,document:{createElement(type){assert.equal(type,'canvas');const context=canvasContext();return canvas={getContext:()=>context,context};}}});
const E=w.BorderExport;
function makeMap(width,height,zoom=3.25,origin={x:720.25,y:555.75}){
 const world=256*2**zoom;
 const ll=([x,y])=>({lng:360*((origin.x+x)/world-.5),lat:Math.atan(Math.sinh(Math.PI*(1-2*(origin.y+y)/world)))*180/Math.PI});
 return {getSize:()=>({x:width,y:height}),getZoom:()=>zoom,getPixelBounds:()=>({min:{...origin}}),containerPointToLatLng:ll,
  distance(a,b){return Math.abs(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180)}};
}
function layout(map,{compact=false,collapsed=false,panelWidth=304,timelineHeight=70}={}){
 const {x:width,y:height}=map.getSize(),page={right:width,bottom:height+64};
 const nodes={'map-page':{getBoundingClientRect:()=>page,classList:{contains:()=>collapsed}},'explore-panel':{getBoundingClientRect:()=>({left:width-panelWidth-12})}};
 const ctx={map,$:id=>nodes[id],compact:()=>compact,document:{querySelector:()=>({getBoundingClientRect:()=>({top:page.bottom-timelineHeight-12})})}};
 vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('  function viewPadding('),app.indexOf('  function syncViewport(')),ctx);
 return plain(ctx.exportViewport());
}
const empty={type:'FeatureCollection',features:[]},data={meta:{window_start:'2016-10-21',window_end:'2026-10-21'},countries:empty};
const cases=[
 ['laptop',makeMap(1366,704),{panelWidth:292}],
 ['desktop',makeMap(1920,1016),{}],
 ['collapsed records',makeMap(1366,704),{collapsed:true}],
 ['phone',makeMap(390,720),{compact:true,timelineHeight:100}],
 ['landscape phone',makeMap(844,336),{compact:true,timelineHeight:70}],
 ['expanded record',makeMap(1280,650),{panelWidth:620}],
 ['north of Mercator limit',makeMap(1000,700,2,{x:5,y:-80}),{collapsed:true}],
 ['unwrapped longitude',makeMap(1200,700,2,{x:950,y:250}),{collapsed:true}]
];
for(const [name,map,options]of cases){
 mobile=options.compact||false;
 const viewport=layout(map,options),centre={x:viewport.x+viewport.width/2,y:viewport.y+viewport.height/2};
 const square=[[centre.x-40,centre.y-40],[centre.x+40,centre.y-40],[centre.x+40,centre.y+40],[centre.x-40,centre.y+40]].map(p=>{const ll=map.containerPointToLatLng(p);return [ll.lng,ll.lat]});
 const snapshot=E.capture({map,data:{...data,countries:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...square,square[0]]]}}]}},viewport,state:{mode:'all'},labels:[{text:'Visible',...centre,fontSize:11},{text:'Outside',x:map.getSize().x-2,y:20,fontSize:11}]});
 assert.deepEqual(plain(snapshot.size),{x:viewport.width,y:viewport.height},name+' crop dimensions');
 near(snapshot.origin.x,map.getPixelBounds().min.x+viewport.x,name+' crop x');
 near(snapshot.origin.y,map.getPixelBounds().min.y+viewport.y,name+' crop y');
 const nw=map.containerPointToLatLng([viewport.x,viewport.y]),se=map.containerPointToLatLng([viewport.x+viewport.width,viewport.y+viewport.height]);
 near(snapshot.bounds.west,nw.lng,name+' west');near(snapshot.bounds.east,se.lng,name+' east');near(snapshot.bounds.north,nw.lat,name+' north');near(snapshot.bounds.south,se.lat,name+' south');
 assert.equal(snapshot.labels.length,1,name+' hidden labels excluded');
 near(snapshot.labels[0].x,viewport.width/2,name+' label x');near(snapshot.labels[0].y,viewport.height/2,name+' label y');
 const projected=square.map(p=>E.project(p,snapshot));
 near(projected[1][0]-projected[0][0],80,name+' horizontal distance retained');near(projected[2][1]-projected[1][1],80,name+' vertical distance retained');
 const result=E.render(snapshot,'Map proportions');
 near(result.frame.w/result.frame.h,viewport.width/viewport.height,name+' frame aspect ratio');
 assert(canvas.context.scales.every(([x,y])=>x===y),name+' every render scale is uniform');
 const points=canvas.context.points,factor=result.scale*result.frame.w/snapshot.size.x;
 near(points[1][0]-points[0][0],80*factor,name+' square width in PNG');near(points[2][1]-points[1][1],80*factor,name+' square height in PNG');
 near(points[0][0],result.scale*(result.frame.x+projected[0][0]*result.frame.w/snapshot.size.x),name+' rendered x matches captured point');
 near(points[0][1],result.scale*(result.frame.y+projected[0][1]*result.frame.h/snapshot.size.y),name+' rendered y matches captured point');
}
const laptop=makeMap(1366,704),crop=layout(laptop,{panelWidth:292}),full=E.capture({map:laptop,data}),cut=E.capture({map:laptop,data,viewport:crop});
assert(cut.size.x<full.size.x&&cut.size.y<full.size.y,'records panel and timeline are cropped, not replaced with hidden map area');
assert(cut.bounds.east<full.bounds.east,'export extent excludes geography hidden behind the right panel');
assert.equal(full.size.x,1366,'direct capture without a viewport retains the whole canvas');
assert.throws(()=>E.capture({map:laptop,data,viewport:{x:0,y:0,width:0,height:600}}),/visible map area/);
assert(E.notes({...cut,state:{mode:'all'},events:[],references:[]},'Map').includes(JSON.stringify(cut.bounds)),'downloaded notes describe the cropped bounds');

// A named crossing repeats exactly one mark of a dotted border, at every zoom.
// The exported explanation must not imply a whole frontier.
const pointMap=makeMap(900,600),pointLL=pointMap.containerPointToLatLng([450,300]);
const pointFeature={type:'Feature',properties:{location_id:'named-post',name:'Named post',precision:'approximate_crossing_area',display_role:'crossing_reference',source_note:'Source identifies the crossing area.',sources:[{url:'https://www.openstreetmap.org/node/1'}]},geometry:{type:'Point',coordinates:[pointLL.lng,pointLL.lat]}};
assert(K.isMapReference(pointFeature));assert(!K.isLineReference(pointFeature));
assert(!K.isMapReference({geometry:{type:'MultiPoint',coordinates:[]}}),'separate crossing bindings use separate points');
const limitedLine=K.symbolStyle({display_role:'frontier_context'},{records:[{scope:'Selected crossings'}]});
assert.equal(limitedLine.width,2.7);assert.deepEqual(limitedLine.dash,[1,7],'existing dotted border pattern is unchanged');
for(const zoom of [1,3.99,4,6.99,7,15]){
 const single=K.symbolStyle(pointFeature.properties,{zoom,count:1}),many=K.symbolStyle(pointFeature.properties,{zoom,count:700,selected:true});
 assert.equal(single.radius*2,limitedLine.width);assert.equal(single.pointLength,limitedLine.dash[0]);assert.equal(many.radius,single.radius,'neither zoom, record count nor selection enlarges the dot');
 assert.equal(K.pointDiameter(zoom),2.7);assert.equal(single.pointStrokeWidth,0,'there is no extra white outline');assert.equal(single.pointStroke,'none');assert(single.hitRadius>=22,'small dot retains a phone-sized invisible target');
}
const pointEvent={id:'point-event',title:'Crossing restriction',rationales:['Environment and resource management'],duration_periods:[{period_id:'point-phase',scope:'Named post road freight',kind:'closed_interval',start_earliest:'2020-01-01',start_latest:'2020-01-01',end_earliest:'2020-02-01',end_latest:'2020-02-01'},{period_id:'other-phase',scope:'All borders'}]};
const savedCore=w.BorderCore;
w.BorderCore={...C,recordsForLocation(items,id,source,state){assert.equal(id,'named-post');assert.equal(items[0].id,'point-event');assert.equal(state.mode,'all');return items.map(e=>({...e,duration_periods:e.duration_periods.filter(p=>p.period_id==='point-phase')}));}};
const awaitingEvent={id:'awaiting-event',duration_periods:[{period_id:'awaiting-phase',scope:'Another named crossing'}]};
const pointData={...data,locations:{type:'FeatureCollection',features:[pointFeature]},crossing_map:{phases:{'point-phase':{record_id:'point-event',category:'single_site',site_ids:['named-post']},'other-phase':{record_id:'point-event',category:'single_site',site_ids:[]},'awaiting-phase':{record_id:'awaiting-event',category:'single_site',site_ids:[]}},undated:{}}};
const pointSnapshot=E.capture({map:pointMap,data:pointData,visible:[pointEvent,awaitingEvent],locationEvents:new Map([['named-post',[pointEvent]]]),state:{mode:'all'}});
w.BorderCore=savedCore;
assert.equal(pointSnapshot.references.length,1);assert.equal(pointSnapshot.references[0].feature.geometry.type,'Point');
assert.deepEqual(plain(pointSnapshot.references[0].phases),[{record_id:'point-event',phase_ids:['point-phase']}],'snapshot retains only the phases bound to this point');
assert.equal(pointSnapshot.references[0].rationale.colour,K.rationaleStyle([pointEvent]).colour);
const pointRender=E.render(pointSnapshot,'Crossing map'),pointFactor=pointRender.scale*pointRender.frame.w/pointSnapshot.size.x;
const pointStroke=canvas.context.strokes[0];
assert.equal(pointStroke.cap,'round');assert.equal(pointStroke.rawWidth,limitedLine.width);assert.equal(pointStroke.colour,pointSnapshot.references[0].rationale.colour);
near(pointStroke.points[1][0]-pointStroke.points[0][0],limitedLine.dash[0]*pointFactor,'export draws exactly one existing border dash');
near(pointStroke.points[1][1]-pointStroke.points[0][1],0,'standalone dash is horizontal');
near(pointStroke.width,2.7*pointFactor,'standalone mark height equals the normal border line width');
near(pointStroke.points[1][0]-pointStroke.points[0][0]+pointStroke.width,3.7*pointFactor,'round caps give the same 3.7 by 2.7 pixel footprint');
assert(canvas.context.texts.includes('Named crossing'),'PNG key explains dots');
assert(!canvas.context.texts.includes('Limited or uncertain scope'),'a point-only view does not advertise a dotted border line');
assert(!canvas.context.texts.includes('1'),'no numbered count bubble is drawn');
const pointNotes=E.notes({...pointSnapshot,events:[]},'Crossing map');
assert(pointNotes.includes('Mapped phases: point-event — point-phase'));
assert(pointNotes.includes('approximate crossing area'));
assert(pointNotes.includes('does not show duration, severity or record count'));
assert(!pointNotes.includes('Crossing points are not displayed'));
assert.deepEqual(plain(pointSnapshot.mappingSummary),{pendingRecords:2,unmappedRecords:1},'pending summary counts partially and fully unmapped records separately');
assert(pointNotes.includes('Locations awaiting checks: 2 records, including 1 with no map position'));
assert(E.notes({...pointSnapshot,state:{mode:'all',precision:'unlocated'},events:[]},'Crossing map').includes('Locations awaiting checks'));

// Earlier crossings are a separate, immutable reference layer: no extra active
// records or reference counts, and no inherited active rationale or duration.
const historicalFeature=plain(pointFeature);historicalFeature.properties.location_id='earlier-post';historicalFeature.properties.name='Earlier post';
const oldPoint=pointMap.containerPointToLatLng([400,300]);historicalFeature.geometry.coordinates=[oldPoint.lng,oldPoint.lat];
const historicalPhase={period_id:'earlier-phase',start_earliest:'2018-01-01',start_latest:'2018-01-02',end_earliest:'2018-02-01',end_latest:'2018-02-02',last_confirmed:'2018-01-20',evidence_dates:['2018-01-20'],end_is_reopening:true,observed_reopening:'Reopening documented',display:'Do not inherit this duration as current'};
const historicalRecord={id:'earlier-event',title:'Old crossing restriction',rationales:['Security'],source_urls:['https://example.invalid/history'],duration_periods:[historicalPhase]};
const historyLocations=[{feature:historicalFeature,locationId:'earlier-post',title:'Earlier post',records:[{record:historicalRecord,phases:[historicalPhase],latestEvidenceDate:'2018-02-02'}],latestEvidenceDate:'2018-02-02'}];
const borderStart=pointMap.containerPointToLatLng([300,300]),borderEnd=pointMap.containerPointToLatLng([600,300]);
const historyData={...pointData,borders:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[borderStart.lng,borderStart.lat],[borderEnd.lng,borderEnd.lat]]}}]}};
const historySnapshot=E.capture({map:pointMap,data:historyData,visible:[pointEvent],locationEvents:new Map([['named-post',[pointEvent]]]),historyLocations,state:{mode:'all',showHistory:true}});
assert.equal(historySnapshot.events.length,1);assert.equal(historySnapshot.references.length,1);assert.equal(historySnapshot.historyReferences.length,1);
assert(!historySnapshot.events.some(event=>event.id==='earlier-event'),'history never enters the active event selection');
assert(!historySnapshot.references.some(reference=>reference.feature.properties.location_id==='earlier-post'),'history never enters active reference totals');
assert.deepEqual(Object.keys(historySnapshot.historyReferences[0]).sort(),['geometry','latestEvidenceDate','locationId','records','title']);
assert.deepEqual(plain(historySnapshot.historyReferences[0].records[0]),{recordId:'earlier-event',latestEvidenceDate:'2018-02-02',phases:[{phaseId:'earlier-phase',startEarliest:'2018-01-01',startLatest:'2018-01-02',endEarliest:'2018-02-01',endLatest:'2018-02-02',lastConfirmed:'2018-01-20',evidenceDates:['2018-01-20']}]});
historicalFeature.geometry.coordinates[0]+=20;historicalRecord.id='changed-record';historicalPhase.evidence_dates.push('2025-01-01');historicalPhase.start_earliest='2025-01-01';historyLocations[0].title='Changed title';historyLocations[0].latestEvidenceDate='2025-01-01';
near(historySnapshot.historyReferences[0].geometry.coordinates[0],oldPoint.lng,'history geometry is captured before later changes');assert.equal(historySnapshot.historyReferences[0].title,'Earlier post');assert.equal(historySnapshot.historyReferences[0].latestEvidenceDate,'2018-02-02');assert.equal(historySnapshot.historyReferences[0].records[0].recordId,'earlier-event');assert.deepEqual(plain(historySnapshot.historyReferences[0].records[0].phases[0].evidenceDates),['2018-01-20']);assert.equal(historySnapshot.historyReferences[0].records[0].phases[0].startEarliest,'2018-01-01');
const historyRender=E.render(historySnapshot,'Current view with earlier histories'),historyFactor=historyRender.scale*historyRender.frame.w/historySnapshot.size.x;
const ring=canvas.context.strokes.find(mark=>mark.colour==='#86928b'&&mark.arcs.length);
assert(ring,'PNG draws the earlier-history ring');assert.equal(ring.rawWidth,1);assert.equal(ring.arcs[0].rawRadius,2.5);near(ring.arcs[0].radius*2+ring.width,6*historyFactor,'history ring has the same 6 px outer diameter as the map');
assert(canvas.context.fills.some(mark=>mark.colour==='#f5f6f4'&&mark.arcs.some(arc=>arc.rawRadius===2.5)),'history ring has the neutral map background');
const borderOperation=canvas.context.operations.findIndex(operation=>operation.type==='stroke'&&operation.mark.colour===K.colours.border),ringOperation=canvas.context.operations.findIndex(operation=>operation.mark===ring),activeOperation=canvas.context.operations.findIndex(operation=>operation.type==='stroke'&&operation.mark.colour===historySnapshot.references[0].rationale.colour);
assert(borderOperation>=0&&borderOperation<ringOperation,'history rings draw after border lines');assert(activeOperation>ringOperation,'active coloured points draw above history rings');
assert(canvas.context.texts.includes('Earlier restriction · read dated history'));
assert(canvas.context.texts.some(text=>text.startsWith('Selection: 1 records · 1 map references.')),'history does not inflate the PNG selection caption');
const historyNotes=E.notes({...historySnapshot,events:[{id:'point-event',title:'Current selection',duration_periods:[]}]},'Current view with earlier histories');
assert(historyNotes.includes('Selection: 1 records; 1 map references.'));const historyHeading=historyNotes.indexOf('EARLIER RESTRICTIONS — DATED HISTORY');assert(historyHeading>historyNotes.indexOf('EVENT REFERENCES'));assert(historyNotes.indexOf('Historical record: earlier-event')>historyHeading);assert(!historyNotes.slice(0,historyHeading).includes('earlier-event'));assert(historyNotes.includes('Latest recorded evidence: 2 Feb 2018'));assert(historyNotes.includes('Recorded start bounds: 1 Jan 2018 to 2 Jan 2018'));assert(historyNotes.includes('do not establish crossing conditions in the selected month'));assert(!historyNotes.includes('Do not inherit this duration as current'));
assert(historyNotes.includes('including records with a documented reopening'),'history is not restricted to cases with unknown reopening');
const onlyHistory={...historySnapshot,events:[],references:[]};E.render(onlyHistory,'Earlier histories');assert(canvas.context.texts.some(text=>text.startsWith('Selection: 0 records · 0 map references.')));assert(!canvas.context.texts.includes('Named crossing'),'a history-only key does not advertise active crossing points');

const historyOff=E.capture({map:pointMap,data:historyData,visible:[pointEvent],locationEvents:new Map([['named-post',[pointEvent]]]),historyLocations,state:{mode:'all',showHistory:false}});
assert.equal(historyOff.historyReferences.length,0,'off ignores even a stale supplied history list');
assert.equal(historyOff.events.length,1);assert.equal(historyOff.references.length,1);
E.render(historyOff,'Earlier histories switched off');
assert(!canvas.context.strokes.some(mark=>mark.colour==='#86928b'),'off draws no history ring or ring key');
assert(!canvas.context.texts.some(text=>/Earlier restriction|Hollow grey rings/i.test(text)),'off shows no history legend or caption');
const offNotes=E.notes({...historyOff,events:[]},'Earlier histories switched off');
assert(!offNotes.includes('EARLIER RESTRICTIONS — DATED HISTORY'));assert(!offNotes.includes('Historical record:'));
assert.equal(E.capture({map:pointMap,data:pointData,state:{mode:'all'}}).historyReferences.length,0,'omitting the optional layer captures no history');

// Full country reference geometries use the same unfilled green outline for
// bans and conditions. England's legal scope does not create an internal line.
const ringFromPixels=points=>points.map(point=>{const ll=pointMap.containerPointToLatLng(point);return [ll.lng,ll.lat]});
const mainland=ringFromPixels([[350,200],[530,180],[550,380],[360,390],[350,200]]);
const island=ringFromPixels([[270,260],[310,250],[320,300],[275,305],[270,260]]);
for(const [code,name] of [['GBR','United Kingdom'],['AUS','Australia'],['NZL','New Zealand']])for(const kind of ['prohibition','entry_conditions']){
 const geometry=code==='AUS'?{type:'Polygon',coordinates:[mainland]}:{type:'MultiPolygon',coordinates:[[mainland],[island]]};
 const feature={type:'Feature',geometry:plain(geometry),properties:{location_id:'national-'+code,map_country:code,label:name+' · international passenger rules',display_role:'national_policy',precision:'Country reference outline; legal jurisdiction is stated in each record',source_note:'Full-country reference geography.'}};
 const england={type:'Feature',geometry:{type:'LineString',coordinates:mainland.slice(0,2)},properties:{location_id:'unused-England-boundary',display_role:'frontier_context'}};
 const event={id:'passenger-rule',title:'Passenger rules',record_kind:'national_policy',national_kind:kind,national_geometry:code==='GBR'?'ENG':code,national_map_country:code,location_ids:['national-'+code],scope:code==='GBR'?'England':name,rationales:['Health and biosecurity'],duration_periods:[],linked_land_ids:[],national_summary:'Dated passenger rules.'};
 const selected=code==='GBR'&&kind==='prohibition';
 const snapshot=E.capture({map:pointMap,data:{...data,countries:{type:'FeatureCollection',features:[{type:'Feature',geometry,properties:{ADM0_A3:code}}]},borders:historyData.borders,context_locations:{type:'FeatureCollection',features:[feature,england]}},visible:[event],locationEvents:new Map([['national-'+code,[event]]]),selected:selected?event.id:null,state:{mode:'all',showHistory:false}});
 assert.equal(snapshot.references.length,1,'country policy yields only the bound country reference');
 assert.deepEqual(plain(snapshot.references[0].feature.geometry),plain(geometry),'snapshot keeps the full country geometry, including separate islands');
 feature.geometry.coordinates=[];
 assert.deepEqual(plain(snapshot.references[0].feature.geometry),plain(geometry),'country geometry is immutable after capture');
 const result=E.render(snapshot,'Passenger rules'),factor=result.scale*result.frame.w/snapshot.size.x,style=K.symbolStyle(feature.properties,{records:[event],selected});
 const coordinates=geometry.type==='Polygon'?geometry.coordinates.flat():geometry.coordinates.flat(2);
 const stroke=canvas.context.strokes.find(mark=>mark.colour==='#287e67'&&mark.rawWidth===style.width&&mark.points.length===coordinates.length);
 assert(stroke,'PNG draws the entire green country outline');
 assert.equal(stroke.rawWidth,selected?3.8:2.4);assert.equal(stroke.opacity,.9);assert.deepEqual(stroke.dash,[]);
 near(stroke.width,style.width*factor,'country outline width matches the map at export scale');
 coordinates.forEach((coordinate,index)=>{const pixel=E.project(coordinate,snapshot);near(stroke.points[index][0],result.scale*result.frame.x+pixel[0]*factor,'country outline x coordinate');near(stroke.points[index][1],result.scale*result.frame.y+pixel[1]*factor,'country outline y coordinate');});
 assert(!canvas.context.fills.some(mark=>mark.colour==='#287e67'),'country outlines and key have no green area fill');
 assert(!canvas.context.rectFills.some(mark=>mark.colour==='#287e67'));assert(!canvas.context.rectStrokes.some(mark=>mark.colour==='#287e67'),'national squares are absent');
 const baseline=canvas.context.operations.findIndex(operation=>operation.type==='stroke'&&operation.mark.colour===K.colours.border),outline=canvas.context.operations.findIndex(operation=>operation.mark===stroke);
 assert(baseline>=0&&outline>baseline,'green country edges draw after the baseline borders');
 assert(canvas.context.texts.includes('Broad visitor-entry ban'));
 assert(!canvas.context.texts.includes('Named crossing'),'policy-only key does not advertise a crossing');
 const notes=E.notes(snapshot,'Passenger rules');
 assert(notes.includes('international passenger-rule country reference'));assert(notes.includes('broad bans on ordinary foreign-visitor entry')); assert(!/square/i.test(notes));
 if(code==='GBR'){assert(notes.includes('Recorded scope: England'));assert(!notes.includes('Where a record specifies England, its legal scope remains England.'));assert(!snapshot.references.some(ref=>ref.feature.properties.location_id==='unused-England-boundary'));}
}

// Exercise the real save handler: capture before asynchronous evidence loading,
// without collapsing or resizing the map as the dialog opens.
const nodes=new Map(),record={id:'example'},originalViewport=layout(laptop,{panelWidth:292});
let complete,opened,handler,passed;
const context={data,visible:[record],locationEvents:new Map(),historyLocations:[],selected:null,state:{mode:'all',showHistory:false},map:{...laptop,closePopup(){}},stop(){},notify(message){throw Error(message)},labelSpecs:()=>[],exportViewport:()=>originalViewport,
 $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'Save view',disabled:false,addEventListener(_,fn){handler=fn}});return nodes.get(id)},
 window:{BorderExport:{capture(input){passed=input;return E.capture(input)},openSnapshot(snapshot){opened=snapshot}},AtlasData:{getResearchData:()=>new Promise(resolve=>complete=resolve)}}};
vm.createContext(context);vm.runInContext(app.slice(app.indexOf("  $('save-view-button').addEventListener"),app.indexOf("  $('panel-toggle').addEventListener")),context);
(async()=>{
 const task=handler();assert.equal(passed.viewport,originalViewport);assert(context.$('save-view-button').disabled);
 context.exportViewport=()=>({x:0,y:0,width:10,height:10});context.visible=[];
 complete({events:[{...record,title:'Full evidence'}]});await task;
 assert.deepEqual(plain(opened.size),{x:originalViewport.width,y:originalViewport.height});assert.equal(opened.events[0].title,'Full evidence');assert.equal(context.$('save-view-button').disabled,false);
 console.log('Map export passed: visible-area crop, eight viewport/projection cases, uniform PNG scaling, label alignment, stable asynchronous capture, phase-specific crossings, unfilled full-country national outlines with England scope, history-off suppression, immutable 6 px optional history rings, known-reopening history wording, and no active-count inflation.');
})().catch(error=>{console.error(error);process.exitCode=1});

