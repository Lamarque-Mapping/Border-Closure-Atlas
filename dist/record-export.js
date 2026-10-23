(function(root){
  'use strict';
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>Array.isArray(value)?value.join('; '):String(value??'');
  const url=value=>{try{const parsed=new URL(value);return /^https?:$/.test(parsed.protocol)?parsed.href:null;}catch{return null;}};
  function cell(value){
    let valueText=text(value);
    // Keep source text as text when opened in spreadsheet applications.
    if(/^[\s\u0000-\u001f]*[=+@-]/.test(valueText))valueText="'"+valueText;
    return '"'+valueText.replace(/"/g,'""')+'"';
  }
  function sources(record){
    const found=new Map();
    for(const source of array(record.sources)){const href=url(source.url);if(href&&!found.has(href))found.set(href,{...source,url:href});}
    for(const value of [...array(record.source_urls),...array(record.duration_periods).flatMap(p=>array(p.source_urls))]){
      const href=url(typeof value==='string'?value:value?.url);
      if(href&&!found.has(href))found.set(href,{url:href,publisher:new URL(href).hostname.replace(/^www\./,'')});
    }
    return [...found.values()];
  }
  function bounds(first,last){return !first?'Not established':!last||first===last?first:first+' to '+last;}
  function periodDates(period){
    if(period.national_observation)return period.period_id+': '+period.start_earliest+' — '+period.national_label;
    if(period.national_display_period)return period.period_id+': '+period.start_earliest+' to '+period.end_latest+' — '+period.national_label+'; changing exceptions, not a measured continuous closure';
    const endpoint=period.kind==='confirmed_through'||period.endpoint_status==='last_confirmed'
      ?'Last confirmed '+(period.last_confirmed||period.end_latest||'not established')+'; reopening not established'
      :(period.end_is_reopening?'Reopening: ':'End of documented period: ')+bounds(period.end_earliest,period.end_latest);
    return (period.contested?'Held / contested · ':'')+(period.period_id?period.period_id+': ':'')+'Start: '+bounds(period.start_earliest,period.start_latest)+'. '+endpoint;
  }
  function filterDescription(state,locationLabel){
    const mode=state.mode==='all'?'All recorded closures':state.mode==='onsets'?'Closures beginning':'Border Restrictions';
    const month=Number.isFinite(state.month)?String(Math.floor(state.month/12))+'-'+String(state.month%12+1).padStart(2,'0'):'';
    return [mode+(state.mode!=='all'&&month?' · '+month:''),state.query?.trim()?'Search: '+state.query.trim():'',
      state.continent?'Continent: '+state.continent:'',state.region?'Region: '+state.region:'',state.rationale?'Coded rationale: '+state.rationale:'',
      locationLabel?'Location: '+locationLabel:'',state.precision?'Location detail: '+state.precision:'',state.measureType?'Timing evidence: '+state.measureType:'',
      state.includeExcluded?'Includes excluded records':''].filter(Boolean).join('; ');
  }
  function build({records,state,locationLabel='',cleanText=text,recordURL=id=>'https://border-closures-atlas.lamarque.chatgpt.site/#analysis/record-'+encodeURIComponent(id)}){
    const headers=['Record ID','Closure','Countries','Named crossings','Geographical scope','Affected movement','Direction','Coded rationale','Documented dates','Duration (days)','Timing notes','Context','Stated justification','Exceptions','Uncertainty','Source names and titles','Source links','Full record link','Region','Current review','Excluded record','Map filters','Record type','Linked land records'];
    const filters=filterDescription(state,locationLabel);
    const rows=records.map(record=>{
      const clean=(value,field)=>text(cleanText(value,field,record.id));
      const periods=array(record.duration_periods),linked=sources(record);
      const duration=record.record_kind==='national_policy'?'Not calculated: policy history with changing traveller eligibility and exceptions':periods.length?periods.map(p=>(p.period_id?p.period_id+': ':'')+clean(p.display||'Duration not established','duration')).join('\n'):clean(record.duration_review?.display||'Duration not established','duration');
      const timing=periods.map(p=>[p.period_id,p.scope,p.basis,p.qualification,'Observed reopening: '+p.observed_reopening,'Endpoint inclusion: '+p.endpoint_inclusion,p.reported_schedule,p.temporal_display_rule,p.map_scope_note].filter(Boolean).join(' · ')).join('\n\n');
      return [record.id,clean(record.title||record.id,'title'),text(record.countries),clean(record.crossings,'Crossings'),clean(record.scope,'scope'),clean(record.movement,'Affected movement'),clean(record.direction,'Direction'),text(record.rationales)||record.rationale_coding_status||'No assigned category',
        periods.length?periods.map(periodDates).join('\n'):'Not established',duration,clean(timing||record.current_timing,'duration'),clean(record.context,'Context'),clean(record.official_rationale,'Stated justification'),clean(record.exceptions,'Exceptions'),clean(record.uncertainty,'uncertainty'),
        linked.map(s=>[s.publisher||new URL(s.url).hostname,s.title,s.publication_date].filter(Boolean).join(' · ')).join('\n'),linked.map(s=>s.url).join('\n'),recordURL(record.id),record.region,record.current_review?.outcome,record.quarantined||record.excluded_from_map?'Yes':'No',filters,record.record_kind==='national_policy'?record.record_type:'Land-border record',text(record.linked_land_ids)];
    });
    const label=String(state.query?.trim()||locationLabel||state.continent||'filtered').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'filtered';
    return {filename:'border-closures-'+label+'-'+records.length+'-records.csv',content:'\ufeff'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n',type:'text/csv;charset=utf-8',count:records.length};
  }
  function download(output){
    const href=URL.createObjectURL(new Blob([output.content],{type:output.type})),link=document.createElement('a');
    link.href=href;link.download=output.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
  }
  const api={build,download};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderRecordExport=api;
})(typeof window!=='undefined'?window:globalThis);


