import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, normalizeGenesisItem } from '../src/catalog.js';
import { createAlliance, initialState, MAX_NUMBER, validateState } from '../src/model.js';

const SOURCE = 'https://docs.google.com/spreadsheets/d/1nWc9ZuLXj-ak4ukKscmOM-_BzeJfBKQngirGgpalTEI/edit';
const SHEETS = {
 'Альянсы': ['A', 'D', 'F', 'H'],
 'Подфункции': ['A', 'D', 'F', 'H', 'J', 'L', 'N', 'P', 'R'],
 'Интерфейс': ['A', 'D', 'F'],
 'Прокачка': ['A', 'B', 'C', 'D'],
 'Эквип': ['A', 'B', 'C'],
 'Доступ': ['A', 'C', 'E'],
};
const COLORS = ['blue', 'purple', 'orange', 'green', 'pink'];
const ROLE_COLUMNS = { engineers: 'D', astrophysicists: 'F', astrobiologists: 'H', archivists: 'J', raiders: 'L' };
const normalized = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const itemKey = value => normalized(value).toLocaleLowerCase('ru');
const fail = message => { throw new Error(`Импорт «Генезиса»: ${message}`); };
const hasContent = value => value.trim() !== '' && value.trim() !== '-';

function cell(row, column, sheet, required = true) {
 const entry = row.cells[`${column}${row.number}`];
 if (entry === undefined || entry.value === undefined || entry.value === null) {
  if (required) fail(`${sheet}, ${column}${row.number}: отсутствует значение.`);
  return '';
 }
 const value = entry.value;
 if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
  fail(`${sheet}, ${column}${row.number}: ожидается текст или число.`);
 }
 const result = String(value);
 if (required && !result.trim()) fail(`${sheet}, ${column}${row.number}: пустое значение.`);
 return result;
}

function whole(value, label, { min = 0, max = MAX_NUMBER } = {}) {
 const raw = value.trim();
 if (!/^\d+(?:\.0+)?$/u.test(raw)) fail(`${label}: требуется целое число, получено «${raw}».`);
 const number = Number(raw);
 if (!Number.isSafeInteger(number) || number < min || number > max) fail(`${label}: число должно быть от ${min} до ${max}.`);
 return number;
}

function price(value, label) {
 const match = value.trim().match(/^(\d+(?:\.0+)?)\s*(?:крыш(?:ек|ечки|ечек))?$/iu);
 if (!match) fail(`${label}: не распознана цена «${value.trim()}».`);
 return whole(match[1], label);
}

function readSheets(workbook) {
 if (!Array.isArray(workbook)) fail('ожидается массив листов { name, rows }.');
 const sheets = new Map();
 for (const sheet of workbook) {
  if (!sheet || typeof sheet.name !== 'string' || !Array.isArray(sheet.rows)) fail('у листа должны быть name и массив rows.');
  const name = normalized(sheet.name);
  if (sheets.has(name)) fail(`повторный лист «${name}».`);
  const rows = new Map();
  for (const row of sheet.rows) {
   if (!row || !/^\d+$/u.test(String(row.row)) || Number(row.row) < 1 || !Number.isSafeInteger(Number(row.row)) || !row.cells || typeof row.cells !== 'object' || Array.isArray(row.cells)) fail(`«${name}»: неверная структура строки.`);
   const number = Number(row.row);
   if (rows.has(number)) fail(`«${name}»: строка ${number} указана дважды.`);
   for (const [address, entry] of Object.entries(row.cells)) {
    const match = address.match(/^([A-Z]+)([1-9]\d*)$/u);
    if (!match || Number(match[2]) !== number || !entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`«${name}»: неверная ячейка ${address}.`);
   }
   rows.set(number, { number, cells: row.cells });
  }
  sheets.set(name, [...rows.values()].sort((a, b) => a.number - b.number));
 }
 for (const [name, columns] of Object.entries(SHEETS)) {
  const rows = sheets.get(name);
  if (!rows) fail(`отсутствует обязательный лист «${name}».`);
  const header = rows.find(row => row.number === 1);
  if (!header) fail(`«${name}»: отсутствует строка заголовков 1.`);
  for (const column of columns) cell(header, column, name);
 }
 return sheets;
}

