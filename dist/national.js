/* National admission and departure rules supplement the land-border dataset.
 * The source rows remain separate, including the linked England land record.
 * Display periods do not calculate closed days or enter land-duration charts. */
(function(root){
  'use strict';
  const array=v=>Array.isArray(v)?v:[],unique=v=>[...new Set(v.filter(Boolean))];
  const lines=v=>String(v||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
  const split=v=>String(v||'').split(';').map(s=>s.trim()).filter(Boolean);
  const isNational=e=>e?.record_kind==='national_policy';
  function compile(source){
    return source.policies.map(config=>{
      const observations=source.observations.filter(row=>row['Policy ID']===config.id).sort((a,b)=>a['Effective date'].localeCompare(b['Effective date']));
      const first=observations[0],country=first.Country,id='NATIONAL-'+config.id;
      const sourceURLs=unique([...observations.flatMap(row=>lines(row['Source URLs'])),...array(config.period?.sources)]);
      const sources=sourceURLs.map(url=>{
        const found=source.sources.find(row=>row['Source URL']===url);
        const host=new URL(url).hostname;
        const publisher=found?.['Publishers / reporting bodies']||(host==='www.anao.gov.au'?'Australian National Audit Office':host.includes('beehive')?'New Zealand Government':host.includes('legislation.gov.uk')?'UK legislation':host.includes('homeaffairs')?'Australian Home Affairs':host.includes('gov.uk')?'UK Government':host);
        return {url,publisher,title:found?.['Source titles']?.split('\n')[0]||publisher,publication_date:found?.['Publication date(s)']||null,source_id:found?.['Source labels — all retrievals']||'National map review',supports:[],source_type:'Official policy evidence',content_access:'See source and workbook',access_history:[]};
      });
      const base={measure_type:'formal_policy_period',kind:'policy_period',contested:false,minimum_days:null,maximum_days:null,complete_operational:false,exact_complete_operational:false,end_inclusive:false,endpoint_inclusion:'Not used for a duration',observed_reopening:'Not an airport or crossing reopening',end_is_reopening:false,map_scope_note:'The outline marks the country or area covered by the rule. Read the record for affected travellers and exceptions.'};
      const periods=observations.map(row=>({...base,period_id:row['Observation ID'],national_observation:true,national_label:({entry_prohibition:'Entry ban introduced',exit_prohibition:'Departure ban introduced',entry_condition:'Entry conditions',relaxation:'Rules relaxed'})[row['Measure class']],start_earliest:row['Effective date'],start_latest:row['Effective date'],end_earliest:null,end_latest:null,last_confirmed:null,evidence_dates:[row['Effective date']],temporal_display_rule:'dated_evidence_only_no_continuity_inference',scope:row.Jurisdiction,movement:row['Affected people'],direction:row.Direction,authority:country+' authorities',display:row['Dated policy change'],basis:row['Dated policy change'],qualification:row['Remaining evidence need'],exceptions:row.Exceptions,modes:row['Supported modes'],endpoint_status:'policy_change',source_ids:split(row['Source IDs']),source_urls:lines(row['Source URLs']),reported_schedule:row['Local time and zone']}));
      if(config.period){
        const p=config.period;
        periods.unshift({...base,period_id:config.id+'-MAP',national_display_period:true,national_label:p.label,start_earliest:p.start,start_latest:p.start,end_earliest:p.end,end_latest:p.end,evidence_dates:[p.start,p.end],last_confirmed:null,endpoint_status:'policy_relaxation',temporal_display_rule:'national_policy_context_not_exact_duration',scope:first.Jurisdiction,movement:'Traveller groups covered by this policy, with changing exceptions',direction:first.Direction,display:p.qualification,basis:'Broad policy history checked against the linked official sources; individual changes are listed below.',qualification:p.qualification,source_ids:[],source_urls:p.sources});
      }
      const linked=unique(observations.flatMap(r=>split(r['Existing record IDs'])));
      return {id,record_kind:'national_policy',national_policy_id:config.id,national_kind:config.kind,national_geometry:config.geometry,national_observations:observations,national_summary:config.summary,linked_land_ids:linked,title:config.title,countries:[country],continents:[config.geometry==='AUS'||config.geometry==='NZL'?'Oceania':'Europe'],region:config.geometry==='AUS'||config.geometry==='NZL'?'Australia and New Zealand':'Northern Europe',start:config.period?.start||first['Effective date'],end:null,onset_month:observations.some(r=>r['Measure class']==='entry_prohibition'||r['Measure class']==='exit_prohibition')?first['Effective date'].slice(0,7):null,scope:unique(observations.map(r=>r.Jurisdiction)).join('; '),crossings:null,movement:unique(observations.map(r=>r['Affected people'])).join('\n'),direction:unique(observations.map(r=>r.Direction)).join('; '),exceptions:unique(observations.map(r=>r.Exceptions)).join('\n'),official_rationale:'Prevent COVID-19 transmission.',context:config.summary,uncertainty:'Traveller eligibility and exceptions changed. No single continuous duration is certified for all travellers; this is not an airport-closure record.',relationship:linked.length?'Extends the mode coverage of '+linked.join(', ')+'. Do not count as an additional independent closure.':null,rationales:['Health and biosecurity'],rationale_coding_status:'Coded',rationale_subcategories:{'Health and biosecurity':['COVID-19']},rationale_assignments:[],source_urls:sourceURLs,sources,duration_periods:periods,duration_review:{display:'No single closed-days total: traveller groups and exceptions changed.'},timing_coverage:{any_dated_evidence:true,operational_complete:false,operational_exact_complete:false,formal_policy:true},current_review:{outcome:'Official national-policy evidence; amendment history incomplete',claims:[]},unresolved_issues:[],followup_reviews:[],quarantined:false,excluded_from_map:false,inclusion_status:'Included',mapping_precision:'national_policy',location_ids:['national-'+config.geometry],geography_note:'The outline marks the country or area covered by the entry or departure rule. The record explains which travellers were affected and what exceptions applied.',source_sha256:source.source_sha256,record_type:config.kind==='entry_conditions'?'National entry conditions — not a closure':'National entry/departure prohibition',status_observation:'Historical policy evidence; no inference about present entry rules.',current_timing:config.period?config.period.label+'; exceptions changed.':'Dated policy changes only.'};
    });
  }
  function attach(data,source=root.ATLAS_NATIONAL_DATA,england=root.ATLAS_ENGLAND_GEOMETRY){
    if(!source||data.meta.national_supplement?.version===source.version)return data;
    // A custom replacement dataset must not inherit this release's supplement.
    if(data.meta.source_sha256!=='b7290c0ce1056ed7f045ff66e7354edd1d5593db001b12f4d65372318185c6f1')return data;
    const events=compile(source),features=[];
    for(const code of unique(events.map(e=>e.national_geometry))){
      let feature=code==='ENG'?england?.features?.[0]:data.countries.features.find(f=>f.properties.ADM0_A3===code);
      if(!feature)throw Error('National policy geography missing: '+code);
      // Keep New Zealand's dateline islands in the same Pacific map copy, so
      // fitting its policy does not zoom out across almost the whole world.
      const pacific=coords=>typeof coords[0]==='number'?[coords[0]<0?coords[0]+360:coords[0],...coords.slice(1)]:coords.map(pacific);
      const geometry=code==='NZL'?{...feature.geometry,coordinates:pacific(feature.geometry.coordinates)}:feature.geometry;
      features.push({type:'Feature',geometry,properties:{...feature.properties,location_id:'national-'+code,label:code==='ENG'?'England':feature.properties.ADMIN||feature.properties.NAME,display_role:'national_policy',precision:'National-policy jurisdiction, not a physical closure footprint',source_name:'Natural Earth',source_url:'https://www.naturalearthdata.com/'}});
    }
    data.events.push(...events);data.context_locations.features.push(...features);
    data.meta.national_supplement={version:source.version,source_sha256:source.source_sha256,policy_histories:events.length,observations:source.observations.length,method:source.method};
    return data;
  }
  const api={compile,attach,isNational};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AtlasNational=api;
})(typeof window==='undefined'?globalThis:window);
