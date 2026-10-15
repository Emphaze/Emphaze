import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,getItem} from '../src/catalog.js';
import {initialState,createAlliance,validateState,allianceLevel,xpProgress,updateBonusLevels,setAllianceLevel,resetAllProgress,MAX_NUMBER,resourceValue,setResource,adjustResource,recordEventResults,updateInterface,addPlanetRecord,startCadiaLanding,outpostBonusStatus,claimOutpostBonus,purchase,craft,grantItem,removeInventory,addStory,removeEvent,updateSettings} from '../src/model.js';
const id='alliance-1';
const setup=()=>{const state=initialState();return {state,a:state.alliances[0]};};
const unchangedOnError=(s,fn,pattern)=>{const before=structuredClone(s);assert.throws(fn,pattern);assert.deepEqual(s,before);};
test('global and alliance story news record the current sol and never award or change progress',()=>{
 const {state}=setup();state.shift.day=5;const before=structuredClone(state),started=Date.now();
 const globalId=addStory(state,{title:'  Получен сигнал  ',detail:'  Экипаж приступил к исследованию.\nОжидаем данные.  '});
 const targetId=addStory(state,{title:'Отчёт альянса',detail:'Открыта новая область.',allianceId:id});
 const [target,global]=state.events;assert.notEqual(globalId,targetId);assert.equal(global.id,globalId);assert.equal(target.id,targetId);
 assert.deepEqual([global.title,global.detail,global.kind,global.allianceId,global.sol],['Получен сигнал','Экипаж приступил к исследованию.\nОжидаем данные.','story','',5]);
 assert.equal(target.kind,'story');assert.equal(target.allianceId,id);assert.equal(target.sol,5);assert.ok(Date.parse(global.time)>=started&&Date.parse(global.time)<=Date.now());
 const withoutNews=structuredClone(state);withoutNews.events.splice(0,2);assert.deepEqual(withoutNews,before);assert.ok(validateState(JSON.parse(JSON.stringify(state))));
});
test('story news accept exact title and text limits but reject malformed content atomically',()=>{
 const {state}=setup();addStory(state,{title:'Т'.repeat(100),detail:'С'.repeat(2000)});assert.ok(validateState(state));
 for(const values of [{title:''},{title:' '},{title:'Т'.repeat(101)},{title:42},{title:null},{detail:'С'.repeat(2001)},{detail:null},{detail:false},{allianceId:'missing-alliance'},{allianceId:null},{allianceId:42}])unchangedOnError(state,()=>addStory(state,{title:'Новость',detail:'Текст',...values}));
});
test('only story events may be global, including an empty journey and headline-only news',()=>{
 const state=initialState(true),storyId=addStory(state,{title:'Начало путешествия'});assert.equal(state.events[0].detail,'');assert.ok(validateState(state));
 for(const change of [event=>event.kind='reward',event=>event.allianceId=null,event=>event.allianceId='missing-alliance',event=>event.title=' ',event=>event.title='Т'.repeat(101),event=>event.detail='С'.repeat(2001)]){
  const copy=JSON.parse(JSON.stringify(state));change(copy.events[0]);assert.equal(validateState(copy),false);
 }
 removeEvent(state,storyId);assert.deepEqual(state.events,[]);assert.ok(validateState(state));
});
test('deleting one event uses its ID even with matching titles and never reverses recorded progress',()=>{
 const {state}=setup();recordEventResults(state,{name:'Одинаковое событие',results:[{allianceId:id,place:1,caps:100,xp:50}]});
 recordEventResults(state,{name:'Одинаковое событие',results:[{allianceId:id,place:2,caps:50,xp:25}]});
 const removedId=state.events[1].id,retainedId=state.events[0].id,before=structuredClone(state);
 assert.notEqual(removedId,retainedId);assert.equal(state.events[0].title,state.events[1].title);assert.equal(removeEvent(state,removedId),true);
 before.events.splice(1,1);assert.deepEqual(state,before);assert.ok(state.events.some(event=>event.id===retainedId));assert.ok(validateState(state));
});
test('invalid and unknown event IDs are atomic, and deleting the final event leaves a valid empty history',()=>{
 const {state}=setup();for(const eventId of ['missing-event','',null,undefined,42,'contains spaces','__proto__'])unchangedOnError(state,()=>removeEvent(state,eventId));
 while(state.events.length)removeEvent(state,state.events[0].id);
 assert.deepEqual(state.events,[]);assert.ok(validateState(JSON.parse(JSON.stringify(state))));unchangedOnError(state,()=>removeEvent(state,'missing-event'),/не найдено/);
});
test('backups accept matching event titles but reject duplicate event IDs',()=>{
 const {state}=setup();state.events[1].title=state.events[0].title;assert.notEqual(state.events[0].id,state.events[1].id);assert.ok(validateState(state));
 const duplicate=JSON.parse(JSON.stringify(state));duplicate.events[1].id=duplicate.events[0].id;assert.equal(validateState(duplicate),false);
});
test('the full supplied catalog and demo state satisfy storage validation',()=>{
 assert.equal(catalog.filter(i=>i.category==='access').length,11);assert.equal(catalog.filter(i=>i.category==='upgrades').length,27);assert.equal(catalog.filter(i=>i.category==='equipment').length,42);assert.equal(catalog.filter(i=>i.category==='tools').length,30);assert.ok(validateState(initialState()));assert.ok(validateState(initialState(true)));assert.equal(initialState().shift.duration,11);assert.equal(initialState(true).shift.duration,11);
 assert.equal(initialState(true).shift.name,'Генезис');const fresh=createAlliance('Новый альянс');assert.equal(fresh.interface.charge,200);assert.equal(fresh.interface.gravitons,1);assert.ok(fresh.interface.maxCharge>=fresh.interface.charge);
});
test('caps balance and total earned are independent from experience',()=>{
 const {state,a}=setup(),xp=a.xp,balance=a.caps,earned=a.earnedCaps;
 adjustResource(state,{allianceId:id,resource:'caps',amount:100,reason:'Первое место'});assert.equal(a.caps,balance+100);assert.equal(a.earnedCaps,earned+100);assert.equal(a.xp,xp);
 purchase(state,id,'upgrade-1');assert.equal(a.caps,balance-200);assert.equal(a.earnedCaps,earned+100);assert.ok(a.upgrades.includes('upgrade-1'));
});
test('manual balance corrections set the entered total in both directions without changing earned caps',()=>{
 const {state,a}=setup();a.caps=2000;const earned=a.earnedCaps,xp=a.xp;
 assert.equal(resourceValue(state,{allianceId:id,resource:'caps'}),2000);
 assert.equal(setResource(state,{allianceId:id,resource:'caps',value:1000,reason:'Обновление показателя'}),true);
 assert.equal(a.caps,1000);assert.equal(a.earnedCaps,earned);assert.equal(a.xp,xp);assert.equal(state.events[0].detail,'Крышечки: 2000 → 1000');assert.equal(state.events[0].kind,'update');
 setResource(state,{allianceId:id,resource:'caps',value:2000,reason:'Проверен баланс'});assert.equal(a.caps,2000);assert.equal(a.earnedCaps,earned);
 setResource(state,{allianceId:id,resource:'caps',value:0,reason:'Баланс обнулён'});assert.equal(a.caps,0);assert.equal(a.earnedCaps,earned);assert.ok(validateState(state));
});
test('setting personal XP reads the child value and adjusts alliance XP by only the difference',()=>{
 const {state,a}=setup(),child=a.children[0],allianceXP=a.xp,childXP=child.xp;
 assert.equal(resourceValue(state,{allianceId:id,resource:'xp',childId:child.id}),childXP);assert.equal(resourceValue(state,{allianceId:id,resource:'xp'}),allianceXP);
 setResource(state,{allianceId:id,resource:'xp',childId:child.id,value:childXP+100,reason:'Проверен личный опыт'});
 assert.equal(child.xp,childXP+100);assert.equal(a.xp,allianceXP+100);assert.match(state.events[0].detail,/Опыт: 220 → 320/);
 setResource(state,{allianceId:id,resource:'xp',childId:child.id,value:0,reason:'Исправлена запись'});assert.equal(child.xp,0);assert.equal(a.xp,allianceXP-childXP);
 const beforeChild=child.xp;setResource(state,{allianceId:id,resource:'xp',value:500,reason:'Проверен общий опыт'});assert.equal(a.xp,500);assert.equal(child.xp,beforeChild);assert.ok(validateState(state));
 a.xp=MAX_NUMBER;unchangedOnError(state,()=>setResource(state,{allianceId:id,resource:'xp',childId:child.id,value:1,reason:'Проверка переполнения'}));
 child.xp=100;a.xp=50;unchangedOnError(state,()=>setResource(state,{allianceId:id,resource:'xp',childId:child.id,value:0,reason:'Проверка отрицательного итога'}));
});
test('setting reputation, raider AP, planetary AP and charge keeps their values independent',()=>{
 const {state,a}=setup(),astro=a.functions.astrophysicists;
 setResource(state,{allianceId:id,resource:'engineers',value:12,reason:'Проверена репутация'});
 setResource(state,{allianceId:id,resource:'raiders',value:0,reason:'Проверены ОД райдеров'});
 setResource(state,{allianceId:id,resource:'cadiaAP',value:7,reason:'Проверены ОД Кадии'});
 setResource(state,{allianceId:id,resource:'charge',value:350,reason:'Проверен заряд'});
 assert.equal(a.functions.engineers,12);assert.equal(a.functions.raiders,0);assert.equal(a.functions.astrophysicists,astro);assert.equal(a.planets.cadia.actionPoints,7);assert.equal(a.interface.charge,350);assert.equal(a.interface.maxCharge,350);assert.equal(a.interface.maxChargeKnown,false);
 for(const [resource,value] of [['engineers',12],['raiders',0],['cadiaAP',7],['charge',350]])assert.equal(resourceValue(state,{allianceId:id,resource}),value);
 setResource(state,{allianceId:id,resource:'charge',value:0,reason:'Заряд израсходован'});assert.equal(a.interface.charge,0);assert.equal(a.interface.maxCharge,350);assert.ok(validateState(JSON.parse(JSON.stringify(state))));
});
test('invalid manual values, resources and foreign children are rejected atomically',()=>{
 const {state}=setup(),valid={allianceId:id,resource:'caps',value:1000,reason:'Обновление показателя'};
 for(const value of [-1,0.5,Infinity,NaN,MAX_NUMBER+1,'',null,undefined,true])unchangedOnError(state,()=>setResource(state,{...valid,value}));
 for(const change of [{resource:'missing'},{resource:'resilience'},{allianceId:'missing'},{resource:'xp',childId:'child-2-1'},{childId:'child-1-1'},{reason:' '}]){
  unchangedOnError(state,()=>setResource(state,{...valid,...change}));
 }
 const before=structuredClone(state);assert.throws(()=>resourceValue(state,{allianceId:id,resource:'xp',childId:'child-2-1'}));assert.throws(()=>resourceValue(state,{allianceId:id,resource:'missing'}));assert.deepEqual(state,before);
});
test('setting the current value is a no-op without events or backup changes',()=>{
 const {state,a}=setup();
 for(const selection of [{resource:'caps'},{resource:'xp'},{resource:'xp',childId:a.children[0].id},{resource:'raiders'},{resource:'charge'},{resource:'cadiaAP'}]){
  const before=structuredClone(state),value=resourceValue(state,{allianceId:id,...selection});
  assert.equal(setResource(state,{allianceId:id,...selection,value,reason:'Обновление показателя'}),false);assert.deepEqual(state,before);
 }
 unchangedOnError(state,()=>setResource(state,{allianceId:id,resource:'caps',value:a.caps,reason:''}));assert.ok(validateState(state));
});
test('personal experience raises alliance XP and its calculated level',()=>{
 const {state,a}=setup();adjustResource(state,{allianceId:id,resource:'xp',childId:'child-1-1',amount:200,reason:'Открытие'});assert.equal(a.xp,2040);assert.equal(a.children[0].xp,420);assert.equal(allianceLevel(state,a),5);
});
test('map bonus levels raise the displayed level while XP progress follows experience thresholds',()=>{
 const {state,a}=setup();state.rules.levelThresholds=Array.from({length:100},(_,i)=>i*100);a.xp=450;
 assert.equal(allianceLevel(state,a),5);updateBonusLevels(state,id,{bonusLevels:2,reason:'Два уровня найдены на карте'});
 assert.equal(a.xp,450);assert.deepEqual(xpProgress(state,a),{level:7,next:500,percent:50,remaining:50});assert.match(state.events[0].detail,/0 → 2/);
 adjustResource(state,{allianceId:id,resource:'xp',amount:50,reason:'Награда за испытание'});assert.deepEqual(xpProgress(state,a),{level:8,next:600,percent:0,remaining:100});
 unchangedOnError(state,()=>updateBonusLevels(state,id,{bonusLevels:-1,reason:'Ошибка'}));unchangedOnError(state,()=>updateBonusLevels(state,id,{bonusLevels:3,reason:' '}));
 a.xp=9900;assert.deepEqual(xpProgress(state,a),{level:102,next:undefined,percent:100,remaining:0});assert.ok(validateState(state));
});
test('manual alliance levels preserve experience and found levels while future XP keeps affecting level',()=>{
 const {state,a}=setup();state.rules.levelThresholds=Array.from({length:100},(_,i)=>i*100);a.xp=450;a.bonusLevels=2;
 assert.equal(setAllianceLevel(state,id,{level:3,reason:'Уточнён фактический уровень'}),true);assert.equal(allianceLevel(state,a),3);assert.equal(a.levelAdjustment,-4);assert.equal(a.xp,450);assert.equal(a.bonusLevels,2);assert.equal(state.events[0].detail,'Уровень альянса: 7 → 3');
 adjustResource(state,{allianceId:id,resource:'xp',amount:50,reason:'Награда'});assert.equal(allianceLevel(state,a),4);
 setAllianceLevel(state,id,{level:0,reason:'Установлен нулевой уровень'});assert.equal(a.xp,500);assert.equal(a.bonusLevels,2);assert.equal(allianceLevel(state,a),0);
 setResource(state,{allianceId:id,resource:'xp',value:0,reason:'Исправлен опыт'});assert.equal(allianceLevel(state,a),0);assert.ok(validateState(state));
 setResource(state,{allianceId:id,resource:'xp',value:600,reason:'Новый опыт'});assert.equal(allianceLevel(state,a),1);assert.ok(validateState(JSON.parse(JSON.stringify(state))));
 const before=structuredClone(state);assert.equal(setAllianceLevel(state,id,{level:1,reason:'Проверка без изменений'}),false);assert.deepEqual(state,before);
});
test('level corrections reject invalid offsets and prevent level overflow before other resource mutations',()=>{
 const {state,a}=setup();state.rules.levelThresholds=[0,100];a.xp=50;
 for(const level of [-1,0.5,MAX_NUMBER+1,Infinity,null,true,''])unchangedOnError(state,()=>setAllianceLevel(state,id,{level,reason:'Проверка'}));
 unchangedOnError(state,()=>setAllianceLevel(state,id,{level:0,reason:' '}));
 setAllianceLevel(state,id,{level:MAX_NUMBER,reason:'Верхняя граница'});assert.ok(validateState(state));
 unchangedOnError(state,()=>setResource(state,{allianceId:id,resource:'xp',value:100,reason:'Переполнение уровня'}));
 unchangedOnError(state,()=>adjustResource(state,{allianceId:id,resource:'xp',amount:50,reason:'Переполнение уровня'}));
 unchangedOnError(state,()=>updateBonusLevels(state,id,{bonusLevels:1,reason:'Переполнение уровня'}));
 unchangedOnError(state,()=>recordEventResults(state,{name:'Переполнение уровня',results:[{allianceId:id,place:1,caps:10,xp:50}]}));
 unchangedOnError(state,()=>updateSettings(state,{name:state.shift.name,day:8,duration:11,levelThresholds:'0,10',craftCostsCaps:false}));
 for(const levelAdjustment of [-MAX_NUMBER-1,MAX_NUMBER+1,0.5,'-1',null,Infinity]){const copy=structuredClone(state);copy.alliances[0].levelAdjustment=levelAdjustment;assert.equal(validateState(copy),false);}
 const tooHigh=structuredClone(state);tooHigh.alliances[0].levelAdjustment=MAX_NUMBER;assert.equal(validateState(tooHigh),false);
 a.bonusLevels=MAX_NUMBER-1;a.levelAdjustment=0;assert.ok(validateState(state));setAllianceLevel(state,id,{level:0,reason:'Нижняя граница коррекции'});assert.equal(a.levelAdjustment,-MAX_NUMBER);assert.ok(validateState(state));
});
test('reset clears all progress and planet ownership while preserving identities, rules, prices and audit',()=>{
 const {state,a}=setup();a.bonusLevels=2;a.levelAdjustment=-1;a.earnedCapsKnown=false;a.sourceNotes={level:'Уровень из таблицы',missing:'Неполные данные'};a.access=['access-1'];a.upgrades=['upgrade-18'];startCadiaLanding(state,id);
 state.itemOverrides['equip-1']={price:125};state.customItems.push({id:'custom-reset-test',category:'equipment',name:'Предмет прайма',effect:'Особый эффект',price:25,recipeText:'-',recipe:null});
 const identities=state.alliances.map(alliance=>({id:alliance.id,name:alliance.name,motto:alliance.motto,color:alliance.color,interfaceName:alliance.interface.name,children:alliance.children.map(child=>({...child,xp:0}))}));
 const preserved=structuredClone({shift:state.shift,rules:state.rules,itemOverrides:state.itemOverrides,customItems:state.customItems}),history=structuredClone(state.events);
 assert.equal(resetAllProgress(state,{reason:'Обнуление по решению прайма'}),true);
 assert.deepEqual({shift:state.shift,rules:state.rules,itemOverrides:state.itemOverrides,customItems:state.customItems},preserved);
 assert.deepEqual(state.alliances.map(alliance=>({id:alliance.id,name:alliance.name,motto:alliance.motto,color:alliance.color,interfaceName:alliance.interface.name,children:alliance.children})),identities);
 for(const alliance of state.alliances){
  assert.deepEqual([alliance.caps,alliance.earnedCaps,alliance.xp,alliance.bonusLevels,allianceLevel(state,alliance)],[0,0,0,0,0]);assert.equal(alliance.earnedCapsKnown,true);assert.equal(alliance.levelAdjustment,-1);
  assert.ok(Object.values(alliance.functions).every(value=>value===0));assert.deepEqual(alliance.inventory,{});assert.deepEqual(alliance.upgrades,[]);assert.deepEqual(alliance.access,[]);assert.equal(alliance.sourceNotes,undefined);
  assert.deepEqual([alliance.interface.charge,alliance.interface.gravitons,alliance.interface.resilience,alliance.interface.gravitonsPurchased],[0,0,0,0]);assert.equal(alliance.interface.maxCharge,1);
  assert.deepEqual(alliance.planets,{cadia:{outposts:[],actionPoints:0},fenris:{territories:[]},cronus:{shuttles:[]}});
 }
 assert.deepEqual(state.events.slice(1),history);assert.equal(state.events[0].kind,'reset');assert.equal(state.events[0].allianceId,id);assert.match(state.events[0].title,/всех альянсов/);assert.ok(validateState(JSON.parse(JSON.stringify(state))));
 state.rules.levelThresholds=[0,100,200];adjustResource(state,{allianceId:id,resource:'xp',amount:100,reason:'Первый опыт после обнуления'});assert.equal(allianceLevel(state,a),1);
});
test('reset validates its reason and input before clearing anything and leaves an empty journey unchanged',()=>{
 const {state}=setup();unchangedOnError(state,()=>resetAllProgress(state,{reason:''}));const invalid=structuredClone(state);invalid.alliances[0].caps=-1;unchangedOnError(invalid,()=>resetAllProgress(invalid,{reason:'Обнуление'}));
 const empty=initialState(true),before=structuredClone(empty);assert.equal(resetAllProgress(empty,{reason:'Обнуление'}),false);assert.deepEqual(empty,before);assert.ok(validateState(empty));
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
test('legacy outpost rewards include caps, XP, planetary action points and tools once until tracking begins',()=>{
 const {state,a}=setup(),record=a.planets.cadia.outposts[0],recordId=record.id;record.bonus={caps:150,xp:60,actionPoints:2,toolId:'tool-6',quantity:2};const before=structuredClone(a);
 claimOutpostBonus(state,id,recordId);assert.equal(a.caps,before.caps+150);assert.equal(a.xp,before.xp+60);assert.equal(a.planets.cadia.actionPoints,before.planets.cadia.actionPoints+2);assert.equal(a.inventory['tool-6'],3);
 unchangedOnError(state,()=>claimOutpostBonus(state,id,recordId),/уже начислен/);
});
test('explicit Cadia landings reset to eight AP plus installed thrust without granting outpost rewards',()=>{
 const {state,a}=setup(),before=structuredClone(a);a.planets.cadia.actionPoints=99;
 assert.deepEqual(startCadiaLanding(state,id),{cycle:1,actionPoints:8});
 assert.deepEqual([a.caps,a.xp,a.inventory,a.functions.raiders],[before.caps,before.xp,before.inventory,before.functions.raiders]);
 assert.equal(a.planets.cadia.outposts[0].claimed,false);assert.equal(a.planets.cadia.bonusCycle,1);assert.equal(state.events[0].title,'Высадка на Кадию');
 a.upgrades.push('upgrade-1');assert.deepEqual(startCadiaLanding(state,id),{cycle:2,actionPoints:10});assert.equal(a.planets.cadia.actionPoints,10);
 assert.equal(state.alliances[1].planets.cadia.bonusCycle,undefined);assert.equal(state.alliances[1].planets.cadia.actionPoints,4);assert.ok(validateState(state));
});
test('an old claimed outpost earns once per subsequent explicit landing and survives backup round trips',()=>{
 const {state,a}=setup(),record=a.planets.cadia.outposts[0];record.claimed=true;
 assert.equal(outpostBonusStatus(state,id,record.id).canClaim,false);
 startCadiaLanding(state,id);assert.equal(outpostBonusStatus(state,id,record.id).canClaim,true);const balance=a.caps;
 claimOutpostBonus(state,id,record.id);assert.equal(a.caps,balance+100);assert.equal(record.lastBonusCycle,1);assert.equal(record.claimed,true);
 assert.equal(outpostBonusStatus(state,id,record.id).canClaim,false);unchangedOnError(state,()=>claimOutpostBonus(state,id,record.id),/уже начислен/);
 const restored=JSON.parse(JSON.stringify(state));assert.ok(validateState(restored));assert.equal(outpostBonusStatus(restored,id,record.id).canClaim,false);
 startCadiaLanding(restored,id);assert.equal(outpostBonusStatus(restored,id,record.id).canClaim,true);claimOutpostBonus(restored,id,record.id);
 assert.equal(restored.alliances[0].caps,balance+200);assert.equal(restored.alliances[0].planets.cadia.outposts[0].lastBonusCycle,2);assert.ok(validateState(restored));
});
test('new captures wait for the next landing both before tracking and during an active landing',()=>{
 const {state,a}=setup(),values={caps:100,xp:0,actionPoints:0,toolId:null,quantity:0};
 const pending=addPlanetRecord(state,id,'cadia',{...values,name:'До первой высадки'});
 assert.equal(a.planets.cadia.outposts.find(record=>record.id===pending).capturedCycle,0);assert.equal(outpostBonusStatus(state,id,pending).label,'Со следующей высадки');
 unchangedOnError(state,()=>claimOutpostBonus(state,id,pending),/следующей высадке/);assert.ok(validateState(state));
 startCadiaLanding(state,id);assert.equal(outpostBonusStatus(state,id,pending).canClaim,true);claimOutpostBonus(state,id,pending);
 const current=addPlanetRecord(state,id,'cadia',{...values,name:'На текущей высадке'});
 assert.equal(a.planets.cadia.outposts.find(record=>record.id===current).capturedCycle,1);assert.equal(outpostBonusStatus(state,id,current).canClaim,false);
 unchangedOnError(state,()=>claimOutpostBonus(state,id,current),/следующей высадке/);
 startCadiaLanding(state,id);assert.equal(outpostBonusStatus(state,id,current).canClaim,true);claimOutpostBonus(state,id,current);assert.ok(validateState(state));
});
test('unknown bonuses and failed reward or cycle overflow cannot mark rewards or advance a landing',()=>{
 const {state,a}=setup(),record=a.planets.cadia.outposts[0];record.bonusKnown=false;
 startCadiaLanding(state,id);assert.equal(outpostBonusStatus(state,id,record.id).label,'Бонус не указан');unchangedOnError(state,()=>claimOutpostBonus(state,id,record.id),/не указан/);
 record.bonusKnown=true;a.caps=MAX_NUMBER;unchangedOnError(state,()=>claimOutpostBonus(state,id,record.id));assert.equal(record.lastBonusCycle,undefined);assert.equal(record.claimed,false);
 a.caps=0;claimOutpostBonus(state,id,record.id);assert.equal(record.lastBonusCycle,1);
 a.planets.cadia.bonusCycle=MAX_NUMBER;unchangedOnError(state,()=>startCadiaLanding(state,id));
});
test('landing metadata rejects negative, fractional, future and inconsistent backup counters',()=>{
 const {state,a}=setup();startCadiaLanding(state,id);const record=a.planets.cadia.outposts[0];claimOutpostBonus(state,id,record.id);assert.ok(validateState(state));
 const mutations=[
  s=>s.alliances[0].planets.cadia.bonusCycle=-1,s=>s.alliances[0].planets.cadia.bonusCycle=0.5,s=>s.alliances[0].planets.cadia.bonusCycle=MAX_NUMBER+1,
  s=>s.alliances[0].planets.cadia.outposts[0].capturedCycle=2,s=>s.alliances[0].planets.cadia.outposts[0].capturedCycle=-1,
  s=>s.alliances[0].planets.cadia.outposts[0].lastBonusCycle=2,s=>s.alliances[0].planets.cadia.outposts[0].lastBonusCycle=0.5,
  s=>s.alliances[0].planets.cadia.outposts[0].capturedCycle=1,s=>delete s.alliances[0].planets.cadia.bonusCycle,
 ];
 for(const mutate of mutations){const copy=structuredClone(state);mutate(copy);assert.equal(validateState(copy),false);}
});
test('planet records remain independent for each planet and alliance',()=>{
 const {state,a}=setup(),before=a.planets.fenris.territories.length;addPlanetRecord(state,id,'fenris',{name:'Сектор 99',note:'Найден лёд'});addPlanetRecord(state,id,'cronus',{name:'«Комета»',note:'На орбите'});assert.equal(a.planets.fenris.territories.length,before+1);assert.equal(a.planets.cronus.shuttles.length,2);assert.equal(state.alliances[1].planets.cronus.shuttles.length,1);
});
test('interface charge constraints remain atomic and graviton mass has no ten-unit cap',()=>{
 const {state,a}=setup();unchangedOnError(state,()=>updateInterface(state,id,{name:'Новый',charge:101,maxCharge:100,gravitons:4,resilience:20}));
 updateInterface(state,id,{name:'Астра',charge:90,maxCharge:150,gravitons:52,gravitonsPurchased:10,resilience:40});assert.equal(a.interface.gravitons,52);assert.ok(validateState(state));
 unchangedOnError(state,()=>updateInterface(state,id,{name:'Астра',charge:90,maxCharge:150,gravitons:52,gravitonsPurchased:11,resilience:40}));
 updateInterface(state,id,{name:'Астра',charge:100,maxCharge:150,gravitons:53,resilience:45});assert.equal(a.interface.gravitonsPurchased,10);assert.equal(a.interface.maxChargeKnown,true);assert.equal(a.interface.resilienceKnown,true);
 assert.equal(state.events[0].detail,'Заряд 100 · гравитоны 53');
});
test('simple interface edits preserve legacy data and accept charge without a capacity limit',()=>{
 const {state,a}=setup();updateInterface(state,id,{name:'Прежний',charge:100,maxCharge:500,gravitons:52,gravitonsPurchased:7,resilience:45,resilienceKnown:false});
 updateInterface(state,id,{name:'Новый',charge:750,gravitons:55});
 assert.deepEqual(a.interface,{name:'Новый',charge:750,maxCharge:750,maxChargeKnown:false,gravitons:55,gravitonsPurchased:7,resilience:45,resilienceKnown:false});
 assert.equal(state.events[0].detail,'Заряд 750 · гравитоны 55');
 updateInterface(state,id,{name:'Новый',charge:0,gravitons:55});assert.equal(a.interface.charge,0);assert.equal(a.interface.maxCharge,750);assert.ok(validateState(state));
 for(const values of [{charge:-1},{charge:0.5},{charge:MAX_NUMBER+1},{gravitons:-1},{maxChargeKnown:'false'}])unchangedOnError(state,()=>updateInterface(state,id,{name:'Новый',charge:100,gravitons:55,...values}));
});
test('only graviton purchases count toward ten per shift and manual grants remain possible',()=>{
 const {state,a}=setup();a.interface.gravitons=42;const balance=a.caps;
 for(let i=0;i<10;i++)purchase(state,id,'upgrade-27');
 assert.equal(a.interface.gravitons,52);assert.equal(a.interface.gravitonsPurchased,10);assert.equal(a.caps,balance-2000);
 unchangedOnError(state,()=>purchase(state,id,'upgrade-27'),/10 покупок/);
 grantItem(state,id,'upgrade-27',3,'Найдены на карте');assert.equal(a.interface.gravitons,55);assert.equal(a.interface.gravitonsPurchased,10);
 const settings={name:'Та же смена',day:8,duration:11,levelThresholds:state.rules.levelThresholds.join(','),craftCostsCaps:false};updateSettings(state,settings);assert.equal(a.interface.gravitonsPurchased,10);
 a.interface.gravitons=MAX_NUMBER;unchangedOnError(state,()=>grantItem(state,id,'upgrade-27',1,'За границей допустимого числа'));assert.ok(validateState(state));
});
test('charge awards expand imported or legacy capacity placeholders without an upper cap',()=>{
 const {state,a}=setup();updateInterface(state,id,{name:'Импорт',charge:150,maxCharge:100,maxChargeKnown:false,gravitons:52,resilience:0,resilienceKnown:false});
 assert.equal(a.interface.maxCharge,150);assert.equal(a.interface.maxChargeKnown,false);assert.equal(a.interface.resilienceKnown,false);assert.equal(a.interface.gravitonsPurchased,0);
 adjustResource(state,{allianceId:id,resource:'charge',amount:20,reason:'Подзарядка'});assert.equal(a.interface.charge,170);assert.equal(a.interface.maxCharge,170);assert.equal(a.interface.maxChargeKnown,false);assert.ok(validateState(state));
 unchangedOnError(state,()=>updateInterface(state,id,{name:'Импорт',charge:170,maxCharge:100,maxChargeKnown:true,gravitons:52,resilience:0}));
 updateInterface(state,id,{name:'Проверен',charge:170,maxCharge:200,gravitons:52,resilience:60});assert.equal(a.interface.maxChargeKnown,true);assert.equal(a.interface.resilienceKnown,true);
 adjustResource(state,{allianceId:id,resource:'charge',amount:31,reason:'Дополнительный заряд'});assert.equal(a.interface.charge,201);assert.equal(a.interface.maxCharge,201);assert.equal(a.interface.maxChargeKnown,false);assert.ok(validateState(state));
 adjustResource(state,{allianceId:id,resource:'charge',amount:-200,reason:'Расход заряда'});assert.equal(a.interface.charge,1);assert.equal(a.interface.maxCharge,201);
 unchangedOnError(state,()=>adjustResource(state,{allianceId:id,resource:'charge',amount:-2,reason:'Недопустимый расход'}));
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
 const {state,a}=setup();purchase(state,id,'access-1');assert.ok(a.access.includes('access-1'));updateSettings(state,{name:'Новая смена',day:8,duration:11,levelThresholds:'0, 100, 1000, 2000',craftCostsCaps:false});assert.equal(allianceLevel(state,a),3);assert.deepEqual(a.access,[]);assert.ok(validateState(state));
 unchangedOnError(state,()=>updateSettings(state,{name:'Тест',day:7,duration:11,levelThresholds:'0, 500, 400'}),/строго возрастать/);
});
test('backups reject invalid currencies, unknown ingredients, duplicate IDs and charge overflow',()=>{
 const {state}=setup();const cases=[s=>s.alliances[0].caps=-1,s=>s.alliances[0].interface.charge=s.alliances[0].interface.maxCharge+1,s=>s.alliances[1].id=s.alliances[0].id,s=>s.alliances[0].inventory['missing']=2,s=>s.itemOverrides['upgrade-1']={recipe:{type:'specific',variants:[['missing']]}}];
 for(const mutate of cases){const copy=structuredClone(state);mutate(copy);assert.equal(validateState(copy),false);}assert.equal(validateState({version:1}),false);
});
test('import uncertainty flags and source notes validate without allowing invented outpost rewards',()=>{
 const {state,a}=setup();a.bonusLevels=2;a.earnedCapsKnown=false;a.sourceNotes={level:'Ещё два уровня с карты',cadia:'Бонусы не указаны',fenris:'Исследовано 3 территории',cronus:'Данные из исходной таблицы',missing:'Ёмкость и стойкость не заполнены'};
 a.interface.gravitons=52;a.interface.gravitonsPurchased=10;a.interface.maxChargeKnown=false;a.interface.resilienceKnown=false;const record=a.planets.cadia.outposts[0];record.bonusKnown=false;
 assert.ok(validateState(state));unchangedOnError(state,()=>claimOutpostBonus(state,id,record.id),/Бонус аванпоста не указан/);
 const cases=[
  s=>s.alliances[0].bonusLevels=-1,s=>s.alliances[0].bonusLevels=1.5,s=>s.alliances[0].bonusLevels=MAX_NUMBER+1,
  s=>s.alliances[0].earnedCapsKnown='false',s=>s.alliances[0].interface.maxChargeKnown=0,s=>s.alliances[0].interface.resilienceKnown=null,
  s=>s.alliances[0].interface.gravitonsPurchased=11,s=>s.alliances[0].interface.gravitonsPurchased=-1,s=>s.alliances[0].interface.gravitonsPurchased=0.5,
  s=>s.alliances[0].sourceNotes={missing:'x'.repeat(2001)},s=>s.alliances[0].sourceNotes={level:2},s=>s.alliances[0].sourceNotes=[],s=>s.alliances[0].sourceNotes=null,
  s=>s.alliances[0].planets.cadia.outposts[0].bonusKnown='false',s=>s.alliances[0].interface.charge=s.alliances[0].interface.maxCharge+1,
 ];
 for(const mutate of cases){const copy=structuredClone(state);mutate(copy);assert.equal(validateState(copy),false);}
 record.bonusKnown=true;claimOutpostBonus(state,id,record.id);assert.equal(record.claimed,true);assert.ok(validateState(state));
});
