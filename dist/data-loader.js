(function(){
 'use strict';
 const offline=window.location?.protocol==='file:',settings=document.currentScript?.dataset||{};
 const mapSource=offline?'data.js':settings.mapSrc||'map-data.js';
 const analysisSource=settings.analysisSrc||'analysis-data.json',expectedSource=settings.sourceSha;
 let initial=null,analysis=null,analysisData=null,research=null,researchByID=null;
 const records=new Map();
 function unpack(data){
  if(expectedSource&&data.meta?.source_sha256!==expectedSource||analysisData&&data.meta?.source_sha256!==analysisData.meta.source_sha256)throw Error('The map and analysis do not match this atlas version. Please reload.');
  if(data.geometry_pool){
   const pool=data.geometry_pool;
   for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of data[key].features){
    if(!Number.isInteger(f.geometry)||!pool[f.geometry])throw Error('The map geometry could not be loaded.');
    f.geometry=pool[f.geometry];
   }
   delete data.geometry_pool;
  }
  return window.AtlasNational?window.AtlasNational.attach(data):data;
 }
 function ready(){
  if(window.BORDER_DATA)return Promise.resolve().then(()=>unpack(window.BORDER_DATA));
  if(!initial)initial=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=mapSource;
   const timeout=setTimeout(()=>{script.remove();initial=null;reject(Error('The map data took too long to load. Please try again.'));},30000);
   const finish=()=>{clearTimeout(timeout);script.remove();};
   script.onload=()=>{finish();try{if(!window.BORDER_DATA)throw Error('The map data is missing.');resolve(unpack(window.BORDER_DATA));}catch(error){initial=null;reject(error);}};
   script.onerror=()=>{finish();initial=null;reject(Error('The map data could not be loaded. Please try again.'));};
   document.head.appendChild(script);
  });
  return initial;
 }
 async function readJSON(file){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(file,{signal:controller.signal});if(!response.ok)throw Error('The record could not be loaded. Please try again.');return await response.json();}
  catch(error){if(error.name==='AbortError')throw Error('Loading took too long. Please try again.');throw error;}
  finally{clearTimeout(timeout);}
 }
 async function getAnalysisData(){
  // Reuse an already requested map. Do not download the same records twice.
  if(window.BORDER_DATA||initial||offline)return ready();
  if(!analysis)analysis=readJSON(analysisSource).then(value=>{
   if(!value.meta?.source_sha256||expectedSource&&value.meta.source_sha256!==expectedSource||!Array.isArray(value.events)||new Set(value.events.map(e=>e.id)).size!==value.events.length||value.events.some(e=>e.record_kind==='national_policy'))throw Error('The analysis does not match this atlas version. Please reload.');
   if(window.BORDER_DATA&&window.BORDER_DATA.meta.source_sha256!==value.meta.source_sha256)throw Error('The map and analysis do not match this atlas version. Please reload.');
   analysisData=value;return value;
  }).catch(error=>{analysis=null;throw error;});
  return analysis;
 }
 function catalogue(){return window.BORDER_DATA||initial||offline?ready():analysis||getAnalysisData();}
 async function getRecord(id){
  const data=await (/^NATIONAL-/.test(id)?ready():catalogue());
  const summary=data.events.find(e=>e.id===id);if(!summary)throw Error('This record could not be found.');
  if(summary.record_kind==='national_policy')return summary;
  if(researchByID)return researchByID.get(id);
  if(!summary.details_file)return summary;
  if(!records.has(id))records.set(id,readJSON(summary.details_file).then(value=>{
   if(value.source_sha256!==data.meta.source_sha256||value.record?.id!==id)throw Error('The record does not match this atlas version. Please reload.');
   return value.record;
  }).catch(error=>{records.delete(id);throw error;}));
  return records.get(id);
 }
 async function getResearchData({includeNational=false}={}){
  const data=await (includeNational?ready():catalogue()),landEvents=data.events.filter(e=>e.record_kind!=='national_policy'),nationalEvents=data.events.filter(e=>e.record_kind==='national_policy');
  if(!data.meta.web_assets)return {meta:data.meta,events:includeNational?data.events:landEvents,workbook_geography:data.workbook_geography,workbook_review:data.workbook_review};
  if(!research)research=readJSON(data.meta.web_assets.research).then(async value=>{
   if(value.meta?.source_sha256!==data.meta.source_sha256)throw Error('The research data does not match this atlas version. Please reload.');
   if(value.events_parts){
    const parts=await Promise.all(value.events_parts.map(readJSON));
    if(parts.some(p=>p.source_sha256!==data.meta.source_sha256||!Array.isArray(p.events)))throw Error('The research data does not match this atlas version. Please reload.');
    value={...value,events:parts.flatMap(p=>p.events)};delete value.events_parts;
   }
   const expected=new Set(landEvents.map(e=>e.id));
   if(value.events?.length!==landEvents.length||new Set(value.events.map(e=>e.id)).size!==expected.size||value.events.some(e=>!expected.has(e.id)))throw Error('The research data does not match this atlas version. Please reload.');
   researchByID=new Map(value.events.map(e=>[e.id,e]));return value;
  }).catch(error=>{research=null;throw error;});
  const value=await research;
  return includeNational?{...value,meta:{...value.meta,national_supplement:data.meta.national_supplement},events:[...value.events,...nationalEvents]}:value;
 }
 window.AtlasData={ready,getAnalysisData,getRecord,getResearchData};
})();

