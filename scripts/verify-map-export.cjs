const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../dist'),K=require(root+'/cartography.js'),C=require(root+'/core.js');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-7,label+': '+actual+' != '+expected);
const plain=value=>JSON.parse(JSON.stringify(value));
const app=fs.readFileSync(root+'/app.js','utf8');
let mobile=false,canvas;
function canvasContext(){
 const scales=[],points=[],arcs=[],texts=[],strokes=[],stack=[];let matrix={x:1,y:1,left:0,top:0},currentPath=[];
 const api={scales,points,arcs,texts,strokes,measureText:text=>({width:String(text).length*7}),
  save(){stack.push({...matrix})},restore(){matrix=stack.pop()},
  scale(x,y){scales.push([x,y]);matrix.x*=x;matrix.y*=y},
  translate(x,y){matrix.left+=x*matrix.x;matrix.top+=y*matrix.y},
  beginPath(){currentPath=[]},
  moveTo(x,y){const p=[matrix.left+x*matrix.x,matrix.top+y*matrix.y];points.push(p);currentPath.push(p)},
  lineTo(x,y){const p=[matrix.left+x*matrix.x,matrix.top+y*matrix.y];points.push(p);currentPath.push(p)},
  stroke(){strokes.push({points:currentPath.slice(),width:api.lineWidth*matrix.x,rawWidth:api.lineWidth,cap:api.lineCap,colour:api.strokeStyle})},
  arc(x,y,radius){arcs.push({x:matrix.left+x*matrix.x,y:matrix.top+y*matrix.y,radius:radius*matrix.x,rawRadius:radius})},
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

// Exercise the real save handler: capture before asynchronous evidence loading,
// without collapsing or resizing the map as the dialog opens.
const nodes=new Map(),record={id:'example'},originalViewport=layout(laptop,{panelWidth:292});
let complete,opened,handler,passed;
const context={data,visible:[record],locationEvents:new Map(),selected:null,state:{mode:'all'},map:{...laptop,closePopup(){}},stop(){},notify(message){throw Error(message)},labelSpecs:()=>[],exportViewport:()=>originalViewport,
 $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'Save view',disabled:false,addEventListener(_,fn){handler=fn}});return nodes.get(id)},
 window:{BorderExport:{capture(input){passed=input;return E.capture(input)},openSnapshot(snapshot){opened=snapshot}},AtlasData:{getResearchData:()=>new Promise(resolve=>complete=resolve)}}};
vm.createContext(context);vm.runInContext(app.slice(app.indexOf("  $('save-view-button').addEventListener"),app.indexOf("  $('panel-toggle').addEventListener")),context);
(async()=>{
 const task=handler();assert.equal(passed.viewport,originalViewport);assert(context.$('save-view-button').disabled);
 context.exportViewport=()=>({x:0,y:0,width:10,height:10});context.visible=[];
 complete({events:[{...record,title:'Full evidence'}]});await task;
 assert.deepEqual(plain(opened.size),{x:originalViewport.width,y:originalViewport.height});assert.equal(opened.events[0].title,'Full evidence');assert.equal(context.$('save-view-button').disabled,false);
 console.log('Map export passed: visible-area crop, eight viewport/projection cases, uniform PNG scaling, label alignment, cropped bounds/notes, stable capture during asynchronous loading, phase-specific crossing points, points matching dotted border marks at every zoom, and point source notes.');
})().catch(error=>{console.error(error);process.exitCode=1});

