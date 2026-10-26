/* Build a small, phase-specific map overlay without changing the dataset. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=path.join(root,'source/crossings');
const scope=JSON.parse(fs.readFileSync(path.join(source,'scope-review.json'),'utf8'));
const locations=JSON.parse(fs.readFileSync(path.join(source,'locations.json'),'utf8'));
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
assert.equal(scope.source_sha256,data.meta.source_sha256,'review must match the native data release');
assert.equal(locations.source_sha256,scope.source_sha256,'location bindings and scope review must match the same release');
const expected=new Map(data.events.filter(e=>!e.quarantined&&!e.excluded_from_map).flatMap(e=>e.duration_periods.length?e.duration_periods.filter(p=>p.analysis_included!==false).map(p=>[p.period_id,{record_id:e.id,scope:p.scope}]):[[e.id,{record_id:e.id,scope:null}]]));
const categories=new Set(['single_site','multiple_named_sites','wider_border','needs_review']),phases={},undated={};
for(const row of scope.rows){
  assert(categories.has(row.category));
  const index=row.phase_id?phases:undated,key=row.phase_id||row.record_id;
  assert(!index[key],'duplicate reviewed phase '+key);
  assert(expected.has(key)&&expected.get(key).record_id===row.record_id,'scope decision belongs to this included record/phase');
  assert.equal(row.current_phase_scope,expected.get(key).scope,'phase scope changed after geography reconciliation');
  index[key]={record_id:row.record_id,phase_id:row.phase_id||null,category:row.category,site_label:row.site_label||'',site_ids:[],partial:row.category==='multiple_named_sites'};
}
assert.equal(scope.rows.length,expected.size,'every included phase and undated record needs one scope decision');
const sites=[],ids=new Set();
for(const site of locations.sites){
  assert(site.id&&site.name&&!ids.has(site.id),'duplicate/unnamed crossing');ids.add(site.id);
  assert(Array.isArray(site.coordinates)&&site.coordinates.length===2&&site.coordinates.every(Number.isFinite));
  assert(Math.abs(site.coordinates[0])<=180&&Math.abs(site.coordinates[1])<=90);
  assert(site.source_urls?.length&&site.source_urls.every(url=>/^https?:\/\//.test(url)),'crossing needs a location source');
  sites.push({type:'Feature',properties:{location_id:site.id,name:site.name,label:site.name,display_role:'crossing_reference',precision:site.precision||'Approximate crossing area',source_url:site.source_urls[0],source_urls:site.source_urls,source_name:'Crossing location evidence',review_note:site.source_note||'',source_note:site.source_note||'',countries:site.countries||[]},geometry:{type:'Point',coordinates:site.coordinates}});
}
for(const binding of locations.bindings){
  const row=binding.phase_id?phases[binding.phase_id]:undated[binding.record_id];
  assert(row&&row.record_id===binding.record_id,'binding belongs to its phase');
  assert(['single_site','multiple_named_sites'].includes(row.category),'only identified crossing phases can receive crossing points');
  assert(ids.has(binding.site_id),'binding must have sourced coordinates');
  if(!row.site_ids.includes(binding.site_id))row.site_ids.push(binding.site_id);
  assert.equal(binding.current_phase_scope,expected.get(binding.phase_id||binding.record_id).scope,'binding applicability must match the current phase scope');
  if(binding.complete===false)row.explicitly_partial=true;
  if(binding.complete===true)row.explicitly_complete=true;
}
for(const row of [...Object.values(phases),...Object.values(undated)]){
  if(row.explicitly_partial)row.partial=true;
  else if(row.explicitly_complete)row.partial=false;
  delete row.explicitly_partial;delete row.explicitly_complete;
}
for(const row of Object.values(phases))if(row.category==='single_site')assert(row.site_ids.length<=1,'one crossing per single-site phase');
const review={source_sha256:scope.source_sha256,review_date:scope.review_date,phases,undated,sites};
const runtime=fs.readFileSync(path.join(__dirname,'crossing-geography-runtime.js'),'utf8');
fs.writeFileSync(path.join(root,'dist/crossing-geography.js'),runtime.replace('__CROSSING_REVIEW__',JSON.stringify(review).replace(/</g,'\\u003c')));
fs.mkdirSync(path.join(root,'dist/downloads'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/downloads/crossing-map-review.json'),JSON.stringify({...scope,geography:locations},null,2)+'\n');
const bound=Object.values(phases).filter(row=>row.site_ids.length);
console.log(JSON.stringify({sites:sites.length,mappedPhases:bound.length,mappedRecords:new Set(bound.map(row=>row.record_id)).size,screenedPhases:Object.keys(phases).length,undated:Object.keys(undated).length}));
