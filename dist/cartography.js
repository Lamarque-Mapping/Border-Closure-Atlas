(function(root){
  'use strict';
  const colours=Object.freeze({ink:'#244e46',muted:'#65756f',land:'#f5f6f4',ocean:'#e1e6e4',teal:'#287567',amber:'#8c754e',selected:'#b16b4c',border:'#c3ccc6',coast:'#b5c0b9',disputed:'#9aa59d'});
  const rationaleKey=Object.freeze([
    {code:'Security',label:'Security',colour:'#b8473f'},
    {code:'Health and biosecurity',label:'Health & biosecurity',colour:'#287e67'},
    {code:'Trade and protectionism',label:'Trade & protectionism',colour:'#b97713'},
    {code:'Migration',label:'Migration',colour:'#287fb5'},
    {code:'Electoral politics',label:'Electoral politics',colour:'#8255a5'},
    {code:'Interstate disputes and pressure',label:'Interstate disputes',colour:'#ad527e'},
    {code:'Power and regime politics',label:'Power & regime',colour:'#67503a'},
    {code:'Policy and socioeconomic demands',label:'Policy demands',colour:'#587c28'},
    {code:'Administration and service operation',label:'Administration & services',colour:'#477987'},
    {code:'Environment and resource management',label:'Environment & resources',colour:'#5967a8'},
    {code:'__multiple',label:'Multiple rationales',colour:'#3e4653'},
    {code:'__uncoded',label:'No assigned category',colour:'#92999e'}
  ].map(Object.freeze));
  const rationaleByCode=new Map(rationaleKey.map(item=>[item.code,item]));
  // A point is eligible only after its phase-to-location binding has been
  // resolved by BorderCore; this helper describes geometry, not evidence.
  function isLineReference(feature){return /^(?:Multi)?(?:LineString|Polygon)$/.test(feature?.geometry?.type||'');}
  function isMapReference(feature){return feature?.geometry?.type==='Point'||isLineReference(feature);}
  // A standalone crossing repeats one mark from the existing dotted border:
  // 1 px of line with round caps at 2.7 px width (3.7 by 2.7 px overall).
  const restrictionWidth=2.7,restrictionDotLength=1;
  function pointDiameter(){return restrictionWidth;}
  function rationaleStyle(records=[],filter=''){
    const codes=[...new Set(records.flatMap(e=>Array.isArray(e.rationales)?e.rationales:[]))];
    const key=filter&&codes.includes(filter)?filter:codes.length===1?codes[0]:codes.length>1?'__multiple':'__uncoded';
    const item=rationaleByCode.get(key)||rationaleByCode.get('__uncoded');
    return {...item,codes,hasUncoded:records.some(e=>!e.rationales?.length)};
  }
  function broadScope(value){
    const text=String(value||'').trim();
    // A named crossing, an explicit exception to extent, or uncertain scope
    // never becomes whole-border coverage because its parent is national.
    if(/\b(?:selected|named|specific|single)\b|\bnot (?:the )?(?:whole|entire|every|all)\b|\b(?:scope|extent) (?:unknown|unclear|unresolved)\b/i.test(text))return false;
    return /\b(?:all|entire|whole)\s+(?:(?:national|international|land|external|road|river|regional)\s+)*(?:borders?|frontiers?|(?:border )?(?:crossings?|checkpoints?|gates?|ports?))\b/i.test(text)
      ||/\b(?:nationwide|countrywide|border-wide)\b/i.test(text)
      ||/^national (?:land[ /-]?(?:water )?)?(?:border|frontier)(?:s|[- ](?:passenger|entry|exit|closure|restriction|policy|regime|order))\b/i.test(text);
  }
  function scopeStyle(records=[]){
    if(records.some(e=>e.record_kind==='national_policy'))return {broad:false,limited:false,national:true,conditionsOnly:records.every(e=>e.national_kind==='entry_conditions'),label:'National entry or departure rules'};
    const scopes=records.flatMap(e=>e.duration_periods?.length?e.duration_periods.map(p=>p.scope||''):[e.scope||'']);
    const broad=scopes.length>0&&scopes.every(broadScope);
    return {broad,limited:!broad,label:broad?'Border-wide scope stated':'Limited or uncertain geographical scope'};
  }
  // Screen-space symbols aid legibility; their size does not encode severity
  // or the geographical extent of a closure. Shared by the map and PNG export.
  function symbolStyle(properties={},options={}){
    const role=properties.display_role||'crossing_reference',national=role==='national_policy',country=role==='country_context'||national,frontier=role==='frontier_context',context=country||frontier,selected=Boolean(options.selected);
    const rationale=options.rationale||rationaleStyle(options.records,options.rationaleFilter),scope=options.scope||scopeStyle(options.records);
    const radius=pointDiameter(options.zoom)/2;
    return {role,country,national,frontier,context,scope,colour:rationale.colour,rationale,selected,approximate:/approx|locality|town|centroid|indicative|unresolved/i.test(String(properties.precision||'')),radius,pointLength:restrictionDotLength,pointStroke:'none',pointStrokeWidth:0,hitRadius:22,selectedHaloRadius:radius+3,width:selected?3.8:national?1.8:country?1.5:restrictionWidth,opacity:national?.85:country?.55:1,dash:national?(scope.conditionsOnly?[2,5]:[]):country?[2,5]:scope.limited?[restrictionDotLength,7]:[],fillOpacity:0};
  }
  const cache=new WeakMap();
  // Area is used only to order and space reference labels. It is not a
  // statistical measure or an interpretation of sovereignty or closure scope.
  function ringArea(ring){
    let sum=0;if(!Array.isArray(ring)||ring.length<3)return 0;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];if(!a||!b)continue;
      let dl=(b[0]-a[0])*Math.PI/180;
      while(dl>Math.PI)dl-=2*Math.PI;while(dl< -Math.PI)dl+=2*Math.PI;
      sum+=dl*(2+Math.sin(a[1]*Math.PI/180)+Math.sin(b[1]*Math.PI/180));
    }
    return Math.abs(sum)*6371*6371/2;
  }
  function polygonArea(rings){return Math.max(0,ringArea(rings?.[0])-((rings||[]).slice(1).reduce((n,r)=>n+ringArea(r),0)));}
  function area(g){
    if(!g)return 0;
    if(g.type==='Polygon')return polygonArea(g.coordinates);
    if(g.type==='MultiPolygon')return g.coordinates.reduce((n,p)=>n+polygonArea(p),0);
    if(g.type==='GeometryCollection')return g.geometries.reduce((n,p)=>n+area(p),0);
    return 0;
  }
  function info(f){
    if(cache.has(f))return cache.get(f);
    const p=f.properties||{},hasRank=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)),value={area:area(f.geometry),rank:hasRank(p.LABELRANK)?Number(p.LABELRANK):hasRank(p.SCALERANK)?Number(p.SCALERANK):99};
    cache.set(f,value);return value;
  }
  function countryLabels(features,project,size,zoom){
    const width=Number(size?.x??size?.width),height=Number(size?.y??size?.height),z=Number(zoom);
    if(!(width>0&&height>0&&Number.isFinite(z))||typeof project!=='function')return [];
    const minArea=z<1.6?600000:z<2.5?300000:z<3.25?110000:z<4?18000:z<5?3000:0;
    const limit=z<1.6?16:z<2.5?30:z<3.25?48:z<4?70:z<5?100:140;
    const fontSize=z<2.5?10:z<4?11:12,pad=8,candidates=[];
    for(const f of features||[]){
      const p=f?.properties||{},name=typeof p.NAME==='string'?p.NAME.trim():'';
      // Reject null/missing coordinates explicitly; Number(null) is not evidence
      // of a label point at zero longitude or latitude.
      if(!name||p.LABEL_X===null||p.LABEL_Y===null||p.LABEL_X===''||p.LABEL_Y===''||p.LABEL_X===undefined||p.LABEL_Y===undefined)continue;
      const lon=Number(p.LABEL_X),lat=Number(p.LABEL_Y);
      if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>90||Math.abs(lon)>180)continue;
      const details=info(f);if(details.area<minArea)continue;
      const point=project([lon,lat]),x=Number(point?.[0]??point?.x),y=Number(point?.[1]??point?.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))continue;
      const textWidth=Math.max(fontSize,name.length*fontSize*.56),box={left:x-textWidth/2-pad,right:x+textWidth/2+pad,top:y-fontSize/2-pad,bottom:y+fontSize/2+pad};
      if(box.left<4||box.right>width-4||box.top<4||box.bottom>height-4)continue;
      candidates.push({text:name,x,y,fontSize,box,rank:details.rank,area:details.area});
    }
    candidates.sort((a,b)=>a.rank-b.rank||b.area-a.area||a.text.localeCompare(b.text));
    const chosen=[],seen=new Set();
    for(const item of candidates){
      if(seen.has(item.text))continue;
      if(chosen.some(v=>item.box.left<v.box.right&&item.box.right>v.box.left&&item.box.top<v.box.bottom&&item.box.bottom>v.box.top))continue;
      chosen.push(item);seen.add(item.text);if(chosen.length>=limit)break;
    }
    return chosen.map(({text,x,y,fontSize})=>({text,x,y,fontSize}));
  }
  const api=Object.freeze({colours,countryLabels,symbolStyle,restrictionWidth,restrictionDotLength,pointDiameter,rationaleKey,rationaleStyle,scopeStyle,broadScope,isLineReference,isMapReference});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.BorderCartography=api;
})(typeof window!=='undefined'?window:globalThis);

