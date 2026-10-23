const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const path=require('node:path'),root=path.resolve(__dirname,'../dist');
const data=JSON.parse(fs.readFileSync(path.join(root,'data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const C=require(path.join(root,'core.js')),E=require(path.join(root,'record-export.js'));
const publicContext={};vm.createContext(publicContext);vm.runInContext(fs.readFileSync(path.join(root,'public-text.js'),'utf8'),publicContext);
const cleanText=publicContext.BorderPublic.text;
function parse(content){
 const result=spawnSync('python',['-c','import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().lstrip("\\ufeff"))))))'],{input:content,encoding:'utf8',maxBuffer:32*1024*1024});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
function check(state){
 const records=C.filterEvents(data,state),file=E.build({records,state,cleanText}),rows=parse(file.content),header=rows.shift();
 assert(file.content.startsWith('\ufeff'));assert.equal(rows.length,records.length);assert.deepEqual(rows.map(row=>row[0]),records.map(record=>record.id));
 for(let i=0;i<rows.length;i++){
  assert.equal(rows[i].length,header.length);
  assert.equal(rows[i][header.indexOf('Closure')],cleanText(records[i].title,'title',records[i].id));
  for(const source of records[i].sources||[])if(/^https?:/.test(source.url))assert(rows[i][header.indexOf('Source links')].includes(new URL(source.url).href),records[i].id+' source');
  for(const period of records[i].duration_periods||[])assert(rows[i][header.indexOf('Documented dates')].includes(period.period_id),records[i].id+' phase');
 }
 return {records,rows,header,file};
}
// Counts and default IDs independently reconciled to Register / Chronology
// phases / Phase locations in the 23 October replacement workbook.
const all=check({mode:'all',query:''});assert.equal(all.records.length,697);assert(all.rows.length>50);
const rwanda=check({mode:'all',query:'Rwanda'});assert(rwanda.records.length>1&&rwanda.records.length<all.records.length);
const dated=check({mode:'intervals',query:'',month:C.monthOrdinal(data.meta.window_start)});
assert.deepEqual(dated.records.map(e=>e.id).sort(),['CC004','CC028','CC029','EA025','FU-COV-EAS-003','H01','H02','ME004','ME005','ME030','NA001','NA019','R16-AN-002','R2-SC-010','R3-ME-010','R3-SC-005','R4-SC-001','R6-AWN-001','SC06']);
const excluded=check({mode:'all',query:'',includeExcluded:true});assert.equal(excluded.records.length,701);
const gl=rwanda.rows.find(row=>row[0]==='GL01');assert(gl[rwanda.header.indexOf('Documented dates')].includes('Held / contested'));assert(gl[rwanda.header.indexOf('Duration (days)')].includes('numeric duration withheld'));
for(let i=1;i<=6;i++)assert(gl[rwanda.header.indexOf('Documented dates')].includes('GL01-C7RWP'+i),'CSV retains each corrected Rwanda passenger phase');
const edge={...rwanda.records[0],id:'TEST',title:'\t=1+1',context:'Quoted "text", comma\nand another line: Côte d’Ivoire',scope:'@command',exceptions:'-danger'};
const edgeRows=parse(E.build({records:[edge],state:{mode:'all'},cleanText:v=>String(v??'')}).content),edgeRow=edgeRows[1],edgeHeader=edgeRows[0];
assert.equal(edgeRow[1],"'\t=1+1");assert.equal(edgeRow[edgeHeader.indexOf('Context')],edge.context);assert.equal(edgeRow[edgeHeader.indexOf('Geographical scope')],"'@command");assert.equal(edgeRow[edgeHeader.indexOf('Exceptions')],"'-danger");
assert.equal(parse(E.build({records:[],state:{mode:'all'}}).content).length,1);

// Exercise the actual application snapshot and reading-view handlers.
const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),nodes=new Map(),ctx={};
function node(id){
 if(nodes.has(id))return nodes.get(id);
 const listeners={},classes=new Set(),el={id,open:false,hidden:false,isConnected:true,textContent:'',attrs:{},children:[],classList:{contains:k=>classes.has(k)},
  appendChild(child){child.parentNode?.children.splice(child.parentNode.children.indexOf(child),1);this.children.push(child);child.parentNode=this;},
  insertBefore(child,before){child.parentNode?.children.splice(child.parentNode.children.indexOf(child),1);this.children.splice(Math.max(0,this.children.indexOf(before)),0,child);child.parentNode=this;},
  setAttribute(k,v){this.attrs[k]=v},focus(){ctx.document.activeElement=this},showModal(){this.open=true},close(){this.open=false;for(const fn of listeners.close||[])fn();},
  addEventListener(type,fn){(listeners[type]??=[]).push(fn)}};
 nodes.set(id,el);return el;
}
Object.assign(ctx,{$:node,C,data,state:{mode:'all',query:'Rwanda',location:'',continent:'',month:0},visible:rwanda.records,selected:null,exportingRecords:false,recordsReturnFocus:null,
 locations:new Map(C.locationFeatures(data).map(f=>[f.properties.location_id,f])),locationTitle:(p,id)=>p.label||p.name||id,monthLabel:String,publicText:cleanText,
 document:{activeElement:node('read-records')},map:{closePopup(){}},stop(){},resetList(){},showBrowse(){ctx.selected=null},setPanelOpen(){},scheduleViewport(){},showEvent(){},
 render(){ctx.visible=C.filterEvents(data,ctx.state)},notify(message){ctx.notice=message},window:{AtlasData:{getResearchData:async()=>data},AtlasNavigation:{getAnalysisURL:hash=>'https://border-closures-atlas.lamarque.chatgpt.site/#analysis'+hash.replace('#','/')},BorderRecordExport:{...E,download(output){ctx.output=output}}}});
vm.createContext(ctx);
vm.runInContext(app.slice(app.indexOf('  function updateRecordsControls('),app.indexOf('  function setRecordView(')),ctx);
vm.runInContext(app.slice(app.indexOf("  $('read-records').addEventListener"),app.indexOf('  const showPage=')),ctx);
node('explore-panel').appendChild(node('panel-scroll'));node('explore-panel').appendChild(node('map-key'));
ctx.openRecords();assert(node('records-dialog').open);assert.equal(node('panel-scroll').parentNode,node('records-body'));assert.equal(node('continent-panel').attrs['aria-labelledby'],'records-heading');
node('records-dialog').close();assert.equal(node('panel-scroll').parentNode,node('explore-panel'));assert.equal(ctx.document.activeElement,node('read-records'));
vm.runInContext(app.slice(app.indexOf('  function activateLocation('),app.indexOf('  function cardBoundary(')),ctx);
const frontier=[...ctx.locations.keys()].find(id=>rwanda.records.filter(e=>C.displayLocationsFor(e,data).includes(id)).length>1);
assert(frontier);ctx.activateLocation(frontier,rwanda.records.filter(e=>C.displayLocationsFor(e,data).includes(frontier)));assert(node('records-dialog').open);assert(ctx.visible.length>1);assert(ctx.visible.every(e=>C.displayLocationsFor(e,data).includes(frontier)));node('records-dialog').close();
(async()=>{
 ctx.state={mode:'all',query:'Rwanda',location:'',continent:'',month:0};ctx.visible=rwanda.records;
 let complete;ctx.window.AtlasData.getResearchData=()=>new Promise(resolve=>complete=resolve);
 const pending=ctx.downloadRecords();assert(node('download-records').disabled);
 ctx.state.query='Norway';ctx.visible=C.filterEvents(data,ctx.state);complete(data);await pending;
 const rows=parse(ctx.output.content);assert.deepEqual(rows.slice(1).map(row=>row[0]),rwanda.records.map(e=>e.id),'export retains the selection captured before asynchronous loading');assert(ctx.output.filename.includes('rwanda'));assert.equal(node('download-records').disabled,false);
 ctx.output=null;ctx.window.AtlasData.getResearchData=async()=>({...data,events:[]});await ctx.downloadRecords();assert.equal(ctx.output,null);assert(ctx.notice.includes('do not match'));assert.equal(node('download-records').disabled,false);
 ctx.visible=[];ctx.output=null;await ctx.downloadRecords();assert.equal(ctx.output,null);
 console.log('CSV and reader passed: '+rwanda.records.length+' Rwanda matches; exact filtered IDs, all 697 included records beyond pagination, dated/excluded filters, corrected Rwanda phase/source preservation, UTF-8/quotes/newlines, formula-safe text, asynchronous snapshot, missing-data error, and wide-view open/return.');
})().catch(error=>{console.error(error);process.exitCode=1});
