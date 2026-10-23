(function(){
 'use strict';
 const mapSource=window.location?.protocol==='file:'?'data.js':document.currentScript?.dataset.mapSrc||'map-data.js';
 let initial=null,research=null,researchByID=null;
 const records=new Map();
 function unpack(data){
  if(data.geometry_pool){
   const pool=data.geometry_pool;
   for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of data[key].features){
    if(!Number.isInteger(f.geometry)||!pool[f.geometry])throw Error('The map geometry could not be loaded.');
    f.geometry=pool[f.geometry];
   }
   delete data.geometry_pool;
  }
  return data;
 }
 function ready(){
  if(window.BORDER_DATA)return Promise.resolve(unpack(window.BORDER_DATA));
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
 async function getRecord(id){
  const data=await ready();
  if(researchByID)return researchByID.get(id);
  const summary=data.events.find(e=>e.id===id);if(!summary)throw Error('This record could not be found.');
  if(!summary.details_file)return summary;
  if(!records.has(id))records.set(id,readJSON(summary.details_file).then(value=>{
   if(value.source_sha256!==data.meta.source_sha256||value.record?.id!==id)throw Error('The record does not match this atlas version. Please reload.');
   return value.record;
  }).catch(error=>{records.delete(id);throw error;}));
  return records.get(id);
 }
 async function getResearchData(){
  const data=await ready();if(!data.meta.web_assets)return {meta:data.meta,events:data.events,workbook_geography:data.workbook_geography,workbook_review:data.workbook_review};
  if(!research)research=readJSON(data.meta.web_assets.research).then(async value=>{
   if(value.meta?.source_sha256!==data.meta.source_sha256)throw Error('The research data does not match this atlas version. Please reload.');
   if(value.events_parts){
    const parts=await Promise.all(value.events_parts.map(readJSON));
    if(parts.some(p=>p.source_sha256!==data.meta.source_sha256||!Array.isArray(p.events)))throw Error('The research data does not match this atlas version. Please reload.');
    value={...value,events:parts.flatMap(p=>p.events)};delete value.events_parts;
   }
   const expected=new Set(data.events.map(e=>e.id));
   if(value.events?.length!==data.events.length||new Set(value.events.map(e=>e.id)).size!==expected.size||value.events.some(e=>!expected.has(e.id)))throw Error('The research data does not match this atlas version. Please reload.');
   researchByID=new Map(value.events.map(e=>[e.id,e]));return value;
  }).catch(error=>{research=null;throw error;});
  return research;
 }
 window.AtlasData={ready,getRecord,getResearchData};
})();
