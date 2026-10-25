'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../dist'),C=require(root+'/core.js'),K=require(root+'/cartography.js'),N=require(root+'/national.js'),CSV=require(root+'/record-export.js');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'../source/current-release-manifest.json'),'utf8'));
const landCount=manifest.counts.records,includedCount=manifest.counts.included;
const ctx={window:{},URL};vm.createContext(ctx);
for(const name of ['map-data.js','national-data.js'])vm.runInContext(fs.readFileSync(root+'/'+name,'utf8'),ctx);
const data=ctx.window.BORDER_DATA,source=ctx.window.ATLAS_NATIONAL_DATA;
const originalLand=JSON.stringify(data.events);
for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of data[key].features)f.geometry=data.geometry_pool[f.geometry];
delete data.geometry_pool;
N.attach(data,source);N.attach(data,source);
const national=data.events.filter(N.isNational),land=data.events.filter(e=>!N.isNational(e));
assert.equal(JSON.stringify(land),originalLand,'supplement must not alter any land record');
assert.equal(land.length,landCount);assert.equal(national.length,2);
assert.equal(C.filterEvents({events:land},{mode:'all'}).length,includedCount);
assert.equal(C.filterEvents(data,{mode:'all'}).length,includedCount+2);
assert.equal(data.context_locations.features.filter(f=>f.properties.display_role==='national_policy').length,2);
assert.equal(source.observations.length,18,'All original policy evidence remains available');
assert.equal(new Set(data.events.map(e=>e.id)).size,data.events.length);
const get=id=>national.find(e=>e.national_policy_id===id),at=(e,month)=>C.temporalState(e,C.monthOrdinal(month));
const aus=get('NAT-AUS-ENTRY-COVID'),nz=get('NAT-NZL-ADMISSION-COVID');
assert.equal(at(aus,'2020-02'),'none');assert.equal(at(aus,'2021-06'),'policy');assert.equal(at(aus,'2022-02'),'observation');assert.equal(at(aus,'2022-03'),'none');
assert.equal(at(nz,'2021-08'),'policy');assert.equal(at(nz,'2022-08'),'none');
for(const id of ['NAT-AUS-EXIT-COVID','NAT-NZL-ARRIVAL-CONDITIONS-COVID','NAT-GBR-ARRIVAL-CONDITIONS-COVID','R6-EU-004','NAT-GBR-ENG-REDLIST-COVID'])assert(!get(id),'No conditions-only, targeted-origin or departure country outline: '+id);
assert(!data.context_locations.features.some(f=>['national-GBR','national-ENG'].includes(f.properties.location_id)));
assert(land.some(e=>e.id==='R6-EU-004'),'Ordinary qualifying UK land record retained');
for(const code of ['AUS','NZL']){
 const outline=data.context_locations.features.find(f=>f.properties.location_id==='national-'+code),country=data.countries.features.find(f=>f.properties.ADM0_A3===code);
 assert(/^(?:Multi)?Polygon$/.test(outline.geometry.type),'all supplement countries use full-country reference outlines');
 assert.deepEqual(outline.geometry,country.geometry,'outline must be the existing complete country geometry, without subnational boundaries');
 assert(outline.properties.label.includes('international passenger rules'));
 assert(outline.properties.precision.includes('Country reference outline'));
 assert(outline.properties.precision.includes('legal jurisdiction is stated in each record'));
}
assert(aus.geography_note.includes('Health conditions alone do not qualify'));
for(const e of national){
 assert.equal(e.sources.length,e.source_urls.length);assert(e.sources.length>0);
 assert.equal(e.timing_coverage.operational_complete,false);
 assert(C.displayLocationsFor(e,data).includes('national-'+e.national_map_country));
 for(const p of e.duration_periods){assert.equal(p.minimum_days,null);assert.equal(p.maximum_days,null);assert.equal(p.end_is_reopening,false);}
}
const custom=JSON.parse(JSON.stringify(data));custom.meta.source_sha256='replacement-workbook';custom.meta.national_supplement=null;const before=custom.events.length;N.attach(custom,source);assert.equal(custom.events.length,before,'no supplement grafted onto a different release');
for(const record of [aus,nz]){
 const style=K.symbolStyle({display_role:'national_policy'},{records:[record]});
 assert.equal(style.fillOpacity,0);assert.deepEqual(style.dash,[]);assert.equal(style.colour,'#287e67');
 assert.equal(style.width,2.4);assert.equal(style.opacity,.9);assert.notEqual(style.pointShape,'square');
 assert.equal(K.symbolStyle({display_role:'national_policy'},{records:[record],selected:true}).width,3.8);
}
assert.equal(K.scopeStyle([nz]).conditionsOnly,false);
const csv=CSV.build({records:national,state:{mode:'all'},recordURL:id=>'https://example.test/#map/record-'+id});
assert.equal(csv.count,2);assert(csv.content.includes('"Record type","Linked land records"'));
for(const e of national){assert(csv.content.includes(e.id));for(const p of e.duration_periods)assert(csv.content.includes(p.period_id));for(const url of e.source_urls)assert(csv.content.includes(new URL(url).href));}
assert(csv.content.includes('Not calculated: policy history'));assert(!csv.content.includes('National entry conditions — not a closure'));
const app=fs.readFileSync(root+'/app.js','utf8'),analysis=fs.readFileSync(root+'/analysis.html','utf8');
assert(app.includes("new URL('#map/record-'+encodeURIComponent(id),window.location.href)"),'record links must use the page URL, not the selected geometry');
assert(analysis.includes("shared.events.filter(e=>e.record_kind!=='national_policy'&&e.record_kind!=='border_status')"),'land charts must not count national histories');
for(const name of ['app.js','index.html','export.js'])assert(!/Unmarked does not mean open/i.test(fs.readFileSync(root+'/'+name,'utf8')));

