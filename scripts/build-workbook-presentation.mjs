#!/usr/bin/env node
/**
 * Author the workbook's presentation resources with @oai/artifact-tool.
 * Run with the Codex primary runtime in a task-specific temporary directory.
 * The release assembler copies the authored OOXML presentation resources into
 * the original package; no research values or cached formulas are re-exported.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const FONT = 'Arial';
const NAVY = '#243A4D';
const INK = '#263746';
const STRIPE = '#F1F5F8';
const LINK = '#175B86';

function column(number) {
  let result = '';
  while (number) { const n = (number - 1) % 26; result = String.fromCharCode(65 + n) + result; number = Math.floor((number - 1) / 26); }
  return result;
}

function formatFor(role) {
  const base = {font: {name: FONT, size: 10, color: INK}, fill: '#FFFFFF',
    horizontalAlignment: 'left', verticalAlignment: 'top', wrapText: true};
  if (role === 'header') return {...base, fill: NAVY, font: {name: FONT, size: 10, bold: true, color: '#FFFFFF'},
    horizontalAlignment: 'center', verticalAlignment: 'center',
    borders: {left: {style: 'thin', color: '#FFFFFF'}, right: {style: 'thin', color: '#FFFFFF'}, bottom: {style: 'thin', color: NAVY}}};
  if (role === 'title') return {...base, font: {name: FONT, size: 15, bold: true, color: NAVY}, verticalAlignment: 'center', wrapText: false};
  if (role === 'context') return {...base, font: {name: FONT, size: 10, italic: true, color: '#536474'}, verticalAlignment: 'center', wrapText: false};
  if (role.endsWith('1')) base.fill = STRIPE;
  if (role.startsWith('key')) base.font.bold = true;
  if (role.startsWith('number')) base.horizontalAlignment = 'right';
  if (role.startsWith('link')) base.font.color = LINK;
  return base;
}

function assignValue(range, cell) {
  let value = cell.value;
  if (cell.type === 'd' && typeof value === 'string') value = new Date(value);
  if (typeof value === 'string' && value.startsWith('=')) value = "'" + value;
  range.values = [[value]];
  if (cell.numberFormat && cell.numberFormat !== 'General') range.setNumberFormat(cell.numberFormat);
}

function fillSheet(workbook, spec, original = false) {
  const sheet = workbook.worksheets.add(spec.name);
  sheet.showGridLines = false;
  const widths = original ? spec.oldWidths : spec.widths;
  for (let i = 0; i < widths.length; i++) sheet.getRange(`${column(i + 1)}1:${column(i + 1)}${spec.headerRow + 7}`).format.columnWidth = widths[i];
  for (const row of spec.sample) {
    sheet.getRange(`A${row.number}:${column(spec.lastColumn)}${row.number}`).format.rowHeight = original ? row.oldHeight : row.height;
    for (const cell of row.cells) {
      const range = sheet.getRange(cell.address);
      assignValue(range, cell);
      range.format = original ? cell.originalStyle : formatFor(cell.role);
    }
  }
  for (const ref of spec.merges) sheet.mergeCells(ref);
  if (!original) {
    if (spec.freezeRows) sheet.freezePanes.freezeRows(spec.freezeRows);
    if (spec.freezeColumns) sheet.freezePanes.freezeColumns(spec.freezeColumns);
    if (spec.name === 'Register' || spec.name === 'Chronology phases') sheet.tabColor = NAVY;
    if (spec.name === 'Codebook' || spec.name === 'Release summary') sheet.tabColor = '#718899';
  }
  // The research package keeps its full native table. This short table is only
  // the visual review sample; its content is never merged into the release.
  const table = sheet.tables.add(`A${spec.headerRow}:${column(spec.lastColumn)}${spec.headerRow + 7}`, true, spec.tableName);
  table.style = 'TableStyleMedium2';
  // Reapply headers because native table defaults may replace the explicit fill.
  if (!original) sheet.getRange(`A${spec.headerRow}:${column(spec.lastColumn)}${spec.headerRow}`).format = formatFor('header');
  return sheet;
}

async function render(workbook, spec, directory, prefix) {
  const lastColumn = Math.min(spec.lastColumn, spec.name === 'Register' ? 7 : 5);
  const endRow = Math.min(spec.headerRow + 4, spec.lastRow);
  const image = await workbook.render({sheetName: spec.name, range: `A1:${column(lastColumn)}${endRow}`, scale: 1, format: 'png'});
  const filename = `${prefix}-${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  await fs.writeFile(path.join(directory, filename), new Uint8Array(await image.arrayBuffer()));
  console.log(JSON.stringify({preview: filename, sheet: spec.name}));
}

async function main() {
  const [modelPath, outputPath, previewDirectory] = process.argv.slice(2);
  if (!modelPath || !outputPath || !previewDirectory) throw new Error('Usage: build-workbook-presentation.mjs model.json palette.xlsx preview-directory');
  const model = JSON.parse(await fs.readFile(modelPath, 'utf8'));
  await fs.mkdir(previewDirectory, {recursive: true});
  const previewArgument = process.argv.find(arg => arg.startsWith('--preview-sheets='));
  const previewNames = previewArgument ? new Set(previewArgument.split('=')[1].split(',')) : null;
  if (!previewNames) {
    const before = Workbook.create();
    for (const name of ['Register', 'Claim checks', 'Release summary']) fillSheet(before, model.sheets.find(s => s.name === name), true);
    before.recalculate();
    for (const name of ['Register', 'Claim checks', 'Release summary']) await render(before, model.sheets.find(s => s.name === name), previewDirectory, 'before');
  }

  const workbook = Workbook.create();
  for (const spec of model.sheets) fillSheet(workbook, spec);
  const palette = workbook.worksheets.add('Presentation resources');
  const manifest = {roles: {}, widths: {}, heights: {}};
  model.roles.forEach((role, i) => {
    const address = `A${i + 1}`;
    palette.getRange(address).values = [[role]];
    palette.getRange(address).format = formatFor(role);
    manifest.roles[role] = address;
  });
  model.widths.forEach((width, i) => {
    palette.getRange(`${column(i + 1)}1:${column(i + 1)}${model.heights.length}`).format.columnWidth = width;
    manifest.widths[width] = i + 1;
  });
  model.heights.forEach((height, i) => {
    palette.getRange(`A${i + 1}:B${i + 1}`).format.rowHeight = height;
    manifest.heights[height] = i + 1;
  });
  workbook.recalculate();
  const errorScan = await workbook.inspect({kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',
    options: {useRegex: true, maxResults: 30}, maxChars: 2000, summary: 'presentation sample error scan'});
  console.log(errorScan.ndjson);
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
  await fs.writeFile(outputPath + '.json', JSON.stringify(manifest, null, 2));
  for (const name of ['Register', 'Claim checks', 'Release summary', 'Chronology phases', 'Codebook', 'Source index']) {
    if (previewNames && !previewNames.has(name)) continue;
    await render(workbook, model.sheets.find(s => s.name === name), previewDirectory, 'after');
  }
  for (const spec of model.sheets) {
    if (['Register', 'Claim checks', 'Release summary', 'Chronology phases', 'Codebook', 'Source index'].includes(spec.name)) continue;
    if (previewNames && !previewNames.has(spec.name)) continue;
    await render(workbook, spec, previewDirectory, 'after');
  }
  console.log(JSON.stringify({output: outputPath, sheetPreviews: model.sheets.length, artifactAuthored: true}));
}

main().catch(error => { console.error(String(error)); process.exitCode = 1; });
