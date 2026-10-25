(function(root){
  'use strict';
  const array=v=>Array.isArray(v)?v:[];
  const CONTINENTS=['Africa','Europe','Asia','North America','South America','Oceania'];
  function monthOrdinal(value){const m=String(value||'').match(/^(\d{4})-(\d{2})(?:$|-)/);if(!m)return null;const n=Number(m[2]);return n>=1&&n<=12?Number(m[1])*12+n-1:null;}
  function monthISO(n){return String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0');}
  function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;}
  function quarantined(e){return typeof e.quarantined==='boolean'?e.quarantined:/quarantin/i.test(String(e.evidence_status||''));}
  function excluded(e){return e.excluded_from_map===true||quarantined(e);}
  const geographyIndexes=new WeakMap();
  function geographyIndex(data){
    let index=geographyIndexes.get(data);
    if(!index||index.linksSource!==data.links||index.contextSource!==data.crossing_contexts||index.locationsSource!==data.locations||index.contextLocationsSource!==data.context_locations){
      index={linksSource:data.links,contextSource:data.crossing_contexts,locationsSource:data.locations,contextLocationsSource:data.context_locations,links:new Map(),contexts:new Map(),features:new Map(locationFeatures(data).map(f=>[f.properties?.location_id,f]))};
      for(const l of array(data.links)){if(!index.links.has(l.event_id))index.links.set(l.event_id,[]);index.links.get(l.event_id).push(l.location_id);}
      for(const l of array(data.crossing_contexts)){if(!index.contexts.has(l.location_id))index.contexts.set(l.location_id,[]);index.contexts.get(l.location_id).push(l.context_location_id);}
      geographyIndexes.set(data,index);
    }
    return index;
  }
  function locationsFor(e,data){if(excluded(e))return [];return [...new Set([...array(e.location_ids),...array(geographyIndex(data).links.get(e.id))].filter(Boolean))];}
  // Display context is separate from the reviewed event-location evidence.
  function locationFeatures(data){return [...array(data.locations?.features),...array(data.context_locations?.features)];}
  function contextLocationsFor(locationId,data){return [...new Set(array(geographyIndex(data).contexts.get(locationId)))];}
  function displayLocationsFor(e,data){const ids=locationsFor(e,data);return [...new Set([...ids,...ids.flatMap(id=>contextLocationsFor(id,data))])];}
  const PERIOD_KINDS=['closed_interval','bounded_interval','same_day','confirmed_through','policy_period','ordered_window','intermittent_regime'];
  const TEMPORAL_ORDER=['supported','closed','restricted','possible','observation','policy','ordered','intermittent','held','unresolved'];
  const isSupplement=e=>e?.record_kind==='national_policy'||e?.record_kind==='border_status';
  function statusTemporalState(p,month){
    if(!p?.map_status||!Number.isInteger(month))return 'none';
    if(p.status==='unresolved')return month>monthOrdinal(p.last_confirmed)&&month<=monthOrdinal(p.end_latest)&&(!p.resolved_from||month<monthOrdinal(p.resolved_from))?'unresolved':'none';
    if(p.status_timeline){
      const start=day(p.start_earliest),end=day(p.end_latest),monthStart=day(monthISO(month)+'-01'),monthEnd=day(monthISO(month+1)+'-01');
      if(start===null||end===null||monthStart===null||monthEnd===null)return 'none';
      return start<monthEnd&&end+(p.end_inclusive?86400000:0)>monthStart?p.status:'none';
    }
    return month===monthOrdinal(p.start_earliest)?p.status:'none';
  }
  function statusPeriods(e,state={}){
    if(state.mode==='onsets'||state.measureType)return [];
    return array(e.map_status_periods).filter(p=>state.mode==='all'||statusTemporalState(p,state.month)!=='none');
  }
  function periodEvidenceDates(p){
    return [...new Set([...array(p?.evidence_dates),p?.start_earliest,p?.start_latest,p?.end_earliest,p?.end_latest,p?.last_confirmed].filter(v=>day(v)!==null))];
  }
  // A displayable phase need not have a measurable interval: observations,
  // incomplete bounds and held dates remain discoverable on their recorded dates.
  function validPeriod(p){return !!p&&PERIOD_KINDS.includes(p.kind)&&periodEvidenceDates(p).length>0;}
  function periodBounds(p){
    const values=[p.start_earliest,p.start_latest,p.end_earliest||p.last_confirmed,p.end_latest||p.last_confirmed].map(day);
    const [a,b,c,d]=values;
    return values.every(v=>v!==null)&&a<=b&&c<=d&&a<=d?values:null;
  }
  const measureLabel=t=>({operational_spell:'Observed closure',formal_policy_period:'Policy in force',ordered_window:'Announced closure dates',intermittent_regime:'Repeated closures'}[t]||'All evidence types');
  function periods(e,measureType=''){
    if(excluded(e))return [];
    if(Array.isArray(e.duration_periods))return e.duration_periods.filter(validPeriod).filter(p=>!measureType||p.measure_type===measureType);
    const start=day(e.interval_start),end=day(e.interval_end);
    return e.interval_eligible===true&&start!==null&&end!==null&&(e.interval_end_inclusive===true?end>=start:end>start)?[{kind:e.interval_end_inclusive?'confirmed_through':'closed_interval',start_earliest:e.interval_start,start_latest:e.interval_start,end_earliest:e.interval_end,end_latest:e.interval_end}]:[];
  }
  function intervalEligible(e){return periods(e).length>0;}
  function phaseTemporalState(p,month){
    if(!Number.isInteger(month)||!validPeriod(p))return 'none';
    const monthStart=day(monthISO(month)+'-01'),monthEnd=day(monthISO(month+1)+'-01');
    if(monthStart===null||monthEnd===null)return 'none';
    const onRecordedDate=periodEvidenceDates(p).some(v=>day(v)>=monthStart&&day(v)<monthEnd);
    const rule=p.temporal_display_rule||'';
    if(p.contested||rule==='held_evidence_do_not_animate_as_confirmed')return onRecordedDate?'held':'none';
    if(rule==='dated_evidence_only_no_continuity_inference')return onRecordedDate?'observation':'none';
    const category=rule==='legal_policy_layer_only_not_operational_closure'||p.measure_type==='formal_policy_period'?'policy':
      rule==='announced_window_layer_only'||p.measure_type==='ordered_window'?'ordered':
      rule==='intermittent_envelope_no_continuous_closed_state'||p.measure_type==='intermittent_regime'?'intermittent':null;
    const bounds=periodBounds(p);
    if(rule==='day_marker_no_whole_day_duration'||p.kind==='same_day'||!bounds||bounds[0]===bounds[3])return onRecordedDate?(category||'observation'):'none';
    const [a,b,c,d]=bounds;
    // Inclusion belongs to the source, never to an inferred reopening or a +1
    // duration adjustment. Unknown inclusion does not extend the interval.
    const inclusive=(p.endpoint_inclusion!==undefined?p.endpoint_inclusion==='Inclusive':p.end_inclusive===true)?86400000:0;
    if(a>=monthEnd||d+inclusive<=monthStart)return 'none';
    if(category)return category;
    return b<monthEnd&&c+inclusive>monthStart?'supported':'possible';
  }
  // Preserve mixed evidence types for summaries. temporalState is the first
  // applicable state for callers that need one presentation class; it is not an
  // assertion that every phase of a parent has that status.
  function temporalStates(e,month,measureType=''){
    const states=new Set([...periods(e,measureType).map(p=>phaseTemporalState(p,month)),...statusPeriods(e,{mode:'intervals',month,measureType}).map(p=>statusTemporalState(p,month))]);
    return TEMPORAL_ORDER.filter(state=>states.has(state));
  }
  function temporalState(e,month,measureType=''){return temporalStates(e,month,measureType)[0]||'none';}
  function periodsForView(e,state={}){
    const onsetIDs=state.mode==='onsets'&&Array.isArray(e.phase_onsets)?new Set(e.phase_onsets.filter(p=>monthOrdinal(p.month)===state.month&&(!state.measureType||p.measure_type===state.measureType)).map(p=>p.phase_id)):null;
    return [...(state.mode==='intervals'?periods(e,state.measureType):array(e.duration_periods).filter(p=>!state.measureType||p.measure_type===state.measureType)).filter(p=>state.mode!=='intervals'||phaseTemporalState(p,state.month)!=='none').filter(p=>!onsetIDs||onsetIDs.has(p.period_id)),...statusPeriods(e,state)];
  }
  function mappingRows(e,data,state={}){
    if(excluded(e)||isSupplement(e)||!data.crossing_map)return [];
    const phases=periodsForView(e,state);
    if(phases.length)return phases.map(p=>data.crossing_map.phases[p.source_phase_id||p.period_id]).filter(row=>row?.record_id===e.id);
    return !array(e.duration_periods).length&&data.crossing_map.undated[e.id]?[data.crossing_map.undated[e.id]]:[];
  }
  function phaseLocationIDs(e,row,data){
    if(!row)return [];
    // Only a wider-scope phase can use the existing border reference. A named
    // crossing with no approved position must never fall back to that line.
    if(row.category!=='wider_border')return array(row.site_ids);
    const features=geographyIndex(data).features;
    return displayLocationsFor(e,data).filter(id=>/^(?:Multi)?(?:LineString|Polygon)$/.test(features.get(id)?.geometry?.type||''));
  }
  function mapLocationsFor(e,data,state={}){
    if(excluded(e))return [];
    if(e.record_kind==='border_status'&&(state.mode==='all'||state.mode==='onsets'||Number.isInteger(state.month)))return [...new Set(statusPeriods(e,state).flatMap(p=>array(p.location_ids)))];
    if(isSupplement(e)||!data.crossing_map)return displayLocationsFor(e,data);
    return [...new Set(mappingRows(e,data,state).flatMap(row=>phaseLocationIDs(e,row,data).filter(id=>state.mode!=='intervals'||!array(e.map_geography_windows).some(w=>w.phase_id===row.phase_id&&w.location_id===id&&state.month<monthOrdinal(w.from_date)))))];
  }
  function recordsForLocation(records,id,data,state={}){
    return records.filter(e=>mapLocationsFor(e,data,state).includes(id)).map(e=>{
      const phases=periodsForView(e,state).filter(p=>e.record_kind==='border_status'?array(p.location_ids).includes(id):isSupplement(e)||!data.crossing_map||phaseLocationIDs(e,data.crossing_map.phases[p.source_phase_id||p.period_id],data).includes(id));
      return {...e,duration_periods:phases.filter(p=>!p.map_status),map_status_periods:phases.filter(p=>p.map_status),map_status_only:phases.length>0&&phases.every(p=>p.map_status),map_status_unresolved:phases.length>0&&phases.every(p=>p.map_status&&p.status==='unresolved')};
    });
  }
  function mappingStatus(e,data,state={}){
    const ids=mapLocationsFor(e,data,state),features=geographyIndex(data).features;
    const pointCount=ids.filter(id=>features.get(id)?.geometry?.type==='Point').length,lineCount=ids.length-pointCount;
    const rows=mappingRows(e,data,state),pending=!excluded(e)&&(rows.some(row=>row.partial||!phaseLocationIDs(e,row,data).length)||!ids.length);
    const label=excluded(e)?'Excluded · list only':e.record_kind==='national_policy'?'National rule mapped':!ids.length?'Location awaiting mapping':pending?'Some locations awaiting mapping':pointCount&&lineCount?'Crossings and wider border rules':pointCount?'Crossing'+(pointCount===1?'':'s')+' mapped':'Wider border rule mapped';
    return {ids,mapped:ids.length>0,pending,pointCount,lineCount,label};
  }
  function temporalLabel(state){return {supported:'Restriction reported this month',closed:'Ordinary crossing closed',restricted:'Restricted access confirmed',unresolved:'Later status unverified',possible:'Dates may overlap this month',observation:'Reported on specific dates',policy:'Policy in force',ordered:'Announced closure dates',intermittent:'Repeated closures',held:'Dates disputed',none:'No evidence dated to this month'}[state]||'Dated evidence';}
  function matchesTime(e,mode,month,measureType=''){
    if(mode==='all')return true;
    if(excluded(e))return false;
    if(mode==='onsets')return month!==null&&month!==undefined&&(Array.isArray(e.phase_onsets)?e.phase_onsets.some(p=>monthOrdinal(p.month)===month&&(!measureType||p.measure_type===measureType)):monthOrdinal(e.onset_month)===month);
    if(mode==='intervals')return temporalState(e,month,measureType)!=='none';
    return false;
  }
  function precision(e){if(excluded(e))return 'excluded';return e.mapping_precision||(array(e.location_ids).length?'crossing_reference':'unlocated');}
  function matchesPrecision(e,value,data,state){if(!value)return true;if(data?.crossing_map){const status=mappingStatus(e,data,state);if(value==='unlocated')return status.pending;if(value==='context')return status.lineCount>0;if(value==='crossing_reference')return status.pointCount>0||e.record_kind==='national_policy';}const p=precision(e);if(value==='context')return p==='frontier_context'||p==='country_context';if(value==='crossing_reference')return p==='crossing_reference'||p==='policy_coverage'||p==='national_policy';return p===value;}
  function availableContinents(){return [...CONTINENTS];}
  function continentCounts(data,includeExcluded=false){const names=availableContinents(data);const counts={World:0,...Object.fromEntries(names.map(c=>[c,0]))};for(const e of data.events){if(excluded(e)&&!includeExcluded)continue;counts.World++;for(const c of new Set(array(e.continents)))if(names.includes(c))counts[c]++;}return counts;}
  function validate(data){
    if(!data||typeof data!=='object'||!Array.isArray(data.events)||!data.meta)throw Error('This file must contain a compiled release with meta and events.');
    const seen=new Set();for(const e of data.events){if(!e||typeof e.id!=='string'||!e.id.trim())throw Error('Every record needs a stable text ID.');if(seen.has(e.id))throw Error('Duplicate record ID: '+e.id);seen.add(e.id);if(e.continents!==undefined&&(!Array.isArray(e.continents)||e.continents.some(c=>!CONTINENTS.includes(c)&&c!=='Unassigned')))throw Error('Unknown continent assignment for '+e.id+'.');}
    const first=monthOrdinal(data.meta.window_start),last=monthOrdinal(data.meta.window_end);if(first===null||last===null||last<first)throw Error('Release metadata must include valid window_start and window_end dates.');
    if(last-first>2400)throw Error('The time window is too large for this monthly viewer.');
    for(const key of ['countries','borders','disputed','locations','context_locations']){const fc=data[key];if(fc&&(!Array.isArray(fc.features)||fc.type!=='FeatureCollection'))throw Error(key+' must be a GeoJSON FeatureCollection.');}
    return data;
  }
  function filterEvents(data,state){
    const q=String(state.query||'').trim().toLowerCase();
    return data.events.filter(e=>!excluded(e)||(state.includeExcluded===true&&state.mode==='all')).filter(e=>!state.continent||array(e.continents).includes(state.continent)).filter(e=>!state.region||e.region===state.region).filter(e=>!state.rationale||array(e.rationales).includes(state.rationale)).filter(e=>matchesPrecision(e,state.precision,data,state)).filter(e=>!q||[e.id,e.title,e.region,e.scope,e.crossings,e.movement,e.direction,...array(e.countries),...array(e.rationales)].join(' ').toLowerCase().includes(q)).filter(e=>!state.location||mapLocationsFor(e,data,state).includes(state.location)).filter(e=>!state.measureType||(state.mode==='all'?array(e.duration_periods).some(p=>p.measure_type===state.measureType):periods(e,state.measureType).length)).filter(e=>matchesTime(e,state.mode,state.month,state.measureType));
  }
  const api={array,CONTINENTS,monthOrdinal,monthISO,day,quarantined,excluded,isSupplement,statusPeriods,statusTemporalState,locationsFor,locationFeatures,contextLocationsFor,displayLocationsFor,mapLocationsFor,mappingRows,recordsForLocation,mappingStatus,periodEvidenceDates,validPeriod,periods,periodsForView,measureLabel,phaseTemporalState,temporalStates,temporalState,temporalLabel,intervalEligible,matchesTime,precision,matchesPrecision,availableContinents,continentCounts,validate,filterEvents};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderCore=api;
})(typeof window!=='undefined'?window:globalThis);

