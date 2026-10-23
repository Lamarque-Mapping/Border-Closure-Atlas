/* Assemble hosted assets. The full offline dataset stays in the source checkout;
 * hosted research downloads use the versioned, checked record-part manifest. */
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'dist'),output=path.join(root,'out');
fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(source,output,{recursive:true,filter:file=>path.relative(source,file)!=='data.js'});
// Keep offline/startup links on the deployment's own host when publishing elsewhere.
if(process.env.ATLAS_PUBLIC_URL){
 const publicURL=new URL(process.env.ATLAS_PUBLIC_URL);
 if(publicURL.protocol!=='https:')throw Error('ATLAS_PUBLIC_URL must use HTTPS.');
 publicURL.hash='';publicURL.search='';
 const base=publicURL.href.replace(/\/$/,'');
 for(const name of ['index.html','navigation.js']){
  const file=path.join(output,name);
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('https://border-closures-atlas.lamarque.chatgpt.site',base));
 }
}
function check(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.statSync(file);if(stat.isDirectory())check(file);else if(stat.size>10*1024*1024)throw Error('Hosted asset exceeds 10 MB: '+path.relative(output,file));}}
check(output);
console.log('Hosted assets prepared; full evidence loads only when requested.');