// Exercise the loader's real cache and full-evidence validation. The manifest
// contains land records only; national records are already complete locally.
async function loaderCheck(withManifest){
 const fixture=JSON.parse(JSON.stringify(data)),landCopy=fixture.events.filter(e=>!N.isNational(e));
 if(withManifest)fixture.meta.web_assets={research:'research.json'};else delete fixture.meta.web_assets;
 const window={BORDER_DATA:fixture,location:{protocol:'https:'},AtlasNational:N,ATLAS_NATIONAL_DATA:source};
 const fetched=[];
 const env={window,document:{currentScript:{dataset:{}}},setTimeout,clearTimeout,AbortController,fetch:async file=>{fetched.push(file);return {ok:true,json:async()=>file==='research.json'?{meta:{source_sha256:fixture.meta.source_sha256},events_parts:['land-part.json']}:file==='land-part.json'?{source_sha256:fixture.meta.source_sha256,events:landCopy}:{source_sha256:fixture.meta.source_sha256,record:landCopy.find(e=>e.details_file===file)}};}};
 vm.runInNewContext(fs.readFileSync(root+'/data-loader.js','utf8'),env);
 assert.equal((await window.AtlasData.getRecord(aus.id)).id,aus.id);assert.equal(fetched.length,0);
 assert.equal((await window.AtlasData.getResearchData()).events.length,landCount);
 assert.equal((await window.AtlasData.getResearchData({includeNational:true})).events.length,landCount+2);
 assert.equal((await window.AtlasData.getRecord(aus.id)).national_observations.length,3,'national record still accessible after full evidence loads');
 assert.equal((await window.AtlasData.getRecord(landCopy[0].id)).id,landCopy[0].id);
 if(withManifest)assert.deepEqual(fetched,['research.json','land-part.json']);
}
Promise.all([loaderCheck(true),loaderCheck(false)]).then(()=>console.log('Passenger policy criteria passed: Australia/NZ broad admission bans mapped; UK, conditions-only, targeted-origin and departure outlines excluded; original evidence and land records preserved; loader, CSV and duration isolation checked.')).catch(error=>{console.error(error);process.exitCode=1;});
