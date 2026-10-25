import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';

if(process.argv.includes('--help-hyperlink')){
  const wb=Workbook.create();
  console.log(wb.help('*',{search:'[Hh]yperlink',include:'index,examples,notes',maxChars:3000}).ndjson);
  process.exit(0);
}

const [modelPath,outputPath,previewDir]=process.argv.slice(2);
if(!previewDir)throw Error('Usage: author_reader.mjs MODEL OUTPUT_XLSX PREVIEW_DIR');
const model=JSON.parse(await fs.readFile(modelPath,'utf8'));
const wb=Workbook.create();
const sheet=wb.worksheets.add('Closures');
const methods=wb.worksheets.add('Methodology');
const NAVY='#243A4D',INK='#263746',MUTED='#536474',PALE='#F2F5F8',LINK='#175B86';
const last=model.rows.length+1;
const methodLast=model.methods.length+5;
const literal=value=>typeof value==='string'&&value.startsWith('=')?"'"+value:value;
const rows=model.rows.map(row=>row.map(literal));
for(const row of rows)if(row[9])row[9]=new Date(String(row[9]).slice(0,10)+'T00:00:00Z');
sheet.showGridLines=false;sheet.tabColor=NAVY;
sheet.getRange(`A1:R${last}`).format={font:{name:'Arial',size:10,color:INK},fill:'#FFFFFF',
  verticalAlignment:'top',wrapText:true};
sheet.getRange('A1:R1').values=[model.columns.map(c=>c.name)];
sheet.getRange(`A2:R${last}`).values=rows;
for(let c=0;c<model.columns.length;c++)sheet.getRangeByIndexes(0,c,last,1).format.columnWidth=model.columns[c].width;
const table=sheet.tables.add(`A1:R${last}`,true,'BorderClosures');
table.style='TableStyleMedium2';table.showFilterButton=true;table.showTotals=false;
sheet.getRange(`A2:R${last}`).format.rowHeight=108;
sheet.getRange('A1:R1').format={fill:NAVY,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},
  verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,rowHeight:34,
  borders:{insideVertical:{style:'thin',color:'#FFFFFF'}}};
sheet.getRange(`A2:A${last}`).format.font={name:'Arial',size:10,bold:true,color:NAVY};
sheet.getRange(`J2:J${last}`).setNumberFormat('dd mmm yyyy');
sheet.getRange(`J2:J${last}`).format.wrapText=false;
sheet.getRange(`P2:P${last}`).setNumberFormat('0');
sheet.getRange(`P2:P${last}`).format.horizontalAlignment='right';
sheet.getRange(`K2:M${last}`).format.font={name:'Arial',size:10,color:LINK};
const escape=value=>String(value).replaceAll('"','""');
const linkFormulas=model.rows.map((row,i)=>[0,1,2].map(j=>{
  const url=model.links[i][j],label=row[10+j];
  // Native Excel evaluates the direct hyperlink. IFERROR retains its friendly
  // text in preview engines that do not implement hyperlink calculation.
  return url?`=IFERROR(HYPERLINK("${escape(url)}","${escape(label)}"),"${escape(label)}")`:null;
}));
sheet.getRange(`K2:M${last}`).formulas=linkFormulas;
sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(1);

methods.showGridLines=false;methods.tabColor='#8A99A6';
methods.getRange(`A1:B${methodLast}`).format={font:{name:'Arial',size:10,color:INK},fill:'#FFFFFF',
  verticalAlignment:'top',wrapText:true};
methods.getRange(`A1:A${methodLast}`).format.columnWidth=27;
methods.getRange(`B1:B${methodLast}`).format.columnWidth=111;
methods.getRange('A1').values=[['Methodology']];
methods.getRange('B1').values=[[model.title]];
methods.getRange('A1:B1').format={font:{name:'Arial',size:14,bold:true,color:NAVY},rowHeight:28,
  borders:{bottom:{style:'thin',color:'#C6D1D9'}}};
