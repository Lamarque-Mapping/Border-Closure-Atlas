const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../dist'),C=require(root+'/core.js');
const parse=file=>JSON.parse(fs.readFileSync(root+'/'+file,'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const full=parse('data.js'),plain=x=>JSON.parse(JSON.stringify(x));
function researchHash(research){
 const hash=crypto.createHash('sha256');
 hash.update(JSON.stringify(research.meta));
 for(const record of research.events)hash.update(JSON.stringify(record)+'\n');
 for(const field of ['workbook_geography','workbook_review'])for(const [name,rows] of Object.entries(research[field]||{}).sort(([a],[b])=>a.localeCompare(b))){hash.update(field+'\0'+name+'\0');for(const row of rows)hash.update(JSON.stringify(row)+'\n');}
 return hash.digest('hex');
}
const requests=[];let scripts=0,failNext=false,gate=null;
const context={console,Promise,setTimeout,clearTimeout,AbortController,location:{protocol:'https:'},document:{currentScript:{dataset:{mapSrc:'map-data.js'}},createElement(){return {remove(){}}},head:{appendChild(script){scripts++;queueMicrotask(()=>{vm.runInContext(fs.readFileSync(root+'/'+script.src,'utf8'),context);script.onload();});}}},fetch:async file=>{
 requests.push(file);if(failNext){failNext=false;return {ok:false};}if(gate)await gate;
 return {ok:true,json:async()=>JSON.parse(fs.readFileSync(root+'/'+file,'utf8'))};
}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/data-loader.js','utf8'),context);
(async()=>{
 const api=context.AtlasData,[small,again]=await Promise.all([api.ready(),api.ready()]);
 assert.equal(small,again);assert.equal(scripts,1);assert.equal(requests.length,0);
 C.validate(small);assert.equal(small.events.length,full.events.length);
 for(const k of ['countries','borders','disputed','locations','context_locations'])assert.deepEqual(plain(small[k]),full[k],k+' coordinates and provenance must be unchanged');
 for(const e of full.events){
  const summary=small.events.find(s=>s.id===e.id);
  assert.deepEqual(C.displayLocationsFor(summary,small),C.displayLocationsFor(e,full),e.id);
  const record=JSON.parse(fs.readFileSync(root+'/'+summary.details_file,'utf8'));assert.deepEqual(record.record,e,e.id+' complete evidence');
 }
 const state={query:'',continent:'',region:'',rationale:'',location:'',precision:'',measureType:'',includeExcluded:false};
 const ids=(data,s)=>plain(C.filterEvents(data,s).map(e=>e.id));
 for(const mode of ['onsets','intervals'])for(let month=C.monthOrdinal(full.meta.window_start);month<=C.monthOrdinal(full.meta.window_end);month++)assert.deepEqual(ids(small,{...state,mode,month}),ids(full,{...state,mode,month}),mode+' '+month);
 for(const rationale of full.meta.rationale_categories)assert.deepEqual(ids(small,{...state,mode:'all',rationale}),ids(full,{...state,mode:'all',rationale}));
 for(const query of ['Malaba','Rosso','freight','Pakistan','health','R16-AN-001'])assert.deepEqual(ids(small,{...state,mode:'all',query}),ids(full,{...state,mode:'all',query}));
 const id=full.events[0].id,[one,two]=await Promise.all([api.getRecord(id),api.getRecord(id)]);assert.deepEqual(plain(one),full.events[0]);assert.equal(one,two);assert.equal(requests.length,1,'coalesce repeated clicks');
 failNext=true;await assert.rejects(api.getRecord(full.events[1].id));assert.deepEqual(plain(await api.getRecord(full.events[1].id)),full.events[1],'retry after failed retrieval');
 const completeResearch={meta:full.meta,events:full.events,workbook_geography:full.workbook_geography,workbook_review:full.workbook_review};
 const research=await api.getResearchData();assert.equal(researchHash(research),researchHash(completeResearch),'complete research rows and all workbook tables are preserved exactly');
 const count=requests.length;assert.deepEqual(plain(await api.getRecord(full.events[2].id)),full.events[2]);assert.equal(requests.length,count,'reuse downloaded archive');
 const offline={window:null,document:{currentScript:null},location:{protocol:'file:'},BORDER_DATA:full};offline.window=offline;vm.createContext(offline);vm.runInContext(fs.readFileSync(root+'/data-loader.js','utf8'),offline);
 assert.equal(await offline.AtlasData.ready(),full);assert.equal(await offline.AtlasData.getRecord(id),full.events[0]);
 assert.equal(researchHash(await offline.AtlasData.getResearchData()),researchHash(completeResearch));
 console.log('Loading passed: one initial request; exact geometry; all 701 complete records; all monthly timeline results; search/filter equivalence; cached detail requests; failed-request retry; complete exports; offline data.');
})().catch(error=>{console.error(error);process.exitCode=1});
