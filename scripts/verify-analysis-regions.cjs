/* Geography boundaries, single counting, shared light/full behaviour and export provenance. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),R=require('./analysis-regions.js'),M=require('./analysis-metrics.js');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'dist',name),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
const data=read('analysis-data.json'),full=read('data.js');
const before=JSON.stringify(data.events),byID=new Map(data.events.map(e=>[e.id,e])),fullByID=new Map(full.events.map(e=>[e.id,e]));
const expected={
 EU001:'Northern Europe',EU031:'Eastern Europe',EU028:'Western Europe',EU032:'Southern Europe',
 GS001:'Southern Europe',EU013:'Eastern Europe',EU029:'Eastern Europe',EU006:'Northern Europe',
 AM001:'North America',AM031:'North America',AM027:'Central America',AM029:'Central America',
 AM009:'Caribbean',AM037:'Caribbean',AM035:'South America',AM014:'South America'
};
for(const [id,area] of Object.entries(expected))assert.equal(R.area(byID.get(id)),area,id);
assert.equal(R.area({region:'Americas',countries:['Sint Maarten (Kingdom of Netherlands)','Saint-Martin (France)']}),'Caribbean');
assert.equal(R.area({region:'Europe',countries:['Gibraltar (UK territory)','Spain']}),'Southern Europe');
assert.equal(R.area({region:'Europe',countries:[]}),'Europe (subregion unassigned)','missing geography must remain visible');
assert.equal(R.area({region:'Americas',countries:['Not identified']}),'Americas (subregion unassigned)','unknown geography must not be silently assigned');
const unchanged=data.events.filter(e=>!['Europe','Americas'].includes(e.region));
for(const e of unchanged)assert.equal(R.area(e),e.region,'other original research groups are retained');
for(const e of data.events){
 assert.equal(R.area(e),R.area(fullByID.get(e.id)),e.id+' has the same area with light or full data');
 assert(!R.area(e).includes('unassigned'),e.id+' needs a reviewed subdivision');
 assert(!['Europe','Americas'].includes(R.area(e)),'broad Europe and Americas bars are fully subdivided');
}
const southAmerica=data.events.filter(e=>R.area(e)==='South America');
assert(southAmerica.some(e=>e.region==='Americas')&&southAmerica.some(e=>e.region==='South America'),'existing South America entries and newly subdivided entries merge');
for(const population of ['all','complete','exact'])for(const duration of ['all','over1']){
 const selected=M.filterRecords(data.events,population,duration),counts=new Map();
 for(const e of selected)counts.set(R.area(e),(counts.get(R.area(e))||0)+1);
 assert.equal([...counts.values()].reduce((a,b)=>a+b,0),selected.length,'each record counted once');
}
assert.equal(JSON.stringify(data.events),before,'display grouping must not mutate source records');
const ui=fs.readFileSync(path.join(__dirname,'analysis-ui.js'),'utf8'),template=fs.readFileSync(path.join(__dirname,'analysis-template.html'),'utf8');
assert(!template.includes('broadRegionChart')&&!ui.includes('broadRegionChart'),'only one regional list remains');
assert.equal((template.match(/id="regionChart"/g)||[]).length,1);
assert(template.includes('first listed country or territory')&&template.includes('not a claim about which authority'));
assert(template.includes('North America here includes Canada, the United States and Mexico'));
const rendered=fs.readFileSync(path.join(root,'dist/analysis.html'),'utf8');
assert(rendered.includes(fs.readFileSync(path.join(__dirname,'analysis-regions.js'),'utf8').trim()),'published page bundles the tested grouping');
// Execute the actual adapter and record export, preserving the original Region column.
let exported;
const context={REGIONS:R,window:{BorderSummary:require('../dist/record-summary.js')},cleanText:String,downloadCSV:(filename,rows)=>{exported={filename,rows};}};
vm.createContext(context);
vm.runInContext(ui.slice(ui.indexOf('function analysisEvent('),ui.indexOf('// National histories'))+'\n'+ui.slice(ui.indexOf('function exportRecordRows('),ui.indexOf('$("exportRows").addEventListener')),context);
context.exportRecordRows(full,Object.keys(expected).map(id=>byID.get(id)),'regions.csv');
const header=exported.rows[0];
assert.equal(header[1],'Region','existing CSV columns keep their positions');
assert(header.includes('Research area'));assert.equal(header.at(-1),'Case description');
for(const row of exported.rows.slice(1)){
 assert.equal(row[1],fullByID.get(row[0]).region,'original workbook label retained');
 assert.equal(row[header.indexOf('Research area')],expected[row[0]],'derived research area exported');
}
console.log('Research areas passed: all records assigned consistently, territory and transregional examples, no double counting across six populations, one chart, original labels preserved in record CSVs.');
