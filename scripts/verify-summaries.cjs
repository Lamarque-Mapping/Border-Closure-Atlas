const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),S=require(path.join(root,'dist/record-summary.js'));
const D=JSON.parse(fs.readFileSync(path.join(root,'dist/data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').trim().replace(/;$/,''));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const before=hash(D.events),byID=new Map(D.events.map(e=>[e.id,e]));
let min=Infinity,max=0,total=0;
for(const e of D.events){
  const description=S.describe(e),size=description.split(/\s+/).length;
  assert.equal(typeof description,'string',e.id);assert(size>=12&&size<=125,e.id+' bounded complete paragraph');
  assert(!/undefined|NaN|Invalid Date|<\/?(?:script|div|p|a)\b/.test(description),e.id+' text safety');
  assert(!/\n|numeric duration withheld|scoped endpoint|operational continuity|calendar[ -](?:day|date)/i.test(description),e.id+' plain paragraph');
  assert(/[.!?]$/.test(description),e.id+' complete final sentence');
  assert(description===S.describe(e),e.id+' deterministic');
  for(const p of e.duration_periods){const single=S.describe(e,{periods:[p]});assert(single&&!/undefined|NaN|Invalid Date/.test(single),p.period_id);assert(!/calendar[ -](?:day|date)/i.test(single),p.period_id+' plain duration wording');}
  min=Math.min(min,size);max=Math.max(max,size);total+=size;
}
assert.equal(before,hash(D.events),'descriptions never change research fields');
// Current audit evidence takes priority even if a legacy event hash survives.
const legacyHashes={GL01:'9c9e6a17200b78097bc980979d975661bc85edd31191ddbb0c650dba8dd3d502',EU022:'21c35d7d251be32aa724b5c672f2289f8fb490883b902aa675adfc61dcae5a4c','R3-EU-004':'aef9bbca965405b6a734f57f621c3dc5c5d604cd5cec36547136fbfe4c2b946b'};
for(const [id,hash] of Object.entries(legacyHashes)){
 const e=byID.get(id);assert(e.audited_reader,id+' current accepted reader is retained');
 assert.notEqual(e.event_hash,hash,id+' source identity changed with audited evidence');
 const fallback=S.describe({...e,record_summary:undefined});
 assert.equal(fallback,S.describe({...e,event_hash:'replacement-audited-record'}),id+' changed source identity invalidates reviewed prose');
 assert.equal(fallback,S.describe({...e,event_hash:hash}),id+' cannot revive its old editorial paragraph');
 assert.equal(S.describe({...e,audit_current:true,audited_reader:undefined,event_hash:hash}),S.describe({...e,audit_current:true,audited_reader:undefined,event_hash:'replacement-audited-record'}),id+' compact audit flag also blocks old editorial prose');
}
assert(!S.describe(byID.get('EU022')).includes('later tightening and final repeal are not fully reconstructed'),'documented policy easing does not retain the obsolete research gap');
assert(!S.describe(byID.get('R3-EU-004')).includes('current dated evidence concerns Korczowa'),'new Hrebenne and Dorohusk phases are not reduced to the old Korczowa-only description');
assert.equal(byID.get('SA025').inclusion_status,'Included');
assert(!S.describe(byID.get('SA025')).includes('This entry is excluded from the analysis'),'an included scoped phase is not described as a wholly excluded parent');
const sa025=byID.get('SA025'),eligibleRail=sa025.duration_periods.filter(p=>p.analysis_included!==false);
assert.equal(S.describe(sa025),S.describe(sa025,{periods:eligibleRail}),'SA025 default summary uses the eligible rail evidence without excluded road qualifications');
assert.equal(S.describe(sa025,{periods:sa025.duration_periods}),S.describe(sa025,{periods:eligibleRail}),'explicit summary periods cannot reintroduce excluded road evidence');
for(const e of D.events.filter(e=>e.inclusion_status==='Excluded'||e.inclusion_status==='Quarantined')){
 assert(e.quarantined&&e.excluded_from_map&&e.quarantine_reason,e.id+' exclusion label and reason remain available to the interface');
 assert(S.describe({...e,record_summary:undefined}).includes('excluded from the analysis'),e.id+' fallback also preserves exclusion');
}
assert(/reportedly announced/.test(S.describe(byID.get('GL18')))&&/implementation.*not been established/.test(S.describe(byID.get('GL18'))),'an unimplemented report is not rewritten as a confirmed closure');
assert(/cancelled/.test(S.describe(byID.get('SUP-004'))),'a cancelled order is not rewritten as an implemented closure');
// Parent fields can name a broader set of crossings and traffic than the phase.
const narrow={id:'test',scope:'International border',crossings:'Apex checkpoint; Birch checkpoint',movement:'Passengers and freight',official_rationale:'Security concerns',context:'Outdated all-border closure',uncertainty:'',duration_periods:[{scope:'Birch checkpoint only',movement:'Passengers',measure_type:'operational_spell',observed_reopening:'Yes',qualification:'Cargo remained exempt.'}]};
const narrowText=S.describe(narrow);assert(narrowText.includes('passengers at Birch checkpoint'));assert(!narrowText.includes('Apex'));assert(!narrowText.includes('Passengers and freight'));assert(!narrowText.includes('Outdated'));assert(narrowText.includes('Cargo remained exempt'));
const unknown={id:'test2',scope:null,crossings:'Not established',movement:'Not separately established',official_rationale:'Not established in retrieved evidence',duration_periods:[]};
assert.equal(S.describe(unknown),'The precise location and affected traffic are not established. A reliable period of closure has not been established.');
const datesOnly={...narrow,duration_periods:[{...narrow.duration_periods[0],qualification:'',temporal_display_rule:'dated_evidence_only_no_continuity_inference'}]};assert(S.describe(datesOnly).includes('particular dates'));
const held={...narrow,duration_periods:[{...narrow.duration_periods[0],qualification:'',contested:true}]};assert(S.describe(held).includes('accounts are disputed'));
console.log(`Summaries passed: ${D.events.length} complete paragraphs, ${min}–${max} words (mean ${Math.round(total/D.events.length)}); current phase scope, policy/observation/held limits, source attribution and immutable data.`);
