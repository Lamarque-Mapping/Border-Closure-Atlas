/* Later-status evidence is separate from measured closure durations. */
(function(root){
  'use strict';
  const array=v=>Array.isArray(v)?v:[];
  const isStatus=e=>e?.record_kind==='border_status';
  const isSupplement=e=>isStatus(e)||e?.record_kind==='national_policy';
  function decorateRecord(record,source=root.ATLAS_STATUS_REVIEW){
    if(!source||isSupplement(record))return record;
    const review=source.unresolved.find(r=>r.record_id===record.id);
    if(!review)return record;
    const finding=source.audit?.records.find(r=>r.record_id===record.id);
    return {...record,later_status_review:finding||null,map_status_periods:review.phases.map(p=>({
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
    return source.observations.map(o=>({
      id:o.id,record_kind:'border_status',title:o.title,region:o.region,countries:o.countries,
      continents:o.continents,location_ids:o.location_ids,mapping_precision:'status_reference',
      scope:o.scope,crossings:o.crossings||'',movement:o.movement,direction:o.direction||'As stated in the source',
      exceptions:o.exceptions,context:o.summary,uncertainty:o.qualification,
      start:o.observed_at,end:null,onset_month:null,phase_onsets:[],rationales:o.rationales||[],
      linked_land_ids:o.linked_land_ids||[],quarantined:false,excluded_from_map:false,
      inclusion_status:'Separate status evidence; excluded from historical episode statistics',
      record_type:'Border-access status observation',duration_periods:[],
      map_status_periods:[{period_id:o.id+'-OBS',map_status:true,status:o.status,
        kind:'status_context',measure_type:'status_context',start_earliest:o.observed_at,
        start_latest:o.observed_at,end_earliest:o.observed_at,end_latest:o.observed_at,
        evidence_dates:[o.observed_at],minimum_days:null,maximum_days:null,
        scope:o.scope,display:o.summary,label:source.audit?.records.some(r=>r.outcome==='reported_current'&&(o.linked_land_ids||[]).includes(r.record_id))?'Restriction reported by operator':o.status==='restricted'?'Restricted access confirmed':'Ordinary crossing closed',
        source_urls:o.sources.map(s=>s.url),location_ids:o.location_ids,observed_reopening:'Not a reopening date'}],
      status_observation:o.summary,status_review:o,source_urls:o.sources.map(s=>s.url),sources:o.sources,
      current_review:{outcome:'Status evidence checked '+source.reviewed_at,claims:[]},
      current_timing:'Status observed '+o.observed_at+'; no continuous duration inferred',
      timing_coverage:{any_dated_evidence:true,operational_complete:false,operational_exact_complete:false},
      duration_review:{display:'Status observation; no closed-days total calculated.'}
    }));
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
  const api={attach,compile,decorateRecord,isStatus,isSupplement};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AtlasStatus=api;
})(typeof window==='undefined'?globalThis:window);