function dataRows(sheets, name) {
 return sheets.get(name).filter(row => row.number !== 1 && Object.values(row.cells).some(entry => entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== ''));
}

function allianceRows(sheets, sheet) {
 const result = new Map();
 for (const row of dataRows(sheets, sheet)) {
  const sourceName = cell(row, 'A', sheet);
  const key = normalized(sourceName);
  if (result.has(key)) fail(`«${sheet}»: альянс «${key}» указан дважды.`);
  result.set(key, { row, sourceName });
 }
 return result;
}

function chargeValue(raw, label) {
 const parts = raw.trim().split(/\s*[/\\]\s*/u);
 if (parts.length > 2) fail(`${label}: ожидается заряд или заряд/ёмкость.`);
 const charge = whole(parts[0], label);
 if (parts.length === 1) return { charge, maxCharge: Math.max(1, charge), maxChargeKnown: false };
 const maxCharge = whole(parts[1], `${label}, ёмкость`, { min: 1 });
 if (charge > maxCharge) fail(`${label}: заряд превышает указанную ёмкость.`);
 return { charge, maxCharge, maxChargeKnown: true };
}

function countValue(raw, label, allowLeadingText = false) {
 if (!hasContent(raw)) return 0;
 if (/^\d+(?:\.0+)?$/u.test(raw.trim())) return whole(raw, label, { max: 10000 });
 if (allowLeadingText) {
  const leading = raw.trim().match(/^(\d+(?:\.0+)?)\s+\S/u);
  if (leading) return whole(leading[1], label, { max: 10000 });
 }
 return 0;
}

