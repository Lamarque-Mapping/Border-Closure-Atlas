/* Later-status evidence is separate from measured closure durations. */
(function(root){
  'use strict';
  const array=v=>Array.isArray(v)?v:[];
  const isStatus=e=>e?.record_kind==='border_status';
  const isSupplement=e=>isStatus(e)||e?.record_kind==='national_policy';
  function periodDates(p,format=v=>v){
    if(p.status==='unresolved')return 'Last confirmed '+format(p.last_confirmed);
    if(!p.status_timeline)return 'Observed '+format(p.observed_at||p.start_earliest)+'; start not established';
    const start=p.start_label||'From '+format(p.start_earliest);
    return start+' · '+(p.continues_through_observation?'confirmed through ':p.end_inclusive?'through ':'until ')+format(p.end_latest)+(p.continues_through_observation?'':p.end_inclusive?'':' (phase changed)');
  }
  function decorateRecord(record,source=root.ATLAS_STATUS_REVIEW){
    if(!source||isSupplement(record))return record;
    const review=source.unresolved.find(r=>r.record_id===record.id);
    const finding=source.audit?.records.find(r=>r.record_id===record.id);
    const geography=array(source.geography_windows).filter(w=>w.record_id===record.id);
    if(!review&&!finding&&!geography.length)return record;
    return {...record,later_status_review:finding||null,
      map_geography_windows:geography,
      map_status_periods:array(review?.phases).map(p=>({
      period_id:p.phase_id+'-LATER',source_phase_id:p.phase_id,map_status:true,
      status:'unresolved',kind:'status_context',measure_type:'status_context',
      start_earliest:p.last_confirmed,start_latest:p.last_confirmed,
      end_earliest:null,end_latest:source.reviewed_at,last_confirmed:p.last_confirmed,
      evidence_dates:[],minimum_days:null,maximum_days:null,observed_reopening:'Unknown',
      endpoint_status:'status_unverified',scope:p.scope,
      display:'Last confirmed '+p.last_confirmed+'. '+(p.resolved_from?'Later evidence is available from '+p.resolved_from+'; the intervening status has not been established.':'Later status has not been established.')+' This mark does not assert continuing closure.',
      source_urls:[],label:'Later status unverified',
      resolved_from:p.resolved_from||null
    }))};
  }
  function compile(source){
    return source.observations.map(o=>{
      const reviewed=array(o.timeline_periods),checkedAt=o.timeline_review?.checked_at||o.checked_at||o.sources?.map(s=>s.checked_at).filter(Boolean).sort().at(-1)||o.observed_at;
      const findings=[...array(source.audit?.records),...array(source.historical_audit?.audit?.records)];
      const reported=array(source.operator_report_observation_ids).includes(o.id)||findings.some(r=>r.outcome==='reported_current'&&(o.linked_land_ids||[]).includes(r.record_id));
      const entries=reviewed.length?reviewed:[{from_date:o.observed_at,through_date:o.observed_at,status:o.status,scope:o.scope,summary:o.summary,source_urls:o.sources.map(s=>s.url),end_inclusive:true}];
      const statusPeriods=entries.map((p,i)=>({
        period_id:o.id+(reviewed.length?'-T'+(i+1):'-OBS'),map_status:true,status:p.status,
        status_timeline:reviewed.length>0,duration_pattern:p.duration_pattern||null,start_precision:p.start_precision,start_label:p.start_label,
        kind:'status_context',measure_type:'status_context',start_earliest:p.from_date,
        start_latest:p.from_date,end_earliest:p.through_date,end_latest:p.through_date,
        end_inclusive:p.end_inclusive,observed_at:o.observed_at,checked_at:checkedAt,
        continues_through_observation:reviewed.length>0&&p.end_inclusive&&p.through_date===o.observed_at,
        evidence_dates:[p.from_date,p.through_date],minimum_days:null,maximum_days:null,
        scope:p.scope,display:p.summary,basis:p.basis,
        label:reported?'Restriction reported by operator':p.status==='restricted'?'Restricted access confirmed':'Ordinary crossing closed',
        source_urls:p.source_urls,location_ids:p.location_ids||o.location_ids,
        observed_reopening:'Status phase boundary; see the dated scope'
      }));
      return {
      id:o.id,record_kind:'border_status',title:o.title,region:o.region,countries:o.countries,
      continents:o.continents,location_ids:o.location_ids,mapping_precision:'status_reference',
      scope:o.scope,crossings:o.crossings||'',movement:o.movement,direction:o.direction||'As stated in the source',
      exceptions:o.exceptions,context:o.summary,uncertainty:o.qualification,
      start:reviewed.length&&reviewed[0].start_precision!=='pre_window'?reviewed[0].from_date:null,end:null,onset_month:null,phase_onsets:[],rationales:o.rationales||[],
      linked_land_ids:o.linked_land_ids||[],quarantined:false,excluded_from_map:false,
      inclusion_status:'Separate status evidence; excluded from historical episode statistics',
      record_type:reviewed.length?'Border-access restriction chronology':'Border-access status observation',duration_periods:[],
      map_status_periods:statusPeriods,
      status_observation:o.summary,status_review:o,source_urls:o.sources.map(s=>s.url),sources:o.sources,
      current_review:{outcome:'Status evidence checked '+checkedAt,claims:[]},
      current_timing:statusPeriods.map(p=>periodDates(p)).join('; ')+' · checked '+checkedAt,
      timing_coverage:{any_dated_evidence:true,operational_complete:false,operational_exact_complete:false},
      duration_review:{display:'Supplemental restriction chronology; no closed-days total calculated.'}
    };});
  }
  function attach(data,source=root.ATLAS_STATUS_REVIEW){
    if(!source||data.meta.status_review?.version===source.version)return data;
    if(source.source_sha256!==data.meta.source_sha256)return data;
    data.events=data.events.map(e=>decorateRecord(e,source));
    const observations=compile(source);
    data.events.push(...observations);
    data.meta.status_review={version:source.version,reviewed_at:source.reviewed_at,
      unresolved_records:source.unresolved.length,observations:observations.length,
      audit:source.audit?.counts,method:source.method};
    return data;
  }
  const api={attach,compile,decorateRecord,isStatus,isSupplement,periodDates};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AtlasStatus=api;
})(typeof window==='undefined'?globalThis:window);
