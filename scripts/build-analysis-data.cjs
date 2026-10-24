/* Analysis uses the same browsing records as the map, without its geometry.
 * Keep every record field: search, filters, dates and chart arithmetic are unchanged. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
function project(data){
 return {meta:data.meta,events:data.events.filter(e=>e.record_kind!=='national_policy')};
}
function build(web=path.resolve(__dirname,'../dist')){
 const raw=fs.readFileSync(path.join(web,'map-data.js'),'utf8');
 const data=JSON.parse(raw.replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
 const body=JSON.stringify(project(data)).replace(/</g,'\\u003c');
 const hash=crypto.createHash('sha256').update(body).digest('hex').slice(0,24);
 const source='analysis-data.json?v='+hash;
 fs.writeFileSync(path.join(web,'analysis-data.json'),body);
 const index=path.join(web,'index.html');
 let html=fs.readFileSync(index,'utf8');
 html=html.replace(/ data-analysis-src="[^"]*"/g,'').replace(/ data-source-sha="[^"]*"/g,'');
 html=html.replace(/(data-map-src="[^"]*")/,'$1 data-analysis-src="'+source+'" data-source-sha="'+data.meta.source_sha256+'"');
 fs.writeFileSync(index,html);
 // The standalone Analysis page uses the same release-specific URL as the main site.
 const analysis=path.join(web,'analysis.html');
 if(fs.existsSync(analysis))fs.writeFileSync(analysis,fs.readFileSync(analysis,'utf8').replace(/script\.dataset\.analysisSrc="[^"]*"/, 'script.dataset.analysisSrc="'+source+'"').replace(/script\.dataset\.sourceSha="[^"]*"/,'script.dataset.sourceSha="'+data.meta.source_sha256+'"'));
 console.log(JSON.stringify({analysisBytes:Buffer.byteLength(body),analysisGzipBytes:zlib.gzipSync(body).length,mapBytes:Buffer.byteLength(raw),mapGzipBytes:zlib.gzipSync(raw).length,records:data.events.length,source_sha256:data.meta.source_sha256}));
}
module.exports={project,build};
if(require.main===module)build(process.argv[2]&&path.resolve(process.argv[2]));
