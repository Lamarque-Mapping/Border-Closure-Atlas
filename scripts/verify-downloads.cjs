/* File extensions, MIME declarations and generated CSV bytes must agree. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source/current-release-manifest.json'),'utf8'));
const filename=path.basename(manifest.downloads.reader.path);
const workbookType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const workbook=fs.readFileSync(path.join(root,'dist/downloads',filename));
const workbookHash=crypto.createHash('sha256').update(workbook).digest('hex');
assert.equal(workbookHash,manifest.downloads.reader.sha256,'Reader download matches the bound release manifest');
for(const item of Object.values(manifest.downloads))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist',item.path))).digest('hex'),item.sha256,'Every companion download matches its bound bytes');

function spreadsheetLinks(html){
 return [...html.matchAll(/<a\b[^>]*>/gi)].map(match=>Object.fromEntries(
  [...match[0].matchAll(/\b([\w-]+)\s*=\s*"([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]])
 )).filter(attributes=>/\.xlsx?(?:[?#]|$)/i.test(attributes.href||''));
}
function checkLinks(file,expectedVersion=workbookHash){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const links=spreadsheetLinks(html);
 for(const link of links){
  const url=new URL(link.href,'https://atlas.invalid/');
  assert.equal(url.origin,'https://atlas.invalid',file+': workbook remains on the same site');
  assert.equal(url.pathname,'/downloads/'+filename,file+': workbook URL has the correct extension');
  assert.equal(url.searchParams.get('v'),expectedVersion,file+': cache version matches the workbook SHA-256');
  assert.equal(url.searchParams.getAll('v').length,1,file+': one workbook cache version');
  assert.equal(link.download,filename,file+': saved filename is explicitly .xlsx');
  assert.equal(link.type,workbookType,file+': link declares spreadsheet MIME type');
  assert(!('target' in link),file+': workbook is downloaded without an extra viewer tab');
 }
 return links.length;
}
function checkCompanions(file){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const anchors=[...html.matchAll(/<a\b[^>]*>/gi)].map(match=>Object.fromEntries([...match[0].matchAll(/\b([\w-]+)\s*=\s*"([^"]*)"/g)].map(a=>[a[1],a[2]])));
 for(const key of ['companion_json','companion_zip']){
  const item=manifest.downloads[key],links=anchors.filter(a=>(a.href||'').split('?')[0]===item.path);
  assert(links.length>0,file+': companion link is present '+key);
  for(const link of links){const url=new URL(link.href,'https://atlas.invalid/');assert.equal(url.searchParams.get('v'),item.sha256,'Companion cache version matches actual bytes');assert.equal(link.download,path.basename(item.path),'Companion download filename matches its format');}
 }
}

(async()=>{
 const templateCount=checkLinks('scripts/analysis-template.html','{{WORKBOOK_SHA256}}');
 const generatedCount=checkLinks('dist/analysis.html');
 checkCompanions('dist/analysis.html');
 const mainCount=checkLinks('dist/index.html');
 assert.equal(templateCount,1,'Dataset offers one complete workbook');
 assert.equal(generatedCount,templateCount,'generated page retains the download');
 assert.equal(workbook.subarray(0,4).toString('hex'),'504b0304','XLSX is a ZIP package, not CSV or an HTML error page');

 // Exercise the real CSV helper, including its Blob MIME, UTF-8 BOM and filename.
 const ui=fs.readFileSync(path.join(root,'scripts/analysis-ui.js'),'utf8');
 const helper=ui.slice(ui.indexOf('function download('),ui.indexOf('function bar('));
 let capturedBlob,downloaded,revoked;
 const context=vm.createContext({Blob,
  URL:{createObjectURL(blob){capturedBlob=blob;return 'blob:download-check';},revokeObjectURL(url){revoked=url;}},
  document:{createElement(tag){assert.equal(tag,'a');return {click(){downloaded={href:this.href,filename:this.download};},remove(){}};},body:{appendChild(){}}},
  setTimeout(callback){callback();}
 });
 vm.runInContext(helper,context);
 vm.runInContext(`downloadCSV('download-check.csv', [['Record','Title'],['EXAMPLE','A, B'],['FORMULA','=1+1']])`,context);
 assert.equal(downloaded.filename,'download-check.csv');
 assert.equal(downloaded.href,'blob:download-check');
 assert.equal(capturedBlob.type,'text/csv;charset=utf-8');
 const csv=Buffer.from(await capturedBlob.arrayBuffer());
 assert.equal(csv.subarray(0,3).toString('hex'),'efbbbf','CSV retains its UTF-8 marker for spreadsheet applications');
 assert.equal(csv.subarray(3).toString('utf8'),'"Record","Title"\r\n"EXAMPLE","A, B"\r\n"FORMULA","\'=1+1"');
 assert.equal(revoked,'blob:download-check');
 console.log(`Download checks passed: ${generatedCount+mainCount} public workbook link(s), SHA-256 cache version, explicit .xlsx name/type, XLSX package signature, CSV filename/MIME/UTF-8/escaping.`);

 const publicIndex=process.argv.indexOf('--public');
 if(publicIndex!==-1){
  const base=process.argv[publicIndex+1]||'https://lamarque-mapping.github.io/Border-Closure-Atlas/';
  const url=new URL('downloads/'+filename,base.endsWith('/')?base:base+'/');
  url.searchParams.set('v',workbookHash);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-download-check-'));
  try{
   const destination=path.join(directory,filename);
   // curl also honours the proxy configuration used by the managed workspace.
   const [status,type,effectiveURL]=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30','--output',destination,'--write-out','%{http_code}\n%{content_type}\n%{url_effective}',url.href],{encoding:'utf8'}).trim().split(/\r?\n/);
   assert.equal(status,'200','published workbook returns HTTP 200');
   assert.equal((type||'').split(';')[0].trim().toLowerCase(),workbookType,'published workbook MIME type');
   assert.equal(path.basename(new URL(effectiveURL).pathname),filename,'published URL preserves the .xlsx filename');
   assert.equal(new URL(effectiveURL).searchParams.get('v'),workbookHash,'published URL preserves the workbook cache version');
   const body=fs.readFileSync(destination);
   assert.equal(body.subarray(0,4).toString('hex'),'504b0304','published body is an XLSX package');
   assert.deepEqual(body,workbook,'published download equals the local release workbook');
   console.log(`Public download passed: ${body.length.toLocaleString('en-GB')} bytes; ${workbookType}; SHA-256 ${crypto.createHash('sha256').update(body).digest('hex')}.`);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
