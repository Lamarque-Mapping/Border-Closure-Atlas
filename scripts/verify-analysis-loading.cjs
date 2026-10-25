/* The faster entry path must preserve the map's land records and all chart inputs. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../dist'),metrics=require('./analysis-metrics.js');
const plain=v=>JSON.parse(JSON.stringify(v)),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const map=JSON.parse(read('map-data.js').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,'')),analysis=JSON.parse(read('analysis-data.json'));
const land=map.events.filter(e=>e.record_kind!=='national_policy');
assert.deepEqual(analysis.meta,map.meta,'same release and complete metadata');
assert.deepEqual(analysis.events,land,'every browsing field, search term, date and detail link is retained');
assert.equal(Object.keys(analysis).sort().join(','),'events,meta','no geometry on the Analysis entry path');
const select=(events,pop)=>events.filter(e=>!e.quarantined&&(pop==='all'||e.timing_coverage[pop]));
for(const pop of ['all','operational_complete','operational_exact_complete']){
 const a=select(land,pop),b=select(analysis.events,pop);
 assert.deepEqual(metrics.durationRows(b),metrics.durationRows(a),pop+' duration export rows');
 assert.deepEqual(metrics.durationGroups(b,map.meta.rationale_categories),metrics.durationGroups(a,map.meta.rationale_categories),pop+' duration statistics and coverage');
 assert.deepEqual(metrics.continents(b),metrics.continents(a),pop+' continents');
 for(const code of map.meta.rationale_categories)assert.equal(b.filter(e=>e.rationales.includes(code)).length,a.filter(e=>e.rationales.includes(code)).length,pop+' '+code);
}
const html=read('analysis.html');
assert.ok(html.includes('const shared=await (provider.getAnalysisData?provider.getAnalysisData():provider.ready());'));
assert.ok(html.includes("shared.events.filter(e=>e.record_kind!=='national_policy'&&e.record_kind!=='border_status')"),'national additions remain outside Analysis');
assert.ok(html.includes(fs.readFileSync(path.join(__dirname,'analysis-metrics.js'),'utf8').trim()),'deployed chart arithmetic matches the checked metric functions');
const index=read('index.html'),source=index.match(/data-analysis-src="([^"]+)"/)[1],sha=index.match(/data-source-sha="([^"]+)"/)[1];
assert.equal(sha,analysis.meta.source_sha256);assert.ok(html.includes('script.dataset.analysisSrc="'+source+'"'));
const loader=read('data-loader.js');
function harness(options={}){
 const requests=[],scripts=[],responses=new Map(),record={...analysis.events[0],sources:[{title:'Complete source history',access_history:[{stage:'Review',access:'Full text'}]}]};
 responses.set(analysis.events[0].details_file,{source_sha256:sha,record});
 const fullEvents=analysis.events.map((e,i)=>i?e:record);
 const archive={meta:analysis.meta,events_parts:['part-a.json','part-b.json'],workbook_review:{Notes:[{finding:'Retained evidence'}]},workbook_geography:{Locations:[{name:'Retained geography'}]}};
 responses.set(analysis.meta.web_assets.research,archive);
 responses.set('part-a.json',{source_sha256:sha,events:fullEvents.slice(0,350)});
 responses.set('part-b.json',{source_sha256:sha,events:fullEvents.slice(350)});
 let fail=false;
 const context={console,Promise,setTimeout,clearTimeout,AbortController,location:{protocol:options.offline?'file:':'https:'},document:{currentScript:{dataset:{mapSrc:'map-data.js',analysisSrc:source,sourceSha:sha}},createElement:()=>({remove(){}}),head:{appendChild(script){scripts.push(script.src);queueMicrotask(()=>{context.BORDER_DATA=plain(map);script.onload();});}}},fetch:async file=>{
  requests.push(file);if(fail){fail=false;return {ok:false};}
  const value=file===source?(options.analysis||analysis):responses.get(file);
  if(value===undefined)throw Error('Unexpected request: '+file);
  return {ok:true,json:async()=>plain(value)};
 }};
 context.window=context;if(options.mapLoaded||options.offline)context.BORDER_DATA=plain(map);
 vm.createContext(context);vm.runInContext(loader,context);
 return {api:context.AtlasData,context,requests,scripts,responses,record,fullEvents,archive,failNext:()=>{fail=true;}};
}
(async()=>{
 const h=harness(),[a,b]=await Promise.all([h.api.getAnalysisData(),h.api.getAnalysisData()]);
 assert.equal(a,b);assert.deepEqual(plain(a),analysis);assert.deepEqual(h.requests,[source]);assert.equal(h.scripts.length,0,'Analysis does not request a map script');
 const [r1,r2]=await Promise.all([h.api.getRecord(h.record.id),h.api.getRecord(h.record.id)]);
 assert.equal(r1,r2);assert.deepEqual(plain(r1),h.record,'complete detail unchanged');assert.equal(h.requests.length,2,'one detail request');assert.equal(h.scripts.length,0);
 const full=await h.api.getResearchData();assert.deepEqual(plain(full.events),h.fullEvents,'all research records remain in full exports');assert.deepEqual(plain(full.workbook_review),h.archive.workbook_review);assert.equal(h.scripts.length,0,'exports do not need map geometry');
 const n=h.requests.length;await h.api.getRecord(land[1].id);assert.equal(h.requests.length,n,'reuse full research after a download');
 await h.api.ready();assert.equal(h.scripts.length,1,'map remains available after Analysis');
 const warm=harness({mapLoaded:true});await warm.api.getAnalysisData();assert.equal(warm.requests.length,0,'reuse the loaded map without a duplicate download');
 const pending=harness();const mapPromise=pending.api.ready();await pending.api.getAnalysisData();await mapPromise;assert.equal(pending.requests.length,0,'share an in-flight map download');
 const retry=harness();retry.failNext();await assert.rejects(retry.api.getAnalysisData());await retry.api.getAnalysisData();assert.equal(retry.requests.length,2,'failed Analysis requests can retry');
 const wrong=harness({analysis:{...analysis,meta:{...analysis.meta,source_sha256:'other'}}});await assert.rejects(wrong.api.getAnalysisData(),/version/);
 const badDetail=harness();await badDetail.api.getAnalysisData();badDetail.responses.set(land[0].details_file,{source_sha256:'other',record:badDetail.record});await assert.rejects(badDetail.api.getRecord(land[0].id),/version/);
 const badArchive=harness();await badArchive.api.getAnalysisData();badArchive.responses.set('part-b.json',{source_sha256:'other',events:badArchive.fullEvents.slice(350)});await assert.rejects(badArchive.api.getResearchData(),/version/);
 const offline=harness({offline:true});await offline.api.getAnalysisData();assert.equal(offline.requests.length,0,'offline data stays supported');
 const saved=100*(1-zlib.gzipSync(read('analysis-data.json')).length/zlib.gzipSync(read('map-data.js')).length);
 console.log('Analysis loading passed: '+land.length+' records identical; all three chart populations, duration exports and search fields unchanged; no map request for Analysis/details/exports; cached requests; retries; release mismatch rejection; offline support.');
 console.log('Cold Analysis data: '+saved.toFixed(1)+'% smaller with gzip than the map payload.');
})().catch(error=>{console.error(error);process.exitCode=1;});
