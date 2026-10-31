const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const base=require('path').resolve(__dirname,fs.existsSync(require('path').resolve(__dirname,'../dist'))?'../dist':'../releases/current_public/web')+'/';
const C=require(base+'core.js'),K=require(base+'cartography.js'),app=fs.readFileSync(base+'app.js','utf8');
const data=JSON.parse(fs.readFileSync(base+'data.js','utf8').replace(/^window.BORDER_DATA = /,'').trim().replace(/;$/,''));
const context={C,URL,state:{mode:'all',measureType:'',month:null},escape:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),publicText:v=>String(v??''),text:v=>String(v??''),safeURL:v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}},monthLabel:n=>new Date(Date.UTC(Math.floor(n/12),n%12,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})};
context.K=K;context.window=context;context.BorderSummary=require(base+'record-summary.js');vm.createContext(context);vm.runInContext(fs.readFileSync(base+'public-text.js','utf8'),context);context.publicText=context.BorderPublic.text;
vm.runInContext(app.slice(app.indexOf('  function eventSources('),app.indexOf('  const playIcon')),context);
vm.runInContext(app.slice(app.indexOf('  function dateText('),app.indexOf('  function dateRange(')),context);
vm.runInContext(app.slice(app.indexOf('  function cardBoundary('),app.indexOf('  function openLocationCard(')),context);
// A cold popup must not flash incomplete dates or old fallback prose. Exercise
// actual compact records, including their duration/location-scoped copies.
const compactData=JSON.parse(fs.readFileSync(base+'map-data.js','utf8').replace(/^window.BORDER_DATA = /,'').trim().replace(/;$/,''));
for(const row of compactData.events){
 const filtered=C.filterEvents({...compactData,events:[row]},{mode:'all',duration:'over1'});
 const scoped=C.mapLocationsFor(row,compactData,{mode:'all'}).flatMap(id=>C.recordsForLocation([row],id,compactData,{mode:'all'}));
 for(const item of [row,...filtered,...scoped]){
  const loading=context.locationRecordHTML(item);
  assert(loading.includes('aria-busy="true"')&&loading.includes('Loading closure details…'),row.id+' waits for its complete record');
  assert(!/location-period|location-summary|location-rationales|location-sources/.test(loading),row.id+' cannot display provisional details');
 }
}
const rosso=data.events.find(e=>e.id==='R16-AN-001'),html=context.locationRecordHTML(rosso);
assert(html.includes('March 2018 – 11 Jul 2025'));
assert(!html.includes('(reopened)'),'a formal transport agreement is not an observed reopening');
assert(html.includes('Policy documented for 2659–2689 days; this does not measure continuous closure.'));
assert(html.includes('Senegalese freight vehicles')&&/cargo for transfer to local trucks/.test(html)&&/goods themselves continued moving/.test(html),'the immediate paragraph distinguishes vehicle restrictions from permitted transferred cargo');
assert(!html.includes('Unknown'));assert(!html.includes('Green point'));
assert(html.includes('https://www.wto.org/english/tratop_e/tpr_e/s371_e.pdf'));
assert(html.includes('https://ami.mr/fr/archives/275255'));
assert.equal((html.match(/data-record-id=/g)||[]).length,1);
assert.equal((html.match(/class="location-source-link"/g)||[]).length,2);
assert(html.includes('>WTO ↗</a>'));assert(html.includes('>AMI ↗</a>'));
assert(html.includes('Coded rationale:</span>'));assert(html.includes('Not established</span>'));
const norway=context.locationRecordHTML(data.events.find(e=>e.id==='EU022'));
assert(norway.includes('Policy documented for 107 days; this does not measure continuous closure.'));
assert(norway.includes('Coded rationale:</span>'));assert(norway.includes('Health and biosecurity</span>'));
assert(norway.includes('--rationale-colour:'+K.rationaleKey.find(item=>item.code==='Health and biosecurity').colour));
assert(norway.includes('Norway Justice Ministry'));
assert(!/>(?:Source )?\d+ ↗<\/a>/.test(norway));
const finland=context.locationRecordHTML(data.events.find(e=>e.id==='EU037'));
assert(finland.includes('class="location-source-name">Finnish Foreign Ministry</span>'));
assert(finland.includes('>29 Sept 2022 ↗</a>'));assert(finland.includes('>6 Jul 2023 ↗</a>'));
assert.equal((finland.match(/class="location-source-group"/g)||[]).length,1);
assert.equal((finland.match(/class="location-source-link"/g)||[]).length,2,'keep both independent source URLs');
const sameDay=context.locationRecordHTML(data.events.find(e=>e.id==='R15-AN-002'));
assert(sameDay.includes('5 Apr 2021'));assert(sameDay.includes('Same-day event; exact hours are not established.'));
const unresolved=data.events.find(e=>!C.excluded(e)&&!e.duration_periods.length);
assert(context.locationRecordHTML(unresolved).includes('Dates and duration are not established.'));
const through=data.events.find(e=>e.id==='R8-AS-001');
assert(context.locationRecordHTML(through).includes('Evidence dated: 19 Sept 2017'));
assert(context.locationRecordHTML(through).includes('These reports do not establish a continuous closure between the dates.'),'Kaytpas dated reports must not imply uninterrupted closure or a measured duration');
assert(/Apkan.*(?:closed|separate)|(?:closed|separate).*Apkan/.test(context.locationRecordHTML(through)),'Kaytpas evidence must not become a reopening of the full Sokh route');
for(const type of ['formal_policy_period','ordered_window','intermittent_regime']){
 const e=data.events.find(e=>C.periods(e).some(p=>p.measure_type===type));
 const markup=context.locationRecordHTML(e);assert(markup.includes(C.measureLabel(type)));assert(!markup.includes('numeric duration withheld'));
}
const phased=data.events.find(e=>e.id==='GL01');assert(context.locationRecordHTML(phased).includes('7 more dated stages'));
const phasedHTML=context.locationRecordHTML(phased);
assert(phasedHTML.indexOf('Dated reports')<phasedHTML.indexOf('Dates disputed'),'lead with dated passenger evidence, retaining disputed freight stages in the disclosure');
assert(phasedHTML.includes('These reports do not establish a continuous closure between the dates.'),'dated passenger observations must not become a continuous all-traffic closure');
assert(!phasedHTML.includes('Disputed evidence · dates onlyDocumented'));
assert.equal(context.cardPeriodDates({observed_reopening:'Yes',temporal_display_rule:'dated_evidence_only_no_continuity_inference',evidence_dates:['2019-03-01','2019-03-03']}),'Evidence dated: 1 Mar 2019; 3 Mar 2019','a union of evidence dates must not label every date a reopening');
context.state.mode='intervals';context.state.month=C.monthOrdinal('2019-03');
const matches=context.cardPeriods(phased);assert.deepEqual(Array.from(matches,p=>p.period_id),['GL01-C7RWP1'],'March 2019 selects the sourced passenger observation, not a held freight interval');
context.state.month=C.monthOrdinal('2019-06');
assert.deepEqual(Array.from(context.cardPeriods(phased),p=>p.period_id).sort(),['GL01-C7RWP2','GL01-R1','GL01-R2'],'June retains the passenger observation and separately held freight dates');
context.state.mode='all';
for(const e of data.events){const markup=context.locationRecordHTML(e);assert(!/undefined|NaN|Invalid Date/.test(markup),e.id);assert(!/scoped endpoint|calendar days|calendar-day difference|days in policy period|operational continuity|numeric duration withheld/.test(markup),e.id);assert(markup.includes('class="location-summary"'),e.id+' paragraph');assert(markup.includes('data-record-id="'+e.id+'"'),e.id);for(const rationale of e.rationales)assert(markup.includes(context.escape(rationale)),e.id+' rationale');assert(!/>(?:Source )?\d+ ↗<\/a>/.test(markup),e.id+' named sources');}
assert(context.locationRecordHTML({...rosso,title:'<script>bad</script>'}).includes('&lt;script&gt;bad&lt;/script&gt;'));
console.log(`Passed: all ${data.events.length} cards render; Rosso uses reviewed policy dates, permitted cargo transfer and occurrence/endpoint sources; same-day, unresolved, last-confirmed, ordered, intermittent and multiple phases stay qualified; Rwanda passenger observations and held dates remain distinct; timeline filters and escaped text preserved.`);

