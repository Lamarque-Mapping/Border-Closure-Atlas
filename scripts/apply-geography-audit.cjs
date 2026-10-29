/* Apply only explicit coordinating-reviewer decisions after two independent passes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'research/geography-audit-2026-10-29');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const audit=read(path.join(folder,'reconciled-decisions.json'));
const sourceFile=path.join(root,'source/crossings/locations.json'),scopeFile=path.join(root,'source/crossings/scope-review.json');
const source=read(sourceFile),scope=read(scopeFile);
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
assert.equal(data.meta.source_sha256,audit.source_sha256);assert.equal(source.source_sha256,audit.source_sha256);
const events=new Map(data.events.map(e=>[e.id,e])),scopeRows=new Map(scope.rows.map(r=>[r.phase_id||r.record_id,r]));
const baseFeatures=new Map([...(data.locations?.features||[]),...(data.context_locations?.features||[])].map(f=>[f.properties.location_id,f]));
const distinct=items=>[...new Set(items.filter(Boolean))];
const applied=[];
source.border_bindings??=[];
for(const decision of audit.decisions){
 const e=events.get(decision.record_id);assert(e&&!e.excluded_from_map&&!e.quarantined,'only included records');
 assert.equal(decision.audit_passes.length,2,'two source reconstructions required');
 const passes=decision.audit_passes.map(ref=>{
   const bytes=fs.readFileSync(path.join(root,ref.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256,'reconcile changed evidence again');
   const row=JSON.parse(bytes);assert.equal(row.record_id,e.id);return row;
 });
 assert.deepEqual(passes.map(p=>p.pass).sort(),['a','b']);assert.notEqual(passes[0].agent,passes[1].agent,'independent agents');
 for(const p of decision.phases){
   const original=(e.duration_periods||[]).find(q=>q.period_id===p.phase_id);assert(original,'canonical phase exists');
   if(p.decision==='hold')continue;
   assert(original.analysis_included!==false,'excluded phases stay excluded');
   assert(passes.every(pass=>pass.phase_decisions.some(q=>q.phase_id===p.phase_id&&['map','partial'].includes(q.decision))),'both passes support mapping');
   const row=scopeRows.get(p.phase_id);assert(row&&row.record_id===e.id);assert.equal(row.current_phase_scope,original.scope);
   row.category=p.category;row.geography_audit={audit_id:audit.audit_id,review_date:decision.review_date,qualification:p.qualification,decision:p.decision};
   const provenance={audit_id:audit.audit_id,review_date:decision.review_date,audit_passes:decision.audit_passes,reconciliation:'research/geography-audit-2026-10-29/reconciled-decisions.json'};
   const common={record_id:e.id,phase_id:p.phase_id,current_phase_scope:original.scope,complete:p.complete,
     review_date:decision.review_date,note:p.rationale,qualification:p.qualification,phase_source_urls:original.source_urls||[],geography_audit:provenance};
   for(const candidate of p.sites||[]){
     assert(['single_site','multiple_named_sites'].includes(p.category));
     const lead=candidate.existing_site_id||candidate.proposed_site_id;
     let site=source.sites.find(s=>s.id===lead||s.original_reference_id===lead);
     if(site){assert.deepEqual(site.coordinates,candidate.coordinates,'changed existing coordinates need a separate review');}
     else{
       const id=lead.startsWith('crossing-')?'post-'+lead.slice(9):lead;
       assert(id&&!baseFeatures.has(id)&&!source.sites.some(s=>s.id===id),'new site ID unique');
       const base=baseFeatures.get(lead)?.properties||{};
       site={id,name:candidate.name,coordinates:candidate.coordinates,countries:e.countries,
         original_reference_id:candidate.existing_site_id||null,coordinate_method:candidate.coordinate_method,
         precision:candidate.precision,source_urls:candidate.source_urls,
         sources:base.sources||[],source_note:candidate.evidence_note,
         historical_location_status:'Approximate crossing-area reference, not a historical barrier footprint.',
         review_status:'two independent source reconstructions reconciled',reviewed_on:decision.review_date,
         geography_audit:provenance,geographic_evidence:candidate.geographic_evidence||[]};
       source.sites.push(site);
     }
     const prior=source.bindings.find(b=>b.record_id===e.id&&b.phase_id===p.phase_id&&b.site_id===site.id);
     if(prior)Object.assign(prior,common);else source.bindings.push({...common,site_id:site.id});
   }
   for(const id of p.border_reference_ids||[]){
     assert.equal(p.category,'wider_border');assert(/^(Multi)?LineString$/.test(baseFeatures.get(id)?.geometry?.type||''));
     const prior=source.border_bindings.find(b=>b.phase_id===p.phase_id&&b.location_id===id);
     if(prior)Object.assign(prior,common);else source.border_bindings.push({...common,location_id:id});
   }
   if(p.complete)source.unlocated=(source.unlocated||[]).filter(r=>r.phase_id!==p.phase_id);
   else for(const unresolved of source.unlocated||[])if(unresolved.phase_id===p.phase_id){unresolved.geography_audit_partial=true;unresolved.reason=p.qualification||p.rationale;}
   applied.push({record_id:e.id,phase_id:p.phase_id,decision:p.decision});
 }
}
source.review_date=scope.review_date='2026-10-29';
source.geography_audit={audit_id:audit.audit_id,status:audit.status,reconciled_records:audit.decisions.length,
  mapped_records:new Set(applied.map(p=>p.record_id)).size,mapped_phases:applied.length,decisions_path:'research/geography-audit-2026-10-29/reconciled-decisions.json'};
for(const [file,value] of [[sourceFile,source],[scopeFile,scope]])fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
fs.writeFileSync(path.join(folder,'integration-receipt.json'),JSON.stringify({audit_id:audit.audit_id,source_sha256:audit.source_sha256,applied},null,2)+'\n');
console.log(JSON.stringify(source.geography_audit));
