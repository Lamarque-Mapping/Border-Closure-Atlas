(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const buttons={map:$('map-page-button'),analysis:$('analysis-page-button'),briefing:$('method-button')};
  const frame=$('analysis-frame'),loading=$('analysis-loading');
  const sections=new Set(['top','main','dimensions','motivations','borderwork','patterns','coding','register','methods']);
  let currentPage='map',analysisHash='#top',started=false,ready=false,loadTimer=null;
  function normaliseHash(hash){
    const value=String(hash||'#top').replace(/^#/,'');
    return sections.has(value)||/^record-[A-Za-z0-9_.%~-]+$/.test(value)?'#'+value:'#top';
  }
  function pageHash(page){return page==='analysis'?'#analysis'+(analysisHash==='#top'?'':'/'+analysisHash.slice(1)):'#'+page;}
  function updateAddress(hash){if(location.hash!==hash){try{history.replaceState(null,'',hash);}catch{}}}
  function syncViewport(){
    const search=$('map-search'),compact=window.matchMedia?.('(max-width:1000px)').matches;
    const slot=$(compact?'panel-search-slot':'header-search-slot');
    if(search.parentNode!==slot)slot.appendChild(search);
    syncSkipLink();
    const viewport=window.visualViewport;
    document.documentElement.style.setProperty('--atlas-viewport-height',Math.round(viewport?viewport.height:window.innerHeight)+'px');
    document.documentElement.style.setProperty('--atlas-masthead-height',Math.ceil(document.querySelector('.masthead').getBoundingClientRect().height)+'px');
  }
  function syncSkipLink(){
    const skip=document.querySelector('.skip-link'),compactSearch=$('map-search').parentNode===$('panel-search-slot');
    skip.href=currentPage==='map'?(compactSearch?($('map-page').classList.contains('panel-collapsed')?'#panel-toggle':$('map-page').classList.contains('detail-open')?'#back-button':'#search'):'#search'):currentPage==='analysis'?'#analysis-frame':'#briefing-page';
    skip.textContent=currentPage==='map'?'Skip to map controls':currentPage==='analysis'?'Skip to analysis':'Skip to methods';
  }
  function navigateFrame(){if(ready)frame.contentWindow.AtlasAnalysis.navigate(analysisHash);}
  function failed(){
    clearTimeout(loadTimer);
    if(ready)return;
    $('analysis-loading-message').textContent='The analysis could not be loaded. Please try again.';
    $('analysis-retry').hidden=false;
  }
  function loadAnalysis(){
    if(started)return;
    started=true;ready=false;frame.hidden=true;loading.hidden=false;
    $('analysis-loading-message').textContent='Loading analysis…';$('analysis-retry').hidden=true;
    loadTimer=setTimeout(failed,20000);
    const embedded=$('analysis-document');
    if(embedded){
      try{frame.srcdoc=JSON.parse(embedded.textContent);}catch{failed();}
    }else frame.src='analysis.html?v=20261024-analysis-fast';
  }
  // Prepare Analysis after the map has painted, without delaying its opening.
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
      ready=true;clearTimeout(loadTimer);frame.hidden=false;loading.hidden=true;navigateFrame();
    }catch{failed();}
  }
  frame.addEventListener('load',analysisLoaded);
  frame.addEventListener('error',failed);
  $('analysis-retry').addEventListener('click',()=>{started=false;loadAnalysis();});
  function show(page,options={}){
    if(!buttons[page])page='map';
    const changed=currentPage!==page;currentPage=page;
    if(options.analysisHash)analysisHash=normaliseHash(options.analysisHash);
    for(const [name,button] of Object.entries(buttons)){
      const active=name===page;
      $(name+'-page').hidden=!active;button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    document.body.dataset.page=page;
    if(page==='analysis'){
      loadAnalysis();
      // Preserve scroll and filters when returning; explicit deep links navigate.
      if(options.analysisHash)navigateFrame();
    }
    if(options.address!==false)updateAddress(pageHash(page));
    if(changed)window.scrollTo(0,0);
    syncViewport();
    window.dispatchEvent(new CustomEvent('atlas:pagechange',{detail:{page}}));
  }
  function readAddress(){
    const hash=location.hash;
    if(hash==='#analysis'||hash.startsWith('#analysis/'))show('analysis',{analysisHash:hash.includes('/')?'#'+hash.slice(10):'#top',address:false});
    else if(hash==='#briefing')show('briefing',{address:false});
    else if(hash===''||hash==='#map')show('map',{address:false});
  }
  window.AtlasNavigation={
    show,
    analysisReady:analysisLoaded,
    getAnalysisHash:()=>analysisHash,
    setAnalysisHash(hash){analysisHash=normaliseHash(hash);if(currentPage==='analysis')updateAddress(pageHash('analysis'));},
    getAnalysisURL(hash){
      const url=new URL(location.protocol==='file:'?'https://border-closures-atlas.lamarque.chatgpt.site/':location.href);
      const target=normaliseHash(hash);url.hash='#analysis'+(target==='#top'?'':'/'+target.slice(1));return url.href;
    }
  };
  for(const [page,button] of Object.entries(buttons))button.addEventListener('click',()=>show(page));
  $('back-to-map').addEventListener('click',()=>show('map'));
  window.addEventListener('hashchange',readAddress);
  window.addEventListener('resize',syncViewport);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',syncViewport);
  if(window.ResizeObserver)new ResizeObserver(syncViewport).observe(document.querySelector('.masthead'));
  if(document.fonts)document.fonts.ready.then(syncViewport);
  syncViewport();readAddress();
})();

