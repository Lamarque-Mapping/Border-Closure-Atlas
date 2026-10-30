'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const parseScript=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const source=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root,'source/record-descriptions.json.gz')))),full=parseScript('dist/data.js'),compact=parseScript('dist/map-data.js');
const analysis=read('dist/analysis-data.json'),S=require('../dist/record-summary.js'),E=require('../dist/record-export.js');
const ids=full.events.map(e=>e.id).sort();
assert.deepEqual(Object.keys(source.records).sort(),ids,'Every register record has a reviewed description');
const index=events=>new Map(events.map(e=>[e.id,e])),map=index(compact.events),list=index(analysis.events);
const reviewRows=n=>fs.readdirSync(path.join(root,`research/description-review-2026-10-30/pass${n}`)).filter(p=>p.endsWith('.jsonl')).flatMap(p=>fs.readFileSync(path.join(root,`research/description-review-2026-10-30/pass${n}`,p),'utf8').trim().split('\n').map(s=>JSON.parse(s)));
const a=index(reviewRows(1)),b=index(reviewRows(2));
assert.equal(a.size,ids.length);assert.equal(b.size,ids.length);
for(const event of full.events){
 const entry=source.records[event.id];
 assert.notEqual(a.get(event.id).verification.reviewer,b.get(event.id).verification.reviewer,event.id+' separate reviewers');
 assert.equal(entry.summary,b.get(event.id).summary,event.id+' accepted second-pass wording');
 assert.equal(entry.event_hash,event.event_hash,event.id+' exact source identity');
 assert.equal(S.describe(event),entry.summary,event.id+' accepted full paragraph');
 for(const candidate of [map.get(event.id),list.get(event.id)]){
  assert.equal(S.describe(candidate),'',event.id+' compact row waits for reviewed prose instead of generating stale text');
  const detail=read('dist/'+candidate.details_file).record;
  assert.equal(S.describe(detail),entry.summary,event.id+' map and Dataset resolve the same reviewed paragraph');
 }
 const replacement={...event,event_hash:'new-unreviewed-content'};
 assert.notEqual(S.describe(replacement),entry.summary,event.id+' old prose cannot follow a changed record');
 assert(!/Recorded scope:|Affected movement:|Verification dates|current convention guidance|Dates, exceptions and evidence limits are recorded separately/i.test(entry.summary),event.id+' event prose replaces mechanical text');
 assert(entry.evidence_urls.length>0,event.id+' supporting links retained');
}
const reindeer=source.records['R16-EU-001'].summary;
assert(/reindeer/i.test(reindeer)&&/graz|pastur/i.test(reindeer)&&/Finland/.test(reindeer)&&/Norway/.test(reindeer),'reindeer summary explains the actual cross-border grazing restriction');
const austria=source.records['R3-EU-012'];
assert(/2020/.test(austria.summary)&&/June/.test(austria.summary),'Austria summary incorporates the later 2020 endpoint correction');
assert(austria.evidence_urls.some(u=>u.includes('811769')||u.includes('106302145')),'Austria reopening sources retained');
const sample=full.events.find(e=>e.id==='R16-EU-001');
const output=E.build({records:[sample],state:{mode:'all'}}).content;
assert(output.includes('Case description')&&output.includes(sample.record_summary.text.replace(/"/g,'""')),'CSV includes accepted text');
console.log(`Reviewed descriptions passed: ${ids.length} records, ${ids.length*2} saved reviews by different agents, matching map/Dataset text, source-identity guard and CSV export.`);
