/* Reading navigation and the two different chart denominators. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),template=fs.readFileSync(path.join(__dirname,'analysis-template.html'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'analysis-ui.js'),'utf8');
const metrics=require('./analysis-metrics.js'),data=JSON.parse(fs.readFileSync(path.join(root,'dist/analysis-data.json'),'utf8'));
const included=data.events.filter(event=>!event.quarantined);
for(const population of ['all','operational_complete','operational_exact_complete']){
 const rows=included.filter(event=>population==='all'||event.timing_coverage[population]);
 for(const group of metrics.durationGroups(rows,data.meta.rationale_categories)){
  const motivationCount=rows.filter(event=>event.rationales.includes(group.code)).length;
  assert.equal(group.total,motivationCount,population+': duration-sample denominator matches motivation count for '+group.code);
  assert(group.records<=group.total,population+': duration sample is a subset of category records');
 }
}
const security=metrics.durationGroups(included,data.meta.rationale_categories).find(group=>group.code==='Security');
assert.equal(included.length,697);assert.equal(security.total,292);assert.equal(security.records,76);
assert.equal(included.filter(event=>event.timing_coverage.operational_exact_complete).length,163);
assert.equal(new Set(metrics.durationRows(included).map(phase=>phase.record_id)).size,160);
assert(!template.includes('How much evidence does each category have?'));
assert.match(template,/<details\b[^>]*id="research-areas"[^>]*\bopen>/);
const targets=[...template.matchAll(/\bid="([^"]+)"[^>]*\bdata-analysis-section="([^"]+)"/g)].map(match=>({id:match[1],label:match[2]}));
assert.deepEqual(targets.map(target=>target.id),['top','dimensions','motivations','borderwork','motivation-counts','closure-lengths','duration-sample','geography','research-areas']);
for(const target of targets){assert(template.includes('href="#'+target.id+'" data-analysis-link'),target.id+' has a desktop link');assert(template.includes('<option value="'+target.id+'">'),target.id+' has a mobile choice');}
const chartLinks=[...template.matchAll(/<a href="#([^"]+)" data-analysis-link data-chart-link>([\s\S]*?)<\/a>/g)];
assert.deepEqual(chartLinks.map(match=>match[1]),['motivation-counts','closure-lengths','duration-sample','geography','research-areas'],'chart navigation has exactly the five requested destinations');
for(const [all,id,content] of chartLinks){assert.match(content,/<span>[^<]+<\/span><svg\b[^>]*class="analysis-nav-icon"/,id+' has its symbol after the readable label');assert.match(content,/<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"/,id+' symbol is decorative');}
assert.equal(new Set(chartLinks.map(match=>match[2].slice(match[2].indexOf('<svg')))).size,5,'each chart has a distinct relevant symbol');
for(const id of ['assessmentChart','durationChart','evidence-coverage','coding'])assert(!template.includes('id="'+id+'"'),id+' moved out of Analysis');
assert(!ui.includes('$("assessmentChart")')&&!ui.includes('$("durationChart")'),'Analysis does not render into the moved Overview panels');
assert.equal((template.match(/id="exportAudit"/g)||[]).length,1);assert(template.indexOf('id="exportAudit"')>template.indexOf('Additional tables and technical formats'),'current-review download remains in Dataset');
assert(template.includes('Types of rationale')&&template.includes('Recorded rationales'));assert(!/>[^<]*\bmotivations?\b[^<]*</i.test(template),'visible labels use rationale terminology; legacy IDs are retained');
assert(template.includes('id="chartPopulation"'),'population filter remains available');
const nodes=new Map(),listeners=new Map();
function node(id,attributes={}){const classes=new Set();return {id,value:'',textContent:'',attributes,classes,events:{},getAttribute(key){return this.attributes[key]},setAttribute(key,value){this.attributes[key]=value},removeAttribute(key){delete this.attributes[key]},classList:{toggle(key,on){on?classes.add(key):classes.delete(key)}},addEventListener(event,callback){this.events[event]=callback}};}
nodes.set('analysis-current-section',node('analysis-current-section'));nodes.set('analysis-section-select',node('analysis-section-select'));
let context;
const sections=targets.map((target,i)=>({...node(target.id,{'data-analysis-section':target.label}),getBoundingClientRect(){return {top:i*1000-context.scrollY,height:700}}}));
const links=targets.map(target=>node('',{href:'#'+target.id}));
const document={activeElement:null,documentElement:{clientHeight:800,scrollHeight:targets.length*1000},querySelectorAll(selector){return selector==='[data-analysis-section]'?sections:selector==='[data-analysis-link]'?links:[]},querySelector(){return {getBoundingClientRect(){return {height:56}}}}};
context={document,currentView:'overview',scrollY:0,innerHeight:800,$:id=>nodes.get(id),setTimeout(){return 1},replaceRoute(hash){context.route=hash},navigateAnalysis(hash){context.destination=hash},addEventListener(event,callback){listeners.set(event,callback)}};context.window=context;
vm.createContext(context);
const start=ui.indexOf('// Keep the desktop section cue'),end=ui.indexOf('function progress()',start);
assert(start>=0&&end>start);
vm.runInContext(ui.slice(start,end)+'\nwindow.sectionTest={updateSectionNavigation,markAnalysisSection};',context);
context.sectionTest.updateSectionNavigation();assert.equal(nodes.get('analysis-current-section').textContent,'Introduction');
const chartIndex=targets.findIndex(target=>target.id==='motivation-counts');context.scrollY=chartIndex*1000;context.sectionTest.updateSectionNavigation();
assert.equal(nodes.get('analysis-section-select').value,'motivation-counts');assert.equal(nodes.get('analysis-current-section').textContent,'Recorded rationales');assert.equal(links.filter(link=>link.attributes['aria-current']==='location').length,1);assert.equal(links[chartIndex].attributes['aria-current'],'location');
const picker=nodes.get('analysis-section-select');document.activeElement=picker;picker.value='closure-lengths';context.scrollY=0;context.sectionTest.updateSectionNavigation();assert.equal(picker.value,'closure-lengths','scroll tracking does not overwrite a focused mobile selection');
picker.events.change({target:picker});assert.equal(context.route,'#closure-lengths');assert.equal(context.destination,'#closure-lengths');
picker.value='unknown-section';picker.events.change({target:picker});assert.equal(context.destination,'#closure-lengths','unknown section values are ignored');
document.activeElement=null;context.currentView='dataset';const prior=nodes.get('analysis-current-section').textContent;context.scrollY=5000;context.sectionTest.updateSectionNavigation();assert.equal(nodes.get('analysis-current-section').textContent,prior,'Dataset scroll does not alter the Analysis cue');
const navigate=ui.slice(ui.indexOf('async function navigateAnalysis('),ui.indexOf('window.AtlasAnalysis='));
for(const embedded of [false,true]){
 const location={replace(url){this.redirect=url}},parent={location:{}};
 const routeContext={ATLAS_HOST:embedded?{}:null,location,window:{parent}};vm.createContext(routeContext);vm.runInContext(navigate,routeContext);
 for(const [hash,anchor] of [['#coding','rationale-coding'],['#evidence-coverage','date-evidence']]){routeContext.navigateAnalysis(hash);assert.equal(embedded?parent.location.hash:location.redirect,(embedded?'':'index.html')+'#overview/'+anchor,'legacy methods anchor reaches Overview');}
}
console.log('Analysis sections passed: unchanged chart denominators; five chart links with decorative icons; Overview panel migration without stale render calls; preserved Dataset review download; rationale terminology with legacy routes; expanded research areas; desktop current-section cue and accessible mobile selection.');
