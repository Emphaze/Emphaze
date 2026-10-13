import { roles, planets, getItem, allItems } from './catalog.js';
export const STORAGE_KEY = 'smena-space-v2';
export const LEGACY_KEY = 'smena-camp-v1';
export const MAX_NUMBER = 1000000000;
let idSequence = 0;
export function uid() {
 const source = globalThis.crypto;
 if (typeof source?.randomUUID === 'function') return source.randomUUID();
 const entropy = typeof source?.getRandomValues === 'function'
  ? Array.from(source.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-')
  : Math.random().toString(36).slice(2);
 return `id-${Date.now().toString(36)}-${++idSequence}-${entropy}`;
}
export function integer(value, label, min=0, max=MAX_NUMBER) {
 if (value === '' || value === null || typeof value==='boolean' || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw Error(`${label}: укажите целое число от ${min} до ${max}.`);
 return Number(value);
}
export function text(value,label,max=500) { if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error(`${label}: заполните поле (до ${max} символов).`);return value.trim(); }
export const allianceLevel = (state, alliance) => state.rules.levelThresholds.filter(n=>alliance.xp>=n).length;
export function xpProgress(state,alliance) {
 const lv=allianceLevel(state,alliance),start=state.rules.levelThresholds[lv-1],next=state.rules.levelThresholds[lv];
 return { level:lv,next,percent:next===undefined?100:(alliance.xp-start)/(next-start)*100,remaining:next===undefined?0:next-alliance.xp };
}
export function createAlliance(name,motto='К новым мирам — вместе',color='blue') {
 return { id:uid(),name:text(name,'Название',60),motto:text(motto,'Девиз',140),color,caps:0,earnedCaps:0,xp:0,functions:Object.fromEntries(roles.map(r=>[r.id,0])), interface:{name:`Интерфейс «${name.trim()}»`,charge:0,maxCharge:100,gravitons:0,resilience:0}, inventory:{},upgrades:[],access:[],children:[],planets:{cadia:{outposts:[],actionPoints:0},fenris:{territories:[]},cronus:{shuttles:[]}} };
}
export function initialState(empty=false) {
 const state={version:2,shift:{name:'Космическая одиссея',day:7,duration:21},rules:{levelThresholds:[0,500,1000,1500,2000,2500,3000,4000,5000,7000],consumeIngredients:true,craftCostsCaps:false},alliances:[],customItems:[],itemOverrides:{},events:[]};
 if(empty)return state;
 const rows=[['Орион','Первым открывать неизведанное','blue',2480,1840,[34,28,19,22,6]],['Андромеда','Знание — наша сверхсила','purple',1920,1620,[21,38,30,25,5]],['Сириус','Дальше звёзд. Ближе друг к другу','orange',1650,1450,[31,20,27,18,8]],['Пегас','Вселенная начинается с команды','green',1380,1280,[24,22,35,20,4]]];
 rows.forEach(([name,motto,color,caps,xp,values],i)=>{
  const a=createAlliance(name,motto,color);a.id=`alliance-${i+1}`;a.caps=caps;a.earnedCaps=caps+800;a.xp=xp;roles.forEach((r,j)=>a.functions[r.id]=values[j]);a.interface.charge=[72,58,86,45][i];a.interface.gravitons=[3,2,4,1][i];a.interface.resilience=60;
  a.children=[{id:`child-${i+1}-1`,name:['Аня К.','Даша Р.','Ваня П.','Полина Е.'][i],role:roles[i].id,xp:220},{id:`child-${i+1}-2`,name:['Миша С.','Илья Н.','Алиса Д.','Кирилл Т.'][i],role:'raiders',xp:180}];
  a.inventory={'tool-1':2,'tool-2':1,'tool-3':1,'tool-4':1,'tool-5':1};if(i===0){a.inventory['tool-6']=1;a.inventory['equip-1']=1;}
  a.planets.cadia.actionPoints=4;
  a.planets.cadia.outposts=[{id:`outpost-${i}`,name:['Сигма-7','Маяк «Вектор»','Опорная станция','Точка «Зенит»'][i],bonus:{caps:100,xp:50,actionPoints:1,toolId:null,quantity:0},claimed:false}];
  a.planets.fenris.territories=Array.from({length:[4,3,2,3][i]},(_,j)=>({id:`territory-${i}-${j}`,name:`Сектор ${String(j+1).padStart(2,'0')}`,note:'Исследован экспедицией'}));
  a.planets.cronus.shuttles=[{id:`shuttle-${i}`,name:['«Странник»','«Аврора»','«Горизонт»','«Искатель»'][i],note:'Готов к высадке'}];state.alliances.push(a);
 });
 log(state,state.alliances[0].id,'Награда за космическую эстафету','Начислено 180 крышечек и 90 опыта','reward');
 log(state,state.alliances[1].id,'Открытие на Фенрисе','Исследован новый сектор','planet');
 log(state,state.alliances[2].id,'Сигнал интерфейса','Заряд восстановлен до 86 / 100','interface');
 return state;
}
export function getAlliance(state,id) {const a=state.alliances.find(a=>a.id===id);if(!a)throw Error('Альянс не найден.');return a;}
export function log(state,allianceId,title,detail='',kind='update') {state.events.unshift({id:uid(),allianceId,title,detail,kind,time:new Date().toISOString(),sol:state.shift.day});}
function checkSum(value,delta,label) {return integer(value+delta,label);}
export function adjustResource(state,{allianceId,resource,amount,reason,childId}) {
 const a=getAlliance(state,allianceId);const delta=integer(amount,'Изменение',-MAX_NUMBER,MAX_NUMBER);if(!delta)throw Error('Изменение не может быть нулевым.');const why=text(reason,'Причина',160);
 const group=roles.find(r=>r.id===resource);if(!group&&!['caps','xp','charge','resilience','cadiaAP'].includes(resource))throw Error('Неизвестный показатель.');
 const child=childId?a.children.find(c=>c.id===childId):null;if(childId&&(!child||resource!=='xp'))throw Error('Личный опыт начисляется участнику выбранного альянса.');
 let current=group?a.functions[resource]:resource==='charge'||resource==='resilience'?a.interface[resource]:resource==='cadiaAP'?a.planets.cadia.actionPoints:a[resource];
 const next=checkSum(current,delta,'Итоговый показатель');if(resource==='charge'&&next>a.interface.maxCharge)throw Error('Заряд не может превышать ёмкость интерфейса.');
 const earned=resource==='caps'&&delta>0?checkSum(a.earnedCaps,delta,'Заработанные крышечки'):a.earnedCaps;
 const childXP=child?checkSum(child.xp,delta,'Опыт участника'):null;
 if(group)a.functions[resource]=next;else if(resource==='charge'||resource==='resilience')a.interface[resource]=next;else if(resource==='cadiaAP')a.planets.cadia.actionPoints=next;else a[resource]=next;
 if(child)child.xp=childXP;a.earnedCaps=earned;
 const labels={caps:'Крышечки',xp:'Опыт',charge:'Заряд',resilience:'Стойкость',cadiaAP:'ОД на Кадии',...Object.fromEntries(roles.map(r=>[r.id,r.name==='Райдеры'?'Райдеры · ОД':`${r.name} · репутация`]))};
 log(state,allianceId,why,`${child?`${child.name} · `:''}${labels[resource]}: ${delta>0?'+':''}${delta}`,'reward');
}
export function recordEventResults(state,{name,results}) {
 const title=text(name,'Мероприятие',100);if(!Array.isArray(results)||!results.length)throw Error('Добавьте результаты.');
 const seen=new Set();const checked=results.map(r=>{const a=getAlliance(state,r.allianceId);if(seen.has(a.id))throw Error('Альянс указан дважды.');seen.add(a.id);const caps=integer(r.caps,'Крышечки'),xp=integer(r.xp,'Опыт'),place=integer(r.place,'Место',1,999);return {a,caps,xp,place,newCaps:checkSum(a.caps,caps,'Баланс'),newEarned:checkSum(a.earnedCaps,caps,'Заработано'),newXP:checkSum(a.xp,xp,'Опыт')};});
 checked.forEach(({a,caps,xp,place,newCaps,newEarned,newXP})=>{a.caps=newCaps;a.earnedCaps=newEarned;a.xp=newXP;log(state,a.id,title,`${place}-е место · +${caps} крышечек · +${xp} опыта`,'event');});
}
export function updateInterface(state,id,values) {
 const a=getAlliance(state,id),name=text(values.name,'Название интерфейса',80),maxCharge=integer(values.maxCharge,'Ёмкость',1),charge=integer(values.charge,'Заряд',0,maxCharge),gravitons=integer(values.gravitons,'Гравитоны',0,10),resilience=integer(values.resilience,'Стойкость');
 a.interface={name,maxCharge,charge,gravitons,resilience};log(state,id,'Обновлён интерфейс',`Заряд ${charge}/${maxCharge} · гравитоны ${gravitons} · стойкость ${resilience}`,'interface');
}
export function addPlanetRecord(state,id,planet,values) {
 const a=getAlliance(state,id);if(!planets.some(p=>p.id===planet))throw Error('Планета не найдена.');const name=text(values.name,'Название',80);
 const list=planet==='cadia'?a.planets.cadia.outposts:planet==='fenris'?a.planets.fenris.territories:a.planets.cronus.shuttles;
 if(list.some(r=>r.name.toLowerCase()===name.toLowerCase()))throw Error('Объект с таким названием уже записан для этого альянса.');
 let record={id:uid(),name};if(planet==='cadia'){
  const toolId=values.toolId||null;const tool=toolId?getItem(state,toolId):null;if(toolId&&(!tool||tool.category!=='tools'))throw Error('Выберите инструмент из каталога.');
  record.bonus={caps:integer(values.caps,'Бонус крышечек'),xp:integer(values.xp,'Бонус опыта'),actionPoints:integer(values.actionPoints,'Бонус ОД'),toolId,quantity:toolId?integer(values.quantity,'Количество инструментов',1,999):0};record.claimed=false;
 }else record.note=typeof values.note==='string'?values.note.trim().slice(0,300):'';
 list.push(record);log(state,id,planet==='cadia'?'Захвачен аванпост':planet==='fenris'?'Исследована территория':'Новый шаттл во флоте',name,'planet');return record.id;
}
export function claimOutpostBonus(state,id,recordId) {
 const a=getAlliance(state,id),r=a.planets.cadia.outposts.find(r=>r.id===recordId);if(!r)throw Error('Аванпост не найден.');if(r.claimed)throw Error('Бонус уже начислен.');const b=r.bonus;
 const caps=checkSum(a.caps,b.caps,'Баланс'),earned=checkSum(a.earnedCaps,b.caps,'Заработано'),xp=checkSum(a.xp,b.xp,'Опыт'),ap=checkSum(a.planets.cadia.actionPoints,b.actionPoints,'ОД'),qty=b.toolId?checkSum(a.inventory[b.toolId]||0,b.quantity,'Инструменты'):0;
 a.caps=caps;a.earnedCaps=earned;a.xp=xp;a.planets.cadia.actionPoints=ap;if(b.toolId)a.inventory[b.toolId]=qty;r.claimed=true;
 log(state,id,`Бонус аванпоста «${r.name}»`,`+${b.caps} крышечек · +${b.xp} опыта · +${b.actionPoints} ОД${b.toolId?` · ${getItem(state,b.toolId).name} ×${b.quantity}`:''}`,'reward');
}
export function removePlanetRecord(state,id,planet,recordId) {
 const a=getAlliance(state,id),key=planet==='cadia'?'outposts':planet==='fenris'?'territories':planet==='cronus'?'shuttles':null;if(!key)throw Error('Планета не найдена.');const rows=a.planets[planet][key],r=rows.find(r=>r.id===recordId);if(!r)throw Error('Объект не найден.');a.planets[planet][key]=rows.filter(r=>r.id!==recordId);log(state,id,'Объект снят с учёта',`${planets.find(p=>p.id===planet).name}: ${r.name}. Ранее полученные бонусы не отменяются.`,'planet');
}
export function grantItem(state,id,itemId,quantity,reason) {
 const a=getAlliance(state,id),item=getItem(state,itemId);if(!item)throw Error('Товар не найден.');const n=integer(quantity,'Количество',1,999),why=text(reason,'Причина',160);
 if(item.category==='upgrades'&&item.kind!=='graviton'){if(a.upgrades.includes(itemId))throw Error('Улучшение уже установлено.');if(n!==1)throw Error('Улучшение выдаётся в одном экземпляре.');a.upgrades.push(itemId);}
 else if(item.kind==='graviton')a.interface.gravitons=integer(a.interface.gravitons+n,'Гравитоны',0,10);
 else if(item.category==='access'){if(a.access.includes(itemId))throw Error('Доступ уже получен на этот сол.');if(n!==1)throw Error('Доступ выдаётся один раз на сол.');a.access.push(itemId);}
 else a.inventory[itemId]=checkSum(a.inventory[itemId]||0,n,'Количество предметов');
 log(state,id,`Выдано: ${item.name}`,`${why} · ${n} шт.`,'inventory');
}
export function owned(state,a,item) {return item.kind==='graviton'?a.interface.gravitons:item.category==='upgrades'?Number(a.upgrades.includes(item.id)):item.category==='access'?Number(a.access.includes(item.id)):(a.inventory[item.id]||0);}
function validateAcquisition(state,a,item) {if(item.kind==='graviton'&&a.interface.gravitons>=10)throw Error('Максимум — 10 гравитонов.');if((item.category==='upgrades'||item.category==='access')&&item.kind!=='graviton'&&owned(state,a,item))throw Error(item.category==='access'?'Доступ уже получен на этот сол.':'Улучшение уже установлено.');}
function acquire(a,item) {if(item.kind==='graviton')a.interface.gravitons++;else if(item.category==='upgrades')a.upgrades.push(item.id);else if(item.category==='access')a.access.push(item.id);else a.inventory[item.id]=(a.inventory[item.id]||0)+1;}
export function purchase(state,allianceId,itemId) {
 const a=getAlliance(state,allianceId),item=getItem(state,itemId);if(!item)throw Error('Товар не найден.');validateAcquisition(state,a,item);if(item.price===null||item.price===undefined)throw Error('Сначала укажите цену товара.');const price=integer(item.price,'Цена');if(a.caps<price)throw Error('Недостаточно крышечек.');if(item.category==='tools'||item.category==='equipment')checkSum(a.inventory[item.id]||0,1,'Количество предметов');
 a.caps-=price;acquire(a,item);log(state,allianceId,`Покупка: ${item.name}`,`−${price} крышечек`,'purchase');
}
export function craft(state,allianceId,itemId,ingredients) {
 const a=getAlliance(state,allianceId),item=getItem(state,itemId);if(!item)throw Error('Товар не найден.');validateAcquisition(state,a,item);
 if(!item.recipe||item.recipeIssue)throw Error(item.recipeIssue||'Рецепт для этого товара не задан.');if(item.needsRecipeReview&&!item.recipeConfirmed)throw Error('Подтвердите состав рецепта в настройках товара.');
 if(!Array.isArray(ingredients)||!ingredients.length||ingredients.some(id=>typeof id!=='string'))throw Error('Выберите ингредиенты.');
 if(item.recipe.type==='anyTools'){
  if(ingredients.length!==item.recipe.count)throw Error(`Нужно ${item.recipe.count} инструмента.`);
  for(const id of ingredients){const tool=getItem(state,id);if(!tool||tool.category!=='tools'||tool.toolLevel<item.recipe.minLevel)throw Error(`Нужны инструменты уровня ${item.recipe.minLevel} или выше.`);}
 }else if(item.recipe.type==='specific'){
  const signature=arr=>[...arr].sort().join('|');if(!item.recipe.variants.some(v=>signature(v)===signature(ingredients)))throw Error('Ингредиенты не соответствуют рецепту.');
 }else throw Error('Неизвестный рецепт.');
 const counts={};for(const id of ingredients)counts[id]=(counts[id]||0)+1;for(const [id,n] of Object.entries(counts))if((a.inventory[id]||0)<n)throw Error(`Не хватает: ${getItem(state,id)?.name||id} (${n} шт.).`);
 const price=state.rules.craftCostsCaps?integer(item.price,'Цена крафта'):0;if(a.caps<price)throw Error('Недостаточно крышечек для крафта.');if(item.category==='tools'||item.category==='equipment')checkSum(a.inventory[item.id]||0,1,'Количество предметов');
 for(const [id,n] of Object.entries(counts)){a.inventory[id]-=n;if(!a.inventory[id])delete a.inventory[id];}a.caps-=price;acquire(a,item);
 log(state,allianceId,`Крафт: ${item.name}`,`${ingredients.map(id=>getItem(state,id).name).join(' + ')}${price?` · −${price} крышечек`:''}. Ингредиенты израсходованы.`,'craft');
}
export function removeInventory(state,id,itemId,quantity,reason) {const a=getAlliance(state,id),item=getItem(state,itemId),n=integer(quantity,'Количество',1,999),why=text(reason,'Причина',160);if(!item||!['tools','equipment'].includes(item.category)||owned(state,a,item)<n)throw Error('Недостаточно предметов.');a.inventory[itemId]-=n;if(!a.inventory[itemId])delete a.inventory[itemId];log(state,id,`Списано: ${item.name}`,`${n} шт. · ${why}`,'inventory');}
export function updateSettings(state,values) {
 const name=text(values.name,'Название смены',80),duration=integer(values.duration,'Длительность',1,365),day=integer(values.day,'Сол',1,duration);
 const thresholds=String(values.levelThresholds).split(/[,;\s]+/).filter(Boolean).map(n=>integer(n,'Порог опыта'));if(!thresholds.length||thresholds[0]!==0||thresholds.length>100||thresholds.some((n,i)=>i>0&&n<=thresholds[i-1]))throw Error('Пороги должны начинаться с 0 и строго возрастать.');
 if(day!==state.shift.day)state.alliances.forEach(a=>a.access=[]);
 state.shift={name,day,duration};state.rules={levelThresholds:thresholds,consumeIngredients:true,craftCostsCaps:values.craftCostsCaps===true||values.craftCostsCaps==='on'};
}
function validId(id) {return typeof id==='string'&&/^[\w-]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);}
const isInt=(v,max=MAX_NUMBER)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const str=(v,max=2000)=>typeof v==='string'&&v.length<=max;
const unique=rows=>new Set(rows.map(r=>r.id)).size===rows.length;
export function validateState(d) {
 try {
 if(d?.version!==2||!str(d.shift?.name,80)||!isInt(d.shift.day,365)||!d.shift.day||!isInt(d.shift.duration,365)||d.shift.day>d.shift.duration||!Array.isArray(d.rules?.levelThresholds)||!d.rules.levelThresholds.length||d.rules.levelThresholds[0]!==0||d.rules.levelThresholds.some((n,i)=>!isInt(n)||(i>0&&n<=d.rules.levelThresholds[i-1]))||d.rules.consumeIngredients!==true||typeof d.rules.craftCostsCaps!=='boolean')return false;
 if(!Array.isArray(d.alliances)||!unique(d.alliances)||!Array.isArray(d.customItems)||!unique(d.customItems)||!Array.isArray(d.events)||!d.itemOverrides||typeof d.itemOverrides!=='object')return false;
 for(const item of d.customItems)if(!validId(item.id)||!Object.keys({access:1,upgrades:1,equipment:1,tools:1}).includes(item.category)||!str(item.name,100)||!str(item.effect)||!(item.price===null||isInt(item.price)))return false;
 const all=allItems(d),ids=new Set(all.map(i=>i.id));if(ids.size!==all.length)return false;
 for(const id of Object.keys(d.itemOverrides))if(!validId(id)||!ids.has(id))return false;
 for(const item of all){if(!str(item.name,100)||!str(item.effect)||!(item.price===null||isInt(item.price))||!str(item.recipeText)||!(!item.recipeIssue||str(item.recipeIssue)))return false;
  if(item.category==='tools'&&!isInt(item.toolLevel,999))return false;
  if(item.recipe){const r=item.recipe;if(r.type==='anyTools'){if(!isInt(r.count,10)||!r.count||!isInt(r.minLevel,999))return false;}else if(r.type==='specific'){if(!Array.isArray(r.variants)||!r.variants.length||r.variants.some(v=>!Array.isArray(v)||!v.length||v.length>10||v.some(id=>!ids.has(id))))return false;}else return false;}
 }
 for(const a of d.alliances){
  if(!validId(a.id)||!str(a.name,60)||!str(a.motto,140)||!['blue','purple','orange','green','pink'].includes(a.color)||!isInt(a.caps)||!isInt(a.earnedCaps)||!isInt(a.xp)||roles.some(r=>!isInt(a.functions?.[r.id]))||!str(a.interface?.name,80)||!isInt(a.interface.charge)||!isInt(a.interface.maxCharge)||!a.interface.maxCharge||a.interface.charge>a.interface.maxCharge||!isInt(a.interface.gravitons,10)||!isInt(a.interface.resilience))return false;
  if(!a.inventory||typeof a.inventory!=='object'||Array.isArray(a.inventory)||Object.entries(a.inventory).some(([id,n])=>!ids.has(id)||!['equipment','tools'].includes(getItem(d,id).category)||!isInt(n)||!n)||!Array.isArray(a.upgrades)||!Array.isArray(a.access)||a.upgrades.some(id=>getItem(d,id)?.category!=='upgrades')||a.access.some(id=>getItem(d,id)?.category!=='access'))return false;
  if(!Array.isArray(a.children)||!unique(a.children)||a.children.some(c=>!validId(c.id)||!str(c.name,60)||!roles.some(r=>r.id===c.role)||!isInt(c.xp)))return false;
  const p=a.planets;if(!p||!isInt(p.cadia?.actionPoints))return false;
  for(const [planet,key] of [['cadia','outposts'],['fenris','territories'],['cronus','shuttles']]){
   const rows=p[planet]?.[key];if(!Array.isArray(rows)||!unique(rows))return false;
   for(const r of rows){if(!validId(r.id)||!str(r.name,80))return false;if(planet==='cadia'){const b=r.bonus;if(!b||!isInt(b.caps)||!isInt(b.xp)||!isInt(b.actionPoints)||!isInt(b.quantity,999)||typeof r.claimed!=='boolean'||!(b.toolId===null||getItem(d,b.toolId)?.category==='tools')||(b.toolId&&!b.quantity))return false;}else if(!str(r.note,300))return false;}
  }
 }
 if(d.events.some(e=>!validId(e.id)||!d.alliances.some(a=>a.id===e.allianceId)||!str(e.title)||!str(e.detail)||!str(e.kind,30)||!isInt(e.sol,365)||!Number.isFinite(Date.parse(e.time))))return false;
 return true;
 }catch{return false;}
}
