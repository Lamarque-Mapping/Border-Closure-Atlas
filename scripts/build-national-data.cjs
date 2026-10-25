'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const workbook=JSON.parse(fs.readFileSync(path.join(root,'source/national-policy-supplement.json'),'utf8'));
const display=JSON.parse(fs.readFileSync(path.join(root,'source/national-map-display.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source/current-release-manifest.json'),'utf8'));
for(const key of ['national_policies','national_display','data']){
 const item=manifest.files[key];assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,item.path))).digest('hex'),item.sha256,'National compatibility inputs match the manifest');
}
if(workbook.observations.length!==18||display.policies.length!==7)throw Error('Unexpected national supplement size');
const ids=new Set(display.policies.map(p=>p.id));
if(workbook.observations.some(r=>!ids.has(r['Policy ID'])))throw Error('Unmapped national observation');
const countries={AUS:'Australia',NZL:'New Zealand',GBR:'United Kingdom'};
for(const policy of display.policies){
 if(!countries[policy.map_country])throw Error('Unknown country reference for policy: '+policy.id);
 if(workbook.observations.filter(row=>row['Policy ID']===policy.id).some(row=>row.Country!==countries[policy.map_country]))throw Error('Policy reference country differs from its source: '+policy.id);
 if(policy.geometry==='ENG'&&policy.map_country!=='GBR')throw Error('England policy requires a UK reference outline without changing its jurisdiction');
}
const source={...workbook,...display,compatible_data_sha256:manifest.files.data.sha256,release_id:manifest.release_id};
fs.writeFileSync(path.join(root,'dist/national-data.js'),'window.ATLAS_NATIONAL_DATA = '+JSON.stringify(source)+';\n');
fs.mkdirSync(path.join(root,'dist/downloads'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/downloads/national-policy-evidence.json'),JSON.stringify(source,null,2)+'\n');
console.log('National supplement: 18 observations grouped into 7 policy histories.');
