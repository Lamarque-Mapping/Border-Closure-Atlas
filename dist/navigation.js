(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const buttons={map:$('map-page-button'),overview:$('overview-page-button'),analysis:$('analysis-page-button'),dataset:$('dataset-page-button')};
  const frame=$('analysis-frame'),loading=$('analysis-loading');
  const sections=new Set(['top','main','dimensions','motivations','borderwork','patterns','coding','register','downloads','methods','motivation-counts','evidence-coverage','closure-lengths','duration-sample','geography','research-areas']);
  const hashes={overview:'#top',dataset:'#register'};
  const movedOverviewSections={'coding':'rationale-coding','evidence-coverage':'date-evidence'};
  let currentPage='map',frameView=null,started=false,ready=false,loadTimer=null;
  const datasetHash=hash=>/^#(?:register|downloads|record-)/.test(hash);
  const primaryPage=page=>page==='briefing'?'overview':page;
  const activeView=()=>currentPage==='dataset'?'dataset':'overview';
  function normaliseHash(hash){
    const value=String(hash||'#top').replace(/^#/,'');
    return sections.has(value)||/^record-[A-Za-z0-9_.%~-]+$/.test(value)?'#'+value:'#top';
  }
  function pageHash(page){
    if(page==='dataset')return '#dataset'+(hashes.dataset==='#register'?'':'/'+hashes.dataset.slice(1));
    if(page==='analysis')return '#analysis'+(hashes.overview==='#top'?'':'/'+hashes.overview.slice(1));
    return page==='briefing'?'#overview':'#map';
  }
  function updateAddress(hash){if(location.hash!==hash){try{history.replaceState(null,'',hash);}catch{}}}
  function syncViewport(){
    const search=$('map-search'),compact=window.matchMedia?.('(max-width:1000px)').matches;
    const slot=$(compact?'panel-search-slot':'header-search-slot');
    if(search.parentNode!==slot)slot.appendChild(search);
    syncSkipLink();
    const viewport=window.visualViewport;
    document.documentElement.style.setProperty('--atlas-viewport-height',Math.round(viewport?viewport.height:window.innerHeight)+'px');
    const headerHeight=document.querySelector('.masthead').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--atlas-masthead-height',Math.ceil(headerHeight)+'px');
  }
  function syncSkipLink(){
    const skip=document.querySelector('.skip-link'),compactSearch=$('map-search').parentNode===$('panel-search-slot');
    skip.href=currentPage==='map'?(compactSearch?($('map-page').classList.contains('panel-collapsed')?'#panel-toggle':$('map-page').classList.contains('detail-open')?'#back-button':'#search'):'#search'):currentPage==='briefing'?'#briefing-page':'#analysis-frame';
    skip.textContent=currentPage==='map'?'Skip to map controls':currentPage==='briefing'?'Skip to overview':currentPage==='dataset'?'Skip to dataset':'Skip to analysis';
  }
  function navigateFrame(explicit=false){
    if(!ready)return;
    const view=activeView(),changed=frameView!==view;
    frame.contentWindow.AtlasAnalysis.setView?.(view);frameView=view;
    if(explicit||changed)frame.contentWindow.AtlasAnalysis.navigate(hashes[view]);
  }
  function failed(){
    clearTimeout(loadTimer);if(ready)return;
    $('analysis-loading-message').textContent='This page could not be loaded. Please try again.';
    $('analysis-retry').hidden=false;
  }
  function loadAnalysis(){
    if(started)return;
    started=true;ready=false;frame.hidden=true;loading.hidden=false;
    $('analysis-loading-message').textContent=currentPage==='dataset'?'Loading dataset…':'Loading analysis…';$('analysis-retry').hidden=true;
    loadTimer=setTimeout(failed,20000);
    const embedded=$('analysis-document');
    if(embedded){try{frame.srcdoc=JSON.parse(embedded.textContent);}catch{failed();}}
    else frame.src='analysis.html?v=20261024-reader-workbook';
  }
  window.addEventListener('atlas:mapready',()=>{
    const connection=navigator.connection;
    if(connection?.saveData||/^(slow-)?2g$/.test(connection?.effectiveType||''))return;
    const warm=()=>{if(currentPage==='map'&&!started)loadAnalysis();};
    if(window.requestIdleCallback)window.requestIdleCallback(warm,{timeout:2500});else setTimeout(warm,1500);
  });
  function analysisLoaded(){
    if(!started||ready)return;
    try{
      if(!frame.contentWindow.AtlasAnalysis)return;
      ready=true;clearTimeout(loadTimer);frame.hidden=false;loading.hidden=true;navigateFrame(true);
    }catch{failed();}
  }
  frame.addEventListener('load',analysisLoaded);frame.addEventListener('error',failed);
  $('analysis-retry').addEventListener('click',()=>{started=false;frameView=null;loadAnalysis();});
  function show(page,options={}){
    if(page==='overview')page='briefing';
    if(!['map','briefing','analysis','dataset'].includes(page))page='map';
    const changed=currentPage!==page;currentPage=page;
    if(options.analysisHash)hashes[activeView()]=normaliseHash(options.analysisHash);
    const primary=primaryPage(page);
    for(const [name,button] of Object.entries(buttons)){
      const active=name===primary;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    $('map-page').hidden=page!=='map';$('briefing-page').hidden=page!=='briefing';$('analysis-page').hidden=page!=='analysis'&&page!=='dataset';
    document.body.dataset.page=page==='dataset'?'analysis':page;document.body.dataset.primaryPage=primary;
    $('analysis-page').setAttribute('aria-label',page==='dataset'?'Dataset':'Analysis');
    frame.title=page==='dataset'?'Border closures: dataset and source records':'Border closures: analysis and charts';
    if(page==='analysis'||page==='dataset'){loadAnalysis();navigateFrame(Boolean(options.analysisHash));}
    if(options.address!==false)updateAddress(pageHash(page));
    if(changed)window.scrollTo(0,0);
    syncViewport();
    window.dispatchEvent(new CustomEvent('atlas:pagechange',{detail:{page:page==='dataset'?'analysis':page,section:primary}}));
  }
  function readAddress(){
    const hash=location.hash;
    const moved=hash.match(/^#(?:(?:analysis|overview\/analysis)\/)?(coding|evidence-coverage)$/);
    const overviewTarget=moved?movedOverviewSections[moved[1]]:hash.match(/^#overview\/(rationale-coding|date-evidence)$/)?.[1];
    if(overviewTarget){show('briefing',{address:false});$(overviewTarget)?.scrollIntoView({block:'start'});if(moved)updateAddress('#overview/'+overviewTarget);return;}
    if(hash==='#dataset'||hash.startsWith('#dataset/'))show('dataset',{analysisHash:hash.includes('/')?'#'+hash.slice(9):'#register',address:false});
    else if(hash==='#overview/analysis'||hash.startsWith('#overview/analysis/'))show('analysis',{analysisHash:hash.startsWith('#overview/analysis/')?'#'+hash.slice(19):'#top',address:false});
    else if(hash==='#analysis'||hash.startsWith('#analysis/')){
      const target=hash.includes('/')?'#'+hash.slice(10):'#top';show(datasetHash(target)?'dataset':'analysis',{analysisHash:target,address:false});
    }else if(hash==='#overview'||hash==='#briefing'||hash==='#overview/methods'||hash==='#overview/cite'){
      show('briefing',{address:false});
      if(hash==='#overview/cite')$('cite-atlas').scrollIntoView({block:'start'});
      if(hash==='#overview/methods')$('research-method').scrollIntoView({block:'start'});
    }else if(hash===''||hash==='#map')show('map',{address:false});
  }
  window.AtlasNavigation={
    show,analysisReady:analysisLoaded,getAnalysisHash:()=>hashes[activeView()],
    setAnalysisHash(hash){const view=frameView||activeView();hashes[view]=normaliseHash(hash);if(currentPage==='analysis'||currentPage==='dataset')updateAddress(pageHash(currentPage));},
    getAnalysisURL(hash){
      const url=new URL(location.protocol==='file:'?'https://lamarque-mapping.github.io/Border-Closure-Atlas/':location.href),target=normaliseHash(hash);
      url.hash=movedOverviewSections[target.slice(1)]?'#overview/'+movedOverviewSections[target.slice(1)]:datasetHash(target)?'#dataset'+(target==='#register'?'':'/'+target.slice(1)):'#analysis'+(target==='#top'?'':'/'+target.slice(1));return url.href;
    }
  };
  for(const [page,button] of Object.entries(buttons))button.addEventListener('click',()=>show(page));
  $('back-to-map').addEventListener('click',()=>show('map'));
  window.addEventListener('hashchange',readAddress);window.addEventListener('resize',syncViewport);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',syncViewport);
  if(window.ResizeObserver)new ResizeObserver(syncViewport).observe(document.querySelector('.masthead'));
  if(document.fonts)document.fonts.ready.then(syncViewport);
  syncViewport();readAddress();
})();
