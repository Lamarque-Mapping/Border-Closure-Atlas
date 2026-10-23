const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=require('path').resolve(__dirname,fs.existsSync(require('path').resolve(__dirname,'../dist'))?'../dist':'../releases/current_public/web')+'/';
function element(id=''){
 const events={};const classes=new Set();
 return {id,hidden:false,value:'',dataset:{},style:{setProperty(k,v){this[k]=v}},classList:{add(c){classes.add(c)},toggle(c,on){on?classes.add(c):classes.delete(c)},contains(c){return classes.has(c)}},attrs:{},textContent:'',innerHTML:'',children:[],events,
 addEventListener(k,fn){(events[k]??=[]).push(fn)},emit(k,data={}){return Promise.all((events[k]||[]).map(fn=>fn(data)))},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},removeAttribute(k){delete this.attrs[k]},appendChild(e){this.children.push(e);e.parentNode=this},remove(){},click(){},scrollIntoView(){this.scrolled=true},getBoundingClientRect(){return {height:52}},showModal(){this.open=true},close(){this.open=false}};
}
function env(html){
 const ids=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],element(m[1])]));
 const listeners={};const docListeners={};const head=element(),skip=element();
 const document={getElementById(id){assert(ids[id],`Missing DOM target ${id}`);return ids[id]},querySelector(s){if(s==='.masthead')return head;if(s==='.skip-link')return skip;return null},querySelectorAll(){return []},createElement(){return element()},body:element(),documentElement:element(),addEventListener(k,f){(docListeners[k]??=[]).push(f)}};
 // Optional elements follow browser semantics.
 document.getElementById=id=>ids[id]||null;
 let location={href:'https://border-closures-atlas.lamarque.chatgpt.site/',protocol:'https:',hash:''};
 const context={document,location,URL,Blob,Intl,console,innerHeight:800,scrollY:0,history:{replaceState(_,__,hash){location.hash=hash;location.href='https://border-closures-atlas.lamarque.chatgpt.site/'+hash}},setTimeout(){return 1},clearTimeout(){},CustomEvent:class{constructor(type,init){this.type=type;Object.assign(this,init)}},IntersectionObserver:class{observe(){}},ResizeObserver:class{observe(){}},navigator:{clipboard:{async writeText(text){context.copied=text}}},addEventListener(k,f){(listeners[k]??=[]).push(f)},dispatchEvent(e){for(const f of listeners[e.type]||[])f(e)},scrollTo(){},getComputedStyle(){return {}}};
 context.window=context;context.parent=context;vm.createContext(context);return {context,ids,document,listeners};
}
const index=fs.readFileSync(root+'index.html','utf8');
const nav=fs.readFileSync(root+'navigation.js','utf8');
const masthead=index.match(/<header class="masthead">([\s\S]*?)<\/header>/)[1];
const mapMarkup=index.match(/<main id="map-page">([\s\S]*?)<\/main>/)[1];
assert(!masthead.includes('id="save-view-button"'),'map export must not change the primary navigation layout');
assert.match(mapMarkup,/<footer class="panel-footer">[^\n]*id="save-view-button"/,'save action belongs with the map panel controls');
assert.equal((index.match(/id="save-view-button"/g)||[]).length,1,'keep one save action and its existing event handler');
function host(initialHash='',offline=false){
 const e=env(index);e.context.location.hash=initialHash;
 if(offline){e.ids['analysis-document']=element();e.ids['analysis-document'].textContent=JSON.stringify('<!doctype html><title>Offline analysis</title>');}
 e.ids['analysis-frame'].contentWindow={AtlasAnalysis:{navigate(hash){e.navigated=hash}}};
 vm.runInContext(nav,e.context);return e;
}
(async()=>{
 const h=host();const frame=h.ids['analysis-frame'];
 assert.equal(frame.src,undefined,'analysis should not load before selection');
 await h.ids['analysis-page-button'].emit('click');
 assert.equal(frame.src,'analysis.html');assert.equal(h.ids['map-page'].hidden,true);assert.equal(h.ids['analysis-page'].hidden,false);assert.equal(h.ids['save-view-button'].hidden,false,'the map ancestor controls save visibility');
 await frame.emit('load');assert.equal(frame.hidden,false);assert.equal(h.ids['analysis-loading'].hidden,true);
 const api=h.context.AtlasNavigation;api.setAnalysisHash('#record-R16-EU-005');
 assert.equal(h.context.location.hash,'#analysis/record-R16-EU-005');
 assert.equal(api.getAnalysisURL('#record-R16-EU-005'),'https://border-closures-atlas.lamarque.chatgpt.site/#analysis/record-R16-EU-005');
 h.navigated=null;await h.ids['map-page-button'].emit('click');assert.equal(h.ids['map-page'].hidden,false);assert.equal(h.ids['save-view-button'].hidden,false);
 await h.ids['analysis-page-button'].emit('click');assert.equal(h.navigated,null,'return must retain iframe scroll rather than reset');
 await h.ids['method-button'].emit('click');assert.equal(h.ids['briefing-page'].hidden,false);assert.equal(h.ids['analysis-page'].hidden,true);assert.equal(h.ids['map-page'].hidden,true);
 h.context.matchMedia=()=>({matches:true});h.ids['map-search'].parentNode=h.ids['panel-search-slot'];h.ids['map-page'].classList.add('detail-open');
 await h.ids['map-page-button'].emit('click');assert.equal(h.document.querySelector('.skip-link').href,'#back-button','returning to a phone record skips to visible controls');
 h.ids['map-page'].classList.add('panel-collapsed');await h.ids['method-button'].emit('click');await h.ids['map-page-button'].emit('click');assert.equal(h.document.querySelector('.skip-link').href,'#panel-toggle');
 h.context.matchMedia=()=>({matches:false});for(const fn of h.listeners.resize||[])fn();assert.equal(h.ids['map-search'].parentNode,h.ids['header-search-slot']);assert.equal(h.document.querySelector('.skip-link').href,'#search');
 h.context.matchMedia=()=>({matches:true});for(const fn of h.listeners.resize||[])fn();assert.equal(h.ids['map-search'].parentNode,h.ids['panel-search-slot']);assert.equal(h.document.querySelector('.skip-link').href,'#panel-toggle','resizing must not target the hidden search');
 const direct=host('#analysis/record-R16-EU-005');await direct.ids['analysis-frame'].emit('load');assert.equal(direct.navigated,'#record-R16-EU-005');
 const slow=host();slow.ids['analysis-frame'].contentWindow={};await slow.ids['analysis-page-button'].emit('click');await slow.ids['analysis-frame'].emit('load');
 assert.equal(slow.ids['analysis-frame'].hidden,true,'wait for asynchronous data initialization');
 slow.ids['analysis-frame'].contentWindow.AtlasAnalysis={navigate(){}};slow.context.AtlasNavigation.analysisReady();assert.equal(slow.ids['analysis-frame'].hidden,false,'show Analysis once its data is ready, even after iframe load');
 const offline=host('#analysis',true);assert(offline.ids['analysis-frame'].srcdoc.includes('Offline analysis'));assert.equal(offline.ids['analysis-frame'].src,undefined);
 offline.context.location.protocol='file:';assert.equal(offline.context.AtlasNavigation.getAnalysisURL('#register'),'https://border-closures-atlas.lamarque.chatgpt.site/#analysis/register');
 console.log('Navigation passed: stable three-tab structure, map-only save action, lazy loading, direct record links, scroll preservation, offline srcdoc.');
 const analysis=fs.readFileSync(root+'analysis.html','utf8'),a=env(analysis);
 for(const match of analysis.matchAll(/<script id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g))a.ids[match[1]].textContent=match[2];
 a.ids.chartPopulation.value='all';a.ids.sortRecords.value='id';
 a.ids.filters.reset=()=>{for(const id of ['query','continentFilter','regionFilter','codeFilter','statusFilter','auditFilter'])a.ids[id].value='';};
 const data=JSON.parse(fs.readFileSync(root+'data.js','utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
 const timeline=env(index),tc=timeline.context,app=fs.readFileSync(root+'app.js','utf8'),core=require(root+'core.js');
 Object.assign(tc,{C:core,$:id=>timeline.ids[id],data:null,events:[],locations:new Map(),selected:null,timer:null,pauseIcon:'pause',escape:String,dateText:String,monthLabel:String,
  resetList(){},stop(){tc.timer=null},populateRegions(){},populateSelect(){},makeTabs(){},resetMapLayers(){},showBrowse(){},render(){},fitContinent(){},fitRecords(){},notify(){},changeMonth(){},setPanelOpen(open){tc.panelOpen=open},scheduleViewport(){},openRecords(){},downloadRecords(){},setInterval(){return 1}});
 vm.runInContext(app.slice(app.indexOf('  const state='),app.indexOf('  const continentViews=')),tc);
 vm.runInContext(app.slice(app.indexOf('  function resetFilters('),app.indexOf('  function render(){')),tc);
 tc.applyData(data);const timelineState=vm.runInContext('state',tc);
 assert.equal(timelineState.mode,'intervals');assert.equal(timeline.ids['time-mode'].value,'intervals');
 assert.equal(timelineState.month,core.monthOrdinal(data.meta.window_start));assert.equal(core.filterEvents(data,timelineState).length,19,'default October 2016 evidence reconciles to current Chronology phases and Phase locations');
 assert(core.filterEvents(data,timelineState).some(e=>e.id==='FU-COV-EAS-003'),'include the replacement workbook conservation-policy record');
 assert.equal((index.match(/id="time-mode"/g)||[]).length,1);assert(!index.slice(index.indexOf('<div class="timeline">')).includes('id="time-mode"'),'view selector belongs in the records panel');
 vm.runInContext(app.slice(app.indexOf("  $('search').addEventListener"),app.indexOf('  const showPage=')),tc);
 await timeline.ids.search.emit('input',{target:{value:' '}});assert.equal(timelineState.mode,'intervals','blank input leaves the initial dated view intact');
 timelineState.location='old-map-selection';tc.timer=1;
 await timeline.ids.search.emit('input',{target:{value:'Norway'}});
 assert.equal(timelineState.mode,'all');assert.equal(timeline.ids['time-mode'].value,'all');assert.equal(timelineState.location,'');assert.equal(tc.timer,null);assert.equal(tc.panelOpen,true);
 assert.equal(core.filterEvents(data,timelineState).length,8,'search must find Norway records beyond the default month');
 assert.equal(core.filterEvents(data,{...timelineState,mode:'intervals'}).length,0,'these records would be hidden by the default month');
 await timeline.ids['time-mode'].emit('change',{target:{value:'onsets'}});assert.equal(timelineState.mode,'onsets','a date mode can still be chosen explicitly after searching');
 await timeline.ids.search.emit('input',{target:{value:'Russia'}});assert.equal(timelineState.mode,'all','editing a query searches all recorded closures again');
 await timeline.ids.search.emit('input',{target:{value:''}});assert.equal(timelineState.mode,'all','clearing search retains the full-period view');assert.equal(core.filterEvents(data,timelineState).length,697);
 timelineState.mode='all';timelineState.query='Norway';timelineState.includeExcluded=true;timelineState.month=core.monthOrdinal(data.meta.window_end);
 await timeline.ids['reset-button'].emit('click');assert.equal(timelineState.mode,'intervals');assert.equal(timeline.ids['time-mode'].value,'intervals');assert.equal(timelineState.query,'');assert.equal(timelineState.includeExcluded,false);assert.equal(timelineState.month,core.monthOrdinal(data.meta.window_start));
 timelineState.mode='all';timeline.ids['time-mode'].value='all';await timeline.ids['play-button'].emit('click');assert.equal(timelineState.mode,'intervals');assert.equal(timeline.ids['time-mode'].value,'intervals');assert.equal(tc.timer,1);
 console.log('Timeline and search passed: dated restrictions on load and Reset; nonempty searches show all recorded closures; explicit date filtering and playback still work.');
 const atlas={hash:'#top',getAnalysisHash(){return this.hash},setAnalysisHash(hash){this.hash=hash},getAnalysisURL:api.getAnalysisURL};
 const summary=JSON.parse(fs.readFileSync(root+'map-data.js','utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
 let detailRequests=0,archiveRequests=0;
 const completeResearch={meta:data.meta,events:data.events,workbook_geography:data.workbook_geography,workbook_review:data.workbook_review};
 a.context.parent={AtlasNavigation:atlas,AtlasData:{ready:async()=>summary,getRecord:async id=>{detailRequests++;return data.events.find(e=>e.id===id)},getResearchData:async()=>{archiveRequests++;return completeResearch}}};
 const ui=fs.readFileSync(require('path').resolve(__dirname,'analysis-ui.js'),'utf8').replace('\n})().catch','\nwindow.TEST={filterFromChart,renderRecords,openRecord,closeRecord,renderCharts,applyFilters,currentCharts,EVENTS,INCLUDED,DATA,setDownload(fn){download=fn}};\n})().catch');
 vm.runInContext(fs.readFileSync(root+'record-summary.js','utf8'),a.context);
 vm.runInContext(fs.readFileSync(require('path').resolve(__dirname,'analysis-metrics.js'),'utf8'),a.context);
 await vm.runInContext(ui,a.context);
 const t=a.context.TEST;assert(t,'Analysis initialization failed');
 assert.equal(detailRequests,0,'Analysis charts and register must not fetch full records on opening');assert.equal(archiveRequests,0);
 assert.equal(a.ids.resultCount.textContent,'697 matching records');assert.equal(a.ids.pageNote.textContent,'1–12 of 697');
 assert(a.ids.codeChart.innerHTML.includes('Health and biosecurity'));assert(a.ids.codeChart.innerHTML.includes('Policy and socioeconomic demands'));
 assert(!a.ids.assessmentChart.innerHTML.includes('rationale assessed as supported'),'initial six-field findings must not be presented as current rationale verification');
 assert(a.ids.codeChart.innerHTML.includes('Administration and service operation'));assert(a.ids.codeChart.innerHTML.includes('Environment and resource management'));
 assert.equal(t.currentCharts.durationRows.length,164);assert(a.ids.durationComparisonNote.textContent.includes('160 records'));
 assert(a.ids.durationRationaleChart.innerHTML.includes('119 days'));assert(a.ids.durationRationaleChart.innerHTML.includes('No eligible phases'));
 assert(a.ids.durationCoverageChart.innerHTML.includes('76 / 292 records'));
 assert(!a.ids.continentChart.innerHTML.includes('Unassigned'));assert(a.ids.continentChart.innerHTML.includes('North America'));
 assert(!a.ids.regionChart.innerHTML.includes('data-chart-value="Europe"'));assert(a.ids.broadRegionChart.innerHTML.includes('data-chart-value="Europe"'));
 assert(!a.ids.regionChart.innerHTML.includes('data-chart-value="South Asia, Central Asia and Caucasus"'));assert(a.ids.broadRegionChart.innerHTML.includes('data-chart-value="South Asia, Central Asia and Caucasus"'));
 assert(a.ids.durationChart.innerHTML.includes('Policy in force'));assert(a.ids.durationChart.innerHTML.includes('Announced closure dates'));assert(a.ids.durationChart.innerHTML.includes('Repeated closures'));
 assert(a.ids.durationChart.innerHTML.includes('Same-day interruption reported'));assert(!a.ids.durationChart.innerHTML.includes('Closed and reopened the same day'));
 t.filterFromChart('continent','Africa');assert.equal(t.applyFilters().length,190);a.ids.filters.reset();

 for(const [code,count] of [['Security',292],['Administration and service operation',3],['Environment and resource management',2]]){t.filterFromChart('code',code);assert.equal(t.applyFilters().length,count,code+' count reconciles to current Register');}
 for(const [value,count] of [['complete',252],['exact',163],['undated',2],['quarantined',4],['held',18]]){
  a.ids.filters.reset();a.ids.statusFilter.value=value;t.renderRecords();assert.equal(t.applyFilters().length,count,value);
 }
 a.ids.filters.reset();a.ids.codeFilter.value='__uncoded';t.renderRecords();assert.equal(t.applyFilters().length,20);
 a.ids.filters.reset();await t.openRecord('R16-EU-005',true);assert.equal(a.ids.recordDialog.open,true);assert.equal(atlas.hash,'#record-R16-EU-005');
 await a.ids.copyRecordLink.emit('click');assert.equal(a.context.copied,'https://border-closures-atlas.lamarque.chatgpt.site/#analysis/record-R16-EU-005');
 t.closeRecord();assert.equal(a.ids.recordDialog.open,false);assert.equal(atlas.hash,'#top');
 atlas.hash='#record-R16-EU-006';await a.context.AtlasAnalysis.navigate(atlas.hash);assert(a.ids.dialogId.textContent.startsWith('R16-EU-006'));
 atlas.hash='#patterns';await a.context.AtlasAnalysis.navigate(atlas.hash);assert.equal(a.ids.recordDialog.open,false);assert(a.ids.patterns.scrolled);
 for(const e of data.events){await t.openRecord(e.id,false);const html=a.ids.dialogBody.innerHTML;assert(!/undefined|NaN|Invalid Date/.test(html),e.id);assert(!/scoped endpoint|calendar days|calendar-day difference|days in policy period|operational continuity/.test(html),e.id);assert(!/>Source \d+ ↗<\/a>/.test(html),e.id);assert(html.includes('Current review'));assert(html.includes('class="event-description"'));}
 await t.openRecord('R16-AN-001',false);assert(a.ids.dialogBody.innerHTML.includes('Policy: 2659–2689 days; continuous closure not confirmed'));assert(a.ids.dialogBody.innerHTML.includes('>WTO ↗</a>'));assert(a.ids.dialogBody.innerHTML.includes('>AMI ↗</a>'));
 await t.openRecord('EA020',false);assert(a.ids.dialogBody.innerHTML.includes('Dates disputed'));
 await t.openRecord('R2-SC-012',false);assert(a.ids.dialogBody.innerHTML.includes('2–7 days'));
 t.closeRecord();a.ids.filters.reset();t.renderRecords();
 a.ids.chartPopulation.value='complete';t.renderCharts();assert(a.ids.chartPopulationNote.textContent.startsWith('252 records'));
 a.ids.chartPopulation.value='exact';t.renderCharts();assert(a.ids.chartPopulationNote.textContent.startsWith('163 records'));
 a.ids.chartPopulation.value='all';t.renderCharts();
 const downloads=[];t.setDownload((filename,body,type)=>downloads.push({filename,body,type}));
 for(const id of ['exportRows','exportCodes','exportSnapshot','exportAudit','exportPhases','exportCoverage','exportDuration','exportDurationCoverage','exportContinents'])await a.ids[id].emit('click');
 assert.equal(downloads.length,9);assert(downloads[0].body.startsWith('\ufeff"ID"'));assert.equal(JSON.parse(downloads[2].body).events.length,701);assert.equal(JSON.parse(downloads[3].body).records.length,701);
 assert.deepEqual(JSON.parse(downloads[2].body),completeResearch,'snapshot must contain complete evidence and workbook review/geography tables, not browsing summaries');
 const auditRecords=new Map(JSON.parse(downloads[3].body).records.map(record=>[record.event_id,record]));
 for(const record of data.events){assert.deepEqual(auditRecords.get(record.id).initial_review,record.initial_review,record.id+' historical initial review');assert.deepEqual(auditRecords.get(record.id).followup_reviews,record.followup_reviews,record.id+' later review evidence');}
 assert(downloads[6].body.includes('Observed reopening date'));assert(downloads[6].body.includes('Exact dates; operational closure; observed reopening'));assert(downloads[7].body.includes('Median days'));assert(downloads[8].body.includes('North America'));
 assert(downloads[4].body.includes('EA020-D1'));assert(downloads[4].body.includes('GL01-C7RWP6'));assert(downloads[5].body.includes('697'));
 console.log('Analysis passed: shared current dataset, 697 included, 20 records without an assigned rationale category, all 701 detail views, current audit, held phases, ten categories, timing subsets, deep links continent/research-area separation, phase duration distributions, and nine CSV/JSON exports.');
})().catch(e=>{console.error(e);process.exitCode=1});
