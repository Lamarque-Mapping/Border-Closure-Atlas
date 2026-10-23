(function(){
  'use strict';
  const COLOURS={...window.BorderCartography.colours,paper:'#ffffff'};
  const FONT='Atlas, Arial, Helvetica, sans-serif';
  const publicTitle=e=>window.BorderPublic?window.BorderPublic.text(e.title||e.id,'title',e.id):(e.title||e.id);
  const emptyFC=()=>({type:'FeatureCollection',features:[]});
  const monthLabel=n=>new Date(Date.UTC(Math.floor(n/12),n%12,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const dateLabel=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?new Date(s+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):String(s||'Unknown');
  const copy=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
  let dialog=null,current=null,imageURL=null,notesURL=null,busy=false,lastFocus=null;

  function cropRect(size,requested){
    const rect=requested||{x:0,y:0,width:size.x,height:size.y};
    if(!['x','y','width','height'].every(key=>Number.isFinite(rect[key]))||rect.width<=0||rect.height<=0)throw new Error('The visible map area is not ready to save.');
    const x=Math.max(0,rect.x),y=Math.max(0,rect.y),right=Math.min(size.x,rect.x+rect.width),bottom=Math.min(size.y,rect.y+rect.height);
    if(right<=x||bottom<=y)throw new Error('The visible map area is not ready to save.');
    return {x,y,width:right-x,height:bottom-y};
  }

  // Capture every map-dependent value before an asynchronous render starts. The
  // projection below is the same spherical Mercator projection used by Leaflet.
  function capture(input){
    const {map,data,visible=[],locationEvents=new Map(),selected=null,state={},labels=[]}=input;
    if(!map||!data)throw new Error('The map is not ready yet.');
    const size=map.getSize();
    if(!(size.x>0&&size.y>0))throw new Error('Open the map before saving a view.');
    const viewport=cropRect(size,input.viewport),zoom=map.getZoom(),pixelOrigin=map.getPixelBounds().min;
    // Crop the existing projected view. Never resize the live map or refit its
    // bounds: the records panel covers part of the canvas without changing it.
    const origin={x:pixelOrigin.x+viewport.x,y:pixelOrigin.y+viewport.y};
    const northWest=map.containerPointToLatLng([viewport.x,viewport.y]),southEast=map.containerPointToLatLng([viewport.x+viewport.width,viewport.y+viewport.height]);
    const croppedLabels=labels.map(label=>({...label,x:label.x-viewport.x,y:label.y-viewport.y})).filter(label=>{
      const halfWidth=label.text.length*label.fontSize*.28,halfHeight=label.fontSize/2;
      return label.x-halfWidth>=0&&label.x+halfWidth<=viewport.width&&label.y-halfHeight>=0&&label.y+halfHeight<=viewport.height;
    });
    const lookup=new Map([...(data.locations?.features||[]),...(data.context_locations?.features||[])].map(f=>[f.properties?.location_id,f]));
    const references=[];
    for(const [id,items] of locationEvents){
      const feature=lookup.get(id);if(!window.BorderCartography.isLineReference(feature))continue;
      const styleItems=(selected&&items.some(e=>e.id===selected)?items.filter(e=>e.id===selected):items).map(e=>({...e,duration_periods:window.BorderCore.periodsForView(e,state)}));
      references.push({feature:copy(feature),rationale:window.BorderCartography.rationaleStyle(styleItems,state.rationale),scope:window.BorderCartography.scopeStyle(styleItems),count:items.length,timePossible:state.mode==='intervals'&&items.every(e=>window.BorderCore?.temporalState(e,state.month,state.measureType)==='possible'),selected:id===state.location||items.some(e=>(typeof e==='string'?e:e.id)===selected)});
    }
    const middle=viewport.y+viewport.height/2;
    const metresPer100=map.distance(map.containerPointToLatLng([viewport.x,middle]),map.containerPointToLatLng([viewport.x+100,middle]));
    return {labels:copy(croppedLabels),size:{x:viewport.width,y:viewport.height},viewport,origin,zoom,worldSize:256*Math.pow(2,zoom),bounds:{west:northWest.lng,south:southEast.lat,east:southEast.lng,north:northWest.lat},metresPer100,meta:copy({window_start:data.meta?.window_start,window_end:data.meta?.window_end,source_filename:data.meta?.source_filename,source_sha256:data.meta?.source_sha256}),state:copy(state),selected,events:copy(visible),references,countries:copy(data.countries||emptyFC()),borders:copy(data.borders||emptyFC()),disputed:copy(data.disputed||emptyFC()),capturedAt:new Date().toISOString()};
  }
  function project(coordinate,snapshot){
    const lng=Number(coordinate[0]),lat=Math.max(-85.0511287798,Math.min(85.0511287798,Number(coordinate[1])));
    const sin=Math.sin(lat*Math.PI/180);
    return [snapshot.worldSize*(lng/360+.5)-snapshot.origin.x,snapshot.worldSize*(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))-snapshot.origin.y];
  }
  function niceDistance(value){
    if(!(value>0))return 0;
    const power=Math.pow(10,Math.floor(Math.log10(value))),n=value/power;
    return (n>=5?5:n>=2?2:1)*power;
  }
  function timeDescription(snapshot){
    if(snapshot.state.mode==='onsets')return 'Closures beginning in '+monthLabel(snapshot.state.month);
    if(snapshot.state.mode==='intervals')return 'Dated evidence periods overlapping '+monthLabel(snapshot.state.month);
    return dateLabel(snapshot.meta.window_start)+' – '+dateLabel(snapshot.meta.window_end)+' · All recorded closures';
  }
  function filterDescription(snapshot){
    const s=snapshot.state,filters=[];
    if(s.region)filters.push('Region: '+s.region);
    if(s.rationale)filters.push('Coded Rationale: '+s.rationale);
    if(s.measureType)filters.push('Timing evidence: '+window.BorderCore.measureLabel(s.measureType));
    if(s.query)filters.push('Search: “'+s.query+'”');
    const precision={crossing_reference:'Sourced crossing or policy geography',context:'Border or country reference',unlocated:'Unlocated records'};
    if(s.precision)filters.push(precision[s.precision]||s.precision);
    if(s.location){const ref=snapshot.references.find(r=>r.feature.properties?.location_id===s.location);filters.push('Location: '+(ref?.feature.properties?.label||ref?.feature.properties?.name||'selected map reference'));}
    if(s.includeExcluded&&s.mode==='all')filters.push('Excluded records included in list only');
    return filters;
  }
  function hasPIDA(snapshot){return snapshot.references.some(ref=>{const p=ref.feature.properties||{};return [p.source_url,...(p.sources||[]).map(s=>s.url)].some(url=>/^https?:\/\/(?:[^/]+\.)?au-pida\.org(?:\/|$)/i.test(url||''));});}
  function notes(snapshot,title){
    const lines=[title,timeDescription(snapshot),'Continent: '+(snapshot.state.continent||'World'),...filterDescription(snapshot),'','Selection: '+snapshot.events.length+' records; '+snapshot.references.length+' map references. Counts refer to the filtered selection; references outside the saved extent are not drawn.','Extent (degrees; unwrapped longitude): '+JSON.stringify(snapshot.bounds),'Projection: Web Mercator. Scale bar is approximate at the centre latitude.','Saved: '+snapshot.capturedAt,'Workbook: '+snapshot.meta.source_filename,'Workbook SHA-256: '+snapshot.meta.source_sha256,'','Reading the map','Unmarked does not mean open. Frontier and country shapes provide context, not exact closure footprints. Present-day reference boundaries do not establish historical territorial control or sovereignty. Unknown endpoints are not extended to the present. Month views do not imply closure throughout the month. Announced dates are schedules, not confirmed implementation. Repeated closures can include openings; their total days closed are unknown.','Line colours show coded rationales. Multiple rationales can span records and dates. Solid lines mean the selected evidence states border-wide scope; dotted lines mean limited or uncertain geographical scope. Both locate the border rather than the exact affected section. Crossing points are not displayed.','', 'Mapping by Hugh Lamarque','Base geography: Natural Earth — https://www.naturalearthdata.com/ (public domain)','Crossing references: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright (ODbL), with additional references below.','','EVENT REFERENCES'];
    if(hasPIDA(snapshot))lines.splice(lines.indexOf('EVENT REFERENCES'),0,'Crossing project markers: AU-PIDA — https://map.au-pida.org/','');
    for(const event of snapshot.events){
      lines.push('',event.id+' — '+publicTitle(event),'Current review: '+(event.current_review?.outcome||'Not recorded'),'Analysis inclusion: '+(event.quarantined?'Excluded':'Included'));
      if(event.crossings)lines.push('Recorded crossings: '+event.crossings);
      if(event.scope)lines.push('Recorded scope: '+(window.BorderPublic?window.BorderPublic.text(event.scope,'Geographical scope',event.id):event.scope));
      for(const period of event.duration_periods||[])lines.push('Phase: '+period.period_id+' · '+window.BorderCore.measureLabel(period.measure_type)+(period.contested?' · Held / contested; recorded dates only':''),'Duration: '+window.BorderPublic.text(period.display,'duration'),'Start bounds: '+period.start_earliest+' to '+period.start_latest,(period.kind==='confirmed_through'||period.endpoint_status==='last_confirmed')?'Last confirmed: '+period.last_confirmed+'; reopening unknown':'Endpoint bounds: '+period.end_earliest+' to '+period.end_latest,'Observed reopening: '+period.observed_reopening,'Endpoint inclusion: '+period.endpoint_inclusion,'Reported schedule: '+(period.reported_schedule||'Not recorded'),'Scope: '+period.scope,'Qualification: '+period.qualification,'Map locations are record context; this duration does not apply automatically to every linked post.',...(period.source_urls||[]));
      for(const source of event.source_urls||[]){const url=typeof source==='string'?source:source?.url;if(/^https?:\/\//i.test(url||''))lines.push(url);}
    }
    lines.push('','GEOGRAPHIC REFERENCES');
    const seen=new Set();
    for(const ref of snapshot.references){const p=ref.feature.properties||{},urls=[p.source_url,...(p.sources||[]).map(s=>s.url)].filter(u=>/^https?:\/\//i.test(u||''));for(const url of urls){const key=(p.location_id||'')+'|'+url;if(!seen.has(key)){seen.add(key);lines.push((p.label||p.name||p.location_id)+' — '+url);}}}
    return lines.join('\n')+'\n';
  }
  function wrap(ctx,value,maxWidth){
    const lines=[];
    for(const paragraph of String(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/)){
        const next=line?line+' '+word:word;
        if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}
        else line=next;
        // Avoid overflow from a long search term or title without spaces.
        while(ctx.measureText(line).width>maxWidth&&line.length>1){let n=line.length-1;while(n>1&&ctx.measureText(line.slice(0,n)).width>maxWidth)n--;lines.push(line.slice(0,n));line=line.slice(n);}
      }
      lines.push(line);
    }
    return lines;
  }
  function textLines(ctx,lines,x,y,lineHeight){for(const line of lines){ctx.fillText(line,x,y);y+=lineHeight;}return y;}
  function geometryPath(ctx,geometry,snapshot){
    if(!geometry)return;
    const line=(coordinates,close)=>{let started=false;for(const c of coordinates){const [x,y]=project(c,snapshot);if(!Number.isFinite(x)||!Number.isFinite(y))continue;if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}if(close&&started)ctx.closePath();};
    switch(geometry.type){
      case 'LineString':line(geometry.coordinates,false);break;
      case 'MultiLineString':geometry.coordinates.forEach(c=>line(c,false));break;
      case 'Polygon':geometry.coordinates.forEach(c=>line(c,true));break;
      case 'MultiPolygon':geometry.coordinates.forEach(p=>p.forEach(c=>line(c,true)));break;
      case 'GeometryCollection':geometry.geometries.forEach(g=>geometryPath(ctx,g,snapshot));break;
    }
  }
  function hasArea(g){return g&&(/Polygon/.test(g.type)||(g.type==='GeometryCollection'&&g.geometries.some(hasArea)));}
  function paintGeometry(ctx,feature,snapshot,style){
    ctx.save();ctx.beginPath();geometryPath(ctx,feature.geometry,snapshot);
    if(style.fill&&hasArea(feature.geometry)){ctx.fillStyle=style.fill;ctx.globalAlpha=style.fillOpacity??1;ctx.fill('evenodd');}
    if(style.stroke){ctx.strokeStyle=style.stroke;ctx.lineWidth=style.width||1;ctx.globalAlpha=style.opacity??1;ctx.setLineDash(style.dash||[]);ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}
    ctx.restore();
  }
  function referenceStyle(ref){
    const style=window.BorderCartography.symbolStyle(ref.feature.properties||{},{selected:ref.selected,count:ref.count,rationale:ref.rationale,scope:ref.scope});
    return {...style,stroke:style.colour,fill:null,...(ref.timePossible?{opacity:.3}:{})};
  }
  function paintPoint(ctx,coordinate,ref,snapshot){
    const [x,y]=project(coordinate,snapshot),style=referenceStyle(ref),radius=style.radius;
    if(x < -30||y < -30||x>snapshot.size.x+30||y>snapshot.size.y+30)return;
    ctx.save();if(ref.timePossible){ctx.globalAlpha=.5;ctx.setLineDash([2,3]);}
    if(ref.selected){ctx.beginPath();ctx.arc(x,y,radius+3.5,0,Math.PI*2);ctx.lineWidth=1;ctx.strokeStyle=style.colour;ctx.stroke();ctx.beginPath();ctx.arc(x,y,radius+1.5,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle=COLOURS.paper;ctx.stroke();}
    else if(style.approximate){ctx.beginPath();ctx.arc(x,y,radius+1,0,Math.PI*2);ctx.lineWidth=2;ctx.strokeStyle=COLOURS.paper;ctx.stroke();}
    ctx.beginPath();ctx.arc(x,y,radius-1,0,Math.PI*2);ctx.fillStyle=style.approximate?COLOURS.paper:style.colour;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=style.approximate?style.colour:COLOURS.paper;ctx.stroke();
    if(ref.count>1){ctx.fillStyle=style.approximate?style.colour:COLOURS.paper;ctx.font='650 10px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(ref.count),x,y+.5);}
    ctx.restore();
  }
  function paintReferences(ctx,references,snapshot){
    for(const ref of references){if(!window.BorderCartography.isLineReference(ref.feature))continue;const style=referenceStyle(ref);if(ref.selected)paintGeometry(ctx,ref.feature,snapshot,{stroke:COLOURS.paper,width:style.width+3,opacity:.95});paintGeometry(ctx,ref.feature,snapshot,style);}
  }
  function legendItems(snapshot){
    const used=new Set(snapshot.references.map(ref=>ref.rationale?.code));
    const items=window.BorderCartography.rationaleKey.filter(item=>used.has(item.code)).map(item=>['rationale',item.label,item.colour]);
    if(snapshot.references.some(r=>r.scope?.broad))items.push(['broad','Border-wide scope stated']);
    if(snapshot.references.some(r=>r.scope?.limited))items.push(['limited','Limited or uncertain scope']);
    if(snapshot.references.some(r=>r.feature.properties?.display_role==='country_context'))items.push(['country','Country outline']);
    items.push(['disputed','Disputed reference boundary']);
    if(snapshot.references.some(r=>r.selected))items.push(['selected','Selected geography']);
    if(snapshot.references.some(r=>r.timePossible))items.push(['possible','Possible month overlap']);
    return items;
  }
  function drawLegendSymbol(ctx,type,x,y,colour){
    ctx.save();ctx.strokeStyle=colour||COLOURS.muted;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=type==='selected'?4:2;ctx.beginPath();
    if(type==='point'||type==='approximate'||type==='number'){
      ctx.arc(x+10,y-4,type==='number'?9:5,0,Math.PI*2);if(type==='approximate'){ctx.fillStyle=COLOURS.paper;ctx.fill();ctx.stroke();}else ctx.fill();
      if(type==='number'){ctx.fillStyle=COLOURS.paper;ctx.font='700 10px '+FONT;ctx.textAlign='center';ctx.fillText('3',x+10,y-.5);}
    }else if(type==='country'){ctx.setLineDash([2,3]);ctx.globalAlpha=.7;ctx.strokeRect(x,y-12,22,15);ctx.globalAlpha=.06;ctx.fillRect(x,y-12,22,15);}
    else{ctx.setLineDash(type==='limited'?[1,7]:type==='disputed'?[4,4]:[]);ctx.lineCap='round';if(type==='possible')ctx.globalAlpha=.3;ctx.moveTo(x,y-4);ctx.lineTo(x+27,y-4);ctx.stroke();}
    ctx.restore();
  }
  function drawScale(ctx,snapshot,frame){
    const factor=frame.w/snapshot.size.x,targetPixels=Math.min(140/factor,snapshot.size.x*.22),distance=niceDistance(snapshot.metresPer100*targetPixels/100);
    if(!distance)return;
    const length=distance/snapshot.metresPer100*100*factor,x=frame.x+20,y=frame.y+frame.h-23;
    ctx.save();ctx.fillStyle='rgba(255,255,255,.93)';ctx.fillRect(x-10,y-33,Math.max(length+20,149),51);ctx.fillStyle=COLOURS.ink;ctx.font='11px '+FONT;ctx.fillText(distance>=1000?distance/1000+' km':distance+' m',x,y-16);ctx.font='9px '+FONT;ctx.fillStyle=COLOURS.muted;ctx.fillText('at centre latitude',x+50,y-16);ctx.strokeStyle=COLOURS.ink;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y-8);ctx.lineTo(x,y);ctx.lineTo(x+length,y);ctx.lineTo(x+length,y-8);ctx.stroke();ctx.restore();
  }
  function drawNorth(ctx,frame){
    const x=frame.x+frame.w-35,y=frame.y+35;ctx.save();ctx.fillStyle='rgba(255,255,255,.93)';ctx.fillRect(x-20,y-24,40,70);ctx.fillStyle=COLOURS.ink;ctx.font='700 12px '+FONT;ctx.textAlign='center';ctx.fillText('N',x,y-7);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-8,y+25);ctx.lineTo(x,y+18);ctx.lineTo(x+8,y+25);ctx.closePath();ctx.fill();ctx.restore();
  }
  function render(snapshot,title){
    const canvas=document.createElement('canvas'),measure=canvas.getContext('2d');
    if(!measure)throw new Error('Image export is unavailable in this browser.');
    const width=1200,margin=28,content=width-margin*2;
    measure.font='600 31px '+FONT;const titleLines=wrap(measure,title||'Border closures',content);
    measure.font='13px '+FONT;const contextLines=wrap(measure,(snapshot.state.continent||'World')+' · '+timeDescription(snapshot),content);
    const filters=filterDescription(snapshot);measure.font='12px '+FONT;const filterLines=filters.length?wrap(measure,filters.join(' · '),content):[];
    const frame={x:margin,y:31+titleLines.length*38+contextLines.length*20+filterLines.length*18+22,w:content,h:content*snapshot.size.y/snapshot.size.x};
    const legend=legendItems(snapshot),legendColumns=3,legendRows=Math.ceil(legend.length/legendColumns),footerY=frame.y+frame.h+32;
    const warning=snapshot.state.mode==='intervals'?'Dated evidence occurs within the selected month. Held and observation-only evidence is shown only at recorded dates; no continuous interval is inferred. Missing markers do not mean open borders. See record duration notes for date bounds, minimum periods and formal policy dates. Policy endpoints do not establish observed traffic resumption.':'Unmarked does not mean open. The map is an incomplete record of documented restrictions.';
    measure.font='12px '+FONT;
    const caveatLines=wrap(measure,warning+' Frontier and country shapes show context, not exact closure footprints. Multiple rationales can span records and dates. Present-day boundaries do not establish historical control or sovereignty.'+(snapshot.state.rationale?' Rationale coding is interpretive and necessarily imperfect.':''),content);
    const selectedEvent=snapshot.events.find(e=>e.id===snapshot.selected),selectionText=selectedEvent?'Selected record: '+selectedEvent.id+' · '+(selectedEvent.title||selectedEvent.id):'';
    const selectionLines=selectionText?wrap(measure,selectionText,content):[];
    const height=Math.ceil(footerY+legendRows*31+26+caveatLines.length*18+selectionLines.length*18+91);
    const phone=window.matchMedia('(max-width:760px), (max-width:950px) and (max-height:500px)').matches;
    const scale=Math.min(phone?2:4,(phone?8000:16000)/height,Math.sqrt((phone?12000000:65000000)/(width*height)));
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle=COLOURS.paper;ctx.fillRect(0,0,width,height);
    ctx.textBaseline='alphabetic';ctx.fillStyle=COLOURS.ink;ctx.font='600 31px '+FONT;let y=textLines(ctx,titleLines,margin,53,38);
    ctx.fillStyle=COLOURS.muted;ctx.font='13px '+FONT;y=textLines(ctx,contextLines,margin,y+1,20);
    ctx.font='12px '+FONT;textLines(ctx,filterLines,margin,y+1,18);
    ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.w,frame.h);ctx.clip();ctx.fillStyle=COLOURS.ocean;ctx.fillRect(frame.x,frame.y,frame.w,frame.h);ctx.translate(frame.x,frame.y);const factor=frame.w/snapshot.size.x;ctx.scale(factor,factor);
    for(const f of snapshot.countries.features)paintGeometry(ctx,f,snapshot,{fill:COLOURS.land,stroke:COLOURS.coast,width:.6,opacity:.8});
    const countryRefs=snapshot.references.filter(r=>referenceStyle(r).country&&!/Point/.test(r.feature.geometry.type)),scopeRefs=snapshot.references.filter(r=>!referenceStyle(r).country&&!/Point/.test(r.feature.geometry.type)),pointRefs=snapshot.references.filter(r=>/Point/.test(r.feature.geometry.type));
    paintReferences(ctx,countryRefs,snapshot);
    for(const f of snapshot.borders.features)paintGeometry(ctx,f,snapshot,{stroke:COLOURS.border,width:.6,opacity:.8});
    for(const f of snapshot.disputed.features)paintGeometry(ctx,f,snapshot,{stroke:COLOURS.disputed,width:.9,opacity:.8,dash:[4,4]});
    paintReferences(ctx,scopeRefs,snapshot);
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    for(const label of snapshot.labels||[]){ctx.font='500 '+label.fontSize+'px '+FONT;ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.strokeText(label.text,label.x,label.y);ctx.fillStyle='#6b7d73';ctx.fillText(label.text,label.x,label.y);}
    ctx.restore();paintReferences(ctx,pointRefs,snapshot);ctx.restore();
    ctx.strokeStyle='#cdd8d7';ctx.lineWidth=1;ctx.strokeRect(frame.x,frame.y,frame.w,frame.h);drawScale(ctx,snapshot,frame);drawNorth(ctx,frame);
    for(let i=0;i<legend.length;i++){const x=margin+(i%legendColumns)*(content/legendColumns),ly=footerY+Math.floor(i/legendColumns)*31;drawLegendSymbol(ctx,legend[i][0],x,ly,legend[i][2]);ctx.font='12px '+FONT;ctx.fillStyle=COLOURS.ink;ctx.fillText(legend[i][1],x+35,ly);}
    y=footerY+legendRows*31+7;ctx.font='12px '+FONT;ctx.fillStyle=COLOURS.muted;y=textLines(ctx,caveatLines,margin,y,18);if(selectionLines.length)y=textLines(ctx,selectionLines,margin,y+5,18);
    ctx.font='11px '+FONT;ctx.fillText('Selection: '+snapshot.events.length.toLocaleString('en-GB')+' records · '+snapshot.references.length.toLocaleString('en-GB')+' map references. Some references may lie outside this view.',margin,y+15);
    ctx.fillText('Sources: event references in the atlas · Natural Earth (public domain) · © OpenStreetMap contributors (ODbL)'+(hasPIDA(snapshot)?' · AU-PIDA.':'.'),margin,y+34);
    ctx.strokeStyle='#dce3e1';ctx.beginPath();ctx.moveTo(margin,height-45);ctx.lineTo(width-margin,height-45);ctx.stroke();
    ctx.font='600 11px '+FONT;ctx.fillStyle=COLOURS.ink;ctx.fillText('Mapping by Hugh Lamarque',margin,height-24);ctx.font='11px '+FONT;ctx.fillStyle=COLOURS.muted;ctx.textAlign='right';ctx.fillText('Border closures atlas · '+dateLabel(snapshot.capturedAt.slice(0,10)),width-margin,height-24);ctx.textAlign='left';
    return {canvas,frame,scale};
  }
  function ensureDialog(){
    if(dialog)return dialog;
    const style=document.createElement('style');style.textContent='#save-view-dialog{max-width:780px;width:calc(100% - 32px);max-height:90dvh;overflow:auto;overscroll-behavior:contain;padding:24px;background:#fff;color:#243e43;border:1px solid #dce3e1;border-radius:8px}#save-view-dialog .save-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}#save-view-dialog h2{font:600 23px Atlas,Arial,Helvetica,sans-serif;margin:0}#save-view-dialog .save-close{border:0;background:none;font-size:28px;cursor:pointer;color:#647879}#save-view-dialog p,#save-view-dialog label{font:13px/1.6 Atlas,Arial,Helvetica,sans-serif}#save-view-dialog label{display:block;font-weight:600}#save-view-title{width:100%;margin:6px 0 12px;padding:10px;border:1px solid #ccd7d3;border-radius:4px;color:inherit;font:14px Atlas,Arial,Helvetica,sans-serif}#save-view-dialog .save-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:15px 0}#save-view-dialog .save-actions button,#save-view-dialog .save-actions a{border:1px solid #cbd7d2;border-radius:4px;padding:10px 13px;background:#fff;color:#226b69;text-decoration:none;font:600 12px Atlas,Arial,Helvetica,sans-serif;cursor:pointer}#save-view-dialog .save-actions a.save-primary{background:#226b69;color:#fff;border-color:#226b69}#save-view-status{min-height:21px;color:#647879}#save-view-preview{display:block;width:100%;max-height:52vh;object-fit:contain;object-position:top;background:#eef3f3;border:1px solid #dce3e1}#save-view-dialog .save-caption{font-size:11px;margin-bottom:0}#save-view-dialog [hidden]{display:none!important}#save-view-dialog::backdrop{background:#203b3b70}';document.head.append(style);
    dialog=document.createElement('dialog');dialog.id='save-view-dialog';dialog.setAttribute('aria-labelledby','save-view-heading');dialog.innerHTML='<div class="save-heading"><h2 id="save-view-heading">Save view</h2><button class="save-close" type="button" aria-label="Close Save view">×</button></div><p>Download a high-resolution map of this view, with its key, sources, scale and north arrow.</p><label for="save-view-title">Map title</label><input id="save-view-title" type="text" maxlength="120"><div class="save-actions"><button id="save-view-generate" type="button">Generate PNG</button><a id="save-view-download" class="save-primary" download hidden>Download PNG</a><a id="save-view-open" target="_blank" rel="noopener" hidden>Open preview ↗</a><a id="save-view-notes" download hidden>Sources &amp; view notes</a></div><p id="save-view-status" role="status" aria-live="polite"></p><img id="save-view-preview" alt="Preview of the map prepared for download" hidden><p class="save-caption">The saved map keeps the visible map area and its proportions, without the records panel or timeline. The view and filters are captured when you open Save view.</p>';
    document.body.append(dialog);dialog.querySelector('.save-close').addEventListener('click',()=>dialog.close());dialog.querySelector('#save-view-generate').addEventListener('click',generate);dialog.querySelector('#save-view-title').addEventListener('input',()=>{if(!busy)dialog.querySelector('#save-view-status').textContent='Choose Generate PNG to apply the new title.';});
    dialog.addEventListener('close',()=>lastFocus?.focus?.());
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    return dialog;
  }
  function filename(snapshot,title){return (title||'border-closures').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)+'-'+(snapshot.state.mode==='all'?'all-recorded-closures':String(Math.floor(snapshot.state.month/12))+'-'+String(snapshot.state.month%12+1).padStart(2,'0'));}
  async function generate(){
    if(busy||!current)return;
    busy=true;const status=dialog.querySelector('#save-view-status'),button=dialog.querySelector('#save-view-generate');button.disabled=true;status.textContent='Preparing your map…';
    const snapshot=current,title=dialog.querySelector('#save-view-title').value.trim()||'Border closures';
    try{
      if(document.fonts)await document.fonts.load('500 12px Atlas');
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      const result=render(snapshot,title),blob=await new Promise((resolve,reject)=>result.canvas.toBlob(value=>value?resolve(value):reject(new Error('The browser could not create the PNG.')),'image/png'));
      if(current!==snapshot)return;
      const nextURL=URL.createObjectURL(blob),nextNotesURL=URL.createObjectURL(new Blob([notes(snapshot,title)],{type:'text/plain;charset=utf-8'})),oldImageURL=imageURL,oldNotesURL=notesURL;
      imageURL=nextURL;notesURL=nextNotesURL;const base=filename(snapshot,title),download=dialog.querySelector('#save-view-download'),preview=dialog.querySelector('#save-view-open'),sourceLink=dialog.querySelector('#save-view-notes'),image=dialog.querySelector('#save-view-preview');
      download.href=imageURL;download.download=base+'.png';download.hidden=false;preview.href=imageURL;preview.hidden=false;sourceLink.href=notesURL;sourceLink.download=base+'-sources.txt';sourceLink.hidden=false;image.src=imageURL;image.hidden=false;
      // Keep the current export available after downloads and after closing the
      // dialog. Only superseded URLs are released, so retry never triggers a rerender.
      if(oldImageURL)URL.revokeObjectURL(oldImageURL);if(oldNotesURL)URL.revokeObjectURL(oldNotesURL);
      status.textContent=result.canvas.width.toLocaleString('en-GB')+' × '+result.canvas.height.toLocaleString('en-GB')+' px · PNG ready. You can download it again at any time from this window.';button.textContent='Generate again';
    }catch(error){status.textContent='Could not prepare this map. '+(error?.message||'Please try again.');}
    finally{busy=false;button.disabled=false;}
  }
  function open(input){
    return openSnapshot(capture(input));
  }
  function openSnapshot(snapshot){
    ensureDialog();lastFocus=document.activeElement;
    const signature=s=>JSON.stringify([s.size,s.origin,s.zoom,s.state,s.selected,s.events.map(e=>e.id),s.meta]);
    if(current&&imageURL&&signature(current)===signature(snapshot)){
      if(!dialog.open)dialog.showModal();dialog.querySelector('#save-view-download').focus();return;
    }
    current=snapshot;
    dialog.querySelector('#save-view-title').value='Border closures · '+(snapshot.state.continent||'World');dialog.querySelector('#save-view-status').textContent='Your map view is captured. Choose Generate PNG to prepare the download.';dialog.querySelector('#save-view-generate').textContent='Generate PNG';
    for(const id of ['save-view-download','save-view-open','save-view-notes','save-view-preview'])dialog.querySelector('#'+id).hidden=true;
    if(!dialog.open)dialog.showModal();dialog.querySelector('#save-view-title').focus();
  }
  window.BorderExport={open,openSnapshot,capture,render,project,notes,niceDistance};
})();
