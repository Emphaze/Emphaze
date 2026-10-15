import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,getItem,normalizeGenesisItem,eventRewards} from '../src/catalog.js';
import {initialState,createAlliance,craft,recordEventResults} from '../src/model.js';

test('the landing booster adds two action points and the graviton effect does not cap total mass',()=>{
 const state=initialState(true);
 assert.equal(getItem(state,'upgrade-1').effect,'+2 ОД на высадку');
 assert.equal(getItem(state,'upgrade-1').price,300);
 assert.equal(getItem(state,'upgrade-27').effect,'1 гравитон');
 assert.equal(getItem(state,'upgrade-27').price,200);
});

test('legacy source overrides cannot restore obsolete effects and normalization never mutates them',()=>{
 const state=initialState(true);
 const cases=[
  ['upgrade-1',' 2 ОД на высадку. '],
  ['upgrade-27','1гравитон (максимум10)'],
  ['equip-10','подзарядка техно-рюкзака на 1 час меньше'],
  ['equip-20','сохранение предметов техно-устройства альянса в случае проигрыша на исследованиях'],
  ['equip-24','мгновенная зарядка рюкзака + 50 к заряду навсегда'],
  ['equip-33','сохраняет себя и еще 1 шмотку в случае проигрыша на событии'],
  ['equip-41','Дарует способность украсть одну шмотку у другого альянса'],
  ['equip-42','Мгновенная  зарядка рюкзака + 50 к заряду навсегда'],
 ];
 for(const [id,effect] of cases){
  state.itemOverrides[id]=Object.freeze({effect,price:725});
  const source=Object.freeze({...catalog.find(item=>item.id===id),...state.itemOverrides[id]});
  const before=structuredClone(source),normalized=normalizeGenesisItem(source);
  assert.notEqual(normalized,source);
  assert.equal(normalized.effect,catalog.find(item=>item.id===id).effect);
  assert.equal(normalized.price,725);
  assert.deepEqual(source,before);
  assert.deepEqual(getItem(state,id),normalized);
  assert.equal(state.itemOverrides[id].effect,effect);
 }
});

test('normalization preserves custom effects, prices, recipes and musical tracks',()=>{
 const state=initialState(true),customEffects={
  'upgrade-1':'+3 ОД на высадку по решению Прайма',
  'upgrade-27':'2 гравитона за исследование',
  'equip-10':'Подзарядка техно-рюкзака на 2 часа меньше',
  'equip-20':'Сохраняет только один выбранный предмет',
  'equip-24':'Мгновенная зарядка рюкзака + 80 к заряду навсегда',
  'equip-33':'Сохраняет себя и ещё 2 шмотки после проигрыша',
  'equip-41':'Позволяет обменять один предмет с другим альянсом',
  'equip-42':'Восстанавливает заряд в конце испытания',
 };
 for(const [id,effect] of Object.entries(customEffects)){
  state.itemOverrides[id]={effect,price:123,recipe:{type:'specific',variants:[['tool-1','tool-5']]}};
  const before=structuredClone(state.itemOverrides[id]),item=getItem(state,id);
  assert.equal(item.effect,effect);assert.equal(item.price,123);assert.deepEqual(item.recipe,before.recipe);assert.deepEqual(state.itemOverrides[id],before);
 }
 const custom=Object.freeze({id:'custom-item',effect:'2 ОД на высадку',price:55});
 assert.deepEqual(normalizeGenesisItem(custom),custom);
 assert.equal(getItem(state,'access-1').effect,'Составить свой плейлист на сол (согласование): по треку с искателя.');
});

test('both documented project-upgrade kits can be crafted without reconfirming an old backup',()=>{
 const upgrades=catalog.filter(item=>/^upgrade-(?:1[89]|2[0-6])$/.test(item.id));
 assert.equal(upgrades.length,9);
 for(const item of upgrades){
  assert.equal(item.recipe.variants.length,2);
  for(const kit of item.recipe.variants){
   const state=initialState(true),alliance=createAlliance('Тестовый альянс');state.alliances.push(alliance);
   for(const id of kit)alliance.inventory[id]=(alliance.inventory[id]||0)+1;
   state.itemOverrides[item.id]={recipeConfirmed:false};
   craft(state,alliance.id,item.id,[...kit]);
   assert.ok(alliance.upgrades.includes(item.id));
   assert.deepEqual(alliance.inventory,{});
   assert.equal(alliance.caps,0);
  }
 }
 const state=initialState(true);
 assert.equal(getItem(state,'equip-11').needsRecipeReview,true);
 assert.match(getItem(state,'tool-20').recipeIssue,/Форпост/);
 assert.match(getItem(state,'tool-25').recipeIssue,/Форпост/);
});

test('all eight documented event rewards award the exact caps and experience for each place',()=>{
 assert.deepEqual(eventRewards,[
  {place:1,caps:1800,xp:70},{place:2,caps:1450,xp:55},
  {place:3,caps:1200,xp:45},{place:4,caps:1000,xp:35},
  {place:5,caps:850,xp:30},{place:6,caps:750,xp:25},
  {place:7,caps:650,xp:20},{place:8,caps:550,xp:15},
 ]);
 const state=initialState(true);
 const results=eventRewards.map(reward=>{
  const alliance=createAlliance(`Альянс ${reward.place}`);state.alliances.push(alliance);
  return {allianceId:alliance.id,...reward};
 });
 recordEventResults(state,{name:'Исследование',results});
 for(const [index,alliance] of state.alliances.entries()){
  assert.equal(alliance.caps,eventRewards[index].caps);assert.equal(alliance.earnedCaps,eventRewards[index].caps);assert.equal(alliance.xp,eventRewards[index].xp);
 }
 assert.equal(state.alliances.reduce((sum,alliance)=>sum+alliance.caps,0),8250);
 assert.equal(state.alliances.reduce((sum,alliance)=>sum+alliance.xp,0),295);
});
