/* Descriptive statistics only: no missing dates, reopening or phase totals are inferred. */
(function(root){
 'use strict';
 const CONTINENTS=Object.freeze(['Africa','Asia','Europe','North America','South America','Oceania']);
 function day(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time/86400000:null;
 }
 function exactDays(p){
  if(!p||p.measure_type!=='operational_spell'||!p.exact_complete_operational||p.contested||p.observed_reopening!=='Yes')return null;
  if(!['closed_interval','bounded_interval'].includes(p.kind))return null;
  if(/held|dated_evidence_only|intermittent/.test(p.temporal_display_rule||''))return null;
  if(p.start_earliest!==p.start_latest||p.end_earliest!==p.end_latest)return null;
  const start=day(p.start_earliest),end=day(p.end_earliest);
  if(start===null||end===null||end<=start)return null;
  const days=end-start;
  // Full records carry the workbook arithmetic; browsing records carry the same dates.
  if(p.minimum_days!=null&&Number(p.minimum_days)!==days)return null;
  if(p.maximum_days!=null&&Number(p.maximum_days)!==days)return null;
  return days;
 }
 const D=typeof module!=='undefined'&&module.exports?require('../dist/duration.js'):root.BorderDuration;
 function operationalMinimumDays(p){return p?.measure_type==='operational_spell'?D.minimumDays(p):null;}
 function durationMatch(event,duration='all'){return D.matches(event,duration);}
 function filterRecords(events,population='all',duration='all'){
  return events.filter(e=>!e.quarantined&&(!e.inclusion_status||e.inclusion_status==='Included')
   &&(population==='complete'?e.timing_coverage?.operational_complete:
      population==='exact'?e.timing_coverage?.operational_exact_complete:true)
   &&durationMatch(e,duration));
 }
 function quantile(values,q){
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),position=(a.length-1)*q,lo=Math.floor(position),fraction=position-lo;
  return a[lo]+(a[Math.min(lo+1,a.length-1)]-a[lo])*fraction;
 }
 function durationRows(events,duration='all'){
  const rows=[],seen=new Set();
  for(const e of events){
   if(e.quarantined||e.inclusion_status&&e.inclusion_status!=='Included')continue;
   for(const p of e.duration_periods||[]){
    const days=exactDays(p),key=e.id+'\t'+p.period_id;
    if(days===null||duration==='over1'&&days<=1||!p.period_id||seen.has(key))continue;
    seen.add(key);rows.push({record_id:e.id,phase_id:p.period_id,title:e.title,scope:p.scope,
     start:p.start_earliest,end:p.end_latest,days,codes:[...new Set(e.rationales||e.codes||[])],
     endpoint_inclusion:p.endpoint_inclusion,observed_reopening:p.observed_reopening});
   }
  }
  return rows;
 }
 function durationGroups(events,codes,duration='all'){
  const rows=durationRows(events,duration);
  return codes.map(code=>{
   const sample=rows.filter(p=>p.codes.includes(code)),values=sample.map(p=>p.days);
   const total=events.filter(e=>!e.quarantined&&(!e.inclusion_status||e.inclusion_status==='Included')&&(e.rationales||e.codes||[]).includes(code)).length;
   return {code,phases:sample.length,records:new Set(sample.map(p=>p.record_id)).size,total,
    min:values.length?Math.min(...values):null,q1:quantile(values,.25),median:quantile(values,.5),q3:quantile(values,.75),max:values.length?Math.max(...values):null};
  });
 }
 function continents(events){return CONTINENTS.map(name=>({label:name,count:events.filter(e=>(e.continents||[]).includes(name)).length}));}
 const api=Object.freeze({CONTINENTS,day,exactDays,operationalMinimumDays,durationMatch,filterRecords,quantile,durationRows,durationGroups,continents});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderAnalysisMetrics=api;
})(typeof window!=='undefined'?window:globalThis);
