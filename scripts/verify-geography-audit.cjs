/* Verify independent reconstruction provenance and protect prior map coverage. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'research/geography-audit-2026-10-29');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const plan=read(path.join(folder,'audit-plan.json')),baseline=read(path.join(folder,'baseline-map-bindings.json'));
const audit=read(path.join(folder,'reconciled-decisions.json')),source=read(path.join(root,'source/crossings/locations.json'));
const C=require('../dist/core.js'),X=require('../dist/crossing-geography.js');
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));X.attach(data);
assert.equal(data.meta.source_sha256,plan.source_sha256);assert.equal(audit.source_sha256,plan.source_sha256);assert.equal(baseline.source_sha256,plan.source_sha256);
const events=new Map(data.events.map(e=>[e.id,e])),scopeIDs=new Set(Object.values(plan.groups).flat());
assert.equal(scopeIDs.size,plan.baseline.unmapped_records);
const decisions=new Map(audit.decisions.map(d=>[d.record_id,d]));assert.equal(decisions.size,audit.decisions.length,'unique reconciled records');
const progress=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/geography-audit-progress.cjs')],{encoding:'utf8'}));
assert.deepEqual(progress.problems,[],'every saved reconstruction has valid identity, phase coverage and evidence fields');
if(audit.status==='complete')assert.equal(decisions.size,scopeIDs.size,'complete audit covers every assigned record');
const applied=new Set();
for(const decision of decisions.values()){
 assert(scopeIDs.has(decision.record_id),'only assigned previously unmapped records');
 const rows=decision.audit_passes.map(ref=>{
  const bytes=fs.readFileSync(path.join(root,ref.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256,'reconciled source unchanged: '+ref.path);
  const row=JSON.parse(bytes);assert.equal(row.record_id,decision.record_id);return row;
 });
 assert.deepEqual(rows.map(r=>r.pass).sort(),['a','b']);assert.notEqual(rows[0].agent,rows[1].agent);
 assert.deepEqual(decision.phases.map(p=>p.phase_id).sort(),(events.get(decision.record_id).duration_periods||[]).map(p=>p.period_id).sort(),'every canonical phase receives a disposition');
 for(const p of decision.phases){
  const original=events.get(decision.record_id).duration_periods.find(q=>q.period_id===p.phase_id);assert(original,'canonical phase');
  if(p.decision==='hold')continue;
  assert(original.analysis_included!==false,'excluded phases stay excluded');
  assert(rows.every(r=>r.phase_decisions.some(q=>q.phase_id===p.phase_id&&['map','partial'].includes(q.decision))),'two supporting geography reconstructions');
  const bindings=[...source.bindings,...(source.border_bindings||[])].filter(b=>b.phase_id===p.phase_id&&b.record_id===decision.record_id);
  assert(bindings.length,'approved phase has compiled source binding');
  for(const binding of bindings){
   assert.equal(binding.current_phase_scope,original.scope);assert.deepEqual(binding.geography_audit.audit_passes,decision.audit_passes,'production provenance matches review');
   assert.equal(binding.complete,p.complete);assert(binding.phase_source_urls.length,'phase sources retained');
  }
  applied.add(decision.record_id);
 }
}
let mapped=0,over24=0;
for(const site of source.sites.filter(s=>s.geography_audit?.audit_id===audit.audit_id)){
 const refs=site.geography_audit.audit_passes;
 const passRows=refs.map(ref=>{
  const bytes=fs.readFileSync(path.join(root,ref.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256,'site evidence is current: '+site.id);
  return JSON.parse(bytes);
 });
 assert.notEqual(passRows[0].agent,passRows[1].agent);
 const d=decisions.get(passRows[0].record_id);assert(d,'site points to a reconciled record');
 assert(d.phases.some(p=>p.decision!=='hold'&&(p.sites||[]).some(s=>{
  const id=s.existing_site_id||s.proposed_site_id;
  return id===site.id||id===site.original_reference_id||id.replace(/^crossing-/,'post-')===site.id;
 })),'site provenance supports this approved facility: '+site.id);
}
for(const [id,old] of Object.entries(baseline.records)){
 const e=events.get(id);assert(e&&!C.excluded(e));
 const now=C.mapLocationsFor(e,data,{mode:'all',duration:'all'}).sort(),long=C.mapLocationsFor(e,data,{mode:'all',duration:'over1'}).sort();
 if(!scopeIDs.has(id)){assert.deepEqual(now,old.all,'prior all-duration geography preserved: '+id);assert.deepEqual(long,old.over24,'prior >24h geography preserved: '+id);}
 else if(!applied.has(id))assert.equal(now.length,0,'unreconciled records remain unmapped: '+id);
 else assert(now.length,'newly approved record actually appears: '+id);
 if(now.length)mapped++;if(long.length)over24++;
}
assert.equal(mapped,plan.baseline.mapped_records+applied.size,'coverage gain counts records, not phases/features');
assert.equal(source.geography_audit.mapped_records,applied.size);
console.log(JSON.stringify({check:'independent geography audit passed',reconciled_records:decisions.size,newly_mapped_records:applied.size,total_mapped:mapped,mapped_over24:over24,unchanged_prior_mapped:baseline.mapped.all}));