const held=data.events.find(e=>e.duration_periods.some(p=>p.contested)&&!C.excluded(e));assert(context.locationRecordHTML(held).includes('Dates disputed'));

// Exercise full-record loading, return navigation and stale request handling.
const nodes=new Map(),skip={};
context.$=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{hidden:false,innerHTML:'',textContent:'',attrs:{},classList:{toggle(k,on){on?classes.add(k):classes.delete(k)},contains:k=>classes.has(k)},setAttribute(k,v){this.attrs[k]=v},focus(){this.focused=true}});}return nodes.get(id);};
Object.assign(context,{data,events:data.events,locations:new Map(),selected:null,AtlasData:{getRecord:async id=>data.events.find(e=>e.id===id)},document:{querySelector:()=>skip},addEventListener(){},compact:()=>true,scheduleViewport(){},setPanelOpen(){},renderLocations(){},map:{closePopup(){}},stop(){},openRecords(){},mapLocationIDs:()=>[],mapLocationNote:()=>''});
vm.runInContext(app.slice(app.indexOf('  function updatePanelTitle('),app.indexOf('  function setPanelOpen(')),context);
vm.runInContext(app.slice(app.indexOf('  function setRecordView('),app.indexOf('  function changeMonth(')),context);
context.$('map-search').parentNode=context.$('panel-search-slot');
(async()=>{
 context.$('panel-scroll').scrollTop=90;
 await context.showEvent('EU022',false);
 assert(context.$('map-page').classList.contains('detail-open'));
 assert.equal(context.$('panel-title').textContent,'Full record');assert.equal(skip.href,'#back-button');
 assert(context.$('event-detail').innerHTML.includes('Health and biosecurity'));
 assert(context.$('event-detail').innerHTML.includes('class="event-summary"'));
 assert.equal(context.$('back-button').focused,true);assert.equal(context.$('panel-scroll').scrollTop,0);
 context.showBrowse();assert(!context.$('map-page').classList.contains('detail-open'));
 assert.equal(context.$('panel-scroll').scrollTop,90,'returning from a full record retains the position in the results');
 assert(context.$('detail-panel').hidden);assert(!context.$('browse-panel').hidden);assert.equal(skip.href,'#search');
 await context.showEvent('SC12',false);
 const currentScope=context.$('event-detail').innerHTML.split('<summary>Rationale and context</summary>')[0];
 assert(currentScope.includes('Tlokweng'),'present the location supported by the current phase');
 context.showBrowse();
 let finish;context.window.AtlasData.getRecord=()=>new Promise(resolve=>finish=resolve);
 const pending=context.showEvent('EU022',false);context.showBrowse();finish(data.events.find(e=>e.id==='EU022'));await pending;
 assert(!context.$('map-page').classList.contains('detail-open'),'late data must not reopen a dismissed record');
 assert(context.$('detail-panel').hidden);
 console.log('Record navigation passed: expanded reading view, visible keyboard target, return to browse and ignored stale requests.');
})().catch(error=>{console.error(error);process.exitCode=1});
