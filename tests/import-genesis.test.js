import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { catalog, getItem } from '../src/catalog.js';
import { adjustResource, allianceLevel, claimOutpostBonus, validateState } from '../src/model.js';
import { convertGenesisWorkbook } from '../scripts/import_genesis.mjs';

const NOW = '2026-10-15T10:00:00.000Z';
const row = (number, values) => ({ row: String(number), cells: Object.fromEntries(Object.entries(values).map(([column, value]) => [`${column}${number}`, { value }])) });
const sheet = (name, headers, values) => ({ name, rows: [row(1, headers), ...values] });
const inputSheet = (workbook, name) => workbook.find(entry => entry.name === name);
const fixture = () => [
 sheet('Альянсы', { A: 'Альянс', D: 'Крышечки', F: 'Опыт', H: 'Уровень' }, [
  row(3, { A: ' Королёва ', D: '1200.0', F: '460.0', H: '7.0' }),
  row(5, { A: 'Гагарина', D: '2600.0', F: '400.0', H: '6+расщепитель 1' }),
 ]),
 sheet('Подфункции', { A: 'Aльянc', D: 'Инженеры', F: 'Астрофизики', H: 'Астробиологи', J: 'Архивариус', L: 'Очки действий', N: 'Кадия\nАванпосты', P: 'Фенрис\nИсследовано узлов', R: 'Кронус\nШаттлов во владении' }, [
  row(3, { A: 'Королёва', D: '12.0', F: '13.0', H: '14.0', J: '13.0', L: '12.0', N: '2.0', P: '2.0', R: '0\\4 Шаттл Молния' }),
  row(5, { A: 'Гагарина', D: '14.0', F: '15.0', H: '14.0', J: '13.0', L: '10.0', N: '3 действия бесплатно', P: '6 3дейтсвия бесплатно', R: '3 действия бесплатно' }),
 ]),
 sheet('Интерфейс', { A: 'Интерфейс', D: 'Гравитоны', F: 'Заряд' }, [
  row(3, { A: '\tКоролёва\u00a0', D: '52.0', F: '210.0' }),
  row(5, { A: 'Гагарина', D: '45.0', F: '300\\300' }),
 ]),
 sheet('Прокачка', { A: 'Название', B: 'цена', C: 'эффект', D: 'крафт' }, catalog.filter(item => item.category === 'upgrades').map((item, index) => row(index + 2, {
  A: item.name, B: `${item.price} крышек`, C: item.effect, ...(item.kind === 'graviton' ? {} : { D: item.recipeText }),
 }))),
 sheet('Эквип', { A: 'Нaзвание', B: 'эффект, требование', C: 'крафт' }, catalog.filter(item => ['equipment', 'tools'].includes(item.category)).map((item, index) => row(index + 2, {
  A: item.name, B: item.category === 'tools' ? `${item.toolLevel}.0` : item.effect, C: item.recipeText,
 }))),
 sheet('Доступ', { A: 'эффект', C: 'цена', E: 'названия' }, catalog.filter(item => item.category === 'access').map((item, index) => row(index * 2 + 3, {
  A: item.id === 'access-1' ? ' Плейлист из исходной таблицы (согласование) ' : item.effect,
  C: item.id === 'access-1' ? '850 крышечки' : `${item.price} крышечки`,
  E: item.name.toLocaleLowerCase('ru').replace(' ', '  '),
 }))),
];

function freeze(value) {
 if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
 return value;
}

