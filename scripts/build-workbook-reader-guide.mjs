#!/usr/bin/env node
/** Author the new front sheet with the Codex primary-runtime artifact tool. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const [modelPath, outputPath, previewDirectory] = process.argv.slice(2);
if (!previewDirectory) throw new Error('Usage: build-workbook-reader-guide.mjs model.json guide.xlsx previews');
const model = JSON.parse(await fs.readFile(modelPath, 'utf8'));
const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Start here');
// These names make every internal destination explicit during authoring. Only
// Start here is extracted into the release; none of these placeholders is used.
for (const name of model.originalSheets) workbook.worksheets.add(name);
const NAVY='#243A4D', INK='#263746', MUTED='#536474', PALE='#F1F5F8', LINK='#175B86';
sheet.showGridLines=false;
sheet.tabColor=NAVY;
sheet.getRange('A1:D40').format={font:{name:'Arial',size:10,color:INK},fill:'#FFFFFF',verticalAlignment:'top',wrapText:true};
for (const [col,width] of [['A',3],['B',29],['C',91],['D',3]]) sheet.getRange(`${col}1:${col}40`).format.columnWidth=width;
sheet.getRange('A1:D40').format.rowHeight=12;
const links=[];
function merged(row,text,height=28,format={}){
  sheet.mergeCells(`B${row}:C${row}`);
  sheet.getRange(`B${row}`).values=[[text]];
  sheet.getRange(`B${row}:C${row}`).format={...format};
  sheet.getRange(`A${row}:D${row}`).format.rowHeight=height;
}
function section(row,text){merged(row,text,26,{font:{name:'Arial',size:11,bold:true,color:NAVY},verticalAlignment:'center',borders:{bottom:{style:'thin',color:'#C6D1D9'}}});}
function row(number,label,description,height=42,link=null){
  sheet.getRange(`B${number}:C${number}`).values=[[label,description]];
  sheet.getRange(`A${number}:D${number}`).format.rowHeight=height;
  sheet.getRange(`B${number}:C${number}`).format.fill=number%2?PALE:'#FFFFFF';
  sheet.getRange(`B${number}`).format.font={name:'Arial',size:10,bold:true,color:link?LINK:INK};
  if(link){
    const formula=`=HYPERLINK("#'${link.sheet.replaceAll("'","''")}'!${link.cell}","${label.replaceAll('"','""')}")`;
    links.push({cell:`B${number}`,sheet:link.sheet,target:link.cell,label,formula});
  }
}
merged(2,'Global Border Closures Atlas',30,{font:{name:'Arial',size:16,bold:true,color:NAVY},wrapText:false});
merged(3,'Workbook guide. Research snapshot: 23 October 2026.',22,{font:{name:'Arial',size:10,italic:true,color:MUTED},wrapText:false});
section(5,'Start with the Register');
row(6,'Open Register',`${model.recordCount} records covering land-border restrictions within 21 October 2016 to 21 October 2026. Filter “Analysis inclusion” to “Included” for the ${model.includedCount} records used in the atlas analyses.`,48,{sheet:'Register',cell:'A5'});
row(7,'Read current corrections','Register is the main record index. Current record corrections (column Y) take precedence over earlier descriptions. Read these with the current timing and rationale fields.',48,{sheet:'Register',cell:'Y5'});
merged(8,'Use the same Record ID to follow a case across the sheets below.',23,{font:{name:'Arial',size:10,italic:true,color:MUTED}});

section(10,'Open the supporting data');
row(11,'Chronology phases','Current scoped timing evidence. Each row is a dated observation or period for a defined restriction, movement or location. Several phases may belong to one record.',48,{sheet:'Chronology phases',cell:'A1'});
row(12,'Durations','Current timing summary for each record, with date bounds, duration interpretation, evidence and qualifications. “Confirmed through” is not a reopening date.',48,{sheet:'Durations',cell:'A1'});
row(13,'Rationale coding','Current rationale categories and subcategories, with attribution, phase notes and sources. A record can have more than one rationale.',40,{sheet:'Rationale coding',cell:'A1'});
row(14,'Source index','Source links and labelled retrieval notes from every research stage. Check the current phase or rationale for what a source supports.',40,{sheet:'Source index',cell:'A1'});

section(16,'Read current and historical evidence');
row(17,'What is a record?','An analytical entry that brings reports together about a restriction episode or regime. One record can cover several crossings, periods or traffic categories.',44);
row(18,'Use current findings','Use Register’s inclusion, current fields and corrections, then the scoped evidence in Chronology phases and Rationale coding. Earlier assessments can be superseded by a later review.',48);
row(19,'Keep dates in scope','A phase ending at its last confirmed date does not establish reopening or continued closure afterwards. Do not treat the original parent dates as one continuous, current duration.',48);
row(20,'Historical columns','Register columns K:O and S:W retain older claims and original dates. They are hidden by default. To inspect them, select columns J:P or R:X, then choose Unhide Columns.',48);

section(22,'Find the retained supporting worksheets');
merged(23,`${model.originalSheets.length-5} additional worksheets are hidden to keep the opening view simple. Their cells, formulas and evidence remain in the file. Hidden sheets include both current supporting detail and earlier research.`,44);
row(24,'Unhide a worksheet','In Excel, right-click a visible sheet tab and choose Unhide, then select a sheet. Other spreadsheet apps provide a similar sheet-visibility command.',44);
row(25,'Current review detail','Audit review (current outcome alongside initial review fields), Follow-up review and Unresolved queue. These retain qualifications, adjudications and outstanding evidence needs.',48);
row(26,'Sources and geography','Chronology sources, Relationships, Locations, Phase locations and Country-year coverage. They retain detailed source, relationship, location and search information.',48);
row(27,'Earlier research','Claim checks, Full audit, Source review, Rationale revision and the Round 2–16 sheets retain earlier findings and research history. They do not replace the current scoped conclusions.',48);
row(28,'Definitions and summaries','Codebook retains definitions alongside earlier snapshots. Release summary and Timing coverage retain release diagnostics, including labelled historical totals. Read the labels before comparing figures.',48);
merged(30,'All 55 original worksheets remain available.',30,{font:{name:'Arial',size:10,italic:true,color:MUTED}});

workbook.recalculate();
const check=await workbook.inspect({kind:'table',range:"'Start here'!B2:C14",include:'values,formulas',tableMaxRows:13,tableMaxCols:2,maxChars:2500});
console.log(check.ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:2000,summary:'reader guide formula error scan'});
console.log(errors.ndjson);
await fs.mkdir(previewDirectory,{recursive:true});
for(const [name,range] of [['start-here','A1:D20'],['supporting-worksheets','A22:D30']]){
  const preview=await workbook.render({sheetName:'Start here',range,scale:1,format:'png'});
  await fs.writeFile(path.join(previewDirectory,`${name}.png`),new Uint8Array(await preview.arrayBuffer()));
}
// The artifact engine exports HYPERLINK formulas but cannot evaluate them. The
// preview uses their authored labels; the narrow native assembler keeps these
// exact formulas and records their known friendly-name caches for Excel.
for(const link of links) sheet.getRange(link.cell).formulas=[[link.formula]];
workbook.recalculate();
const output=await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.writeFile(`${outputPath}.json`,JSON.stringify({author:'@oai/artifact-tool',builder:'scripts/build-workbook-reader-guide.mjs',links,originalSheets:model.originalSheets},null,2)+'\n');
console.log(JSON.stringify({output:outputPath,guide:'Start here',internalLinks:links.length,originalCellsAuthored:0}));