methods.getRange('A2').values=[['Research snapshot']];
methods.getRange('B2').values=[[model.subtitle]];
methods.getRange('A2:B2').format.rowHeight=34;
methods.getRange('A3:B3').values=[['Reading long entries','Rows fit their text where Excel permits. For unusually long cells, expand the formula bar to read the full entry; the data companion also retains complete phase narratives and source lists.']];
methods.getRange('A3:B3').format={font:{name:'Arial',size:9,color:MUTED},rowHeight:34};
methods.getRangeByIndexes(3,0,model.methods.length,2).values=model.methods;
for(let i=0;i<model.methods.length;i++){
  const row=i+4;
  const methodLines=Math.ceil(model.methods[i][1].length/95);
  methods.getRange(`A${row}:B${row}`).format={fill:i%2?PALE:'#FFFFFF',rowHeight:Math.max(58,methodLines*13+12)};
  methods.getRange(`A${row}`).format.font={name:'Arial',size:10,bold:true,color:NAVY};
}
methods.getRange(`A${methodLast}`).values=[['Data version']];
methods.getRange(`B${methodLast}`).values=[[model.data_state_sha256]];
methods.getRange(`A${methodLast}:B${methodLast}`).format={font:{name:'Arial',size:9,color:MUTED},rowHeight:26};

wb.recalculate();
// Fit the displayed evidence and multi-phase narratives to each record. Fixed
// heights clipped complete rationale and uncertainty paragraphs in the reader.
sheet.getRange(`A2:R${last}`).format.autofitRows();
const rowHeightLimits=[];
for(let i=0;i<model.rows.length;i++){
  const row=sheet.getRange(`A${i+2}:R${i+2}`);
  const fitted=row.format.rowHeight;
  // Excel supports at most 409 points. Preserve the full cell text; the reader
  // guide explains the expanded formula bar for the few longer narratives.
  if(fitted>409)rowHeightLimits.push({record_id:model.rows[i][0],row:i+2,fitted_height:fitted});
  row.format.rowHeight=Math.min(409,fitted+6);
}
const checks=[];
checks.push((await wb.inspect({kind:'table',sheetId:'Closures',range:'A1:C4',include:'values,formulas',tableMaxRows:4,tableMaxCols:3,maxChars:1600})).ndjson);
checks.push((await wb.inspect({kind:'table',sheetId:'Closures',range:'J1:M4',include:'values,formulas',tableMaxRows:4,tableMaxCols:4,maxChars:2200})).ndjson);
checks.push((await wb.inspect({kind:'table',sheetId:'Methodology',range:'A1:B6',include:'values,formulas',tableMaxRows:6,tableMaxCols:2,maxChars:2200})).ndjson);
const errors=[];
for(let i=0;i<model.links.length;i++)for(let j=0;j<model.links[i].length;j++){
  const value=sheet.getCell(i+1,j+10).values[0][0];
  if(value!==model.rows[i][j+10])errors.push({row:i+2,column:j+11,expected:model.rows[i][j+10],actual:value});
}
if(errors.length)throw Error('Source hyperlink labels did not calculate: '+JSON.stringify(errors.slice(0,3)));
await fs.mkdir(previewDir,{recursive:true});
for(const [name,sheetName,range] of [
  ['master-records','Closures','A1:D5'],['master-dates','Closures','E1:J5'],
  ['master-sources','Closures','K1:R5'],['methodology','Methodology',`A1:B${methodLast}`],
  ['recent-phase-sample','Closures',`E${Math.max(2,last-2)}:J${last}`],
  ['long-evidence-sample','Closures','G160:H160']]){
  const image=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(previewDir,name+'.png'),new Uint8Array(await image.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(wb);await output.save(outputPath);
await fs.writeFile(path.join(previewDir,'author-report.json'),JSON.stringify({
  author:'@oai/artifact-tool',sheets:['Closures','Methodology'],rows:model.rows.length,
  columns:model.columns.length,clickable_evidence_links:model.links.reduce((n,x)=>n+x.length,0),
  data_state_sha256:model.data_state_sha256,workbook_origin_sha256:model.workbook_origin_sha256,
  source_link_labels_checked:true,inspection:checks,row_height_limits:rowHeightLimits,
  native_excel_tested:false,publication:false},null,2)+'\n');
console.log(JSON.stringify({output:outputPath,rows:model.rows.length,sheets:2,links:model.links.reduce((n,x)=>n+x.length,0)}));
