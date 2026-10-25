/* Independent release expectations read from native research tables.
 * This module never imports the browser importer, core or analysis metrics.
 * Keep these source-column rules separate from the generated browser model. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const FLAG_COLUMNS={
 any_dated_evidence:'Any dated phase (1=yes)',
 operational_complete:'Complete operational (1=yes)',
 operational_exact_complete:'Exact operational (1=yes)',
 operational_censored:'Operational censored (1=yes)',
 same_day:'Same-day operational (1=yes)',
 formal_policy:'Formal policy (1=yes)',
 ordered_window:'Ordered window (1=yes)',
 intermittent_regime:'Intermittent regime (1=yes)'
};
const yes=value=>Number(value)===1;
const index=(rows,key)=>new Map(rows.map(row=>[row[key],row]));
function calendarDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.getTime()/86400000:null;
}
function percentile(values,fraction){
 if(!values.length)return null;
 const ordered=[...values].sort((a,b)=>a-b),position=(ordered.length-1)*fraction;
 const below=Math.floor(position),above=Math.ceil(position);
 return ordered[below]+(ordered[above]-ordered[below])*(position-below);
}
function fromNative(native){
 const tables=native.tables;
 assert(tables&&Array.isArray(tables.Register),'Native release tables are required');
 const records=tables.Register,byID=index(records,'ID'),durations=index(tables.Durations,'Record ID');
 const phases=tables['Chronology phases'],phasesByRecord=new Map(records.map(row=>[row.ID,[]]));
 const bindingRules=new Map();
 for(const row of tables['Phase locations']){
  if(!bindingRules.has(row['Phase ID']))bindingRules.set(row['Phase ID'],new Set());
  bindingRules.get(row['Phase ID']).add(row['Temporal display rule']);
 }
 const rationalesByID=new Map(records.map(row=>[row.ID,new Set()]));
 for(const row of tables['Rationale coding']){
  if(row['Broad rationale']&&row['Broad rationale']!=='Uncoded')rationalesByID.get(row['Record ID']).add(row['Broad rationale']);
 }
 for(const phase of phases){
  assert(phasesByRecord.has(phase['Parent record ID']),'Phase has a known parent');
  phasesByRecord.get(phase['Parent record ID']).push(phase);
  assert.equal(bindingRules.get(phase['Phase ID'])?.size,1,'One current temporal rule for '+phase['Phase ID']);
 }
 const included=records.filter(row=>row['Analysis inclusion']==='Included'),includedIDs=included.map(row=>row.ID);
 for(const row of records){
  assert(durations.has(row.ID),'Current duration summary for '+row.ID);
  assert.equal(yes(durations.get(row.ID)['Included (1=yes)']),row['Analysis inclusion']==='Included','Native inclusion agrees for '+row.ID);
 }
 const temporalRule=phase=>[...bindingRules.get(phase['Phase ID'])][0];
 const validOperational=phase=>phase['Evidence category']==='operational_spell'
  &&!yes(phase['Contested / held (1=yes)'])
  &&!String(phase['Calculation rule']||'').startsWith('withheld_');
 function exactLength(phase){
  if(!validOperational(phase)||!yes(phase['Exact complete operational (1=yes)'])
   ||phase['Endpoint is observed reopening']!=='Yes'
   ||!['closed_interval','bounded_interval'].includes(phase['Interval type']))return null;
  if(/held|dated_evidence_only|intermittent/.test(temporalRule(phase)))return null;
  const start=phase['Start earliest'],end=phase['Endpoint earliest'];
  if(start!==phase['Start latest']||end!==phase['Endpoint latest'])return null;
  const from=calendarDay(start),to=calendarDay(end);
  if(from===null||to===null||to<=from)return null;
  const elapsed=to-from;
  for(const field of ['Minimum date difference (days)','Maximum date difference (days)']){
   if(phase[field]!=null&&Number(phase[field])!==elapsed)return null;
  }
  return elapsed;
 }
 function lowerBound(phase){
  if(!validOperational(phase))return null;
  const rule=temporalRule(phase),kind=phase['Interval type'];
  const complete=yes(phase['Complete operational (1=yes)'])&&['closed_interval','bounded_interval'].includes(kind)
   &&rule==='scoped_interval_with_endpoint_uncertainty';
  const censored=kind==='confirmed_through'&&phase['Endpoint status']==='last_confirmed'
   &&rule==='censored_interval_stop_at_last_confirmation_unknown_afterward';
  if(!complete&&!censored)return null;
  const last=phase['Last confirmed (not reopening)'];
  const rawEnds=[phase['Endpoint earliest']||last,phase['Endpoint latest']||last];
  const dates=[phase['Start earliest'],phase['Start latest'],...(censored?[last,last]:rawEnds)].map(calendarDay);
  if(dates.some(value=>value===null))return null;
  const [firstStart,lastStart,firstEnd,lastEnd]=dates;
  if(firstStart>lastStart||firstEnd>lastEnd)return null;
  const minimum=firstEnd-lastStart,recordedMinimum=phase['Minimum date difference (days)'],recordedMaximum=phase['Maximum date difference (days)'];
  if(minimum<0||typeof recordedMinimum!=='number'||recordedMinimum!==minimum)return null;
  if(complete&&(typeof recordedMaximum!=='number'||recordedMaximum!==lastEnd-firstStart))return null;
  if(censored&&(recordedMaximum!=null||rawEnds.some(value=>value!==last)))return null;
  return minimum;
 }
 function policyLowerBound(phase){
  if(phase['Evidence category']!=='formal_policy_period'||yes(phase['Contested / held (1=yes)'])
   ||String(phase['Calculation rule']||'').startsWith('withheld_')||temporalRule(phase)!=='legal_policy_layer_only_not_operational_closure')return null;
  const censored=phase['Endpoint status']==='last_confirmed',last=phase['Last confirmed (not reopening)'];
  const dates=[phase['Start earliest'],phase['Start latest'],censored?last:phase['Endpoint earliest'],censored?last:phase['Endpoint latest']].map(calendarDay);
  if(dates.some(value=>value===null))return null;
  const [a,b,c,d]=dates,minimum=c-b;
  if(a>b||c>d||minimum<0||phase['Minimum date difference (days)']!==minimum)return null;
  if(censored&&(phase['Maximum date difference (days)']!=null||[phase['Endpoint earliest']||last,phase['Endpoint latest']||last].some(value=>value!==last)))return null;
  return minimum;
 }
 function populationIDs(population='all',duration='all'){
  const flag=population==='complete'?'Complete operational (1=yes)':population==='exact'?'Exact operational (1=yes)':null;
  return includedIDs.filter(id=>(!flag||yes(durations.get(id)[flag]))
   &&(duration!=='over1'||phasesByRecord.get(id).some(phase=>lowerBound(phase)>1||policyLowerBound(phase)>1)));
 }
 function exactPhases(ids=includedIDs,duration='all'){
  const selected=new Set(ids),rows=[];
  for(const phase of phases){
   const id=phase['Parent record ID'];
   if(!selected.has(id)||byID.get(id)['Analysis inclusion']!=='Included')continue;
   const days=exactLength(phase);
   if(days===null||(duration==='over1'&&days<=1))continue;
   rows.push({record_id:id,phase_id:phase['Phase ID'],start:phase['Start earliest'],end:phase['Endpoint latest'],days,codes:[...rationalesByID.get(id)]});
  }
  return rows;
 }
 function recordIDsInMonth(month,duration='all'){
  assert.match(month,/^\d{4}-\d{2}$/);
  const [year,number]=month.split('-').map(Number),first=Date.UTC(year,number-1,1)/86400000,next=Date.UTC(year,number,1)/86400000;
  const kinds=new Set(['closed_interval','bounded_interval','same_day','confirmed_through','policy_period','ordered_window','intermittent_regime']);
  const pointRules=new Set(['held_evidence_do_not_animate_as_confirmed','dated_evidence_only_no_continuity_inference','day_marker_no_whole_day_duration']);
  return includedIDs.filter(id=>phasesByRecord.get(id).some(phase=>{
   if(!kinds.has(phase['Interval type'])||duration==='over1'&&!(lowerBound(phase)>1||policyLowerBound(phase)>1))return false;
   const dates=['Start earliest','Start latest','Endpoint earliest','Endpoint latest','Last confirmed (not reopening)'].map(key=>calendarDay(phase[key]));
   const recorded=dates.some(value=>value!==null&&value>=first&&value<next);
   const [a,b]=dates,c=dates[2]??dates[4],d=dates[3]??dates[4];
   const bounded=[a,b,c,d].every(value=>value!==null)&&a<=b&&c<=d&&a<=d;
   if(yes(phase['Contested / held (1=yes)'])||pointRules.has(temporalRule(phase))||phase['Interval type']==='same_day'||!bounded||a===d)return recorded;
   // Inclusion affects month overlap, not the duration arithmetic above.
   return a<next&&d+(phase['Endpoint inclusion recorded']==='Inclusive'?1:0)>first;
  }));
 }
 function groups(ids=includedIDs,codes=[...new Set(tables['Rationale coding'].map(row=>row['Broad rationale']))].filter(code=>code&&code!=='Uncoded'),duration='all'){
  const rows=exactPhases(ids,duration);
  return codes.map(code=>{
   const sample=rows.filter(row=>row.codes.includes(code)),values=sample.map(row=>row.days);
   return {code,total:ids.filter(id=>rationalesByID.get(id).has(code)).length,phases:sample.length,
    records:new Set(sample.map(row=>row.record_id)).size,min:values.length?Math.min(...values):null,
    q1:percentile(values,.25),median:percentile(values,.5),q3:percentile(values,.75),max:values.length?Math.max(...values):null};
  });
 }
 const timingCounts=Object.fromEntries(Object.entries(FLAG_COLUMNS).map(([key,column])=>[key,includedIDs.filter(id=>yes(durations.get(id)[column])).length]));
 const counts={records:records.length,included:included.length,excluded:records.length-included.length,phases:phases.length,
  assigned:includedIDs.filter(id=>rationalesByID.get(id).size>0).length,held:phases.filter(phase=>yes(phase['Contested / held (1=yes)'])).length};
 return {native,tables,records,byID,included,includedIDs,durations,phases,phasesByRecord,rationalesByID,bindingRules,
  counts,timingCounts,populationIDs,exactPhases,groups,exactLength,lowerBound,recordIDsInMonth};
}
function load(file=path.resolve(__dirname,'../source/current-release.json.gz')){
 const bytes=fs.readFileSync(file);
 return fromNative(JSON.parse((file.endsWith('.gz')?zlib.gunzipSync(bytes):bytes).toString('utf8')));
}
module.exports={load,fromNative,calendarDay,FLAG_COLUMNS};
