(function(root){
  'use strict';
  const array=value=>Array.isArray(value)?value:[];
  const latest=dates=>dates.length?[...dates].sort().at(-1):null;
  const title=feature=>String(feature.properties?.label||feature.properties?.name||feature.properties?.location_id||'Border').replace(/ — (?:frontier|geographic) context$/,'');
  const eligible=(record,C)=>!C.excluded(record)&&record.record_kind!=='national_policy'&&record.record_kind!=='border_status';
  function monthBounds(C,state){
    if(!Number.isInteger(state?.month))return null;
    return {start:C.day(C.monthISO(state.month)+'-01'),end:C.day(C.monthISO(state.month+1)+'-01')};
  }
  function datesFor(record,C,measureType){
    return [...new Set(C.periods(record,measureType).flatMap(C.periodEvidenceDates))].sort();
  }
  function orderRecords(a,b){
    const rank=item=>item.datedThisMonth?0:item.latestEvidenceOnOrBeforeMonth?1:2;
    return rank(a)-rank(b)||String(b.latestEvidenceOnOrBeforeMonth||b.latestEvidenceDate||'').localeCompare(String(a.latestEvidenceOnOrBeforeMonth||a.latestEvidenceDate||''))||a.record.id.localeCompare(b.record.id);
  }

  // Boundary references are a directory, never approved restriction footprints.
  // In particular, a many-country record does not generate every possible pair.
  function buildIndex(data,C){
    const boundaries=C.locationFeatures(data).filter(feature=>{
      const p=feature.properties||{},codes=array(p.country_codes);
      return p.display_role==='frontier_context'&&codes.length===2&&new Set(codes).size===2&&/^(?:Multi)?LineString$/.test(feature.geometry?.type||'');
    });
    const byId=new Map(boundaries.map(feature=>[feature.properties.location_id,{feature,records:[]}]));
    const linkedRecords=new Set();let associations=0;
    for(const record of data.events.filter(record=>eligible(record,C))){
      for(const id of C.locationsFor(record,data)){
        const entry=byId.get(id);if(!entry)continue;
        entry.records.push(record);linkedRecords.add(record.id);associations++;
      }
    }
    return {boundaries,byId,data,core:C,stats:{boundaries:boundaries.length,boundariesWithRecords:[...byId.values()].filter(entry=>entry.records.length).length,linkedRecords:linkedRecords.size,associations}};
  }

  // The selected month affects ordering and dated counts, never the historical
  // association. Non-temporal filters apply; the clicked boundary owns location.
  function lookup(index,locationId,state={}){
    const entry=index.byId.get(locationId);if(!entry)return null;
    const C=index.core,bounds=monthBounds(C,state);
    const allowed=new Map(C.filterEvents(index.data,{...state,mode:'all',location:'',includeExcluded:false}).map(record=>[record.id,record]));
    const records=entry.records.filter(record=>allowed.has(record.id)).map(record=>allowed.get(record.id)).map(record=>{
      const dates=datesFor(record,C,state.measureType),preceding=bounds?dates.filter(date=>C.day(date)<bounds.end):dates;
      const temporalStates=bounds?C.temporalStates(record,state.month,state.measureType):[];
      return {record,latestEvidenceDate:latest(dates),latestEvidenceOnOrBeforeMonth:latest(preceding),datedThisMonth:temporalStates.length>0,temporalStates};
    }).sort(orderRecords);
    return {locationId,feature:entry.feature,title:title(entry.feature),records,totalRecordCount:entry.records.length,recordCount:records.length,datedRecordCount:records.filter(item=>item.datedThisMonth).length,priorRecordCount:records.filter(item=>!item.datedThisMonth&&item.latestEvidenceOnOrBeforeMonth).length,latestEvidenceDate:latest(records.map(item=>item.latestEvidenceDate).filter(Boolean)),latestEvidenceOnOrBeforeMonth:latest(records.map(item=>item.latestEvidenceOnOrBeforeMonth).filter(Boolean))};
  }

  // An inactive approved point can remain a neutral route into earlier records.
  // These references are not ongoing closures and never enter active counts.
  function priorCrossings(data,C,state={},activeLocationIDs=[]){
    const bounds=monthBounds(C,state);
    if(state.mode!=='intervals'||!bounds||!data.crossing_map)return [];
    const active=new Set(activeLocationIDs),features=new Map(C.locationFeatures(data).map(feature=>[feature.properties?.location_id,feature]));
    const found=new Map();
    const candidates=C.filterEvents(data,{...state,mode:'all',includeExcluded:false}).filter(record=>eligible(record,C));
    for(const record of candidates){
      for(const phase of C.periods(record,state.measureType)){
        if(phase.contested||phase.temporal_display_rule==='held_evidence_do_not_animate_as_confirmed'||C.phaseTemporalState(phase,state.month)!=='none')continue;
        const dates=C.periodEvidenceDates(phase).filter(date=>C.day(date)<bounds.start);
        if(!dates.length)continue;
        const mapping=data.crossing_map.phases[phase.period_id];
        if(!mapping||mapping.record_id!==record.id||!['single_site','multiple_named_sites'].includes(mapping.category))continue;
        for(const locationId of array(mapping.site_ids)){
          const feature=features.get(locationId);
          if(!feature||feature.geometry?.type!=='Point'||active.has(locationId)||(state.location&&state.location!==locationId))continue;
          if(!found.has(locationId))found.set(locationId,{locationId,feature,title:title(feature),byRecord:new Map()});
          const entry=found.get(locationId),date=latest(dates);
          if(!entry.byRecord.has(record.id))entry.byRecord.set(record.id,{record,phases:[],latestEvidenceDate:date});
          const item=entry.byRecord.get(record.id);item.phases.push(phase);item.latestEvidenceDate=latest([item.latestEvidenceDate,date]);
        }
      }
    }
    return [...found.values()].map(entry=>{
      const records=[...entry.byRecord.values()].sort((a,b)=>b.latestEvidenceDate.localeCompare(a.latestEvidenceDate)||a.record.id.localeCompare(b.record.id));
      return {locationId:entry.locationId,feature:entry.feature,title:entry.title,records,recordCount:records.length,latestEvidenceDate:records[0].latestEvidenceDate};
    }).sort((a,b)=>a.title.localeCompare(b.title)||a.locationId.localeCompare(b.locationId));
  }
  const api={buildIndex,lookup,priorCrossings};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderHistory=api;
})(typeof window!=='undefined'?window:globalThis);
