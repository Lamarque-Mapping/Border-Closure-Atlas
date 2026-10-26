/* Derive a small browsing dataset and independently retrievable complete records.
 * data.js remains the canonical, lossless offline/export dataset. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const web=path.resolve(process.argv[2]||path.join(__dirname,'../dist'));
const raw=fs.readFileSync(path.join(web,'data.js'),'utf8');
const data=JSON.parse(raw.replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
const serialise=v=>JSON.stringify(v).replace(/</g,'\\u003c');
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
const recordDir=path.join(web,'records');fs.mkdirSync(recordDir,{recursive:true});
const currentFiles=new Set();
const recordFields=['id','title','region','countries','continents','location_ids','mapping_precision','start','end','scope','crossings','movement','direction','rationales','rationale_coding_status','quarantined','inclusion_status','excluded_from_map','evidence_status','quarantine_reason','timing_coverage','onset_month','onset_months','phase_onsets','onset_status','policy_group','audit_current'];
const phaseFields=['period_id','kind','measure_type','contested','start_earliest','start_latest','end_earliest','end_latest','last_confirmed','minimum_days','maximum_days','endpoint_status','end_inclusive','endpoint_inclusion','observed_reopening','temporal_display_rule','evidence_dates','scope','complete_operational','exact_complete_operational','analysis_included','strictly_over_24_hours','over_24_hours_basis','rationales'];
const events=data.events.map(e=>{
 const body=serialise({source_sha256:data.meta.source_sha256,record:e});
 const file='records/'+hash(body)+'.json';currentFiles.add(path.basename(file));fs.writeFileSync(path.join(web,file),body);
 // Preserve the existing Analysis search vocabulary without loading its source histories.
 const dimensions=[e.countries.join('; '),e.imposing_authority,e.scope,e.crossings,e.direction,e.movement,e.exceptions,e.enforcement,e.consequences,e.last_confirmed_closed,e.record_type,e.status_observation,e.relationship];
 const search=[...new Set([e.id,e.title,e.region,e.official_rationale,e.context,e.uncertainty,e.policy_group,...dimensions,...e.sources.map(s=>s.title),...e.duration_periods.map(p=>p.scope),...e.rationale_assignments.map(a=>a.Subcategory)].filter(Boolean))].join(' ');
 // Deduplicate repeated complete source fields; preserve phrases and all full
 // evidence in the lazily loaded record and downloadable source.
 return {...pick(e,recordFields),details_file:file,search_text:search,
  duration_periods:e.duration_periods.map(p=>pick(p,phaseFields)),duration_review:{display:e.duration_review.display},
  current_review:{outcome:e.current_review.outcome,claims:e.current_review.claims.map(c=>pick(c,['field','assessment']))},sources:[],rationale_assignments:[],unresolved_issues:[]};
});
const parts=[];
for(let i=0;i<data.events.length;i+=100){
 const body=serialise({source_sha256:data.meta.source_sha256,events:data.events.slice(i,i+100)});
 const file='records/part-'+hash(body)+'.json';parts.push(file);currentFiles.add(path.basename(file));fs.writeFileSync(path.join(web,file),body);
}
const archive=serialise({meta:data.meta,events_parts:parts,workbook_geography:data.workbook_geography,workbook_review:data.workbook_review}),archiveFile='records/all-'+hash(archive)+'.json';
currentFiles.add(path.basename(archiveFile));
fs.writeFileSync(path.join(web,archiveFile),archive);
for(const file of fs.readdirSync(recordDir))if(/^(?:(?:all|part)-)?[a-f0-9]{24}\.json$/.test(file)&&!currentFiles.has(file))fs.unlinkSync(path.join(recordDir,file));
// Keep every coordinate unchanged. Share exactly identical geometries in memory and on disk.
const geometries=[],seen=new Map(),collections={};
for(const key of ['countries','borders','disputed','locations','context_locations']){
 collections[key]={...data[key],features:data[key].features.map(f=>{const key=serialise(f.geometry);if(!seen.has(key)){seen.set(key,geometries.length);geometries.push(f.geometry);}return {...f,geometry:seen.get(key)};})};
}
const {workbook_geography,workbook_review,...browsingData}=data;
const compact={...browsingData,...collections,geometry_pool:geometries,events,
 links:data.links.map(l=>pick(l,['event_id','location_id'])),
 meta:{...data.meta,web_assets:{research:archiveFile,geometry_encoding:'references-v1'}}};
const body='window.BORDER_DATA = '+serialise(compact)+';\n';
fs.writeFileSync(path.join(web,'map-data.js'),body);
const index=path.join(web,'index.html');
fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace(/data-map-src="[^"]*"/,'data-map-src="map-data.js?v='+hash(body)+'"'));
require('./build-analysis-data.cjs').build(web);
console.log(JSON.stringify({fullBytes:Buffer.byteLength(raw),initialBytes:Buffer.byteLength(body),fullGzipBytes:zlib.gzipSync(raw).length,initialGzipBytes:zlib.gzipSync(body).length,records:events.length}));

