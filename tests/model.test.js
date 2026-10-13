import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,getItem} from '../src/catalog.js';
import {initialState,validateState,allianceLevel,adjustResource,recordEventResults,updateInterface,addPlanetRecord,claimOutpostBonus,purchase,craft,grantItem,removeInventory,updateSettings} from '../src/model.js';
const id='alliance-1';
const setup=()=>{const state=initialState();return {state,a:state.alliances[0]};};
const unchangedOnError=(s,fn,pattern)=>{const before=structuredClone(s);assert.throws(fn,pattern);assert.deepEqual(s,before);};
test('the full supplied catalog and demo state satisfy storage validation',()=>{
 assert.equal(catalog.filter(i=>i.category==='access').length,1);assert.equal(catalog.filter(i=>i.category==='upgrades').length,27);assert.equal(catalog.filter(i=>i.category==='equipment').length,42);assert.equal(catalog.filter(i=>i.category==='tools').length,30);assert.ok(validateState(initialState()));assert.ok(validateState(initialState(true)));
});
test('caps balance and total earned are independent from experience',()=>{
 const {state,a}=setup(),xp=a.xp,balance=a.caps,earned=a.earnedCaps;
 adjustResource(state,{allianceId:id,resource:'caps',amount:100,reason:'Первое место'});assert.equal(a.caps,balance+100);assert.equal(a.earnedCaps,earned+100);assert.equal(a.xp,xp);
 purchase(state,id,'upgrade-1');assert.equal(a.caps,balance-200);assert.equal(a.earnedCaps,earned+100);assert.ok(a.upgrades.includes('upgrade-1'));
});
test('personal experience raises alliance XP and its calculated level',()=>{
 const {state,a}=setup();adjustResource(state,{allianceId:id,resource:'xp',childId:'child-1-1',amount:200,reason:'Открытие'});assert.equal(a.xp,2040);assert.equal(a.children[0].xp,420);assert.equal(allianceLevel(state,a),5);
});
test('raider action points and subfunction reputation remain separate',()=>{
 const {state,a}=setup(),rep=a.functions.engineers;adjustResource(state,{allianceId:id,resource:'raiders',amount:2,reason:'Победа'});assert.equal(a.functions.raiders,8);assert.equal(a.functions.engineers,rep);
});
test('invalid changes, negative balances and other alliance participants are rejected atomically',()=>{
 for(const amount of [0,-3000,0.5,Infinity,'bad']){const {state}=setup();unchangedOnError(state,()=>adjustResource(state,{allianceId:id,resource:'caps',amount,reason:'Тест'}));}
 const {state}=setup();unchangedOnError(state,()=>adjustResource(state,{allianceId:id,resource:'xp',childId:'child-2-1',amount:100,reason:'Тест'}));
});
test('event results award all selected alliances and are atomic when any row is invalid',()=>{
 const {state,a}=setup(),before=a.caps;recordEventResults(state,{name:'Космическая эстафета',results:[{allianceId:id,place:1,caps:300,xp:150},{allianceId:'alliance-2',place:2,caps:200,xp:100}]});assert.equal(a.caps,before+300);assert.equal(state.alliances[1].caps,2120);assert.match(state.events[0].detail,/2-е место/);
 unchangedOnError(state,()=>recordEventResults(state,{name:'Тест',results:[{allianceId:id,place:1,caps:100,xp:20},{allianceId:'alliance-2',place:2,caps:-1,xp:20}]}));
});
test('outpost rewards include caps, XP, planetary action points and tools once',()=>{
 const {state,a}=setup();const recordId=addPlanetRecord(state,id,'cadia',{name:'Новый аванпост',caps:150,xp:60,actionPoints:2,toolId:'tool-6',quantity:2});const before=structuredClone(a);
 claimOutpostBonus(state,id,recordId);assert.equal(a.caps,before.caps+150);assert.equal(a.xp,before.xp+60);assert.equal(a.planets.cadia.actionPoints,before.planets.cadia.actionPoints+2);assert.equal(a.inventory['tool-6'],3);
 unchangedOnError(state,()=>claimOutpostBonus(state,id,recordId),/уже начислен/);
});
test('planet records remain independent for each planet and alliance',()=>{
 const {state,a}=setup(),before=a.planets.fenris.territories.length;addPlanetRecord(state,id,'fenris',{name:'Сектор 99',note:'Найден лёд'});addPlanetRecord(state,id,'cronus',{name:'«Комета»',note:'На орбите'});assert.equal(a.planets.fenris.territories.length,before+1);assert.equal(a.planets.cronus.shuttles.length,2);assert.equal(state.alliances[1].planets.cronus.shuttles.length,1);
});
test('interface constraints and ten-graviton cap are enforced without partial writes',()=>{
 const {state,a}=setup();unchangedOnError(state,()=>updateInterface(state,id,{name:'Новый',charge:101,maxCharge:100,gravitons:4,resilience:20}));
 updateInterface(state,id,{name:'Астра',charge:90,maxCharge:150,gravitons:9,resilience:40});purchase(state,id,'upgrade-27');assert.equal(a.interface.gravitons,10);unchangedOnError(state,()=>purchase(state,id,'upgrade-27'),/Максимум/);
});
test('insufficient currency, unknown prices and duplicate upgrades do not mutate state',()=>{
 const {state,a}=setup();unchangedOnError(state,()=>purchase(state,id,'equip-1'),/цену/);a.caps=100;unchangedOnError(state,()=>purchase(state,id,'upgrade-1'),/Недостаточно/);a.caps=1000;purchase(state,id,'upgrade-1');unchangedOnError(state,()=>purchase(state,id,'upgrade-1'),/уже установлено/);
});
test('edited prices are used for purchases while earned currency is preserved',()=>{
 const {state,a}=setup();state.itemOverrides['equip-1']={price:250};const earned=a.earnedCaps;purchase(state,id,'equip-1');assert.equal(a.caps,2230);assert.equal(a.inventory['equip-1'],2);assert.equal(a.earnedCaps,earned);
});
test('crafting consumes both copies of the same ingredient and no caps by default',()=>{
 const {state,a}=setup(),before=a.caps;craft(state,id,'upgrade-1',['tool-1','tool-1']);assert.equal(a.inventory['tool-1'],undefined);assert.equal(a.caps,before);assert.ok(a.upgrades.includes('upgrade-1'));assert.ok(validateState(state));
});
test('recipes check quantity, tool levels and exact ingredient combinations',()=>{
 const {state}=setup();unchangedOnError(state,()=>craft(state,id,'upgrade-1',['tool-2','tool-2']),/Не хватает/);unchangedOnError(state,()=>craft(state,id,'upgrade-5',['tool-1','tool-2']),/уровня/);unchangedOnError(state,()=>craft(state,id,'tool-6',['tool-1','tool-2']),/не соответствуют/);
 craft(state,id,'tool-6',['tool-1','tool-5']);assert.equal(state.alliances[0].inventory['tool-6'],2);assert.equal(state.alliances[0].inventory['tool-1'],1);assert.equal(state.alliances[0].inventory['tool-5'],undefined);
});
test('crafting with a currency cost remains atomic when balance is insufficient',()=>{
 const {state,a}=setup();state.rules.craftCostsCaps=true;a.caps=200;unchangedOnError(state,()=>craft(state,id,'upgrade-1',['tool-1','tool-1']),/Недостаточно/);a.caps=400;craft(state,id,'upgrade-1',['tool-1','tool-1']);assert.equal(a.caps,100);
});
test('ambiguous recipes require review and missing Форпост is not silently substituted',()=>{
 const {state}=setup();unchangedOnError(state,()=>craft(state,id,'equip-11',['equip-1','equip-2']),/Подтвердите/);unchangedOnError(state,()=>craft(state,id,'tool-20',['tool-15','tool-10']),/Форпост/);
 state.itemOverrides['equip-11']={recipeConfirmed:true};grantItem(state,id,'equip-2',1,'Награда');craft(state,id,'equip-11',['equip-1','equip-2']);assert.equal(state.alliances[0].inventory['equip-11'],1);assert.equal(state.alliances[0].inventory['equip-1'],undefined);
});
test('manual item grants and spending are tracked and cannot overdraw inventory',()=>{
 const {state,a}=setup();grantItem(state,id,'tool-1',3,'Награда');assert.equal(a.inventory['tool-1'],5);removeInventory(state,id,'tool-1',4,'Крафт вне приложения');assert.equal(a.inventory['tool-1'],1);unchangedOnError(state,()=>removeInventory(state,id,'tool-1',2,'Потеря'),/Недостаточно/);
});
test('level thresholds can change, invalid thresholds cannot mutate settings, and daily access resets',()=>{
 const {state,a}=setup();purchase(state,id,'access-1');assert.ok(a.access.includes('access-1'));updateSettings(state,{name:'Новая смена',day:8,duration:21,levelThresholds:'0, 100, 1000, 2000',craftCostsCaps:false});assert.equal(allianceLevel(state,a),3);assert.deepEqual(a.access,[]);assert.ok(validateState(state));
 unchangedOnError(state,()=>updateSettings(state,{name:'Тест',day:7,duration:21,levelThresholds:'0, 500, 400'}),/строго возрастать/);
});
test('backups reject invalid currencies, unknown ingredients, duplicate IDs and charge overflow',()=>{
 const {state}=setup();const cases=[s=>s.alliances[0].caps=-1,s=>s.alliances[0].interface.charge=101,s=>s.alliances[1].id=s.alliances[0].id,s=>s.alliances[0].inventory['missing']=2,s=>s.itemOverrides['upgrade-1']={recipe:{type:'specific',variants:[['missing']]}}];
 for(const mutate of cases){const copy=structuredClone(state);mutate(copy);assert.equal(validateState(copy),false);}assert.equal(validateState({version:1}),false);
});
