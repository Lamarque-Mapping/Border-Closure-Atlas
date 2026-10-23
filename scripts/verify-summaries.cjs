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
const gl=S.describe(byID.get('GL01'));assert(gl.includes('do not show an uninterrupted 2019–2022 closure of all traffic'));assert(gl.includes('remain contested'));
assert.notEqual(S.describe({...byID.get('GL01'),event_hash:'replacement-record'}),gl,'a replacement source record must not inherit the older editorial description');
const maz=S.describe(byID.get('FU-COV-EAS-003'));assert(maz.includes('August 2021'));assert(maz.includes('one crossing'));assert(maz.includes('according to the Chinese official port history'));assert(!maz.includes('2019 only'));
const norway=S.describe(byID.get('EU022'));assert(norway.includes('legal changes'));assert(norway.includes('do not establish that every land crossing'));
const rosso=S.describe(byID.get('R16-AN-001'));assert(rosso.includes('Cargo itself was not banned'));assert(rosso.includes('original start'));
const korczowa=S.describe(byID.get('R3-EU-004'));assert(korczowa.includes('current dated evidence concerns Korczowa'));assert(korczowa.includes('Dorohusk had an interruption'));
assert(S.describe(byID.get('SC12')).includes('specifically to ordinary passengers at Tlokweng'));
assert(S.describe(byID.get('R2-ME-010')).includes('Palestinian patients with medical referrals'));
assert(S.describe(byID.get('R15-SM-003')).includes('does not describe a continuous 2–5 July closure'));
assert(S.describe(byID.get('SA025')).includes('excluded from the analysis'));
assert(S.describe(byID.get('NP-COV-AM-001')).includes('The dates are two days apart; the exact hours are not established.'));
// Parent fields can name a broader set of crossings and traffic than the phase.
const narrow={id:'test',scope:'International border',crossings:'Apex checkpoint; Birch checkpoint',movement:'Passengers and freight',official_rationale:'Security concerns',context:'Outdated all-border closure',uncertainty:'',duration_periods:[{scope:'Birch checkpoint only',movement:'Passengers',measure_type:'operational_spell',observed_reopening:'Yes',qualification:'Cargo remained exempt.'}]};
const narrowText=S.describe(narrow);assert(narrowText.includes('passengers at Birch checkpoint'));assert(!narrowText.includes('Apex'));assert(!narrowText.includes('Passengers and freight'));assert(!narrowText.includes('Outdated'));assert(narrowText.includes('Cargo remained exempt'));
const unknown={id:'test2',scope:null,crossings:'Not established',movement:'Not separately established',official_rationale:'Not established in retrieved evidence',duration_periods:[]};
assert.equal(S.describe(unknown),'The precise location and affected traffic are not established. A reliable period of closure has not been established.');
const datesOnly={...narrow,duration_periods:[{...narrow.duration_periods[0],qualification:'',temporal_display_rule:'dated_evidence_only_no_continuity_inference'}]};assert(S.describe(datesOnly).includes('particular dates'));
const held={...narrow,duration_periods:[{...narrow.duration_periods[0],qualification:'',contested:true}]};assert(S.describe(held).includes('accounts are disputed'));
console.log(`Summaries passed: ${D.events.length} complete paragraphs, ${min}–${max} words (mean ${Math.round(total/D.events.length)}); current phase scope, policy/observation/held limits, source attribution and immutable data.`);
