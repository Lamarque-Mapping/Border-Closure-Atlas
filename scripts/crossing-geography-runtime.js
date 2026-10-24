(function(root){
  'use strict';
  // Generated from the separately reviewable geography files. Historical
  // records, dates, evidence and Analysis inputs are never rewritten here.
  const review=__CROSSING_REVIEW__;
  function attach(data){
    if(data.crossing_map===review)return data;
    if(data.meta?.source_sha256!==review.source_sha256)throw Error('The crossing locations do not match this dataset version. Please reload.');
    const events=new Map(data.events.map(e=>[e.id,e]));
    const included=[...events.values()].filter(e=>e.record_kind!=='national_policy'&&!e.quarantined&&!e.excluded_from_map);
    const expected=new Map(included.flatMap(e=>(e.duration_periods||[]).map(p=>[p.period_id,e.id])));
    if(expected.size!==Object.keys(review.phases).length)throw Error('The crossing review is incomplete for this dataset.');
    for(const [id,row] of Object.entries(review.phases))if(expected.get(id)!==row.record_id)throw Error('A crossing phase does not match its record.');
    const undated=included.filter(e=>!e.duration_periods?.length);
    if(undated.length!==Object.keys(review.undated).length||undated.some(e=>!review.undated[e.id]))throw Error('The undated crossing review is incomplete.');
    const old=new Map((data.locations?.features||[]).map(f=>[f.properties?.location_id,f]));
    const additions=[];
    for(const site of review.sites){
      if(old.has(site.properties.location_id))throw Error('A reviewed crossing location ID is duplicated.');
      additions.push(site);old.set(site.properties.location_id,site);
    }
    data.locations={...data.locations,features:[...(data.locations?.features||[]),...additions]};
    data.crossing_map=review;
    return data;
  }
  const api={attach,review};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AtlasCrossings=api;
})(typeof window!=='undefined'?window:globalThis);
