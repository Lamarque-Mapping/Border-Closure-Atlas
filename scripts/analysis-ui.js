(async function(){
"use strict";
const ATLAS_HOST = window.parent !== window && window.parent.AtlasNavigation ? window.parent.AtlasNavigation : null;
if(ATLAS_HOST){document.documentElement.classList.add("atlas-embedded");document.documentElement.dataset.analysisView="overview";}
const routeHash = function(){return ATLAS_HOST ? ATLAS_HOST.getAnalysisHash() : location.hash;};
const replaceRoute = function(hash){
 if(ATLAS_HOST)ATLAS_HOST.setAnalysisHash(hash);
 else history.replaceState(null,"",hash);
};
let provider=ATLAS_HOST ? window.parent.AtlasData : window.AtlasData;
if(!provider && (ATLAS_HOST ? window.parent.BORDER_DATA : window.BORDER_DATA)){
 const complete=ATLAS_HOST ? window.parent.BORDER_DATA : window.BORDER_DATA;
 provider={ready:async()=>complete,getRecord:async id=>complete.events.find(e=>e.id===id),getResearchData:async()=>complete};
}
if(!provider){
 await new Promise(function(resolve,reject){const script=document.createElement("script");script.src="data-loader.js?v=20261024-analysis-fast";script.dataset.analysisSrc="analysis-data.json";script.dataset.sourceSha="";script.onload=resolve;script.onerror=()=>reject(new Error("The data could not be loaded. Please try again."));document.head.appendChild(script);});
 provider=window.AtlasData;
}
const shared=await (provider.getAnalysisData?provider.getAnalysisData():provider.ready());
const METRICS=window.BorderAnalysisMetrics;
const cleanText = value => String(value==null?"":value).replace(/(\d)(calendar)/gi,"$1 $2").replace(/\bcalendar-day differences?\b/gi,"days").replace(/;\s*scoped endpoint only\b/gi,"; for the stated movement and location").replace(/\bcalendar(?:-date)? (days?)\b/gi,"$1").replace(/\s+to (?:the )?scoped endpoint\b/gi,"").replace(/\bscoped endpoint(s?)\b/gi,"endpoint$1").replace(/\bFormal policy:\s*/gi,"Policy: ").replace(/\b(days?) in policy period\b/gi,"$1").replace(/\boperational continuity not established\b/gi,"continuous closure not confirmed").replace(/\boperational continuity\b/gi,"continuous closure").replace(/\b1 days\b/g,"1 day");
function analysisEvent(e){
 const d={"Countries or territories":e.countries.join("; "),"Imposing authority":e.imposing_authority,"Geographical scope":e.scope,"Crossing points":e.crossings,Direction:e.direction,"Affected people or goods":e.movement,Exceptions:e.exceptions,"Enforcement evidence":e.enforcement,"Consequences evidence":e.consequences,"Last confirmed closed":e.last_confirmed_closed,"Record type":e.record_type,"Status observation":e.status_observation,Relationship:e.relationship};
 return {...e,codes:e.rationales,status:e.current_review.outcome,justification:e.official_rationale,policy:e.policy_group,dimensions:d,
  claims:e.current_review.claims.map(c=>({Field:c.field,"Evidence assessment":c.assessment,"Assessment note":c.note})),
  sources:e.sources.map(s=>({"Source ID":s.source_id,Publisher:s.publisher,"Original reporting source":s.origin,Title:s.title,"Publication date":s.publication_date,"Source type":s.source_type,"Access level":s.content_access,"Supports fields":(s.supports||[]).join("; "),"Evidence note":s.evidence_note,URL:s.url,access_history:s.access_history||[]}))};
}
// National histories remain separate from land-closure statistics.
const EVENTS = shared.events.filter(e=>e.record_kind!=='national_policy'&&e.record_kind!=='border_status').map(analysisEvent);
const INCLUDED=EVENTS.filter(e=>!e.quarantined);
const DATA={meta:shared.meta,events:EVENTS,summary:{codes:shared.meta.rationale_counts}};
const CODES=DATA.meta.rationale_categories;
const outcomeCounts={};INCLUDED.forEach(e=>outcomeCounts[e.status]=(outcomeCounts[e.status]||0)+1);
const AUDIT={meta:{source_file:DATA.meta.source_filename,source_sha256:DATA.meta.source_sha256,data_state_sha256:DATA.meta.data_state_sha256,
 release_id:DATA.meta.release_method?.release_id,limits:DATA.meta.research_method.review_limits,
 cumulative_review_coverage:DATA.meta.release_method?.rec50,
 coverage_note:"Cumulative review coverage can overlap. A record's latest review status is not its full review history."},
 records:EVENTS.map(e=>({event_id:e.id,classification_key:e.status,...e.current_review,unresolved_issues:e.unresolved_issues})),
 groups:Object.entries(outcomeCounts).map(([key,count])=>({key,label:key,count}))};
const AUDIT_BY_ID=new Map(AUDIT.records.map(r=>[r.event_id,r]));
const AUDIT_GROUPS=new Map(AUDIT.groups.map(g=>[g.key,g]));
const populationMatch=(e,value)=>value==="complete"?e.timing_coverage.operational_complete:value==="exact"?e.timing_coverage.operational_exact_complete:value==="undated"?!e.timing_coverage.any_dated_evidence:value==="held"?e.duration_periods.some(p=>p.contested):true;
const $ = function(id){return document.getElementById(id);};
const escapeHTML = function(value){return cleanText(value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
const pct = function(n,d){return d ? (100*n/d).toFixed(1)+"%" : "0.0%";};
const norm = function(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();};
const frequencies = function(list, key){const out={};list.forEach(function(e){const v=key(e);out[v]=(out[v]||0)+1;});return out;};
const rationale = function(e){return e.claims.find(function(c){return c.Field==="rationale";}) || {};};
const regions = Array.from(new Set(INCLUDED.map(function(e){return e.region;}))).sort();
const currentCharts = {codes:[],regions:[],continents:[],durationRows:[],durationGroups:[]};
let filtered = [];
let page = 0;
const PAGE_SIZE = 12;
let recordBeforeHash = "#register";
let currentRecord = null;
const dialog = $("recordDialog");
let currentView="overview";
function setView(view){
 currentView=view==="dataset"?"dataset":"overview";
 document.documentElement.dataset.analysisView=currentView;
 document.title=currentView==="dataset"?"Dataset · Global Border Closures Atlas":"Analysis · Global Border Closures Atlas";
 const skip=document.querySelector(".skip");if(skip)skip.href=currentView==="dataset"?"#register":"#main";
 if(currentView!=="dataset")scheduleSectionNavigation();
}
function openDataset(hash="#register",behavior="smooth"){
 setView("dataset");
 if(ATLAS_HOST?.show)ATLAS_HOST.show("dataset",{analysisHash:hash});
 else replaceRoute(hash);
 const target=$(hash.slice(1));if(target)target.scrollIntoView({behavior,block:"start"});
}
const dateLabel = function(value){
 if(!value)return "Not established";
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
  return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(value+"T00:00:00Z"));
 }
 if(/^\d{4}-\d{2}$/.test(value)){
  return new Intl.DateTimeFormat("en-GB",{month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(value+"-01T00:00:00Z"))+" (month)";
 }
 return value.length===4?value+" (year)":value;
};
const option = function(value,label){const o=document.createElement("option");o.value=value;o.textContent=label;return o;};
regions.forEach(function(r){$("regionFilter").appendChild(option(r,r));});
METRICS.CONTINENTS.forEach(function(c){$("continentFilter").appendChild(option(c,c));});
CODES.forEach(function(c){$("codeFilter").appendChild(option(c,c));});
AUDIT.groups.forEach(function(g){$("auditFilter").appendChild(option(g.key,g.label+" ("+g.count+")"));});
document.querySelectorAll("[data-count]").forEach(function(el){el.textContent=String(DATA.summary.codes[el.dataset.count]||0)+" records";});
$("sourceHash").textContent="Master workbook SHA-256: "+DATA.meta.download_workbook_sha256+" · Data source SHA-256: "+DATA.meta.source_sha256+" · Data state: "+DATA.meta.data_state_sha256;
EVENTS.forEach(function(e){
 e.searchText=norm(e.search_text||[e.id,e.title,e.region,e.justification,e.context,e.uncertainty,e.policy].concat(Object.values(e.dimensions)).concat(e.sources.map(function(s){return s.Title;}).concat(e.duration_periods.map(p=>p.scope)).concat(e.rationale_assignments.map(a=>a.Subcategory))).join(" "));
});
function download(filename,body,type){
 const blob=new Blob([body],{type:type||"text/plain;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download=filename;
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(function(){URL.revokeObjectURL(url);},1500);
}
function csvCell(value){
 if(value==null)return '""';
 let s=String(value);
 if(typeof value==="string" && /^[=+\-@\t\r]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
function downloadCSV(filename,rows){download(filename,"\ufeff"+rows.map(function(r){return r.map(csvCell).join(",");}).join("\r\n"),"text/csv;charset=utf-8");}
const durationExplanation="Includes records with at least one documented closure period whose minimum date difference exceeds one day. A continuing closure can qualify through its last confirmed date, without implying a reopening or later duration. Policy-only dates and lengths that could be one day or less are excluded. Days use date differences, not hour-by-hour measurements.";
const durationSelection=(population,duration)=>population+(duration==='over1'?'; minimum date difference >1 day in at least one operational phase; confirmed-through lower bounds allowed':'');
const filteredFilename=(filename,duration)=>duration==='over1'?filename.replace(/\.csv$/,'-over-1-day.csv'):filename;
function bar(label,value,total,max,kind,uncoded){
 const width=max?Math.max(0,100*value/max):0;
 return '<button type="button" class="bar-row'+(uncoded?' uncoded':'')+'" data-chart-kind="'+kind+'" data-chart-value="'+escapeHTML(label)+'" aria-label="'+escapeHTML(label)+': '+value+' records, '+pct(value,total)+'. Inspect records.">'+
 '<span class="bar-label">'+escapeHTML(label)+'</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:'+width+'%"></span></span><span class="bar-value">'+value+'<small>'+pct(value,total)+'</small></span></button>';
}
function renderCharts(){
 const selected=$("chartPopulation").value,duration=$("chartDuration").value,selection=durationSelection(selected,duration);
 const rows=METRICS.filterRecords(INCLUDED,selected,duration);
 const n=rows.length;
 const counts=CODES.map(function(c){return {label:c,count:rows.filter(function(e){return e.codes.includes(c);}).length};}).sort(function(a,b){return b.count-a.count;});
 const blank=rows.filter(function(e){return !e.codes.length;}).length;
 const max=Math.max(1,...counts.map(function(x){return x.count;}),blank);
 $("codeChart").innerHTML=counts.map(function(x){return bar(x.label,x.count,n,max,"code",false);}).join("")+bar("No code assigned",blank,n,max,"code",true);
 currentCharts.codes=counts.concat({label:"No code assigned",count:blank}).map(function(x){return [x.label,x.count,n,pct(x.count,n),selection];});
 $("chartPopulationNote").textContent=n+" records"+(duration==='over1'?" · more than 1 day":"")+" · select a bar to explore";
 $("chartDurationNote").hidden=duration!=='over1';$("chartDurationNote").textContent=duration==='over1'?durationExplanation:'';
 $("motivationDenominatorNote").textContent="Percentages use all "+n+" selected records, including those without a category.";
 const rc=Object.entries(frequencies(rows,function(e){return e.region;})).sort(function(a,b){return b[1]-a[1];});
 const broad=new Set(['Americas','Europe','East and Southeast Asia and Oceania','South Asia, Central Asia and Caucasus']);
 $("regionChart").innerHTML=rc.filter(x=>!broad.has(x[0])).map(function(x){return bar(x[0],x[1],n,rc[0]?.[1]||1,"region",false);}).join("");
 $("broadRegionChart").innerHTML=rc.filter(x=>broad.has(x[0])).map(function(x){return bar(x[0],x[1],n,rc[0]?.[1]||1,"region",false);}).join("");
 currentCharts.regions=rc.map(function(x){return [x[0],x[1],n,pct(x[1],n),selection];});
 const cc=METRICS.continents(rows).sort((a,b)=>b.count-a.count);
 $("continentChart").innerHTML=cc.map(x=>bar(x.label,x.count,n,cc[0]?.count||1,'continent',false)).join('');
 currentCharts.continents=cc.map(x=>[x.label,x.count,n,pct(x.count,n),selection]);
 renderDurationComparison(rows,selected,duration);
}
function renderDurationComparison(rows,population,duration='all'){
 const phases=METRICS.durationRows(rows,duration),groups=METRICS.durationGroups(rows,CODES,duration).sort((a,b)=>(b.median??-1)-(a.median??-1)||a.code.localeCompare(b.code));
 currentCharts.durationRows=phases;currentCharts.durationGroups=groups;currentCharts.durationPopulation=durationSelection(population,duration);currentCharts.durationFilter=duration;
 const parentIDs=new Set(phases.map(p=>p.record_id)),parents=parentIDs.size,uncoded=phases.filter(p=>!p.codes.length).length;
 const eligibleParents=new Set(METRICS.durationRows(rows).map(p=>p.record_id));
 const extraChecks=rows.filter(e=>e.timing_coverage.operational_exact_complete&&!eligibleParents.has(e.id)).length;
 $("durationComparisonNote").textContent=phases.length+' eligible phases from '+parents+' records. A phase is one documented period for a particular movement and location.'+(duration==='over1'?' Only phases longer than one day are plotted; shorter phases from the same record are excluded.':'')+(extraChecks?' '+extraChecks+' other records have exact date ranges but do not meet this chart’s further checks, including a confirmed reopening.':'')+' The horizontal scale is logarithmic: the marks 1, 10, 100 and 1,000 days are equally spaced.'+(uncoded?' '+uncoded+' phase'+(uncoded===1?' has':'s have')+' no rationale label and '+(uncoded===1?'is':'are')+' not plotted.':'');
 const maximum=Math.max(1,...phases.map(p=>p.days)),cap=[10,30,100,300,1000,3000,10000,30000].find(x=>x>=maximum)||Math.pow(10,Math.ceil(Math.log10(maximum))),position=value=>(100*Math.log10(value)/Math.log10(cap)).toFixed(3)+'%';
 const ticks=[1,10,100,1000,10000].filter(t=>t<=cap),number=value=>Number.isInteger(value)?value.toLocaleString('en-GB'):Number(value.toFixed(1)).toLocaleString('en-GB');
 const axis='<div class="distribution-axis"><span>Days · log scale</span><svg aria-hidden="true">'+ticks.map(t=>'<text x="'+position(t)+'" y="25" text-anchor="'+(t===1?'start':'middle')+'" font-size="10" fill="#65756f">'+number(t)+'</text>').join('')+'</svg><span>Median · sample</span></div>';
 $("durationRationaleChart").innerHTML=axis+groups.map(g=>{
  const description=g.phases?g.code+': median '+number(g.median)+' days; middle half '+number(g.q1)+' to '+number(g.q3)+' days; shortest '+number(g.min)+', longest '+number(g.max)+' days; '+g.phases+' phases from '+g.records+' records.':g.code+': no eligible phases.';
  const plot=g.phases?'<svg class="distribution-plot" role="img" aria-label="'+escapeHTML(description)+'"><title>'+escapeHTML(description)+'</title>'+ticks.map(t=>'<line x1="'+position(t)+'" x2="'+position(t)+'" y1="0" y2="32" stroke="#e2e9e4"/>').join('')+'<line x1="'+position(g.min)+'" x2="'+position(g.max)+'" y1="16" y2="16" stroke="#9ab0a4" stroke-width="2"/><line x1="'+position(g.q1)+'" x2="'+position(g.q3)+'" y1="16" y2="16" stroke="#709784" stroke-width="8" stroke-linecap="round"/><circle cx="'+position(g.median)+'" cy="16" r="4" fill="#244e46" stroke="#fff" stroke-width="1.2"/></svg>':'<span class="distribution-none">No eligible phases</span>';
  return '<div class="distribution-row"><span class="distribution-label">'+escapeHTML(g.code)+'</span>'+plot+'<span class="distribution-value">'+(g.phases?number(g.median)+' days':'—')+'<small>'+g.phases+' phases · '+g.records+' records</small></span></div>';
 }).join('');
 const coverageGroups=[...groups].sort((a,b)=>b.total-a.total||CODES.indexOf(a.code)-CODES.indexOf(b.code));
 const example=coverageGroups.find(g=>g.total);
 $("durationCoverageExample").textContent=example?'For example, '+example.code+' appears in '+example.total+' selected records. Of these, '+example.records+' can contribute to the duration comparison: '+pct(example.records,example.total)+' of that category.':'No selected records are available for this comparison.';
 $("durationCoverageChart").innerHTML='<table><caption>The categories follow the same order as the rationale chart. “Used” means a record contributes at least one phase to the duration comparison.</caption><thead><tr><th scope="col">Recorded rationale</th><th scope="col">Used / category total</th><th scope="col">Share used</th></tr></thead><tbody>'+coverageGroups.map(g=>'<tr><th scope="row">'+escapeHTML(g.code)+'</th><td class="sample-total">'+(g.total?g.records+' / '+g.total+' records':'No selected records')+'</td><td>'+(g.total?pct(g.records,g.total):'—')+'</td></tr>').join('')+'</tbody></table>';
}
function filterFromChart(kind,value){
 $("filters").reset();
 $("statusFilter").value=$("chartPopulation").value==="all"?"":$("chartPopulation").value;
 $("durationFilter").value=$("chartDuration").value;
 if(kind==="region")$("regionFilter").value=value;
 if(kind==="continent")$("continentFilter").value=value;
 if(kind==="code")$("codeFilter").value=value==="No code assigned"?"__uncoded":value;
 page=0;renderRecords();
 openDataset();
}
function applyFilters(){
 const q=norm($("query").value).trim(),r=$("regionFilter").value,continent=$("continentFilter").value,c=$("codeFilter").value,s=$("statusFilter").value,a=$("auditFilter").value,duration=$("durationFilter").value;
 let result=EVENTS.filter(function(e){
  if(s==="quarantined"){if(!e.quarantined)return false;}
  else {if(e.quarantined)return false;if(s && !populationMatch(e,s))return false;}
  return METRICS.durationMatch(e,duration) && (!q||e.searchText.includes(q)) && (!continent||e.continents.includes(continent)) && (!r||e.region===r) && (!c||(c==="__uncoded"?!e.codes.length:e.codes.includes(c))) && (!a||(AUDIT_BY_ID.has(e.id)&&AUDIT_BY_ID.get(e.id).classification_key===a));
 });
 const sort=$("sortRecords").value;
 result.sort(function(a,b){
  if(sort==="title")return a.title.localeCompare(b.title);
  if(sort==="id")return a.id.localeCompare(b.id,undefined,{numeric:true});
  if(!a.start && !b.start)return a.id.localeCompare(b.id);
  if(!a.start)return 1;if(!b.start)return -1;
  return sort==="newest"?b.start.localeCompare(a.start):a.start.localeCompare(b.start);
 });
 return result;
}
function recordTimingLabel(e){
 const phases=e.duration_periods||[],exact=METRICS.durationRows([e]);
 if(!phases.length)return 'Dates not established';
 if(phases.length>1)return phases.length+' periods or observations';
 const p=phases[0];
 if(p.contested)return 'Dates disputed';
 if(p.kind==='same_day')return 'Same-day interruption reported';
 if(p.measure_type==='formal_policy_period')return 'Policy dates';
 if(p.measure_type==='ordered_window')return 'Announced dates';
 if(p.measure_type==='intermittent_regime')return 'Repeated closures';
 if(exact.length)return exact[0].days+' day'+(exact[0].days===1?'':'s');
 if(!p.start_earliest||!p.end_latest||p.temporal_display_rule==='dated_evidence_only_no_continuity_inference')return 'Dated observation';
 if(p.observed_reopening!=='Yes')return 'Reopening unconfirmed';
 return 'Duration estimated';
}
function renderRecords(){
 filtered=applyFilters();
 const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 page=Math.min(page,pages-1);
 const start=page*PAGE_SIZE;
 const longOnly=$("durationFilter").value==='over1';
 $("resultCount").textContent=filtered.length+" matching "+(filtered.length===1?"record":"records")+(longOnly?" · more than 1 day":"")+($("statusFilter").value==="quarantined"?" · excluded from analysis":"");
 $("datasetDurationNote").hidden=!longOnly;$("datasetDurationNote").textContent=longOnly?durationExplanation:'';
 $("recordList").innerHTML=filtered.length?filtered.slice(start,start+PAGE_SIZE).map(function(e){
  return '<button type="button" class="record-row" data-record="'+escapeHTML(e.id)+'" aria-label="Open '+escapeHTML(e.id)+': '+escapeHTML(e.title)+'">'+
  '<span class="record-id">'+escapeHTML(e.id)+'</span><span><span class="record-title">'+escapeHTML(e.title)+'</span>'+
  '<span class="record-meta">'+escapeHTML(e.region)+' · '+escapeHTML(e.codes.join(" · ")||"No code assigned")+'</span>'+
  '</span><span class="record-dates">'+escapeHTML(recordTimingLabel(e))+'<br><span aria-hidden="true">↗</span></span></button>';
 }).join(""):'<p class="empty-state">No matching records. Try a broader search or reset the filters.</p>';
 $("prevPage").disabled=page===0;$("nextPage").disabled=page>=pages-1;
 $("pageNote").textContent=filtered.length?(start+1)+"–"+Math.min(start+PAGE_SIZE,filtered.length)+" of "+filtered.length:"0 records";
}
function field(label,value,full){
 return '<div'+(full?' class="full"':'')+'><label>'+escapeHTML(label)+'</label>'+escapeHTML(value==null||value===""?"Not established":value)+'</div>';
}
function section(title,body){return '<section class="dialog-section"><h3>'+escapeHTML(title)+'</h3>'+body+'</section>';}
function auditSection(e){
 const reviews=e.followup_reviews||[],initial=e.initial_review||{};
 return section("Current review",'<p class="review-label">'+escapeHTML(e.current_review.outcome)+'</p>'+reviews.map(r=>'<article class="evidence-check"><strong>'+escapeHTML(r['Adjudicated outcome'])+' · '+escapeHTML(r['Completed (UTC)'])+'</strong><p>'+escapeHTML(r['Research finding'])+'</p><p>'+escapeHTML(r['Root decision'])+'</p><p>'+escapeHTML(r['Issue dispositions'])+'</p></article>').join('')+(e.unresolved_issues.length?'<h4>Open evidence needs</h4>'+e.unresolved_issues.map(q=>'<p><strong>'+escapeHTML(q.Priority)+' · '+escapeHTML(q['Field needing evidence'])+'</strong><br>'+escapeHTML(q['Unresolved finding'])+'<br>'+escapeHTML(q['Next evidence needed'])+'</p>').join(''):'')+'<p class="figure-note">'+escapeHTML(DATA.meta.research_method.verification_statement)+'</p>'+(initial.claims?.length?'<details><summary>Initial review findings (historical)</summary><p>These initial findings do not override the current phases or later reviews.</p>'+initial.claims.map(c=>'<p><strong>'+escapeHTML(c.field)+' · '+escapeHTML(c.assessment)+'</strong><br>'+escapeHTML(c.note)+'</p>').join('')+'</details>':''));
}
function phaseDates(p){
 const bound=(a,b)=>!a?dateLabel(b):!b||a===b?dateLabel(a):dateLabel(a)+' – '+dateLabel(b);
 if(p.contested||p.temporal_display_rule==='dated_evidence_only_no_continuity_inference'||!p.start_earliest||!p.end_latest){
  const dates=[...new Set(p.evidence_dates||[p.start_earliest,p.start_latest,p.end_earliest,p.end_latest,p.last_confirmed].filter(Boolean))];
  return (p.contested?'Reported dates: ':'Evidence dated: ')+(dates.length?dates.map(dateLabel).join('; '):'Not established');
 }
 if(p.kind==='same_day')return bound(p.start_earliest,p.start_latest);
 return bound(p.start_earliest,p.start_latest)+(p.endpoint_status==='last_confirmed'?' · still closed on ':p.observed_reopening==='Yes'?' → reopened ':' → last recorded date ')+(p.endpoint_status==='last_confirmed'?dateLabel(p.last_confirmed):bound(p.end_earliest,p.end_latest));
}
function phaseSourceLink(url,sources){
 const s=sources.find(source=>source.URL===url)||{},publisher=String(s.Publisher||'').trim();
 const aliases={'Norwegian Ministry of Justice':'Norway Justice Ministry','Norwegian Justice Ministry':'Norway Justice Ministry','WTO Secretariat':'WTO','Agence mauritanienne d’information':'AMI',"Agence mauritanienne d'information":'AMI'};
 const name=aliases[publisher]||publisher||new URL(url).hostname.replace(/^www\./,'');
 const description=[publisher,s.Title].filter(Boolean).join(': ')||name;
 return '<a href="'+escapeHTML(url)+'" target="_blank" rel="noopener noreferrer" title="'+escapeHTML(description)+'" aria-label="'+escapeHTML(description)+'">'+escapeHTML(name)+' ↗</a>';
}
function phaseHTML(p,sources){
 const label={operational_spell:'Observed closure',formal_policy_period:'Policy in force',ordered_window:'Announced closure dates',intermittent_regime:'Repeated closures'}[p.measure_type]||'Recorded dates';
 const summary=p.contested?'The dates are disputed; no duration is calculated.':p.kind==='same_day'?(p.observed_reopening==='Yes'?'Closed and reopened the same day; no whole-day duration is calculated.':'Same-day interruption reported; no whole-day duration is calculated.'):p.measure_type==='formal_policy_period'?'These dates describe a policy, not a confirmed continuous closure.':p.measure_type==='ordered_window'?'This is an announced schedule. Actual enforcement is not established.':p.measure_type==='intermittent_regime'?'Closures recurred during this period. Total closed days are unknown.':p.temporal_display_rule==='dated_evidence_only_no_continuity_inference'||!p.start_earliest||!p.end_latest?'These are dated observations; they do not establish the whole closure duration.':cleanText(p.display);
 return '<article class="evidence-check"><strong>'+escapeHTML(label)+(p.contested?' · Dates disputed':'')+'</strong><p>'+escapeHTML(phaseDates(p))+'</p><p>'+escapeHTML(summary)+'</p><p>'+escapeHTML(p.scope)+'</p><details><summary>Evidence and date details</summary><p>'+escapeHTML(p.basis)+'</p><p>'+escapeHTML(p.qualification)+'</p><p>'+escapeHTML(p.movement)+' · '+escapeHTML(p.direction)+'</p><p>Observed reopening: '+escapeHTML(p.observed_reopening)+'. Endpoint inclusion: '+escapeHTML(p.endpoint_inclusion)+'.</p>'+(p.display?'<p>Workbook timing: '+escapeHTML(p.display)+'</p>':'')+(p.reported_duration?'<p>'+escapeHTML(p.reported_duration)+'</p>':'')+(p.reported_schedule?'<p>'+escapeHTML(p.reported_schedule)+'</p>':'')+'<p>'+p.source_urls.filter(u=>/^https?:\/\//.test(u)).map(u=>phaseSourceLink(u,sources)).join(' · ')+'</p></details></article>';
}
function sourceLink(s){
 const safe=/^https?:\/\//i.test(s.URL||"");
 return '<article class="source-item">'+(safe?'<a href="'+escapeHTML(s.URL)+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(s.Title||s.URL)+' ↗</a>':'<b>'+escapeHTML(s.Title||"Source")+'</b>')+
 '<div class="source-meta">'+escapeHTML(s["Source ID"])+' · '+escapeHTML(s.Publisher||"Publisher not recorded")+' · '+escapeHTML(dateLabel(s["Publication date"]))+'</div>'+
 '<p><b>Type:</b> '+escapeHTML(s["Source type"]||"Not recorded")+' · <b>Recorded access:</b> '+escapeHTML(s["Access level"]||"Not recorded")+'</p>'+
 '<p><b>Supports:</b> '+escapeHTML(s["Supports fields"]||"Not recorded")+'</p>'+
 (s["Original reporting source"]?'<p><b>Reporting origin:</b> '+escapeHTML(s["Original reporting source"])+'</p>':"")+
 (s["Evidence note"]?'<p>'+escapeHTML(s["Evidence note"])+'</p>':"")+
 (s.access_history.length?'<details><summary>Source access history ('+s.access_history.length+')</summary>'+s.access_history.map(a=>'<p><b>'+escapeHTML(a.stage)+' · '+escapeHTML(a.access)+'</b><br>'+escapeHTML(a.inspected)+'<br>'+escapeHTML(a.limitation)+'</p>').join('')+'</details>':'')+'</article>';
}
let recordRequest=0;
async function openRecord(id,changeHash){
 const summary=EVENTS.find(function(x){return x.id===id;});if(!summary)return;
 const request=++recordRequest;
 if(changeHash!==false){recordBeforeHash=routeHash().startsWith("#record-")?"#register":routeHash()||"#register";replaceRoute("#record-"+encodeURIComponent(id));}
 currentRecord=summary;
 $("dialogId").textContent=summary.id+" · "+summary.region;
 $("dialogBody").innerHTML='<h2 id="dialogTitle">'+escapeHTML(summary.title)+'</h2><p role="status">Loading closure details…</p>';
 if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
 let e;
 try{e=analysisEvent(await provider.getRecord(id));}catch(error){
  if(request!==recordRequest)return;
  $("dialogBody").innerHTML='<h2 id="dialogTitle">'+escapeHTML(summary.title)+'</h2><p role="status">'+escapeHTML(error.message)+'</p><button type="button" id="retryRecord">Try again</button>';
  $("retryRecord").addEventListener('click',()=>openRecord(id,false));return;
 }
 if(request!==recordRequest)return;
 currentRecord=e;
 $("dialogId").textContent=e.id+" · "+e.region;
 const d=e.dimensions;
 $("dialogBody").innerHTML='<div class="dialog-heading"><p>Closure record</p><h2 id="dialogTitle">'+escapeHTML(e.title)+'</h2><p class="event-description">'+escapeHTML(window.BorderSummary.describe(e,{periods:e.duration_periods}))+'</p>'+
 '<div>'+((e.codes.length?e.codes:[e.rationale_coding_status||"No category assigned"]).map(c=>'<span class="tag">'+escapeHTML(c)+'</span>').join(''))+'</div>'+
 (e.quarantined?'<div class="quarantine-note">Excluded from analysis, mapping and playback. '+escapeHTML(e.quarantine_reason)+'</div>':'')+'</div>'+
 section("Dates and duration",e.duration_periods.length?e.duration_periods.map(p=>phaseHTML(p,e.sources)).join(''):'<p>The evidence does not establish a duration.</p>')+
 section("Location and movement",'<div class="field-grid">'+field('Countries or territories',d['Countries or territories'])+field('Crossings',e.crossings)+field('Geographical scope',e.scope,true)+field('Direction',e.direction,true)+field('Affected people or goods',e.movement,true)+field('Exceptions',e.exceptions,true)+'</div>')+
 (e.uncertainty?section('Qualifications','<p>'+escapeHTML(e.uncertainty)+'</p>'):'')+
 '<details class="disclosure"><summary>Rationale, attribution and context</summary><div class="disclosure-body">'+section('Recorded explanation','<p>'+escapeHTML(e.justification||'Not established')+'</p><p>'+escapeHTML(e.context)+'</p>')+
 e.rationale_assignments.map(a=>'<article class="evidence-check"><strong>'+escapeHTML(a['Broad rationale'])+' · '+escapeHTML(a.Subcategory)+'</strong><p>'+escapeHTML(a['Evidence attribution'])+'</p><p>'+escapeHTML(a['Phase / overlap'])+'</p><p>'+escapeHTML(a['Coding decision and qualification'])+'</p></article>').join('')+'</div></details>'+
 '<details class="disclosure"><summary>Current review and open evidence needs</summary><div class="disclosure-body">'+auditSection(e)+'</div></details>'+
 '<details class="disclosure"><summary>Authority, enforcement and related records</summary><div class="disclosure-body"><div class="field-grid">'+field('Imposing authority',e.imposing_authority,true)+field('Enforcement evidence',e.enforcement,true)+field('Consequences evidence',e.consequences,true)+field('Related policy',e.policy_group)+field('Relationship',e.relationship)+field('Status observation',e.status_observation,true)+'</div></div></details>'+
 '<details class="disclosure"><summary>Historical parent claims</summary><div class="disclosure-body"><p>Retained for provenance. These original claims do not supersede the current phase dates or audit findings above.</p><div class="field-grid">'+field('Original start',dateLabel(e.historical.start))+field('Original endpoint',dateLabel(e.historical.end))+field('Original endpoint meaning',e.historical.endpoint,true)+field('Original day calculation',e.historical.days==null?'Not established':e.historical.days+' days')+field('Original duration qualification',e.historical.duration_note,true)+field('Historical evidence status',e.historical.evidence_status,true)+'</div>'+e.historical.claim_checks.map(c=>'<p><b>'+escapeHTML(c.Field)+' · '+escapeHTML(c['Historical parent-claim assessment'])+'</b><br>'+escapeHTML(c['Historical note — current findings are in Audit review and Follow-up review'])+'</p>').join('')+'</div></details>'+
 section('Sources ('+e.sources.length+' distinct links)','<p class="figure-note">Links are deduplicated by URL, not by reporting origin. Each access history distinguishes historical and current checks; a failed retrieval is not full-text access.</p>'+e.sources.map(sourceLink).join(''));

 if(!dialog.open)dialog.showModal();
 dialog.scrollTop=0;
}
function closeRecord(){
 recordRequest++;
 if(dialog.open)dialog.close();
 if(routeHash().startsWith("#record-"))replaceRoute(recordBeforeHash);
 currentRecord=null;
}
function toast(message){$("toast").textContent=message;$("toast").style.display="block";setTimeout(function(){$("toast").style.display="none";},3500);}
document.addEventListener("click",function(event){
 const record=event.target.closest("[data-record]");
 if(record){openRecord(record.dataset.record,true);return;}
 const chart=event.target.closest("[data-chart-kind]");
 if(chart){filterFromChart(chart.dataset.chartKind,chart.dataset.chartValue);return;}
 const audit=event.target.closest("[data-audit-group]");
 if(audit){$("filters").reset();$("auditFilter").value=audit.dataset.auditGroup;page=0;renderRecords();openDataset();return;}
 const code=event.target.closest(".code-filter");
 if(code){$("chartPopulation").value="all";$("chartDuration").value="all";renderCharts();filterFromChart("code",code.dataset.code);}
});
$("chartPopulation").addEventListener("change",renderCharts);
$("chartDuration").addEventListener("change",renderCharts);
$("filters").addEventListener("submit",function(e){e.preventDefault();});
$("filters").addEventListener("input",function(){page=0;renderRecords();});
$("filters").addEventListener("change",function(){page=0;renderRecords();});
$("filters").addEventListener("reset",function(){setTimeout(function(){page=0;renderRecords();},0);});
$("sortRecords").addEventListener("change",function(){page=0;renderRecords();});
$("prevPage").addEventListener("click",function(){page--;renderRecords();$("recordList").scrollIntoView({behavior:"smooth",block:"start"});});
$("nextPage").addEventListener("click",function(){page++;renderRecords();$("recordList").scrollIntoView({behavior:"smooth",block:"start"});});
$("closeDialog").addEventListener("click",closeRecord);
dialog.addEventListener("cancel",function(event){event.preventDefault();closeRecord();});
dialog.addEventListener("click",function(event){if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeRecord();}});
$("copyRecordLink").addEventListener("click",async function(){
 if(!currentRecord)return;
 try {await navigator.clipboard.writeText(ATLAS_HOST ? ATLAS_HOST.getAnalysisURL("#record-"+encodeURIComponent(currentRecord.id)) : location.href);toast("Record link copied.");}
 catch(err){toast(ATLAS_HOST && location.protocol==="about:" ? "Open the hosted atlas to copy a shareable record link." : "Copy the page address to share this record.");}
});
async function withResearch(buttonID,action){
 const button=$(buttonID),label=button.innerHTML;button.disabled=true;button.textContent='Preparing…';
 try{await action(await provider.getResearchData());}catch(error){toast(error.message);}finally{button.disabled=false;button.innerHTML=label;}
}
function exportRecordRows(full,selected,filename){
 const byID=new Map(full.events.map(e=>[e.id,analysisEvent(e)]));
 const headings=['ID','Region','Episode','Countries','Crossings','Current timing','Current review','Included','Rationales','Rationale attribution','Scope','Direction','Affected movement','Exceptions','Current uncertainty','Any dated evidence','Complete operational duration','Exact operational duration','Original start (historical)','Original endpoint (historical)','Source URLs'];
 downloadCSV(filename,[headings,...selected.map(e=>byID.get(e.id)).map(e=>[e.id,e.region,e.title,e.countries.join('; '),e.crossings,cleanText(e.current_timing),e.status,!e.quarantined,e.codes.join('; '),e.rationale_assignments.map(a=>a['Broad rationale']+': '+a['Evidence attribution']).join(' | '),e.scope,e.direction,e.movement,e.exceptions,e.uncertainty,e.timing_coverage.any_dated_evidence,e.timing_coverage.operational_complete,e.timing_coverage.operational_exact_complete,e.historical.start,e.historical.end,e.sources.map(s=>s.URL).join(' | ')])]);
}
$("exportRows").addEventListener("click",()=>withResearch('exportRows',full=>exportRecordRows(full,filtered,filteredFilename('border-closures-current.csv',$("durationFilter").value))));
$("exportAllRows").addEventListener("click",()=>withResearch('exportAllRows',full=>exportRecordRows(full,INCLUDED,'border-closures-included-records.csv')));
$("exportCodes").addEventListener("click",()=>downloadCSV(filteredFilename('rationale-counts.csv',currentCharts.durationFilter),[["Current code","Records","Denominator","Share of selected records","Population"],...currentCharts.codes]));
$("exportRegions").addEventListener("click",()=>downloadCSV(filteredFilename('regional-counts.csv',currentCharts.durationFilter),[["Original region label","Records","Denominator","Share of selected records","Population"],...currentCharts.regions]));
$("exportContinents").addEventListener("click",()=>downloadCSV(filteredFilename('continent-counts.csv',currentCharts.durationFilter),[["Continent","Records","All selected records","Share of selected records","Population"],...currentCharts.continents]));
$("exportDuration").addEventListener("click",()=>downloadCSV(filteredFilename('duration-by-rationale-phases.csv',currentCharts.durationFilter),[
 ['Record ID','Phase ID','Event','Phase scope','Start date','Observed reopening date','Days (date difference)','Parent record rationale labels','Endpoint inclusion','Eligibility','Population','Data source SHA-256'],
 ...currentCharts.durationRows.map(p=>[p.record_id,p.phase_id,p.title,p.scope,p.start,p.end,p.days,p.codes.join('; '),p.endpoint_inclusion,'Exact dates; operational closure; observed reopening; not disputed; '+(currentCharts.durationFilter==='over1'?'more than one day (date difference)':'at least one date-boundary day'),currentCharts.durationPopulation,DATA.meta.source_sha256])
]));
$("exportDurationCoverage").addEventListener("click",()=>downloadCSV(filteredFilename('duration-by-rationale-coverage.csv',currentCharts.durationFilter),[
 ['Parent record rationale','Eligible phases','Records with eligible phases','All selected records in category','Share of category records','Shortest days','25th percentile days','Median days','75th percentile days','Longest days','Population','Data source SHA-256'],
 ...currentCharts.durationGroups.map(g=>[g.code,g.phases,g.records,g.total,g.total?pct(g.records,g.total):'',g.min,g.q1,g.median,g.q3,g.max,currentCharts.durationPopulation,DATA.meta.source_sha256])
]));
$("exportSnapshot").addEventListener("click",()=>withResearch('exportSnapshot',full=>download('border-closures-current-snapshot.json',JSON.stringify(full,null,2),'application/json;charset=utf-8')));
$("exportAudit").addEventListener("click",()=>withResearch('exportAudit',full=>download('border-closures-current-review.json',JSON.stringify({...AUDIT,records:full.events.map(e=>({event_id:e.id,classification_key:e.current_review.outcome,...e.current_review,initial_review:e.initial_review,followup_reviews:e.followup_reviews,unresolved_issues:e.unresolved_issues})),workbook_review:full.workbook_review},null,2),'application/json;charset=utf-8')));
$("exportPhases").addEventListener("click",()=>withResearch('exportPhases',full=>downloadCSV('border-closures-chronology-phases.csv',[
 ['Parent ID','Phase ID','Parent included','Evidence type','Interval type','Held or contested','Scope','Start earliest','Start latest','Endpoint earliest','Endpoint latest','Last confirmed (not reopening)','Minimum days','Maximum days','Interpretation','Calculation rule','Complete operational','Exact operational','Qualification','Observed reopening','Endpoint inclusion','Reported schedule','Temporal display rule','Phase location decisions','Source URLs'],
 ...full.events.flatMap(e=>e.duration_periods.map(p=>[e.id,p.period_id,!e.quarantined,p.measure_type,p.kind,p.contested,p.scope,p.start_earliest,p.start_latest,p.endpoint_status==='last_confirmed'?'':p.end_earliest,p.endpoint_status==='last_confirmed'?'':p.end_latest,p.last_confirmed,p.minimum_days,p.maximum_days,cleanText(p.display),p.calculation_rule,p.complete_operational,p.exact_complete_operational,p.qualification,p.observed_reopening,p.endpoint_inclusion,p.reported_schedule,p.temporal_display_rule,(p.location_bindings||[]).map(b=>b['Binding decision']+': '+b['Location / marker']).join(' | '),p.source_urls.join(' | ')]))])));
$("exportCoverage").addEventListener("click",function(){const rows=DATA.meta.timing_coverage,keys=Object.keys(rows[0]);downloadCSV('border-closures-timing-coverage.csv',[keys,...rows.map(r=>keys.map(k=>r[k]))]);});
$("exportFontLicense").addEventListener("click",function(){download("Borderland-Sans-LICENSE.txt",JSON.parse($("fontLicense").textContent),"text/plain;charset=utf-8");});
// Keep the desktop section cue and the mobile selector in step with reading position.
const readingSections=Array.from(document.querySelectorAll('[data-analysis-section]'));
const sectionLinks=Array.from(document.querySelectorAll('[data-analysis-link]'));
let sectionFrame=0;
function markAnalysisSection(id){
 const section=readingSections.find(node=>node.id===id);if(!section)return;
 $("analysis-current-section").textContent=section.getAttribute('data-analysis-section');
 if(document.activeElement!==$("analysis-section-select"))$("analysis-section-select").value=id;
 for(const link of sectionLinks){const active=link.getAttribute('href')==='#'+id;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
}
function updateSectionNavigation(){
 sectionFrame=0;if(currentView==='dataset'||!document.documentElement.clientHeight)return;
 const bar=document.querySelector('.topnav'),readingLine=(bar?bar.getBoundingClientRect().height:0)+28;
 let current=readingSections[0];
 for(const section of readingSections){const anchor=section.id==='motivation-counts'?($("patterns")||section):section;if(anchor.getBoundingClientRect().top<=readingLine)current=section;else break;}
 if(scrollY+innerHeight>=document.documentElement.scrollHeight-8)current=readingSections[readingSections.length-1];
 if(current)markAnalysisSection(current.id);
}
function scheduleSectionNavigation(){
 if(sectionFrame)return;
 const schedule=window.requestAnimationFrame||function(callback){return setTimeout(callback,16);};
 sectionFrame=schedule(updateSectionNavigation);
}
$("analysis-section-select").addEventListener('change',function(event){
 const id=event.target.value;if(!readingSections.some(section=>section.id===id))return;
 const hash='#'+id;replaceRoute(hash);navigateAnalysis(hash);markAnalysisSection(id);
});
function progress(){const available=document.documentElement.scrollHeight-innerHeight;$("readProgress").style.width=(available?100*scrollY/available:0)+"%";}
window.addEventListener("scroll",function(){progress();scheduleSectionNavigation();},{passive:true});
window.addEventListener("resize",scheduleSectionNavigation);
async function navigateAnalysis(hash){
 const overviewAnchor=({'#coding':'rationale-coding','#evidence-coverage':'date-evidence'})[hash];
 if(overviewAnchor){if(ATLAS_HOST)window.parent.location.hash='#overview/'+overviewAnchor;else location.replace('index.html#overview/'+overviewAnchor);return;}
 if(hash==="#methods"&&ATLAS_HOST?.show){ATLAS_HOST.show("briefing");return;}
 if(hash==="#register"||hash==="#downloads")setView("dataset");
 else if(hash==="#methods"&&!ATLAS_HOST){currentView="overview";delete document.documentElement.dataset.analysisView;}
 else if(!hash.startsWith("#record-")&&hash!=="#top"&&hash!=="#main")setView("overview");
 if(hash.startsWith("#record-")){
  let id;try{id=decodeURIComponent(hash.slice(8));}catch{return;}
  await openRecord(id,false);
 }else{
  if(dialog.open)closeRecord();
  const target=document.getElementById(currentView==="dataset"&&hash==="#top"?"register":hash.slice(1)||"top");
  if(target){if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView({behavior:"auto",block:"start"});if(currentView!=='dataset')markAnalysisSection(target.id==='patterns'?'motivation-counts':target.id);}
 }
}
window.AtlasAnalysis={navigate:navigateAnalysis,setView,getView:()=>currentView};
window.addEventListener("hashchange",function(){if(!ATLAS_HOST)navigateAnalysis(routeHash());});
if(ATLAS_HOST)document.addEventListener("click",function(event){
 const link=event.target.closest('a[href^="#"]');
 if(!link)return;
 event.preventDefault();let hash=link.getAttribute("href");
 if(hash==="#methods"){ATLAS_HOST.show("briefing");return;}
 if(hash==="#register"||hash==="#downloads"){openDataset(hash);return;}
 if(currentView==="dataset"&&hash==="#top")hash="#register";
 else if(currentView==="dataset"&&!hash.startsWith("#record-")&&hash!=="#register"){setView("overview");ATLAS_HOST.show("analysis",{analysisHash:hash});return;}
 replaceRoute(hash);navigateAnalysis(hash);
});
renderCharts();renderRecords();progress();scheduleSectionNavigation();
if(!ATLAS_HOST){setView(routeHash().startsWith("#record-")||["#register","#downloads"].includes(routeHash())?"dataset":"overview");}
if(routeHash())navigateAnalysis(routeHash());
if(ATLAS_HOST?.analysisReady)ATLAS_HOST.analysisReady();

})().catch(function(error){const el=document.getElementById("analysisError");el.hidden=false;el.textContent=error.message;console.error(error);});