test('six-sheet import joins normalized names, preserves levels and creates no demo ownership', () => {
 const workbook = freeze(fixture());
 const before = JSON.stringify(workbook);
 const { state, report } = convertGenesisWorkbook(workbook, { now: NOW });
 assert.ok(validateState(state));
 assert.equal(JSON.stringify(workbook), before);
 assert.deepEqual(convertGenesisWorkbook(workbook, { now: NOW }), { state, report });
 assert.deepEqual(state.shift, { name: 'Генезис', day: 1, duration: 11 });
 assert.deepEqual(state.rules.levelThresholds, Array.from({ length: 100 }, (_, index) => index * 100));
 assert.deepEqual(state.alliances.map(alliance => alliance.id), ['genesis-alliance-1', 'genesis-alliance-2']);
 const [first, second] = state.alliances;
 assert.equal(first.name, 'Королёва');
 assert.deepEqual([first.caps, first.xp, first.bonusLevels, allianceLevel(state, first)], [1200, 460, 2, 7]);
 assert.deepEqual([second.xp, second.bonusLevels, allianceLevel(state, second)], [400, 1, 6]);
 assert.deepEqual(first.functions, { engineers: 12, astrophysicists: 13, astrobiologists: 14, archivists: 13, raiders: 12 });
 for (const alliance of state.alliances) {
  assert.deepEqual(alliance.children, []);
  assert.deepEqual(alliance.inventory, {});
  assert.deepEqual(alliance.access, []);
  assert.equal(alliance.earnedCaps, 0);
  assert.equal(alliance.earnedCapsKnown, false);
  assert.doesNotMatch(alliance.sourceNotes.missing, /стойк|ёмк|куплен.{0,16}гравитон/iu);
 }
 assert.deepEqual(first.upgrades, []);
 assert.deepEqual(second.upgrades, ['upgrade-18']);
 assert.deepEqual(state.events, []);
 assert.equal(report.createdAt, NOW);
 assert.equal(report.summary.recipesChecked, 99);
 assert.equal(report.summary.catalogEntries, 110);
 assert.equal(report.defaults.find(entry => entry.field === 'shift.duration').value, 11);
 assert.match(report.defaults.find(entry => entry.field === 'shift.duration').reason, /уточнению прайма/);
});

test('unknown capacity stays unknown and larger graviton totals are not clamped', () => {
 const { state, report } = convertGenesisWorkbook(fixture(), { now: NOW });
 const [unknown, known] = state.alliances;
 assert.deepEqual([unknown.interface.charge, unknown.interface.maxCharge, unknown.interface.maxChargeKnown, unknown.interface.gravitons], [210, 210, false, 52]);
 assert.deepEqual([known.interface.charge, known.interface.maxCharge, known.interface.maxChargeKnown], [300, 300, true]);
 for (const alliance of state.alliances) {
  assert.equal(alliance.interface.resilience, 0);
  assert.equal(alliance.interface.resilienceKnown, false);
  assert.equal(alliance.interface.gravitonsPurchased, 0);
 }
 assert.deepEqual(report.unknown.find(entry => entry.field === 'interface.maxCharge').alliances, ['Королёва']);
 assert.equal(report.unknown.find(entry => entry.field === 'interface.resilience').alliances.length, 2);
 const workbook = fixture();
 inputSheet(workbook, 'Интерфейс').rows[2].cells.F5.value = '75/300';
 const changed = convertGenesisWorkbook(workbook, { now: NOW }).state.alliances[1].interface;
 assert.deepEqual([changed.charge, changed.maxCharge], [75, 300]);
 inputSheet(workbook, 'Интерфейс').rows[1].cells.F3.value = '0.0';
 const zero = convertGenesisWorkbook(workbook, { now: NOW }).state;
 assert.ok(validateState(zero));
 assert.deepEqual([zero.alliances[0].interface.charge, zero.alliances[0].interface.maxCharge, zero.alliances[0].interface.maxChargeKnown], [0, 1, false]);
});

test('planet notes remain verbatim, counts create placeholders, and bonuses never invent ownership', () => {
 const { state, report } = convertGenesisWorkbook(fixture(), { now: NOW });
 const [first, second] = state.alliances;
 assert.equal(first.planets.cadia.outposts.length, 2);
 assert.equal(first.planets.fenris.territories.length, 2);
 assert.equal(first.planets.cronus.shuttles[0].name, 'Молния');
 assert.equal(first.planets.cronus.shuttles[0].note, '0\\4 Шаттл Молния');
 const outpost = first.planets.cadia.outposts[0];
 assert.match(outpost.name, /название не указано/);
 assert.deepEqual(outpost.bonus, { caps: 0, xp: 0, actionPoints: 0, toolId: null, quantity: 0 });
 assert.equal(outpost.bonusKnown, false);
 assert.equal(outpost.claimed, false);
 assert.throws(() => claimOutpostBonus(state, first.id, outpost.id), /не указан/);
 assert.equal(second.planets.cadia.outposts.length, 0);
 assert.equal(second.planets.fenris.territories.length, 6);
 assert.equal(second.planets.cronus.shuttles.length, 0);
 assert.equal(second.sourceNotes.cadia, '3 действия бесплатно');
 assert.equal(second.sourceNotes.fenris, '6 3дейтсвия бесплатно');
 assert.equal(second.sourceNotes.cronus, '3 действия бесплатно');
 assert.equal(second.sourceNotes.level, '6+расщепитель 1');
 assert.equal(second.planets.fenris.territories[0].note, '6 3дейтсвия бесплатно');
 assert.equal(report.planets.outpostBonusesUnknown, 2);
 const dash = fixture();
 for (const column of ['N', 'P', 'R']) inputSheet(dash, 'Подфункции').rows[1].cells[`${column}3`].value = '-';
 const empty = convertGenesisWorkbook(dash, { now: NOW }).state.alliances[0];
 assert.equal(empty.sourceNotes.cadia, undefined);
 assert.equal(empty.sourceNotes.fenris, undefined);
 assert.equal(empty.sourceNotes.cronus, undefined);
 assert.deepEqual(empty.planets.cadia.outposts, []);
});

