/* Inspect checkpoint files without treating research completion as map approval. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const folder=path.join(root,'research/geography-audit-2026-10-29');
const plan=JSON.parse(fs.readFileSync(path.join(folder,'audit-plan.json'),'utf8'));
const raw=JSON.parse(fs.readFileSync(path.join(root,'dist/data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
if(raw.meta.source_sha256!==plan.source_sha256)throw Error('Audit source release changed');
const records=new Map(raw.events.map(e=>[e.id,e]));
const ids=Object.values(plan.groups).flat(),byPass={},problems=[];
for(const pass of ['a','b']){
  const rows=new Map();
  for(const id of ids){
    const file=path.join(folder,'pass-'+pass,id+'.json');if(!fs.existsSync(file))continue;
    try{
      const text=fs.readFileSync(file,'utf8'),row=JSON.parse(text),issues=[];
      if(row.record_id!==id||row.pass!==pass)issues.push('record/pass identity');
      if(!['verified','qualified','unresolved'].includes(row.verification_status))issues.push('verification status');
      if(!row.agent||!row.review_date||!row.record_scope_reconstruction)issues.push('review attribution/scope');
      if(!Array.isArray(row.source_checks)||!row.source_checks.length)issues.push('source checks absent');
      for(const check of row.source_checks||[])if(!check.url||!check.access_status||!check.finding)issues.push('source access/finding absent');
      const expected=(records.get(id).duration_periods||[]).map(p=>p.period_id).sort();
      const actual=(row.phase_decisions||[]).map(p=>p.phase_id).filter(Boolean).sort();
      if(JSON.stringify(expected)!==JSON.stringify(actual))issues.push('phase coverage');
      for(const p of row.phase_decisions||[]){
        if(!['map','partial','hold'].includes(p.decision))issues.push('phase decision');
        if(!['single_site','multiple_named_sites','wider_border','needs_review'].includes(p.category))issues.push('geography category');
        if(!p.phase_applicability||!p.date_scope_check)issues.push('phase applicability/date checks');
        if(p.decision!=='hold'&&!(p.sites?.length||p.border_reference_ids?.length))issues.push('mapping recommendation without geometry');
        if(records.get(id).duration_periods?.find(q=>q.period_id===p.phase_id)?.analysis_included===false&&p.decision!=='hold')issues.push('excluded phase proposed');
        for(const s of p.sites||[])if(!Array.isArray(s.coordinates)||s.coordinates.length!==2||!s.coordinates.every(Number.isFinite)||!s.source_urls?.length||!s.coordinate_method||!s.precision)issues.push('site coordinates/provenance incomplete');
      }
      rows.set(id,{row,issues,sha256:crypto.createHash('sha256').update(text).digest('hex')});
      if(issues.length)problems.push({pass,id,issues:[...new Set(issues)]});
    }catch(error){problems.push({pass,id,error:error.message});}
  }
  byPass[pass]=rows;
}
const paired=ids.filter(id=>byPass.a.has(id)&&byPass.b.has(id));
const ready=paired.filter(id=>!byPass.a.get(id).issues.length&&!byPass.b.get(id).issues.length);
const counts=pass=>({saved:byPass[pass].size,complete_checkpoints:[...byPass[pass].values()].filter(r=>!r.issues.length).length,
  recommended_records:[...byPass[pass].values()].filter(r=>r.row.phase_decisions?.some(p=>p.decision==='map'||p.decision==='partial')).length});
const result={audit_id:plan.audit_id,baseline:plan.baseline,pass_a:counts('a'),pass_b:counts('b'),both_passes_saved:paired.length,
  ready_for_reconciliation:ready.length,groups:Object.fromEntries(Object.entries(plan.groups).map(([group,list])=>[group,{assigned:list.length,a:list.filter(id=>byPass.a.has(id)).length,b:list.filter(id=>byPass.b.has(id)).length,paired:list.filter(id=>ready.includes(id)).length}])),problems};
console.log(JSON.stringify(result,null,2));
if(process.argv.includes('--pairs')){
  const pairs=ready.map(id=>({record_id:id,pass_a:byPass.a.get(id).sha256,pass_b:byPass.b.get(id).sha256,
    phases:byPass.a.get(id).row.phase_decisions.map(a=>({phase_id:a.phase_id,a,b:byPass.b.get(id).row.phase_decisions.find(b=>b.phase_id===a.phase_id)}))}));
  fs.writeFileSync(path.join(folder,'comparison-candidates.json'),JSON.stringify({audit_id:plan.audit_id,warning:'Independent recommendations only; agreement is not integration approval.',pairs},null,2)+'\n');
}
