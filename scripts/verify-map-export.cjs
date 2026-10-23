const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../dist'),K=require(root+'/cartography.js'),C=require(root+'/core.js');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-7,label+': '+actual+' != '+expected);
const plain=value=>JSON.parse(JSON.stringify(value));
const app=fs.readFileSync(root+'/app.js','utf8');
let mobile=false,canvas;
function canvasContext(){
 const scales=[],points=[],stack=[];let matrix={x:1,y:1,left:0,top:0};
 const api={scales,points,measureText:text=>({width:String(text).length*7}),
  save(){stack.push({...matrix})},restore(){matrix=stack.pop()},
  scale(x,y){scales.push([x,y]);matrix.x*=x;matrix.y*=y},
  translate(x,y){matrix.left+=x*matrix.x;matrix.top+=y*matrix.y},
  moveTo(x,y){points.push([matrix.left+x*matrix.x,matrix.top+y*matrix.y])},
  lineTo(x,y){points.push([matrix.left+x*matrix.x,matrix.top+y*matrix.y])}};
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
 console.log('Map export passed: visible-area crop, eight viewport/projection cases, uniform PNG scaling, label alignment, cropped bounds/notes, and stable capture during asynchronous loading.');
})().catch(error=>{console.error(error);process.exitCode=1});
