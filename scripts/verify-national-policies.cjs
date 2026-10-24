'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../dist'),C=require(root+'/core.js'),K=require(root+'/cartography.js'),N=require(root+'/national.js'),CSV=require(root+'/record-export.js');
const ctx={window:{},URL};vm.createContext(ctx);
for(const name of ['map-data.js','national-data.js'])vm.runInContext(fs.readFileSync(root+'/'+name,'utf8'),ctx);
const data=ctx.window.BORDER_DATA,source=ctx.window.ATLAS_NATIONAL_DATA;
const originalLand=JSON.stringify(data.events);
for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of data[key].features)f.geometry=data.geometry_pool[f.geometry];
delete data.geometry_pool;
N.attach(data,source);N.attach(data,source);
const national=data.events.filter(N.isNational),land=data.events.filter(e=>!N.isNational(e));
assert.equal(JSON.stringify(land),originalLand,'supplement must not alter any land record');
assert.equal(land.length,701);assert.equal(national.length,7);
assert.equal(C.filterEvents({events:land},{mode:'all'}).length,697);
assert.equal(C.filterEvents(data,{mode:'all'}).length,704);
assert.equal(data.context_locations.features.filter(f=>f.properties.display_role==='national_policy').length,3);
assert.equal(national.reduce((n,e)=>n+e.national_observations.length,0),18);
assert.equal(new Set(data.events.map(e=>e.id)).size,data.events.length);
const get=id=>national.find(e=>e.national_policy_id===id),at=(e,month)=>C.temporalState(e,C.monthOrdinal(month));
const aus=get('NAT-AUS-ENTRY-COVID'),exit=get('NAT-AUS-EXIT-COVID'),nz=get('NAT-NZL-ADMISSION-COVID'),eng=get('R6-EU-004'),red=get('NAT-GBR-ENG-REDLIST-COVID'),uk=get('NAT-GBR-ARRIVAL-CONDITIONS-COVID');
assert.equal(at(aus,'2020-02'),'none');assert.equal(at(aus,'2021-06'),'policy');assert.equal(at(aus,'2022-02'),'observation');assert.equal(at(aus,'2022-03'),'none');
assert.equal(at(exit,'2021-10'),'policy');assert.equal(at(exit,'2021-11'),'observation');assert.equal(at(exit,'2021-12'),'none');
assert.equal(at(nz,'2021-08'),'policy');assert.equal(at(nz,'2022-08'),'none');
assert.equal(at(eng,'2021-04'),'policy');assert.equal(at(eng,'2021-06'),'none');
assert.equal(at(red,'2021-04'),'observation');assert.equal(at(red,'2021-05'),'none');
assert.equal(at(uk,'2020-06'),'observation');assert.equal(at(uk,'2021-06'),'none');assert.equal(at(uk,'2022-03'),'observation');
assert.deepEqual(eng.linked_land_ids,['R6-EU-004']);assert.equal(eng.national_geometry,'ENG');
assert.equal(eng.scope,'England');assert.equal(red.scope,'England');
assert.equal(eng.national_map_country,'GBR');assert.equal(red.national_geometry,'ENG');assert.equal(red.national_map_country,'GBR');
assert.deepEqual(eng.location_ids,['national-GBR']);assert.deepEqual(red.location_ids,uk.location_ids,'UK and England policies share a country reference without broadening legal scope');
assert(!data.context_locations.features.some(f=>f.properties.location_id==='national-ENG'),'no England perimeter is presented as a closed domestic boundary');
for(const code of ['AUS','NZL','GBR']){
 const outline=data.context_locations.features.find(f=>f.properties.location_id==='national-'+code),country=data.countries.features.find(f=>f.properties.ADM0_A3===code);
 assert(/^(?:Multi)?Polygon$/.test(outline.geometry.type),'all supplement countries use full-country reference outlines');
 assert.deepEqual(outline.geometry,country.geometry,'outline must be the existing complete country geometry, without subnational boundaries');
 assert(outline.properties.label.includes('international passenger rules'));
 assert(outline.properties.precision.includes('Country reference outline'));
 assert(outline.properties.precision.includes('legal jurisdiction is stated in each record'));
}
assert(eng.geography_note.includes('England-only rules use the UK outline for reference'));
for(const e of national){
 assert.equal(e.sources.length,e.source_urls.length);assert(e.sources.length>0);
 assert.equal(e.timing_coverage.operational_complete,false);
 assert(C.displayLocationsFor(e,data).includes('national-'+e.national_map_country));
 for(const p of e.duration_periods){assert.equal(p.minimum_days,null);assert.equal(p.maximum_days,null);assert.equal(p.end_is_reopening,false);}
}
const custom=JSON.parse(JSON.stringify(data));custom.meta.source_sha256='replacement-workbook';custom.meta.national_supplement=null;const before=custom.events.length;N.attach(custom,source);assert.equal(custom.events.length,before,'no supplement grafted onto a different release');
for(const record of [aus,uk,eng]){
 const style=K.symbolStyle({display_role:'national_policy'},{records:[record]});
 assert.equal(style.fillOpacity,0);assert.deepEqual(style.dash,[]);assert.equal(style.colour,'#287e67');
 assert.equal(style.width,2.4);assert.equal(style.opacity,.9);assert.notEqual(style.pointShape,'square');
 assert.equal(K.symbolStyle({display_role:'national_policy'},{records:[record],selected:true}).width,3.8);
}
assert.equal(K.scopeStyle([nz,get('NAT-NZL-ARRIVAL-CONDITIONS-COVID')]).conditionsOnly,false);
const csv=CSV.build({records:national,state:{mode:'all'},recordURL:id=>'https://example.test/#map/record-'+id});
assert.equal(csv.count,7);assert(csv.content.includes('"Record type","Linked land records"'));
for(const e of national){assert(csv.content.includes(e.id));for(const p of e.duration_periods)assert(csv.content.includes(p.period_id));for(const url of e.source_urls)assert(csv.content.includes(new URL(url).href));}
assert(csv.content.includes('Not calculated: policy history'));assert(csv.content.includes('National entry conditions — not a closure'));
const app=fs.readFileSync(root+'/app.js','utf8'),analysis=fs.readFileSync(root+'/analysis.html','utf8');
assert(app.includes("new URL('#map/record-'+encodeURIComponent(id),window.location.href)"),'record links must use the page URL, not the selected geometry');
assert(analysis.includes("shared.events.filter(e=>e.record_kind!=='national_policy')"),'land charts must not count national histories');
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
 assert.equal((await window.AtlasData.getResearchData()).events.length,701);
 assert.equal((await window.AtlasData.getResearchData({includeNational:true})).events.length,708);
 assert.equal((await window.AtlasData.getRecord(aus.id)).national_observations.length,3,'national record still accessible after full evidence loads');
 assert.equal((await window.AtlasData.getRecord(landCopy[0].id)).id,landCopy[0].id);
 if(withManifest)assert.deepEqual(fetched,['research.json','land-part.json']);
}
Promise.all([loaderCheck(true),loaderCheck(false)]).then(()=>console.log('Passenger policies passed: 18 observations, 7 histories, 3 complete country reference outlines; precise England jurisdiction retained, no UK constituent boundaries, unfilled solid green outlines, unchanged timelines, no inferred durations, CSV evidence, source isolation, loader cache, and unchanged 697-record land analysis.')).catch(error=>{console.error(error);process.exitCode=1;});
