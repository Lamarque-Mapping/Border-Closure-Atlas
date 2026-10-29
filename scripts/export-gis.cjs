/* GIS projection of the current register and the website's reviewed geography.
 * No new geocoding, inferred endpoints or inherited parent-date intervals. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('../dist/core.js'),D=require('../dist/duration.js'),R=require('./analysis-regions.js');
const root=path.resolve(__dirname,'..');
const BASE='https://lamarque-mapping.github.io/Border-Closure-Atlas/';
const unique=values=>[...new Set(values.filter(Boolean))];
const urls=values=>unique(values).filter(value=>/^https?:\/\//.test(value));
const textList=values=>(values||[]).join('; ');
const scalar=value=>value==null?null:typeof value==='boolean'?Number(value):typeof value==='object'?JSON.stringify(value):value;
const flatten=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,scalar(value)]));
const phaseFields=['kind','measure_type','start_earliest','start_latest','end_earliest','end_latest',
  'last_confirmed','minimum_days','maximum_days','display','scope','movement','direction','authority',
  'continuity_status','endpoint_status','basis','qualification','review_type','review_date','contested',
  'calculation_rule','reported_duration','reported_schedule','endpoint_inclusion','observed_reopening',
  'end_is_reopening','complete_operational','exact_complete_operational','evidence_dates',
  'strictly_over_24_hours','over_24_hours_basis','temporal_display_rule'];

function build(data,review,statusSource){
  C.validate(data);review.attach(data);
  assert.equal(data.meta.source_sha256,statusSource.source_sha256,'Later geography qualifications belong to the same release');
  const locations=new Map(C.locationFeatures(data).map(f=>[f.properties.location_id,f]));
  const layers={crossing_points:[],border_lines:[],context_areas:[]};
  const records=[],phases=[],sources=[],unmapped=[];
  for(const e of data.events){
    const included=!C.excluded(e),reader=e.audited_reader||{};
    const recordURL=BASE+'#dataset/record-'+encodeURIComponent(e.id);
    const allURLs=urls([...(e.source_urls||[]),...(e.sources||[]).map(s=>s.url),
      ...(e.duration_periods||[]).flatMap(p=>p.source_urls||[])]);
    const record={record_id:e.id,title:e.title,countries:textList(e.countries),
      research_area:R.area(e),original_region:e.region,continents:textList(e.continents),
      included:Number(included),over_24h:Number(included&&D.matches(e,'over1')),
      crossing_scope:reader['Crossing and scope']||e.scope,
      movement_exceptions:reader['Traffic, direction and exceptions']||e.movement,
      chronology:reader['Phase dates and scope']||e.current_timing,
      rationales:textList(e.rationales),rationale_attribution:reader['Rationales and attribution']||'',
      qualification:reader['Current uncertainty / qualification']||e.uncertainty,
      verification:reader['Latest verification']||'',review_date:reader['Review date']||null,
      source_access:reader['Recorded source-access limits']||'',
      exclusion_reason:included?null:e.quarantine_reason||e.inclusion_status,
      source_urls:allURLs.join('\n'),record_url:recordURL,mapped_phases:0,mapped_features:0,located_phases:0,border_reference_phases:0,unmapped_phases:0};
    for(const s of e.sources||[])sources.push(flatten({record_id:e.id,...s}));
    const catalogued=new Set((e.sources||[]).map(s=>s.url));
    for(const url of allURLs)if(!catalogued.has(url))sources.push({record_id:e.id,url,
      evidence_note:'Retained record/phase source URL; consult the record for its attribution and access limits.'});
    for(const p of e.duration_periods||[]){
      const phaseIncluded=included&&p.analysis_included!==false;
      const row=review.review.phases[p.period_id];
      const ids=phaseIncluded?C.mapLocationsFor({...e,duration_periods:[p]},data,{mode:'all',duration:'all'}):[];
      const referenceIDs=new Set(row?.reference_border_ids||[]);
      const referenceOnly=ids.length>0&&ids.every(id=>referenceIDs.has(id));
      const referenceNotes=(row?.reference_border_notes||[]).map(note=>note.qualification);
      const props=flatten({record_id:e.id,phase_id:p.period_id,
        ...Object.fromEntries(phaseFields.map(key=>[key,p[key]??null])),
        record_included:Number(included),included:Number(phaseIncluded),
        over_24h:Number(phaseIncluded&&D.qualifies(p,e)),rationales:textList(p.rationales||e.rationales),
        source_ids:textList(p.source_ids),source_urls:urls(p.source_urls||[]).join('\n'),
        scope_category:row?.category||null,locations_partial:row?Number(row.partial||!ids.length):null,
        mapping_status:!phaseIncluded?'Excluded':!ids.length?'Unmapped':referenceOnly?'Border reference only':row?.partial?'Partly mapped':'Mapped',
        map_representation:!ids.length?'unmapped':referenceOnly?'border_reference':'located',
        border_reference_qualification:referenceOnly?unique(referenceNotes).join(' '):null,
        mapped_features:ids.length,record_url:recordURL});
      phases.push(props);
      if(ids.length){record.mapped_phases++;record.mapped_features+=ids.length;if(referenceOnly)record.border_reference_phases++;else record.located_phases++;}
      else if(phaseIncluded){record.unmapped_phases++;unmapped.push({...props,title:e.title,countries:record.countries});}
      for(const id of ids){
        const feature=locations.get(id);assert(feature?.geometry,'Unresolved geometry '+id);
        const g=feature.geometry,loc=feature.properties;
        const featureReferenceNotes=(row?.reference_border_notes||[]).filter(note=>note.location_id===id).map(note=>note.qualification);
        const layer=g.type==='Point'?'crossing_points':/^(Multi)?LineString$/.test(g.type)?'border_lines':/^(Multi)?Polygon$/.test(g.type)?'context_areas':null;
        assert(layer,'Unsupported reviewed geometry '+g.type);
        const window=(statusSource.geography_windows||[]).find(w=>w.record_id===e.id&&w.phase_id===p.period_id&&w.location_id===id);
        layers[layer].push({type:'Feature',geometry:g,properties:{...props,
          feature_id:e.id+'|'+p.period_id+'|'+id,
          title:e.title,countries:record.countries,research_area:record.research_area,
          location_id:id,location_name:loc.label||loc.name||id,
          geometry_role:referenceIDs.has(id)?'Known border only; exact crossing or extent unresolved':layer==='crossing_points'?'Approximate crossing reference':layer==='border_lines'?'Wider border reference':'Country/area context only',
          geometry_precision:loc.precision||'Generalised reference',
          geometry_note:referenceIDs.has(id)?unique(featureReferenceNotes).join(' '):loc.review_note||loc.source_note||e.geography_note||'',
          geometry_source_urls:urls([loc.source_url,...(loc.source_urls||[]),...(loc.sources||[]).map(s=>s.url)]).join('\n'),
          geometry_valid_from:window?.from_date||null,
          geometry_time_note:window?'This location applies from '+window.from_date+' within the recorded staggered onset; the phase dates have not been rewritten.':null,
          geometry_provenance:JSON.stringify(loc)}});
      }
    }
    if(included&&!e.duration_periods?.length){
      // An undated location is not assigned a fabricated phase or date range.
      unmapped.push({record_id:e.id,phase_id:null,title:e.title,countries:record.countries,
        included:1,mapping_status:'No dated phase',record_url:recordURL,
        qualification:'See the record: no dated phase is available for a phase-location feature.'});
    }
    records.push(flatten(record));
  }
  const counts={records:records.length,included_records:records.filter(r=>r.included).length,
    phases:phases.length,included_phases:phases.filter(p=>p.included).length,
    mapped_records:records.filter(r=>r.mapped_features).length,
    located_records:records.filter(r=>r.located_phases).length,
    border_reference_only_records:records.filter(r=>r.border_reference_phases&&!r.located_phases).length,
    border_reference_phases:records.reduce((n,r)=>n+r.border_reference_phases,0),
    mapped_phases:records.reduce((n,r)=>n+r.mapped_phases,0),
    included_records_without_geometry:records.filter(r=>r.included&&!r.mapped_features).length,
    sources:sources.length,features:Object.fromEntries(Object.entries(layers).map(([name,rows])=>[name,rows.length]))};
  assert.equal(counts.records,data.meta.release_method.counts.records);
  assert.equal(counts.phases,data.meta.release_method.counts.phases);
  assert.equal(counts.included_records,data.meta.release_method.counts.included_records);
  return {meta:{release_id:data.meta.release_id,snapshot_date:data.meta.snapshot_date,
    study_window:[data.meta.window_start,data.meta.window_end],source_sha256:data.meta.source_sha256,
    data_state_sha256:data.meta.data_state_sha256,crs:'EPSG:4326',coordinate_order:'longitude, latitude',
    scope:'Historical land-border register, all dates and durations. National-policy and later-status supplements are separate.',
    counts,website:BASE},layers,tables:{records,phases,sources,unmapped_phases:unmapped},method:data.meta.release_method};
}
function current(){
  const data=JSON.parse(fs.readFileSync(path.join(root,'dist/data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
  return build(data,require('../dist/crossing-geography.js'),JSON.parse(fs.readFileSync(path.join(root,'source/border-status-review.json'),'utf8')));
}
module.exports={build,current};
if(require.main===module)process.stdout.write(JSON.stringify(current()));