test('all supplied catalog entries are matched by category and preserve source edits and ambiguities', () => {
 const workbook = fixture();
 const upgrade = inputSheet(workbook, 'Прокачка').rows.find(entry => entry.cells[`A${entry.row}`]?.value === 'Лазерный расщепитель I');
 upgrade.cells[`D${upgrade.row}`].value = 'Спора + Орбита\n\nКонтур + Импульс';
 const { state, report } = convertGenesisWorkbook(workbook, { now: NOW });
 assert.deepEqual(report.catalog.counts, { access: 11, upgrades: 27, equipment: 42, tools: 30 });
 assert.deepEqual(report.catalog.missing, []);
 assert.equal(getItem(state, 'access-1').price, 850);
 assert.equal(getItem(state, 'access-1').effect, ' Плейлист из исходной таблицы (согласование) ');
 assert.equal(getItem(state, 'upgrade-18').recipeText, 'Спора + Орбита\n\nКонтур + Импульс');
 assert.deepEqual(getItem(state, 'upgrade-18').recipe, catalog.find(item => item.id === 'upgrade-18').recipe);
 assert.match(getItem(state, 'tool-20').recipeIssue, /Форпост/);
 assert.ok(report.catalog.recipeReview.some(entry => entry.id === 'tool-20' && /Форпост/.test(entry.issue)));
 assert.ok(report.catalog.sourceItems.some(entry => entry.id === 'tool-30'));
 assert.ok(report.catalog.sourceItems.some(entry => entry.id === 'upgrade-17'));
});

test('imported legacy wording is canonicalized without replacing source prices or authored effects', () => {
 const workbook = fixture();
 const first = inputSheet(workbook, 'Прокачка').rows.find(entry => entry.cells[`A${entry.row}`]?.value === 'Десантный форсаж');
 const graviton = inputSheet(workbook, 'Прокачка').rows.find(entry => entry.cells[`A${entry.row}`]?.value === 'Гравитон');
 const nano = inputSheet(workbook, 'Эквип').rows.find(entry => entry.cells[`A${entry.row}`]?.value === 'Нановолна');
 first.cells[`B${first.row}`].value = '375 крышек';first.cells[`C${first.row}`].value = '2 ОД на высадку';
 graviton.cells[`C${graviton.row}`].value = '1 гравитон (максимум 10)';nano.cells[`B${nano.row}`].value = 'Мгновенная зарядка рюкзака + 50 к заряду навсегда';
 const { state, report } = convertGenesisWorkbook(workbook, { now: NOW });
 assert.equal(getItem(state, 'upgrade-1').price, 375);assert.equal(getItem(state, 'upgrade-1').effect, '+2 ОД на высадку');
 assert.equal(getItem(state, 'upgrade-27').effect, '1 гравитон');assert.equal(getItem(state, 'equip-24').effect, 'Мгновенная зарядка модульного интерфейса + 50 к заряду навсегда');
 assert.equal(state.itemOverrides['upgrade-1'].effect, undefined);assert.equal(report.catalog.normalizedEffects.length, 3);
 nano.cells[`B${nano.row}`].value = 'Авторский эффект: +75 заряда';
 const authored = convertGenesisWorkbook(workbook, { now: NOW });
 assert.equal(getItem(authored.state, 'equip-24').effect, 'Авторский эффект: +75 заряда');assert.equal(authored.state.itemOverrides['equip-24'].effect, 'Авторский эффект: +75 заряда');
 assert.equal(getItem(authored.state, 'upgrade-1').price, 375);
});

