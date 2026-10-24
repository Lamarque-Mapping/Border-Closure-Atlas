(function(){
  'use strict';
  const K=window.BorderCartography,PALETTE=K.colours;
  const C=window.BorderCore,$=id=>document.getElementById(id),emptyFC=()=>({type:'FeatureCollection',features:[]});
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=v=>Array.isArray(v)?v.join('; '):typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');
  const publicText=(v,field,id)=>window.BorderPublic?window.BorderPublic.text(v,field,id):text(v);
  const safeURL=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}};
  const locationTitle=(p,id)=>String(p.label||p.name||id).replace(/ — (?:frontier|geographic) context$/,'');
  function eventSources(e){
    const details=new Map(C.array(e.sources).map(s=>[safeURL(s.url),s])),seen=new Set();
    return C.array(e.source_urls).map(s=>{const url=safeURL(typeof s==='string'?s:s.url);if(!url||seen.has(url))return null;seen.add(url);const d=details.get(url)||{},publisher=d.publisher||new URL(url).hostname.replace(/^www\./,'');return {url,label:d.title||(typeof s==='object'&&(s.title||s.label))||publisher,publisher,date:d.publication_date};}).filter(Boolean);
  }
  function shortSourceName(source){
    const publisher=source.publisher||new URL(source.url).hostname.replace(/^www\./,'');
    const names={'Finnish Ministry for Foreign Affairs':'Finnish Foreign Ministry','Norwegian Ministry of Justice':'Norway Justice Ministry','Norwegian Justice Ministry':'Norway Justice Ministry','WTO Secretariat':'WTO','Agence mauritanienne d’information':'AMI','Agence mauritanienne d\'information':'AMI','Associated Press':'AP','Anadolu Agency':'Anadolu'};
    return names[publisher]||publisher.split(';')[0].trim();
  }
  function rationaleHTML(records){
    const codes=[...new Set(records.flatMap(record=>C.array(record.rationales)))];
    return '<span class="rationale-tags">'+(codes.length?codes:['__uncoded']).map(code=>{
      const item=K.rationaleKey.find(entry=>entry.code===code)||K.rationaleKey.find(entry=>entry.code==='__uncoded');
      return '<span class="rationale-tag" style="--rationale-colour:'+item.colour+'"><i aria-hidden="true"></i>'+escape(code==='__uncoded'?'Not established':code)+'</span>';
    }).join('')+'</span>';
  }
  const playIcon='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13 8 4 13.5Z"/></svg>',pauseIcon='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx=".5"/><rect x="9.5" y="2" width="3.5" height="12" rx=".5"/></svg>';
  const monthLabel=n=>new Date(Date.UTC(Math.floor(n/12),n%12,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const compactMedia=window.matchMedia('(max-width:760px), (max-width:950px) and (max-height:500px)');
  const compact=()=>compactMedia.matches;
  let desktopPanelOpen=true,desktopKeyOpen=true,viewportFrame=0,lastMapWidth=0,lastMapHeight=0;
  let labelLayer=null,labelsVisible=false;
  let data=null,events=[],locations=new Map(),locationEvents=new Map(),selected=null,cardLocation='',timer=null,noticeTimer=null,baseGroup=null,featureGroup=null,visible=[],listLimit=50;
  let exportingRecords=false,recordsReturnFocus=null,recordsListScroll=0,recordsPanelScroll=0,playbackRate=1;
  const state={query:'',region:'',rationale:'',location:'',continent:'',precision:'',measureType:'',includeExcluded:false,mode:'intervals',month:0};
  const continentViews={World:[[-55,-170],[75,180]],Africa:[[-36,-20],[38,54]],Europe:[[34,-25],[72,48]],Asia:[[-10,25],[74,150]],'North America':[[6,-168],[73,-50]],'South America':[[-56,-83],[14,-32]],Oceania:[[-50,110],[5,180]]};
  const precisionLabel=e=>({crossing_reference:'Sourced crossing / policy geography',policy_coverage:'Reviewed policy geography',frontier_context:'Border shown for reference',country_context:'Country outline shown for reference',unlocated:'Location not assigned',excluded:'Excluded · list only'}[C.precision(e)]||'Geography under review');
  function resetList(){listLimit=50;}
  $('rationale-legend').innerHTML=K.rationaleKey.map(item=>'<span title="'+escape(item.code.startsWith('__')?item.label:item.code)+'"><i class="rationale-swatch" style="--rationale-colour:'+item.colour+'"></i>'+escape(item.label)+'</span>').join('');
  const map=L.map('map',{preferCanvas:true,zoomControl:false,attributionControl:true,worldCopyJump:false,minZoom:.25,maxZoom:14,zoomSnap:.25}).setView([17,5],2);
  L.control.zoom({position:'topleft'}).addTo(map);
  const scaleControl=L.control.scale({imperial:false,position:'bottomleft'}).addTo(map),labelToggle=document.createElement('button');
  labelToggle.type='button';labelToggle.className='country-label-toggle';labelToggle.textContent='Country labels';
  labelToggle.setAttribute('aria-label','Country labels');labelToggle.setAttribute('aria-pressed','false');labelToggle.title='Show country labels';
  labelToggle.addEventListener('click',()=>{labelsVisible=!labelsVisible;labelToggle.setAttribute('aria-pressed',String(labelsVisible));labelToggle.title=labelsVisible?'Hide country labels':'Show country labels';renderLabels();});
  const mapButtons=document.createElement('div'),keyToggle=document.createElement('button'),keyDialog=$('mobile-map-key');
  mapButtons.className='map-control-buttons';keyToggle.type='button';keyToggle.className='map-key-toggle';keyToggle.textContent='Map key';
  keyToggle.setAttribute('aria-controls','mobile-map-key');keyToggle.setAttribute('aria-expanded','false');keyToggle.setAttribute('aria-haspopup','dialog');
  const mobileKeyContent=$('map-key').querySelector('.map-key-content').cloneNode(true);
  mobileKeyContent.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));keyDialog.append(mobileKeyContent);
  keyToggle.addEventListener('click',()=>{if(!compact())return;stop();map.closePopup();keyDialog.showModal();keyToggle.setAttribute('aria-expanded','true');});
  $('mobile-map-key-close').addEventListener('click',()=>keyDialog.close());
  keyDialog.addEventListener('click',event=>{if(event.target!==keyDialog)return;const box=keyDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)keyDialog.close();});
  keyDialog.addEventListener('close',()=>keyToggle.setAttribute('aria-expanded','false'));
  mapButtons.append(keyToggle,labelToggle);L.DomEvent.disableClickPropagation(mapButtons);L.DomEvent.disableScrollPropagation(mapButtons);scaleControl.getContainer().append(mapButtons);
  map.attributionControl.addAttribution('Base geometry: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · Locations: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>)');
  map.createPane('countryContext');map.getPane('countryContext').style.zIndex=405;map.createPane('referenceLines');map.getPane('referenceLines').style.zIndex=407;map.createPane('scope');map.getPane('scope').style.zIndex=410;map.createPane('points');map.getPane('points').style.zIndex=430;
  function notify(message){$('message').textContent=message;$('message').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('message').hidden=true,6500);}
  function setPlayback(playing){
    const button=$('play-button'),label=playing?'Pause timeline':'Play timeline';
    button.innerHTML=playing?pauseIcon:playIcon;button.title=label;button.setAttribute('aria-label',label);
    button.classList.toggle('is-playing',playing);document.querySelector('.timeline').classList.toggle('is-playing',playing);
  }
  function stop(){if(timer)clearInterval(timer);timer=null;setPlayback(false);}
  function schedulePlayback(){
    if(timer)clearInterval(timer);
    timer=setInterval(()=>{changeMonth(state.month+1);if(state.month>=Number($('month-slider').max))stop();},1400/playbackRate);
  }
  function dateText(value){if(!value)return 'Unknown';const s=text(value);if(C.day(s)!==null)return new Date(s+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});if(/^\d{4}-\d{2}$/.test(s)&&C.monthOrdinal(s)!==null)return monthLabel(C.monthOrdinal(s));return s;}
  function dateRange(e){return dateText(e.start)+' → '+dateText(e.end);}
  function pointLocations(e){return C.locationsFor(e,data).filter(id=>locations.get(id)?.geometry?.type==='Point');}
  function mapLocationNote(e){
    const points=pointLocations(e);if(!points.length)return '';
    const names=points.map(id=>locationTitle(locations.get(id).properties,id));
    const borders=[...new Set(points.flatMap(id=>C.contextLocationsFor(id,data)))].filter(id=>locations.has(id)).map(id=>locationTitle(locations.get(id).properties,id));
    return '<section class="detail-field crossing-location-note"><h3>Referenced crossings</h3><p>'+escape(names.join('; '))+'.</p>'+(borders.length?'<p><strong>Border context:</strong> '+escape(borders.join('; '))+'.</p><p>The border line gives geographical context. It does not mean every crossing or the full length was closed; the scope and location notes below describe this record.</p>':'')+'</section>';
  }
  const mapLocationIDs=e=>C.displayLocationsFor(e,data).filter(id=>K.isLineReference(locations.get(id)));
  function currentLocationIDs(){return [...new Set(visible.flatMap(mapLocationIDs))];}
  function fitContinent(){
    const bounds=continentViews[state.continent||'World']||continentViews.World,padding=viewPadding(),size=map.getSize();
    if(!state.continent&&compact()&&size.y>size.x){
      // Give the portrait map more detail, with its focus above the timeline.
      const topLeft=L.point(padding.paddingTopLeft),bottomRight=L.point(padding.paddingBottomRight);
      const zoom=map.getBoundsZoom(bounds,false,topLeft.add(bottomRight))+.5;
      const centre=map.unproject(map.project([30,12],zoom).add(bottomRight.subtract(topLeft).divideBy(2)),zoom);
      map.setView(centre,zoom,{animate:false});return;
    }
    map.fitBounds(bounds,{...padding,animate:false});
  }
  function fitRecords(){if(compact()){setPanelOpen(false);$('panel-toggle').focus();}const features=currentLocationIDs().map(id=>locations.get(id));if(!features.length){fitContinent();notify('No assigned geography in this selection. The continent view is retained.');return;}const layer=L.geoJSON({type:'FeatureCollection',features});const bounds=layer.getBounds();if(bounds.isValid())map.fitBounds(bounds,{...viewPadding(12),maxZoom:7,animate:false});}
  function updateTabs(){
    for(const button of $('continent-tabs').querySelectorAll('[role="tab"]')){const name=button.dataset.continent;const active=(state.continent||'World')===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    $('continent-panel').setAttribute('aria-labelledby',selected?'panel-title':'tab-'+(state.continent||'World').toLowerCase().replaceAll(' ','-'));
  }
  function selectContinent(name,focus=false){
    stop();state.continent=name==='World'?'':name;state.region='';state.location='';selected=null;resetList();$('region').value='';populateRegions();showBrowse();render();if(compact()){setPanelOpen(false);if(focus)$('panel-toggle').focus();}fitContinent();
    if(focus&&!compact())$('tab-'+name.toLowerCase().replaceAll(' ','-')).focus();
  }
  function makeTabs(){
    $('continent-tabs').replaceChildren();const names=['World',...C.availableContinents(data)];
    names.forEach((name,index)=>{const button=document.createElement('button');button.type='button';button.id='tab-'+name.toLowerCase().replaceAll(' ','-');button.className='continent-tab';button.dataset.continent=name;button.setAttribute('role','tab');button.setAttribute('aria-controls','continent-panel');button.textContent=name;button.addEventListener('click',()=>selectContinent(name));button.addEventListener('keydown',e=>{let target=null;if(e.key==='ArrowRight')target=(index+1)%names.length;if(e.key==='ArrowLeft')target=(index+names.length-1)%names.length;if(e.key==='Home')target=0;if(e.key==='End')target=names.length-1;if(target!==null){e.preventDefault();selectContinent(names[target],true);}});$('continent-tabs').append(button);});
  }
  function populateRegions(){populateSelect('region',events.filter(e=>!state.continent||C.array(e.continents).includes(state.continent)).map(e=>e.region),'All regions');}
  function resetMapLayers(){
    if(baseGroup)map.removeLayer(baseGroup);baseGroup=L.layerGroup().addTo(map);
    L.geoJSON(data.countries||emptyFC(),{interactive:false,style:{fillColor:PALETTE.land,fillOpacity:1,color:PALETTE.coast,weight:.6,opacity:.8}}).addTo(baseGroup);
    L.geoJSON(data.borders||emptyFC(),{pane:'referenceLines',interactive:false,style:{color:PALETTE.border,weight:.6,opacity:.8}}).addTo(baseGroup);
    L.geoJSON(data.disputed||emptyFC(),{pane:'referenceLines',interactive:false,style:{color:PALETTE.disputed,weight:.9,opacity:.8,dashArray:'4 4'}}).addTo(baseGroup);
    renderLabels();
  }
  function labelSpecs(){
    if(!data||!labelsVisible)return [];
    const size=map.getSize();
    return K.countryLabels((data.countries||emptyFC()).features,c=>{const p=map.latLngToContainerPoint([c[1],c[0]]);return [p.x,p.y];},{x:size.x,y:size.y},map.getZoom());
  }
  function renderLabels(){
    if(!labelsVisible){if(labelLayer)labelLayer.hidden=true;return;}
    if(!labelLayer){const pane=map.createPane('countryLabels');pane.style.zIndex=420;pane.style.pointerEvents='none';labelLayer=document.createElement('div');labelLayer.className='country-labels';labelLayer.setAttribute('aria-hidden','true');pane.append(labelLayer);}
    const origin=map.containerPointToLayerPoint([0,0]),size=map.getSize();
    labelLayer.style.left=origin.x+'px';labelLayer.style.top=origin.y+'px';labelLayer.style.width=size.x+'px';labelLayer.style.height=size.y+'px';
    labelLayer.hidden=false;labelLayer.replaceChildren();
    for(const p of labelSpecs()){const el=document.createElement('span');el.className='country-label';el.textContent=p.text;el.style.left=p.x+'px';el.style.top=p.y+'px';el.style.fontSize=p.fontSize+'px';labelLayer.append(el);}
  }
  function updatePanelTitle(active=Boolean(selected)){$('panel-title').textContent=active?'Full record':compact()?'Choose continent':state.continent||'World';}
  function setPanelOpen(open){
    $('map-page').classList.toggle('panel-collapsed',!open);$('panel-toggle').setAttribute('aria-expanded',String(open));
    $('explore-panel').setAttribute('aria-hidden',String(!open));$('explore-panel').inert=!open;
    if(!compact())desktopPanelOpen=open;
    if(!$('map-page').hidden)document.querySelector('.skip-link').href=$('map-search').parentNode===$('panel-search-slot')?(!open?'#panel-toggle':selected?'#back-button':'#search'):'#search';
    $('collapse-panel').setAttribute('aria-label',compact()?'Back to map':'Minimize views and records');
    $('collapse-panel').title=compact()?'Back to map':'Minimize views and records';
    $('collapse-panel').textContent=compact()?'Back to map':'−';
    updatePanelTitle();scheduleViewport();
  }
  function viewPadding(extra=0){
    const page=$('map-page').getBoundingClientRect(),timeline=document.querySelector('.timeline').getBoundingClientRect();
    const open=!$('map-page').classList.contains('panel-collapsed'),right=!compact()&&open?page.right-$('explore-panel').getBoundingClientRect().left+16:16;
    const top=16,bottom=Math.max(16,page.bottom-timeline.top+12);
    return {paddingTopLeft:[16+extra,top+extra],paddingBottomRight:[right+extra,bottom+extra]};
  }
  function exportViewport(){
    const size=map.getSize(),padding=viewPadding(),[x,y]=padding.paddingTopLeft,[right,bottom]=padding.paddingBottomRight;
    return {x,y,width:size.x-x-right,height:size.y-y-bottom};
  }
  function syncViewport(){
    viewportFrame=0;
    const page=$('map-page'),viewport=window.visualViewport;
    const height=viewport&&Math.abs(viewport.scale-1)<.01?viewport.height:window.innerHeight;
    page.style.setProperty('--viewport-height',Math.round(height)+'px');
    page.style.setProperty('--masthead-height',Math.ceil(document.querySelector('.masthead').getBoundingClientRect().height)+'px');
    page.classList.toggle('search-editing',compact()&&document.activeElement===$('search')&&height<500);
    if(page.hidden)return;
    const bounds=page.getBoundingClientRect(),timeline=document.querySelector('.timeline').getBoundingClientRect();
    page.style.setProperty('--timeline-clearance',Math.max(0,Math.ceil(bounds.bottom-timeline.top))+8+'px');
    if(bounds.width!==lastMapWidth||bounds.height!==lastMapHeight){
      lastMapWidth=bounds.width;lastMapHeight=bounds.height;
      map.invalidateSize({pan:false,debounceMoveend:true});renderLabels();
    }
  }
  function scheduleViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(syncViewport);}

  function populateSelect(id,values,first){const el=$(id);el.replaceChildren(new Option(first,''));[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b)).forEach(v=>el.add(new Option(v,v)));}
  function resetFilters(){
    Object.assign(state,{month:C.monthOrdinal(data.meta.window_start),query:'',region:'',rationale:'',location:'',continent:'',precision:'',measureType:'',includeExcluded:false,mode:'intervals'});
    selected=null;resetList();
    for(const id of ['search','region','rationale','precision','measure-type'])$(id).value='';
    $('time-mode').value=state.mode;$('include-excluded').checked=false;
  }
  function applyData(value,loaded=false){
    C.validate(value);stop();data=value;events=data.events;locations=new Map();for(const f of C.locationFeatures(data)){const id=f.properties?.location_id;if(id&&f.geometry)locations.set(id,f);}resetFilters();
    populateRegions();populateSelect('rationale',events.flatMap(e=>C.array(e.rationales)),'All coded rationales');makeTabs();
    const excludedCount=events.filter(C.excluded).length;
    $('excluded-count').textContent='('+excludedCount+')';
    $('release-label').textContent=data.meta.window_start.slice(0,4)+'–'+data.meta.window_end.slice(0,4);document.title='Border closures · Global atlas';
    const min=C.monthOrdinal(data.meta.window_start),max=C.monthOrdinal(data.meta.window_end);$('month-slider').min=min;$('month-slider').max=max;$('month-slider').value=min;$('last-month').textContent=monthLabel(max);
    const summary=data.meta.atlas_summary||{};
    const method=data.meta.research_method||{};
    $('research-method').innerHTML='<h2>How was the research checked?</h2><p>The dataset has been developed through 16 rounds of research, repeated reviews of the full dataset, and further checks on dates, missing events and unanswered questions. Earlier work recorded three checks across the whole dataset. Other reviews included 272 checks of closure length, a review of 686 records across six regions, and follow-up on 371 evidence questions. The number and scope of checks vary between entries as the dataset has grown.</p><p>The latest review of the land dataset used six regional AI reviews and a combined review using the same model. These checks did not provide independent human verification. The source links and review history allow readers to examine the conclusions.</p>';
    const coverage=summary.chronology_coverage||{};
    const nationalCount=events.filter(e=>e.record_kind==='national_policy').length;
    $('release-method').innerHTML='<p><strong>'+(events.length-excludedCount-nationalCount)+' land-border records are included</strong>. '+excludedCount+' other records are retained for reference but excluded from the map and charts. '+coverage.without_dated_evidence+' included land records have no dated evidence.</p><p>Land dataset dated '+escape(dateText(data.meta.snapshot_date))+'. <a href="downloads/Global_Border_Closures_Register_2016_2026.xlsx" download="Global_Border_Closures_Register_2016_2026.xlsx">Download the land dataset (Excel)</a>.</p>';

    resetMapLayers();showBrowse();render();fitContinent();openSharedRecord();if(loaded)notify('Atlas data updated.');
  }
  function render(){
    if(!data)return;map.closePopup();visible=C.filterEvents(data,state);locationEvents=new Map();for(const e of visible)for(const id of mapLocationIDs(e)){if(!locationEvents.has(id))locationEvents.set(id,[]);locationEvents.get(id).push(e);}
    const mappedRecords=visible.filter(e=>mapLocationIDs(e).length).length;
    const excludedCount=visible.filter(C.excluded).length;const unlocatedCount=visible.length-mappedRecords-excludedCount;
    const nationalCount=visible.filter(e=>e.record_kind==='national_policy').length;
    $('record-count').textContent=visible.length.toLocaleString('en-GB');$('count-label').textContent=visible.length===1?'record':'records';$('mapped-count').textContent=(nationalCount?(visible.length-nationalCount)+' land · '+nationalCount+' national '+(nationalCount===1?'record':'records')+' · ':'')+mappedRecords+' with geography · '+unlocatedCount+' unlocated'+(excludedCount?' · '+excludedCount+' excluded':'');
    const modeLabel=state.mode==='all'?'Matching records across the full study period, including those without confirmed dates. These closures did not all happen at once.':state.mode==='onsets'?'Recorded starts in the selected month.':'Dated evidence overlapping part of this month. Ordered windows and intermittent regimes do not establish continuous closure. Possible date overlap is labelled.';
    $('result-context').textContent=modeLabel+(state.mode==='intervals'?' '+Number(data.meta.atlas_summary?.duration_reviewed_unresolved||0)+' land records have no dated phase. Disputed evidence appears only at its recorded dates.':'')+' Country outlines show national rules: solid for entry or departure bans, dotted for entry conditions. Read each record for the people and routes affected. Unmarked does not necessarily mean open.';
    $('map-note').textContent=(state.continent||'World')+' · '+(state.mode==='all'?'all recorded closures':state.mode==='onsets'?'starts · '+monthLabel(state.month):'Border Restrictions · '+monthLabel(state.month));
    $('month-label').textContent=state.mode==='all'?data.meta.window_start.slice(0,4)+'–'+data.meta.window_end.slice(0,4):monthLabel(state.month);$('month-slider').value=state.month;$('month-slider').setAttribute('aria-valuetext',monthLabel(state.month));
    const progress=100*(state.month-Number($('month-slider').min))/(Number($('month-slider').max)-Number($('month-slider').min)||1);
    $('month-slider').style.setProperty('--timeline-progress',progress+'%');
    $('month-slider').disabled=state.mode==='all';$('previous-button').disabled=state.mode==='all'||state.month<=Number($('month-slider').min);$('next-button').disabled=state.mode==='all'||state.month>=Number($('month-slider').max);
    $('include-excluded').disabled=state.mode!=='all';$('excluded-note').textContent=state.mode==='all'?'Excluded records are list-only and never animated.':'Excluded records are unavailable in timeline views.';
    $('time-note').textContent=state.mode==='all'?'Full study period · Play to explore by month':state.mode==='onsets'?'Recorded starts in this month':'Border Restrictions · Unmarked does not necessarily mean open';
    $('location-filter').hidden=!state.location;$('location-filter-label').textContent=state.location?'Linked to '+(locations.get(state.location)?.properties?.label||locations.get(state.location)?.properties?.name||state.location):'';
    const activeFilters=[state.region,state.rationale,state.measureType?C.measureLabel(state.measureType):'',({crossing_reference:'Sourced geography',context:'Context geography',unlocated:'Without a mapped location'})[state.precision],state.includeExcluded&&state.mode==='all'?'Including excluded records':''].filter(Boolean);
    $('filter-summary').textContent=activeFilters.join(' · ');$('filter-summary').hidden=!activeFilters.length;
    updatePanelTitle();updateTabs();renderList();renderLocations();
    updateRecordsControls();
    if(selected&&!visible.some(e=>e.id===selected)){selected=null;showBrowse();}
  }
  function renderListContent(){
    const list=$('event-list');list.replaceChildren();
    const sorted=[...visible].sort((a,b)=>(text(a.start)||'9999').localeCompare(text(b.start)||'9999')||a.id.localeCompare(b.id));
    $('show-more').hidden=sorted.length<=listLimit;$('list-page-label').textContent=sorted.length?'Showing '+Math.min(sorted.length,listLimit)+' of '+sorted.length+' matching records':'';
    if(!sorted.length){const p=document.createElement('p');p.className='empty';p.textContent=state.mode!=='all'&&state.query?'No evidence matches this month. Switch to All recorded closures to find records outside the selected dates. An unmarked border does not necessarily mean it was open.':'No records match this selection. An unmarked border does not necessarily mean it was open.';list.append(p);return;}
    for(const e of sorted.slice(0,listLimit)){
      const phases=cardPeriods(e),stageCount=phases.filter(p=>!p.national_display_period).length,first=phases.find(p=>!p.contested)||phases[0],timing=first?periodLabel(first)+' · '+cardPeriodDates(first):'Dates not established';
      const card=document.createElement('button');card.className='event-card'+(C.excluded(e)?' excluded-card':'');card.dataset.eventId=e.id;
      card.innerHTML='<span class="card-top"><span>'+escape(C.array(e.countries).join(' – ')||e.region||'')+'</span><span>'+escape(e.id)+'</span></span><span class="card-title">'+escape(publicText(e.title||e.id,'title',e.id))+'</span><span class="card-bottom">'+rationaleHTML([e])+'<span class="duration-badge">'+escape(timing)+'</span>'+(stageCount>1?'<span class="period-scope">'+stageCount+' dated stages</span>':'')+'</span>';
      card.addEventListener('click',()=>showEvent(e.id,true));list.append(card);
    }
  }
  function renderList(){renderListContent();}
  function activateLocation(id,items){
    stop();state.location=id;selected=null;resetList();showBrowse();setPanelOpen(true);render();$('panel-scroll').scrollTop=0;
    openRecords();
    if(items.length===1)showEvent(items[0].id,false);
  }
  function cardBoundary(first,last){
    if(!first)return 'Not established';
    if(!last||first===last)return dateText(first);
    if(first.slice(0,7)===last.slice(0,7)){
      const monthEnd=new Date(Date.UTC(Number(first.slice(0,4)),Number(first.slice(5,7)),0)).getUTCDate();
      if(first.endsWith('-01')&&Number(last.slice(8))===monthEnd)return dateText(first.slice(0,7));
      return Number(first.slice(8))+'–'+dateText(last);
    }
    return dateText(first)+' – '+dateText(last);
  }
  function cardPeriodDates(p){
    const start=cardBoundary(p.start_earliest,p.start_latest),end=cardBoundary(p.end_earliest,p.end_latest);
    if(p.national_observation)return start;
    if(p.contested)return C.periodEvidenceDates(p).map(dateText).join('; ')||'Dates not established';
    if(p.temporal_display_rule==='dated_evidence_only_no_continuity_inference'||!p.start_earliest||!p.end_latest)return 'Evidence dated: '+(C.periodEvidenceDates(p).map(dateText).join('; ')||'date not established');
    if(p.kind==='same_day')return start;
    return start+' – '+end+(p.endpoint_status==='last_confirmed'?' (last report)':p.observed_reopening==='Yes'?' (reopened)':'');
  }
  function cardPeriods(e){return C.periodsForView(e,state);}
  function periodLabel(p){return p.national_label|| (p.contested?'Dates disputed':p.kind==='same_day'?'Same-day closure':p.temporal_display_rule==='dated_evidence_only_no_continuity_inference'?'Dated reports':C.measureLabel(p.measure_type));}
  function periodDuration(p){
    if(p.national_display_period||p.national_observation)return p.display;
    if(p.contested)return 'The dates are disputed; a continuous closure cannot be established.';
    if(p.kind==='same_day'||p.temporal_display_rule==='day_marker_no_whole_day_duration')return 'Same-day event; exact hours are not established.';
    if(p.temporal_display_rule==='dated_evidence_only_no_continuity_inference')return 'These reports do not establish a continuous closure between the dates.';
    if(p.measure_type==='intermittent_regime')return 'Closures recurred during this period; total days closed are unknown.';
    const min=Number.isFinite(p.minimum_days)?p.minimum_days:null,max=Number.isFinite(p.maximum_days)?p.maximum_days:null;
    const amount=min!==null?(max===null?'at least '+min:max===min?String(min):min+'–'+max)+(min===1&&max===1?' day':' days'):max!==null?'up to '+max+(max===1?' day':' days'):'';
    if(p.measure_type==='formal_policy_period')return amount?'Policy documented for '+amount+'; this does not measure continuous closure.':'Policy dates are recorded, but a closure duration is not established.';
    if(p.measure_type==='ordered_window')return amount?'Announced for '+amount+'; implementation is not confirmed.':'These are announced dates; implementation is not confirmed.';
    if(!amount)return p.observed_reopening==='Yes'?'A reopening was reported; the full duration is not established.':'Duration and reopening date are not established.';
    if(p.endpoint_status==='last_confirmed'||max===null)return amount.charAt(0).toUpperCase()+amount.slice(1)+' documented; reopening date unknown.';
    return amount+(p.observed_reopening==='Yes'?'': ' between recorded dates; reopening is unconfirmed')+'.';
  }
  function cardSources(e){
    const sources=eventSources(e);
    for(const p of C.array(e.duration_periods))for(const value of C.array(p.source_urls)){
      const url=safeURL(value);if(url&&!sources.some(s=>s.url===url))sources.push({url,label:'Duration evidence',publisher:new URL(url).hostname.replace(/^www\./,'')});
    }
    return sources;
  }
  function cardPeriodHTML(p){
    return '<div class="location-period"><span class="location-period-label">'+escape(periodLabel(p))+'</span><span class="location-period-dates">'+escape(cardPeriodDates(p))+'</span><p class="location-period-duration">'+escape(periodDuration(p))+'</p></div>';
  }
  function locationRecordHTML(e){
    const periods=cardPeriods(e),sources=cardSources(e);
    const endpointURL=C.array(e.sources).filter(s=>C.array(s.supports).includes('end')).map(s=>safeURL(s.url)).find(url=>url&&url!==sources[0]?.url&&sources.some(s=>s.url===url));
    const linked=sources.length?[sources[0],...(endpointURL?[sources.find(s=>s.url===endpointURL)]:sources.slice(1,2))]:[];
    const sourceLink=(s,label)=>'<a class="location-source-link" href="'+escape(s.url)+'" target="_blank" rel="noopener noreferrer" title="'+escape((s.publisher||'Source')+': '+s.label+(s.date?' · Published '+dateText(s.date):''))+'" aria-label="'+escape(shortSourceName(s)+': '+s.label)+'">'+escape(label||shortSourceName(s))+' ↗</a>';
    const sourceGroups=new Map();
    for(const source of linked){const name=shortSourceName(source);if(!sourceGroups.has(name))sourceGroups.set(name,[]);sourceGroups.get(name).push(source);}
    const sourceHTML=[...sourceGroups].map(([name,group])=>group.length===1?sourceLink(group[0]):'<div class="location-source-group"><span class="location-source-name">'+escape(name)+'</span><div class="location-source-dates">'+group.map(s=>sourceLink(s,s.date?dateText(s.date):s.label)).join('')+'</div></div>').join('');
    const first=periods.find(p=>!p.contested)||periods[0],other=periods.filter(p=>p!==first);
    const duration=first?cardPeriodHTML(first)+(other.length?'<details class="location-extra-periods"><summary>'+other.length+' more dated stage'+(other.length===1?'':'s')+'</summary>'+other.map(cardPeriodHTML).join('')+'</details>':''):'<p class="location-period-duration">Dates and duration are not established.</p>';
    const rationales=C.array(e.rationales);
    const description=window.BorderSummary?.describe(e,{periods});
    return '<article><h3 class="location-closure-title">'+escape(publicText(e.title||e.id,'title',e.id))+'</h3>'+(description?'<p class="location-summary">'+escape(description)+'</p>':'')+'<p class="location-rationales"><span>Coded rationale'+(rationales.length>1?'s':'')+':</span> '+rationaleHTML([e])+'</p>'+duration+
      '<div class="location-card-links">'+(linked.length?'<div class="location-sources"><span class="location-sources-label">Sources</span><div class="location-source-list">'+sourceHTML+'</div></div>':'')+
      '<button type="button" class="location-record-link" data-record-id="'+escape(e.id)+'">Full record <span aria-hidden="true">→</span></button></div></article>';
  }
  function locationRecords(items){return [...items].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||(text(a.start)||'9999').localeCompare(text(b.start)||'9999')||a.id.localeCompare(b.id));}
  function openLocationCard(id,items,latlng,focusCard=false){
    if(!data.meta.web_assets){renderLocationCard(id,items,latlng,focusCard);return;}
    stop();map.closePopup();
    const content=document.createElement('div');content.setAttribute('role','status');content.textContent='Loading closure details…';
    const loading=L.popup({className:'location-popup',maxWidth:280}).setLatLng(latlng).setContent(content).openOn(map);
    const first=locationRecords(items).slice(0,1);
    Promise.all(first.map(e=>window.AtlasData.getRecord(e.id))).then(records=>{
      if(!map.hasLayer(loading))return;
      const complete=new Map(records.map(e=>[e.id,e]));
      renderLocationCard(id,items.map(e=>complete.get(e.id)||e),latlng,focusCard);
    }).catch(error=>{
      if(!map.hasLayer(loading))return;
      content.textContent=error.message+' ';
      const retry=document.createElement('button');retry.textContent='Try again';retry.addEventListener('click',()=>openLocationCard(id,items,latlng,focusCard));content.append(retry);loading.update();
    });
  }
  function renderLocationCard(id,items,latlng,focusCard=false){
    const f=locations.get(id),p=f.properties||{},style=K.symbolStyle(p),mobile=compact();
    const sorted=locationRecords(items);
    const card=document.createElement('div');card.className='location-card';
    const locationMeta=items.length>1?'Showing 1 of '+items.length+' matching records':'';
    card.innerHTML='<h2>'+escape(locationTitle(p,id))+'</h2>'+(locationMeta?'<div class="location-card-meta">'+escape(locationMeta)+'</div>':'')+'<div class="location-card-records">'+sorted.slice(0,1).map(locationRecordHTML).join('')+'</div>';
    for(const button of card.querySelectorAll('[data-record-id]'))button.addEventListener('click',()=>{map.closePopup();showEvent(button.dataset.recordId,false);$('back-button').focus();});
    let action=card.querySelector('[data-record-id]');
    if(items.length>1){
      action=document.createElement('button');action.type='button';action.className='location-card-action';action.textContent='View all '+items.length+' records →';
      action.addEventListener('click',()=>{map.closePopup();activateLocation(id,items);});card.append(action);
    }
    const notes=document.createElement('p');notes.className='location-map-note';
    notes.textContent=p.display_role==='national_policy'?'The outline marks the country or area covered by the rule. Read the record for the travellers and journeys affected.':'The line locates the border. The description identifies the affected crossings and travellers.';card.append(notes);
    stop();map.closePopup();cardLocation=id;renderLocations();if(mobile)setPanelOpen(false);
    const padding=viewPadding();
    const availableHeight=$('map-page').getBoundingClientRect().height-padding.paddingTopLeft[1]-padding.paddingBottomRight[1]-58;
    const popup=L.popup({className:'location-popup',maxWidth:Math.min(400,window.innerWidth-48),minWidth:Math.min(280,window.innerWidth-72),maxHeight:Math.max(90,Math.min(mobile?400:520,availableHeight)),offset:L.point(0,-7),autoPanPaddingTopLeft:L.point(16,padding.paddingTopLeft[1]),autoPanPaddingBottomRight:L.point(padding.paddingBottomRight[0],padding.paddingBottomRight[1]),closeButton:true}).setLatLng(latlng).setContent(card);
    popup.on('remove',()=>{cardLocation='';renderLocations();if(focusCard&&document.activeElement===document.body){const marker=[...document.querySelectorAll('.closure-marker')].find(el=>el.dataset.locationId===id);if(marker)marker.focus({preventScroll:true});}});
    card.addEventListener('toggle',()=>popup.update(),true);
    popup.openOn(map);if(focusCard&&action)action.focus({preventScroll:true});
  }
  function renderLocations(){
    if(featureGroup)map.removeLayer(featureGroup);featureGroup=L.featureGroup().addTo(map);
    // Area hit targets come first, so specific land lines stay clickable above
    // them. Use the shared interaction pane, above the non-interactive basemap.
    const orderedLocations=[...locationEvents].sort(([a],[b])=>Number(locations.get(b)?.properties.display_role==='national_policy')-Number(locations.get(a)?.properties.display_role==='national_policy'));
    for(const [id,items] of orderedLocations){
      const f=locations.get(id);if(!K.isLineReference(f))continue;
      const styleRecords=(selected&&items.some(e=>e.id===selected)?items.filter(e=>e.id===selected):items).map(e=>({...e,duration_periods:C.periodsForView(e,state)}));
      const p=f.properties||{},isSelected=id===cardLocation||id===state.location||items.some(e=>e.id===selected),style=K.symbolStyle(p,{selected:isSelected,count:items.length,records:styleRecords,rationaleFilter:state.rationale});
      const timePossible=state.mode==='intervals'&&items.every(e=>C.temporalState(e,state.month,state.measureType)==='possible');
      const label=locationTitle(p,id);
      const tooltip='<strong class="map-tip-title">'+escape(label)+'</strong><span class="map-tip-meta">'+items.length+' record'+(items.length===1?'':'s')+'</span>'+rationaleHTML(items)+(style.rationale.hasUncoded&&style.rationale.codes.length?'<span class="map-tip-meta">Some records uncoded</span>':'')+(timePossible?'<span class="map-tip-meta">Possible month overlap</span>':'')+'<span class="map-tip-hint">Click for records &amp; sources →</span>';
        const pane=style.country?'countryContext':'scope';
        // A wider transparent stroke keeps thin or dashed geography clickable.
        // Country interiors do not become inferred closure footprints.
        const target=L.geoJSON(f,{pane:'scope',style:{color:style.colour,weight:compact()?22:16,opacity:0,fill:style.national,fillOpacity:0,className:'geography-hit'}}).addTo(featureGroup);
        if(isSelected)L.geoJSON(f,{pane,interactive:false,style:{color:'#ffffff',weight:style.width+3,opacity:.95,fill:false}}).addTo(featureGroup);
        L.geoJSON(f,{pane,interactive:false,style:{className:style.national?'national-policy-area':style.frontier?'frontier-reference':'location-reference',color:style.colour,weight:style.width,opacity:timePossible?.3:style.opacity,dashArray:style.dash.join(' '),lineCap:'round',fill:false}}).addTo(featureGroup);
      target.bindTooltip(tooltip,{direction:'top',offset:[0,-10]});
      target.on('click',e=>openLocationCard(id,items,e.latlng||target.getLatLng(),/^key/.test(e.originalEvent?.type||'')));
    }
  }
  function updateRecordsControls(){
    for(const id of ['download-records','download-reader-records']){$(id).disabled=exportingRecords||!visible.length;$(id).textContent=exportingRecords?'Preparing…':'Download CSV';}
    $('read-records').disabled=!visible.length;
    const location=locations.get(state.location);
    const scope=location?locationTitle(location.properties,state.location):state.query.trim()?'Search: “'+state.query.trim()+'”':state.continent||'World';
    $('records-heading').textContent=scope;
    $('records-caption').textContent=visible.length+' matching record'+(visible.length===1?'':'s')+' · '+(state.mode==='all'?'All recorded closures':(state.mode==='onsets'?'Closures beginning':'Border Restrictions')+' · '+monthLabel(state.month));
  }
  function openRecords(){
    if(!data)return;stop();map.closePopup();
    const dialog=$('records-dialog');
    updateRecordsControls();
    if(!dialog.open){recordsReturnFocus=document.activeElement;recordsPanelScroll=$('explore-panel').scrollTop;$('records-body').appendChild($('panel-scroll'));dialog.showModal();$('records-close').focus();}
    $('continent-panel').setAttribute('role','region');$('continent-panel').setAttribute('aria-labelledby','records-heading');
  }
  async function downloadRecords(){
    if(!data||!visible.length||exportingRecords)return;stop();
    const ids=visible.map(e=>e.id),snapshot={...state},source=data,location=locations.get(state.location);
    const locationLabel=location?locationTitle(location.properties,state.location):'';
    exportingRecords=true;updateRecordsControls();
    try{
      const full=visible.every(e=>e.record_kind==='national_policy')?{meta:source.meta,events:visible}:await window.AtlasData.getResearchData({includeNational:true}),byID=new Map(full.events.map(e=>[e.id,e]));
      if(full.meta.source_sha256!==source.meta.source_sha256||ids.some(id=>!byID.has(id)))throw Error('The records do not match this atlas version. Please reload and try again.');
      const output=window.BorderRecordExport.build({records:ids.map(id=>byID.get(id)),state:snapshot,locationLabel,cleanText:publicText,recordURL:id=>id.startsWith('NATIONAL-')?new URL('#map/record-'+encodeURIComponent(id),window.location.href).href:window.AtlasNavigation.getAnalysisURL('#record-'+id)});
      window.BorderRecordExport.download(output);notify('Downloaded '+ids.length+' matching records as a CSV spreadsheet.');
    }catch(error){notify(error.message||'The spreadsheet could not be prepared. Please try again.');}
    finally{exportingRecords=false;updateRecordsControls();}
  }
  function setRecordView(active){
    $('map-page').classList.toggle('detail-open',active);
    $('browse-panel').hidden=active;$('detail-panel').hidden=!active;
    updatePanelTitle(active);
    const reading=$('records-dialog').open;
    $('continent-panel').setAttribute('role',active||reading?'region':'tabpanel');
    $('continent-panel').setAttribute('aria-labelledby',reading?'records-heading':active?'panel-title':'tab-'+(state.continent||'World').toLowerCase().replaceAll(' ','-'));
    if($('map-search').parentNode===$('panel-search-slot')&&!$('map-page').hidden)document.querySelector('.skip-link').href=$('map-page').classList.contains('panel-collapsed')?'#panel-toggle':active?'#back-button':'#search';
    scheduleViewport();
  }
  function showBrowse(){const wasRecord=Boolean(selected);selected=null;setRecordView(false);if(wasRecord)$('panel-scroll').scrollTop=recordsListScroll;if(data)renderLocations();}
  function field(title,value){value=publicText(value,title,selected);return value?'<section class="detail-field"><h3>'+escape(title)+'</h3><p>'+escape(text(value))+'</p></section>':'';}
  function nationalDetailHTML(e){
    const main=e.duration_periods.find(p=>p.national_display_period),sources=eventSources(e);
    return '<div class="detail-id">National border rules · '+escape(e.countries.join(' – '))+'</div><h2 class="detail-title">'+escape(e.title)+'</h2><p class="event-summary">'+escape(e.national_summary)+'</p>'+rationaleHTML([e])+
      (e.national_kind==='entry_conditions'?'<p class="qualification">Entry conditions only — this is not an additional border closure.</p>':'')+
      (main?'<section class="detail-field"><h3>Dates</h3>'+cardPeriodHTML(main)+'</section>':'<p class="qualification">Shown only in months with a recorded policy change. No continuous interval is inferred.</p>')+
      (e.linked_land_ids.length?field('Linked record',e.relationship):'')+
      '<section class="detail-field"><h3>What changed, and who was affected?</h3><ol class="national-history">'+e.national_observations.map(r=>'<li><strong>'+escape(dateText(r['Effective date']))+'</strong><p>'+escape(r['Dated policy change'])+'</p><p><b>Affected:</b> '+escape(r['Affected people'])+'</p><details><summary>Exceptions and evidence</summary><p><b>Exceptions:</b> '+escape(r.Exceptions)+'</p><p><b>Applies to:</b> '+escape(r.Jurisdiction)+'. '+escape(r['Supported modes'].replace(/;/g,',').replace(/international_rail/g,'international rail'))+'.</p><p>'+escape(r['Remaining evidence need'])+'</p>'+String(r['Source URLs']).split('\n').filter(safeURL).map(url=>{const s=sources.find(s=>s.url===url);return '<p><a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(s?.publisher||new URL(url).hostname)+' ↗</a></p>';}).join('')+'</details></li>').join('')+'</ol></section>'+
      '<section class="detail-field"><h3>Sources</h3><ul>'+sources.map(s=>'<li><a href="'+escape(s.url)+'" target="_blank" rel="noopener noreferrer">'+escape(s.publisher)+': '+escape(s.label)+' ↗</a></li>').join('')+'</ul></section>'+field('How this appears on the map',e.geography_note+' Policy histories are kept separate from the land-border duration charts.');
  }
  function openSharedRecord(){
    const match=location.hash.match(/^#map\/record-(NATIONAL-[A-Za-z0-9_-]+)$/);
    if(!data||!match||!events.some(e=>e.id===match[1]))return;
    window.AtlasNavigation.show('map',{address:false});resetFilters();populateRegions();state.mode='all';$('time-mode').value='all';render();showEvent(match[1],true);
  }
  window.addEventListener('hashchange',openSharedRecord);
  async function showEvent(id,zoom){
    if(!events.some(v=>v.id===id))return;map.closePopup();stop();if(!selected)recordsListScroll=$('panel-scroll').scrollTop||0;selected=id;
    openRecords();
    setRecordView(true);setPanelOpen(true);
    $('event-detail').innerHTML='<p role="status">Loading closure details…</p>';
    $('panel-scroll').scrollTop=0;$('back-button').focus({preventScroll:true});
    let e;
    try{e=await window.AtlasData.getRecord(id);}catch(error){
      if(selected!==id)return;
      $('event-detail').innerHTML='<p role="status">'+escape(error.message)+'</p>';
      const retry=document.createElement('button');retry.textContent='Try again';retry.addEventListener('click',()=>showEvent(id,zoom));$('event-detail').append(retry);return;
    }
    if(selected!==id)return;
    if(e.record_kind==='national_policy'){
      $('event-detail').innerHTML=nationalDetailHTML(e);renderLocations();
      if(zoom){const features=mapLocationIDs(e).map(lid=>locations.get(lid));if(features.length)map.fitBounds(L.geoJSON({type:'FeatureCollection',features}).getBounds(),{...viewPadding(12),maxZoom:6,animate:false});}
      return;
    }
    const ids=C.displayLocationsFor(e,data).filter(v=>locations.has(v));
    const reasonLabels={continuity_flag_missing_review_required:'Continuous closure has not been confirmed for the recorded dates.',continuity_claim_not_supported_or_qualified:'The evidence does not establish continuous closure over these dates.',end_claim_not_supported_or_qualified:'The reopening date is not sufficiently supported.',endpoint_not_operational_or_partial_reopening:'The endpoint is not classified as an operational or partial reopening.',exact_compatible_dates_missing:'Exact compatible start and end dates are missing.',explicit_continuity_false:'Continuous closure is not supported by the sources.',no_source_calculated_interval:'No supported duration is available.',same_day_or_nonpositive_date_interval:'A same-day or nonpositive date interval is not displayed as a whole-day closure.',start_claim_not_supported_or_qualified:'The start date is not sufficiently supported.'};
    const humanStatus=v=>text(v).replace(/_/g,' ');
    const reasons=C.array(e.interval_exclusion_reasons).map(r=>reasonLabels[r]||humanStatus(r)).join(' ');
    const intervalLead=C.excluded(e)?'Excluded from animation.':C.intervalEligible(e)?'Included: '+dateText(e.interval_start)+' to '+dateText(e.interval_end)+'.':e.interval_status==='source_interval_needs_mapping_review'?'Not shown in the interval view.':'Not shown in the interval view.';
    let temporal=intervalLead+(reasons?' '+reasons:'')+(e.interval_basis?' '+publicText(e.interval_basis,'interval_basis',e.id):'');
    if(C.array(e.duration_periods).length)temporal=e.duration_periods.map(p=>C.measureLabel(p.measure_type)+' · '+p.period_id+'\n'+cardPeriodDates(p)+'\n'+p.display+'\nScope: '+p.scope+'\nObserved reopening: '+p.observed_reopening+'. Endpoint inclusion: '+p.endpoint_inclusion+'.\n'+p.basis+' '+p.qualification+(p.reported_duration?'\nReported duration: '+p.reported_duration:'')+(p.reported_schedule?'\nReported schedule: '+p.reported_schedule:'')+'\n'+p.map_scope_note).join('\n\n');
    else if(e.duration_review)temporal=e.duration_review.display+'. '+e.duration_review.next_step;
    const onset=C.excluded(e)?'Excluded from timeline views.':C.monthOrdinal(e.onset_month)!==null?'Shown in '+monthLabel(C.monthOrdinal(e.onset_month))+'. The recorded date precision is retained.':'No sufficiently supported start month is available.';
    const sources=eventSources(e);for(const p of C.array(e.duration_periods))for(const url of C.array(p.source_urls))if(safeURL(url)&&!sources.some(s=>s.url===url))sources.push({url,label:'Duration evidence: '+new URL(url).hostname.replace(/^www\./,'')});
    const locHTML=ids.length?ids.map(lid=>{
      const f=locations.get(lid),p=f.properties||{},u=safeURL(p.source_url);
      const eventLinks=C.array(data.links).filter(link=>link.event_id===e.id&&link.location_id===lid);
      const linkNotes=[...new Set(eventLinks.flatMap(link=>[link.geography_note===e.geography_note?null:link.geography_note]).filter(Boolean))];
      const qualifications=[...new Set([p.scope_note,p.review_note,p.boundary_status?('Boundary status: '+text(p.boundary_status)):null].filter(Boolean))];
      return '<section class="detail-field"><h3>Map location</h3><p>'+escape(p.label||p.name||lid)+'<br><span class="date-meaning">'+escape(publicText(p.precision||'Precision not supplied','precision',e.id))+'</span></p>'+(linkNotes.length?'<div class="qualification">'+linkNotes.map(note=>'<p>'+escape(publicText(note,'geography_note',e.id))+'</p>').join('')+'</div>':'')+qualifications.map(note=>'<p>'+escape(publicText(note,'geography_note',e.id))+'</p>').join('')+(u?'<p><a href="'+escape(u)+'" target="_blank" rel="noopener noreferrer">'+escape(p.source_name||p.source_label||'Location source')+' ↗</a></p>':'')+'</section>';
    }).join(''):field('Map location',C.excluded(e)?'This record is excluded from the map.':'The exact location has not been established.');
    const currentReview=e.current_review||{};
    const currentFindings=C.array(e.followup_reviews).map(r=>field('Review · '+(r['Completed (UTC)']||''),(r['Adjudicated outcome']||'')+'\n'+(r['Research finding']||'')+'\n'+(r['Root decision']||'')+'\n'+(r['Issue dispositions']||''))).join('')||field('Review',currentReview.outcome);
    const historical=e.historical||{};
    const description=window.BorderSummary?.describe(e),allPeriods=C.array(e.duration_periods),first=allPeriods.find(p=>!p.contested)||allPeriods[0],other=allPeriods.filter(p=>p!==first);
    const datesHTML=first?cardPeriodHTML(first)+(other.length?'<details class="location-extra-periods"><summary>'+other.length+' more dated stage'+(other.length===1?'':'s')+'</summary>'+other.map(cardPeriodHTML).join('')+'</details>':''):'<p>Dates and duration are not established.</p>';
    const scopes=[...new Set(allPeriods.map(p=>text(p.scope)).filter(Boolean))],movements=[...new Set(allPeriods.map(p=>text(p.movement)).filter(Boolean))];
    const scopeHTML=scopes.length===1?field('Crossings and geographical scope',scopes[0]):scopes.length>1?'<details class="detail-field"><summary>Locations and traffic by dated stage</summary>'+allPeriods.map(p=>field(cardPeriodDates(p),[p.scope,p.movement].filter(Boolean).join('\n'))).join('')+'</details>':field('Crossings and geographical scope',e.scope);
    const movementHTML=movements.length===1?field('Affected movement',movements[0]):!allPeriods.length?field('Affected movement',e.movement):'';
    $('event-detail').innerHTML='<div class="detail-id">'+escape(e.id)+(e.countries.length?' · '+escape(e.countries.join(' – ')):'')+'</div><h2 class="detail-title">'+escape(publicText(e.title||e.id,'title',e.id))+'</h2>'+(description?'<p class="event-summary">'+escape(description)+'</p>':'')+(C.excluded(e)?'<p class="qualification">Excluded from mapping and analysis. '+escape(e.quarantine_reason||'')+'</p>':'')+
      '<section class="detail-field"><h3>Coded rationale</h3><p>'+rationaleHTML([e])+'</p></section><section class="detail-field"><h3>Dates and duration</h3>'+datesHTML+'</section>'+scopeHTML+movementHTML+
      (sources.length?'<section class="detail-field"><h3>Sources</h3><ul>'+sources.map(s=>'<li><a href="'+escape(s.url)+'" target="_blank" rel="noopener noreferrer">'+escape(s.label||new URL(s.url).hostname.replace(/^www\./,''))+' ↗</a></li>').join('')+'</ul></section>':'')+
      '<details class="detail-field"><summary>Detailed timing evidence</summary>'+field('Dates, sources and qualifications',temporal)+'</details>'+
      '<details class="detail-field"><summary>Rationale and context</summary>'+field('Stated justification',e.official_rationale)+field('Context',e.context)+field('Overall record scope',e.scope)+field('Direction',e.direction)+field('Exceptions',e.exceptions)+field('Rationale subcategories',Object.entries(e.rationale_subcategories||{}).map(([k,v])=>k+': '+v.join('; ')).join('\n'))+field('Attribution and phase',C.array(e.rationale_assignments).map(a=>a['Broad rationale']+': '+a['Evidence attribution']+'. '+a['Phase / overlap']+'. '+a['Coding decision and qualification']).join('\n\n'))+'</details>'+
      '<details class="detail-field"><summary>Uncertainty and review notes</summary>'+field('What remains uncertain',e.uncertainty)+currentFindings+field('Open evidence needs',C.array(e.unresolved_issues).map(q=>q['Field needing evidence']+': '+q['Unresolved finding']+' '+q['Next evidence needed']).join('\n\n'))+'</details>'+
      '<details class="detail-field"><summary>Scope and map notes</summary><p>'+escape(publicText(e.geography_note,'geography_note',e.id))+'</p>'+mapLocationNote(e)+field('Start-month view',onset)+field('Linked policy or phase',e.relationship)+locHTML+'</details>'+
      '<details class="detail-field"><summary>Earlier dates and claims</summary><p>These original claims are retained in the workbook. The corrected dates and findings above take precedence.</p>'+field('Original start',dateText(historical.start))+field('Original end date',dateText(historical.end))+field('What that end date meant',historical.endpoint)+field('Original duration qualification',historical.duration_note)+field('Historical evidence assessment',historical.evidence_status)+C.array(e.initial_review?.claims).map(c=>field('Initial '+c.field+' · '+c.assessment,c.note)).join('')+'</details>';

    setPanelOpen(true);$('browse-panel').hidden=true;$('detail-panel').hidden=false;$('panel-scroll').scrollTop=0;renderLocations();
    const focusIDs=mapLocationIDs(e);
    if(zoom&&focusIDs.length){const layer=L.geoJSON({type:'FeatureCollection',features:focusIDs.map(lid=>locations.get(lid))});const b=layer.getBounds();if(b.isValid())map.fitBounds(b,{...viewPadding(12),maxZoom:6,animate:false});}

  }
  function changeMonth(n){state.month=Math.max(Number($('month-slider').min),Math.min(Number($('month-slider').max),n));resetList();render();}
  $('search').addEventListener('input',e=>{
    stop();state.query=e.target.value;state.location='';
    if(state.query.trim()){state.mode='all';$('time-mode').value='all';setPanelOpen(true);}
    resetList();showBrowse();render();
  });
  $('region').addEventListener('change',e=>{state.region=e.target.value;resetList();render();});$('rationale').addEventListener('change',e=>{state.rationale=e.target.value;resetList();render();});$('time-mode').addEventListener('change',e=>{stop();state.mode=e.target.value;resetList();render();});$('month-slider').addEventListener('input',e=>{stop();changeMonth(Number(e.target.value));});$('previous-button').addEventListener('click',()=>{stop();changeMonth(state.month-1);});$('next-button').addEventListener('click',()=>{stop();changeMonth(state.month+1);});
  $('measure-type').addEventListener('change',e=>{state.measureType=e.target.value;resetList();render();});
  $('search').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&compact()){e.preventDefault();e.currentTarget.blur();$('panel-scroll').scrollTop=0;scheduleViewport();}});
  $('search').addEventListener('focus',scheduleViewport);$('search').addEventListener('blur',scheduleViewport);
  $('precision').addEventListener('change',e=>{state.precision=e.target.value;resetList();render();});$('include-excluded').addEventListener('change',e=>{state.includeExcluded=e.target.checked;resetList();render();});$('show-more').addEventListener('click',()=>{listLimit+=50;renderList();});
  $('play-button').addEventListener('click',()=>{
    if(!data)return;if(timer){stop();return;}
    if(state.mode==='all'){state.mode='intervals';$('time-mode').value='intervals';}
    const min=Number($('month-slider').min),max=Number($('month-slider').max);
    setPlayback(true);changeMonth(state.month>=max?min:state.month+1);
    if(state.month>=max){stop();return;}
    schedulePlayback();
  });
  $('playback-speed').addEventListener('change',event=>{
    const rate=Number(event.target.value);playbackRate=[1,2,4,8].includes(rate)?rate:1;
    if(timer)schedulePlayback();
  });
  $('back-button').addEventListener('click',showBrowse);$('fit-button').addEventListener('click',fitRecords);$('clear-location').addEventListener('click',()=>{state.location='';resetList();render();});$('reset-button').addEventListener('click',()=>{stop();resetFilters();populateRegions();showBrowse();render();fitContinent();});
  $('read-records').addEventListener('click',openRecords);
  $('download-records').addEventListener('click',downloadRecords);$('download-reader-records').addEventListener('click',downloadRecords);
  $('records-close').addEventListener('click',()=>$('records-dialog').close());
  $('records-dialog').addEventListener('close',()=>{
    $('explore-panel').insertBefore($('panel-scroll'),$('map-key'));showBrowse();$('explore-panel').scrollTop=recordsPanelScroll;scheduleViewport();
    if(!$('map-page').hidden){const target=recordsReturnFocus?.isConnected?recordsReturnFocus:$('map-page').classList.contains('panel-collapsed')?$('panel-toggle'):$('read-records');target.focus({preventScroll:true});}
    recordsReturnFocus=null;
  });
  const showPage=page=>window.AtlasNavigation.show(page);
  let mapHasBeenVisible=!$('map-page').hidden;
  window.addEventListener('atlas:pagechange',event=>{
    if(event.detail.page!=='analysis')loadMap();
    stop();if(event.detail.page!=='map'){if(keyDialog.open)keyDialog.close();if($('records-dialog').open)$('records-dialog').close();return;}scheduleViewport();
    if(!mapHasBeenVisible){mapHasBeenVisible=true;requestAnimationFrame(()=>{syncViewport();if(data)fitContinent();});}
  });
  $('save-view-button').addEventListener('click',async()=>{
    if(!data||!window.BorderExport)return;stop();map.closePopup();
    const button=$('save-view-button');button.disabled=true;button.textContent='Preparing…';
    try{
      const snapshot=window.BorderExport.capture({map,data,visible,locationEvents,selected,state,labels:labelSpecs(),viewport:exportViewport()});
      const full=snapshot.events.every(e=>e.record_kind==='national_policy')?{events:snapshot.events}:await window.AtlasData.getResearchData({includeNational:true}),byID=new Map(full.events.map(e=>[e.id,e]));
      snapshot.events=snapshot.events.map(e=>byID.get(e.id));window.BorderExport.openSnapshot(snapshot);
    }catch(error){notify(error.message);}finally{button.disabled=false;button.textContent='Save view';}
  });
  $('panel-toggle').addEventListener('click',()=>{if(compact())stop();setPanelOpen(true);});
  $('collapse-panel').addEventListener('click',()=>{setPanelOpen(false);$('panel-toggle').focus();});
  $('coding-note-button').addEventListener('click',()=>{showPage('briefing');requestAnimationFrame(()=>$('rationale-coding').scrollIntoView({behavior:'smooth',block:'center'}));});
  setPanelOpen(!compact());$('map-key').open=!compact();$('record-filters').open=false;
  compactMedia.addEventListener('change',()=>{
    if(keyDialog.open)keyDialog.close();
    if(compact()){desktopKeyOpen=$('map-key').open;$('map-key').open=false;setPanelOpen(false);}
    else{$('map-key').open=desktopKeyOpen;setPanelOpen(desktopPanelOpen);}
    map.closePopup();scheduleViewport();
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||document.querySelector('dialog[open]')||$('map-page').hidden)return;
    if(cardLocation){map.closePopup();e.preventDefault();}
    else if(!$('map-page').classList.contains('panel-collapsed')){setPanelOpen(false);$('panel-toggle').focus();e.preventDefault();}
  });
  map.on('movestart zoomstart',()=>{if(labelLayer)labelLayer.hidden=true;});
  map.on('moveend zoomend',renderLabels);
  map.on('popupopen',()=>$('map-page').classList.add('location-card-open'));
  map.on('popupclose',()=>$('map-page').classList.remove('location-card-open'));
  window.addEventListener('resize',scheduleViewport);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',scheduleViewport);
  if(window.ResizeObserver){const observer=new ResizeObserver(scheduleViewport);observer.observe(document.querySelector('.masthead'));observer.observe(document.querySelector('.timeline'));}
  syncViewport();
  if(document.fonts)document.fonts.ready.then(()=>{scheduleViewport();renderLabels();});

  let loadingMap=null;
  function loadMap(){
    if(data||loadingMap)return;
    window.AtlasStartup?.start();
    loadingMap=window.AtlasData.ready().then(value=>{
      applyData(value);window.AtlasStartup?.ready();window.dispatchEvent(new CustomEvent('atlas:mapready'));
    }).catch(err=>{window.AtlasStartup?.fail(err);$('result-context').textContent='The atlas could not be opened. Please try again.';notify(err.message);}).finally(()=>{loadingMap=null;});
  }
  // A direct Analysis link should not download or draw map geometry first.
  if(document.body.dataset.page!=='analysis')loadMap();
  window.BORDER_VIEWER={getData:()=>data,getState:()=>({...state}),getVisible:()=>visible.map(e=>e.id),load:applyData,map};
})();


