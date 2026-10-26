/* A conservative duration gate shared by the map, charts and record list.
 * Calendar-date lower bounds are not exact hour measurements or closed-days totals. */
(function(root){
 'use strict';
 function day(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time/86400000:null;
 }
 function minimumDays(p){
  if(!p||p.contested||p.analysis_included===false)return null;
  const policy=p.measure_type==='formal_policy_period'&&p.temporal_display_rule==='legal_policy_layer_only_not_operational_closure';
  const complete=p.measure_type==='operational_spell'&&p.complete_operational&&['closed_interval','bounded_interval'].includes(p.kind)
   &&p.temporal_display_rule==='scoped_interval_with_endpoint_uncertainty';
  const censored=p.endpoint_status==='last_confirmed'&&(policy||p.measure_type==='operational_spell'&&p.kind==='confirmed_through'
   &&p.temporal_display_rule==='censored_interval_stop_at_last_confirmation_unknown_afterward');
  if(!policy&&!complete&&!censored)return null;
  const dates=[p.start_earliest,p.start_latest,censored?p.last_confirmed:p.end_earliest,censored?p.last_confirmed:p.end_latest].map(day);
  if(dates.some(v=>v===null))return null;
  const [firstStart,lastStart,firstEnd,lastEnd]=dates,minimum=firstEnd-lastStart;
  if(firstStart>lastStart||firstEnd>lastEnd||minimum<0||!Number.isFinite(p.minimum_days)||p.minimum_days!==minimum)return null;
  if(complete&&(!Number.isFinite(p.maximum_days)||p.maximum_days!==lastEnd-firstStart))return null;
  if(censored&&(p.maximum_days!=null||p.end_earliest!==p.last_confirmed||p.end_latest!==p.last_confirmed))return null;
  return minimum;
 }
 function reviewedSpan(p){
  // These scoped histories are separately reviewed; they never enter duration statistics.
  if(p.duration_pattern==='intermittent')return null;
  if(!(p.map_status&&p.status_timeline&&['closed','restricted'].includes(p.status))
   &&!(p.national_display_period&&p.temporal_display_rule==='national_policy_context_not_exact_duration'))return null;
  const start=day(p.start_latest),end=day(p.end_earliest);
  return start!==null&&end!==null&&end>=start?end-start:null;
 }
 function qualifies(p,event){
  if(!p||p.analysis_included===false||p.contested)return false;
  if(p?.status==='unresolved'){
   // The age of an unanswered report is never a duration. Use only its source phase.
   const source=(event?.duration_source_periods||event?.duration_periods)?.find(q=>q.period_id===p.source_phase_id);
   return source?qualifies(source,event):false;
  }
  // A reviewed elapsed-time finding can establish >24 hours without supplying
  // an exact reopening or a defensible numeric duration. False includes exactly
  // 24 hours; null means unestablished and must not inherit stale arithmetic.
  if(Object.prototype.hasOwnProperty.call(p,'strictly_over_24_hours'))return p.strictly_over_24_hours===true;
  return minimumDays(p)>1||reviewedSpan(p)>1;
 }
 function matches(event,value='all'){
  return value!=='over1'||(event.duration_periods||[]).some(p=>qualifies(p,event))||(event.map_status_periods||[]).some(p=>qualifies(p,event));
 }
 function scopedEvent(event,value='all'){
  if(value!=='over1')return event;
  const periods=(event.duration_periods||[]).filter(p=>qualifies(p,event)),statuses=(event.map_status_periods||[]).filter(p=>qualifies(p,event));
  if(!periods.length&&!statuses.length)return null;
  const ids=new Set(periods.map(p=>p.period_id));
  return {...event,duration_periods:periods,map_status_periods:statuses,
   phase_onsets:Array.isArray(event.phase_onsets)?event.phase_onsets.filter(p=>ids.has(p.phase_id)):event.phase_onsets};
 }
 const api=Object.freeze({day,minimumDays,qualifies,matches,scopedEvent});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderDuration=api;
})(typeof window!=='undefined'?window:globalThis);