test('map-awarded levels remain additional when experience later crosses a threshold', () => {
 const { state } = convertGenesisWorkbook(fixture(), { now: NOW });
 const alliance = state.alliances[0];
 adjustResource(state, { allianceId: alliance.id, resource: 'xp', amount: 50, reason: 'Новое испытание' });
 assert.equal(alliance.xp, 510);
 assert.equal(alliance.bonusLevels, 2);
 assert.equal(allianceLevel(state, alliance), 8);
 const invalid = fixture();
 inputSheet(invalid, 'Альянсы').rows[1].cells.H3.value = '4.0';
 assert.throws(() => convertGenesisWorkbook(invalid, { now: NOW }), /ниже уровня.*отрицательный бонус/);
});

test('incomplete and malformed numeric values fail without changing the workbook', () => {
 const cases = [
  workbook => { delete inputSheet(workbook, 'Альянсы').rows[1].cells.D3; },
  workbook => { inputSheet(workbook, 'Альянсы').rows[1].cells.F3.value = '460.5'; },
  workbook => { inputSheet(workbook, 'Подфункции').rows[1].cells.D3.value = ''; },
  workbook => { inputSheet(workbook, 'Интерфейс').rows[1].cells.D3.value = false; },
  workbook => { inputSheet(workbook, 'Интерфейс').rows[1].cells.F3.value = '75/'; },
  workbook => { inputSheet(workbook, 'Интерфейс').rows[1].cells.F3.value = '75//300'; },
  workbook => { inputSheet(workbook, 'Интерфейс').rows[1].cells.F3.value = '301/300'; },
  workbook => { inputSheet(workbook, 'Альянсы').rows[1].cells.H3.value = 'неизвестно'; },
  workbook => { inputSheet(workbook, 'Доступ').rows[1].cells.C3.value = '-100 крышечки'; },
 ];
 for (const change of cases) {
  const workbook = fixture();
  change(workbook);
  const before = structuredClone(workbook);
  assert.throws(() => convertGenesisWorkbook(workbook, { now: NOW }), /Импорт «Генезиса»/);
  assert.deepEqual(workbook, before);
 }
});

test('missing, unknown and duplicate joins or sheets are rejected', () => {
 for (const change of [
  workbook => { inputSheet(workbook, 'Интерфейс').rows.pop(); },
  workbook => { inputSheet(workbook, 'Подфункции').rows[1].cells.A3.value = 'Другой альянс'; },
  workbook => { inputSheet(workbook, 'Альянсы').rows[2].cells.A5.value = ' Королёва\u00a0'; },
  workbook => { workbook.push(structuredClone(inputSheet(workbook, 'Интерфейс'))); },
  workbook => { workbook.splice(workbook.findIndex(entry => entry.name === 'Интерфейс'), 1); },
  workbook => { inputSheet(workbook, 'Интерфейс').rows[1].cells.A4 = { value: 'не в той строке' }; },
 ]) {
  const workbook = fixture();
  change(workbook);
  assert.throws(() => convertGenesisWorkbook(workbook, { now: NOW }), /Импорт «Генезиса»/);
 }
});

test('missing, unknown and duplicate catalog entries cannot silently disappear', () => {
 for (const change of [
  workbook => { inputSheet(workbook, 'Эквип').rows.pop(); },
  workbook => { inputSheet(workbook, 'Прокачка').rows[1].cells.A2.value = 'Неизвестный ускоритель'; },
  workbook => { inputSheet(workbook, 'Доступ').rows[2].cells.E5.value = 'звуковой анализатор'; },
 ]) {
  const workbook = fixture();
  change(workbook);
  assert.throws(() => convertGenesisWorkbook(workbook, { now: NOW }), /каталог|товар|соответствие/);
 }
});

test('CLI writes a plain import state and a separate report, and never overwrites its source', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'orbita-genesis-test-'));
 try {
  const input = join(directory, 'workbook.json');
  const output = join(directory, 'genesis-ready.json');
  await writeFile(input, JSON.stringify(fixture()));
  const script = fileURLToPath(new URL('../scripts/import_genesis.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(await readFile(output, 'utf8'));
  const report = JSON.parse(await readFile(join(directory, 'genesis-ready.report.json'), 'utf8'));
  assert.ok(validateState(state));
  assert.equal(state.state, undefined);
  assert.equal(report.summary.alliances, 2);
  const before = await readFile(input, 'utf8');
  const refused = spawnSync(process.execPath, [script, input, input], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(await readFile(input, 'utf8'), before);
 } finally {
  await rm(directory, { recursive: true, force: true });
 }
});