function importPlanets(alliance, raw) {
 const outpostCount = countValue(raw.cadia, `${alliance.name}, аванпосты`);
 alliance.planets.cadia.outposts = Array.from({ length: outpostCount }, (_, index) => ({
  id: `${alliance.id}-outpost-${index + 1}`,
  name: `Аванпост ${index + 1} (название не указано)`,
  bonusKnown: false,
  bonus: { caps: 0, xp: 0, actionPoints: 0, toolId: null, quantity: 0 },
  claimed: false,
 }));
 const territoryCount = countValue(raw.fenris, `${alliance.name}, узлы`, true);
 alliance.planets.fenris.territories = Array.from({ length: territoryCount }, (_, index) => ({
  id: `${alliance.id}-territory-${index + 1}`,
  name: `Узел ${index + 1} (название не указано)`,
  note: hasContent(raw.fenris) ? raw.fenris : 'Название отсутствует в исходной таблице',
 }));
 const names = [...raw.cronus.matchAll(/(?:^|[^\p{L}\p{N}])Шаттл\s+[«"']?([\p{L}][\p{L}\p{N}-]*)/giu)].map(match => match[1]);
 if (new Set(names.map(itemKey)).size !== names.length) fail(`${alliance.name}: имя шаттла в исходной записи повторяется.`);
 alliance.planets.cronus.shuttles = names.map((name, index) => ({ id: `${alliance.id}-shuttle-${index + 1}`, name, note: raw.cronus }));
}

function importCatalog(sheets, state) {
 const expected = catalog.filter(item => ['access', 'upgrades', 'equipment', 'tools'].includes(item.category));
 const matched = new Map();
 const sourceItems = [];
 const normalizedEffects = [];
 for (const sheet of ['Прокачка', 'Эквип', 'Доступ']) {
  const allowed = sheet === 'Прокачка' ? ['upgrades'] : sheet === 'Эквип' ? ['equipment', 'tools'] : ['access'];
  for (const row of dataRows(sheets, sheet)) {
   const name = cell(row, sheet === 'Доступ' ? 'E' : 'A', sheet);
   const candidates = expected.filter(item => allowed.includes(item.category) && itemKey(item.name) === itemKey(name));
   if (candidates.length !== 1) fail(`${sheet}, строка ${row.number}: в каталоге не найдено однозначное соответствие «${name.trim()}».`);
   const item = candidates[0];
   if (matched.has(item.id)) fail(`${sheet}, строка ${row.number}: товар «${name.trim()}» указан дважды.`);
   const override = {};
   let recipeText;
   if (item.category === 'tools') {
    const toolLevel = whole(cell(row, 'B', sheet), `${sheet}, B${row.number}: уровень инструмента`, { max: 999 });
    if (toolLevel !== item.toolLevel) { override.toolLevel = toolLevel; override.effect = `Уровень инструмента: ${toolLevel}`; }
   } else {
    const sourceEffect = cell(row, sheet === 'Прокачка' ? 'C' : sheet === 'Доступ' ? 'A' : 'B', sheet);
    const effect = normalizeGenesisItem({ ...item, effect: sourceEffect }).effect;
    if (effect !== sourceEffect) normalizedEffects.push({ id: item.id, sourceEffect, effect });
    if (effect !== item.effect) override.effect = effect;
   }
   if (sheet === 'Доступ' || sheet === 'Прокачка') {
    const sourcePrice = price(cell(row, sheet === 'Доступ' ? 'C' : 'B', sheet), `${sheet}, строка ${row.number}`);
    if (sourcePrice !== item.price) override.price = sourcePrice;
   }
   if (sheet !== 'Доступ') {
    recipeText = cell(row, sheet === 'Прокачка' ? 'D' : 'C', sheet, item.id !== 'upgrade-27');
    if (recipeText !== item.recipeText) override.recipeText = recipeText;
   }
   if (Object.keys(override).length) state.itemOverrides[item.id] = override;
   const entry = { id: item.id, category: item.category, sheet, row: row.number, sourceName: name, ...(recipeText === undefined ? {} : { recipeText }) };
   matched.set(item.id, entry);
   sourceItems.push(entry);
  }
 }
 const missing = expected.filter(item => !matched.has(item.id));
 if (missing.length) fail(`неполный каталог: отсутствуют ${missing.map(item => `${item.name} (${item.category})`).join(', ')}.`);
 return {
  counts: Object.fromEntries(['access', 'upgrades', 'equipment', 'tools'].map(category => [category, sourceItems.filter(item => item.category === category).length])),
  sourceItems,
  normalizedEffects,
  missing: [],
  recipeReview: expected.filter(item => item.recipeIssue || item.needsRecipeReview).map(item => ({ id: item.id, name: item.name, recipeText: matched.get(item.id).recipeText ?? item.recipeText, issue: item.recipeIssue || 'Исходный рецепт допускает неоднозначное прочтение; требуется подтверждение прайма.' })),
 };
}

/** Convert the six cached XLSX sheets without changing the workbook or any live site. */
export function convertGenesisWorkbook(workbook, { now } = {}) {
 const date = new Date(now ?? Date.now());
 if (!Number.isFinite(date.getTime())) fail('now должен содержать корректную дату.');
 const sheets = readSheets(workbook);
 const rows = Object.fromEntries(['Альянсы', 'Подфункции', 'Интерфейс'].map(name => [name, allianceRows(sheets, name)]));
 if (!rows['Альянсы'].size) fail('в листе «Альянсы» нет альянсов.');
 for (const sheet of ['Подфункции', 'Интерфейс']) {
  for (const name of rows['Альянсы'].keys()) if (!rows[sheet].has(name)) fail(`«${sheet}»: отсутствует строка альянса «${name}».`);
  for (const name of rows[sheet].keys()) if (!rows['Альянсы'].has(name)) fail(`«${sheet}»: неизвестный альянс «${name}», которого нет в листе «Альянсы».`);
 }
 const state = initialState(true);
 state.shift = { name: 'Генезис', day: 1, duration: 11 };
 state.rules.levelThresholds = Array.from({ length: 100 }, (_, index) => index * 100);
 const allianceReport = [];
 for (const [name, { row }] of rows['Альянсы']) {
  const sub = rows['Подфункции'].get(name).row;
  const iface = rows['Интерфейс'].get(name).row;
  const alliance = createAlliance(name, 'К новым мирам — вместе', COLORS[state.alliances.length % COLORS.length]);
  alliance.id = `genesis-alliance-${state.alliances.length + 1}`;
  alliance.caps = whole(cell(row, 'D', 'Альянсы'), `${name}, крышечки`);
  alliance.xp = whole(cell(row, 'F', 'Альянсы'), `${name}, опыт`, { max: 9999 });
  const sourceLevel = cell(row, 'H', 'Альянсы');
  const leadingLevel = sourceLevel.trim().match(/^(\d+)(?:\.0+)?(?=$|\s|\+)/u);
  if (!leadingLevel) fail(`${name}, уровень: не распознана запись «${sourceLevel}».`);
  const level = whole(leadingLevel[1], `${name}, уровень`, { min: 1 });
  const baseLevel = Math.floor(alliance.xp / 100) + 1;
  if (level < baseLevel) fail(`${name}: исходный уровень ${level} ниже уровня ${baseLevel} по опыту; отрицательный бонус недопустим.`);
  alliance.bonusLevels = level - baseLevel;
  alliance.earnedCaps = 0;
  alliance.earnedCapsKnown = false;
  for (const [role, column] of Object.entries(ROLE_COLUMNS)) alliance.functions[role] = whole(cell(sub, column, 'Подфункции'), `${name}, ${role}`);
  const sourceCharge = cell(iface, 'F', 'Интерфейс');
  Object.assign(alliance.interface, chargeValue(sourceCharge, `${name}, заряд`), {
   gravitons: whole(cell(iface, 'D', 'Интерфейс'), `${name}, гравитоны`),
   gravitonsPurchased: 0,
   resilience: 0,
   resilienceKnown: false,
  });
  const raw = { cadia: cell(sub, 'N', 'Подфункции', false), fenris: cell(sub, 'P', 'Подфункции', false), cronus: cell(sub, 'R', 'Подфункции', false) };
  alliance.sourceNotes = { level: sourceLevel };
  for (const [planet, value] of Object.entries(raw)) if (hasContent(value)) alliance.sourceNotes[planet] = value;
  alliance.sourceNotes.missing = 'В таблице не указаны: исторически заработанные крышечки; искатели; полный инвентарь, улучшения и полученные устройства; очки действий на Кадии.';
  importPlanets(alliance, raw);
  if (itemKey(name) === 'гагарина' && /расщепитель\s*1(?:\D|$)/iu.test(sourceLevel)) {
   const splitter = catalog.find(item => item.category === 'upgrades' && item.name === 'Лазерный расщепитель I');
   if (!splitter) fail('в каталоге отсутствует «Лазерный расщепитель I».');
   alliance.upgrades.push(splitter.id);
  }
  state.alliances.push(alliance);
  allianceReport.push({ id: alliance.id, name, sourceRows: { alliances: row.number, functions: sub.number, interface: iface.number }, sourceLevel, baseLevel, bonusLevels: alliance.bonusLevels, sourceCharge, maxChargeKnown: alliance.interface.maxChargeKnown, outposts: alliance.planets.cadia.outposts.length, territories: alliance.planets.fenris.territories.length, shuttles: alliance.planets.cronus.shuttles.length, importedUpgrades: [...alliance.upgrades] });
 }
 const catalogReport = importCatalog(sheets, state);
 const missingFor = predicate => state.alliances.filter(predicate).map(alliance => alliance.name);
 const allNames = missingFor(() => true);
 const report = {
  format: 'orbita-genesis-import-report-v1',
  createdAt: date.toISOString(),
  source: { url: SOURCE, sheets: [...sheets].map(([name, sourceRows]) => ({ name, dataRows: sourceRows.filter(row => row.number !== 1).length })) },
  summary: { alliances: state.alliances.length, catalogEntries: catalogReport.sourceItems.length, recipesChecked: catalogReport.counts.upgrades + catalogReport.counts.equipment + catalogReport.counts.tools, importedUpgrades: allianceReport.reduce((sum, alliance) => sum + alliance.importedUpgrades.length, 0) },
  defaults: [
   { field: 'shift.day', value: 1, reason: 'Текущий сол в источнике не указан.' },
   { field: 'shift.duration', value: 11, reason: 'По уточнению прайма: путешествие длится 11 солов.' },
   { field: 'rules.levelThresholds', value: '0, 100, …, 9900', reason: 'По уточнению прайма: шаг уровня 100 опыта; находки +уровень учтены отдельным бонусом.' },
   { field: 'interface.gravitonsPurchased', value: 0, reason: 'Счётчик покупок ведётся с момента импорта; прошлое количество покупок неизвестно. Общего лимита гравитонов нет.' },
  ],
  unknown: [
   { field: 'interface.maxCharge', alliances: missingFor(alliance => !alliance.interface.maxChargeKnown), behavior: 'Сохранён только текущий заряд; maxCharge равен Math.max(1, charge) как техническое значение, ёмкость не считается известной.' },
   { field: 'interface.resilience', alliances: allNames, behavior: 'Неизвестно; внутреннее значение 0, resilienceKnown=false.' },
   { field: 'earnedCaps', alliances: allNames, behavior: 'Прошлые поступления неизвестны; 0 и earnedCapsKnown=false, новые награды считаются после импорта.' },
   { field: 'inventory/upgrades/access/children', alliances: allNames, behavior: 'Полного списка владений и искателей нет; массивы и инвентарь пусты, кроме явно указанного у Гагарина расщепителя I.' },
   { field: 'interface.gravitonsPurchased', alliances: allNames, behavior: 'История покупок не указана; счётчик начинается с 0.' },
   { field: 'planets.cadia.actionPoints', alliances: allNames, behavior: 'В таблице есть ОД райдеров, но отдельные ОД Кадии не указаны; внутреннее значение 0.' },
  ],
  planets: { outpostBonusesUnknown: state.alliances.reduce((sum, alliance) => sum + alliance.planets.cadia.outposts.length, 0), note: 'Количества представлены объектами с явной пометкой об отсутствующем названии. Текстовые бонусы сохранены в sourceNotes; награды не начислялись, дополнительные владения не создавались.' },
  alliances: allianceReport,
  catalog: catalogReport,
  warnings: [...sheets.keys()].filter(name => !Object.hasOwn(SHEETS, name)).map(name => `Дополнительный лист «${name}» не импортирован.`),
 };
 if (!validateState(state)) fail('результат не проходит проверку модели сайта; импорт не записан.');
 return { state, report };
}

async function main(args) {
 if (args.length !== 2) {
  console.error('Использование: node scripts/import_genesis.mjs <workbook.json> <state-output.json>');
  process.exitCode = 2;
  return;
 }
 const [input, output] = args.map(value => resolve(value));
 const reportPath = resolve(dirname(output), `${basename(output, extname(output))}.report.json`);
 if (input === output || input === reportPath || output === reportPath) fail('пути исходника, состояния и отчёта должны различаться.');
 const { state, report } = convertGenesisWorkbook(JSON.parse(await readFile(input, 'utf8')));
 await mkdir(dirname(output), { recursive: true });
 for (const [path, data] of [[output, state], [reportPath, report]]) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
 }
 console.log(`Подготовлено: ${state.alliances.length} альянсов, ${report.summary.catalogEntries} товаров.\nСостояние: ${output}\nОтчёт: ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
