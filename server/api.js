import { initialState, validateState } from '../src/model.js';
const COOKIE = 'orbita_session';
const MAX_BODY = 5 * 1024 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const json = (body,status=200,extra={}) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const error = (message,status) => json({error:message},status);
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function cookies(request){const value=request.headers.get('Cookie')||'';const match=value.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`));return match?match.slice(COOKIE.length+1):'';}
function cookie(value,secure,clear=false){return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:SESSION_MS/1000}${secure?'; Secure':''}`;}
async function readBody(request){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw Object.assign(Error('Нужен JSON-запрос.'),{status:415});
 if(Number(request.headers.get('Content-Length'))>MAX_BODY)throw Object.assign(Error('Запрос слишком большой.'),{status:413});
 const reader=request.body?.getReader();if(!reader)throw Object.assign(Error('Пустой запрос.'),{status:400});
 const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BODY){await reader.cancel();throw Object.assign(Error('Запрос слишком большой.'),{status:413});}chunks.push(value);}
 const buffer=new Uint8Array(length);let offset=0;for(const c of chunks){buffer.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(buffer));}catch{throw Object.assign(Error('Некорректный JSON.'),{status:400});}
}
async function session(request,db,now,password){const token=cookies(request);if(!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT token_hash, csrf_token, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ? AND credential_hash = ?').bind(await digest(token),now,await digest(password)).first();}
async function stateRecord(db,now){let row=await db.prepare('SELECT revision, document FROM camp_state WHERE id = 1').first();if(!row){await db.prepare('INSERT OR IGNORE INTO camp_state (id, revision, document, updated_at) VALUES (1, 0, ?, ?)').bind(JSON.stringify(initialState()),now).run();row=await db.prepare('SELECT revision, document FROM camp_state WHERE id = 1').first();}return row;}
async function consumeAttempt(db,key,now,max){
 await db.prepare(`INSERT INTO login_attempts (key, window_start, attempts) VALUES (?, ?, 1)
 ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
 window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END`).bind(key,now,now-15*60*1000,now-15*60*1000).run();
 const row=await db.prepare('SELECT attempts FROM login_attempts WHERE key = ?').bind(key).first();return row.attempts<=max;
}
export async function handleApi(request,env,{ip='unknown',now=Date.now()}={}){
 const db=env.ORBITA_DB;if(!db)return error('База данных не подключена.',503);
 const url=new URL(request.url),path=url.pathname,secure=env.COOKIE_SECURE==='false'?false:url.protocol==='https:';
 const configured=typeof env.ADMIN_PASSWORD==='string'&&env.ADMIN_PASSWORD.length>=12&&env.ADMIN_PASSWORD.length<=256;
 try{
  if(path==='/api/state'&&request.method==='GET'){const row=await stateRecord(db,now);return json({state:JSON.parse(row.document),revision:row.revision});}
  if(path==='/api/session'&&request.method==='GET'){const s=configured?await session(request,db,now,env.ADMIN_PASSWORD):null;return json({role:s?'admin':'viewer',configured,...(s?{csrfToken:s.csrf_token,expiresAt:s.expires_at}:{})});}
  if(!['POST','PUT','DELETE','PATCH'].includes(request.method))return error('Маршрут не найден.',404);
  // Cross-origin requests are never allowed to change state or establish sessions.
  const expectedOrigin=env.PUBLIC_ORIGIN?new URL(env.PUBLIC_ORIGIN).origin:url.origin;
  if(request.headers.get('Origin')!==expectedOrigin)return error('Запрос с другого сайта запрещён.',403);
  if(path==='/api/login'&&request.method==='POST'){
   if(!configured)return error('Администратор пока не настроен. Задайте ADMIN_PASSWORD в настройках хостинга (не менее 12 символов).',503);
   if(!await consumeAttempt(db,`ip:${ip}`,now,10)||!await consumeAttempt(db,'global',now,40))return json({error:'Слишком много попыток. Попробуйте через 15 минут.'},429,{'Retry-After':'900'});
   const body=await readBody(request);if(typeof body.password!=='string'||body.password.length>256)return error('Неверный пароль.',401);
   if(!equal(await digest(body.password),await digest(env.ADMIN_PASSWORD)))return error('Неверный пароль.',401);
   const token=randomToken(),csrf=randomToken();await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
   const old=cookies(request);if(/^[a-f0-9]{64}$/.test(old))await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await digest(old)).run();
   await db.prepare('INSERT INTO admin_sessions (token_hash, csrf_token, expires_at, credential_hash) VALUES (?, ?, ?, ?)').bind(await digest(token),csrf,now+SESSION_MS,await digest(env.ADMIN_PASSWORD)).run();
   await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(`ip:${ip}`).run();
   return json({role:'admin',csrfToken:csrf,expiresAt:now+SESSION_MS},200,{'Set-Cookie':cookie(token,secure)});
  }
  const s=configured?await session(request,db,now,env.ADMIN_PASSWORD):null;
  if(!s)return error('Редактирование доступно только прайму. Войдите снова.',401);
  if(!equal(request.headers.get('X-CSRF-Token'),s.csrf_token))return error('Проверка сессии не пройдена. Обновите страницу.',403);
  if(path==='/api/logout'&&request.method==='POST'){await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(s.token_hash).run();return json({role:'viewer'},200,{'Set-Cookie':cookie('',secure,true)});}
  if(path==='/api/state'&&request.method==='PUT'){
   const body=await readBody(request);if(!Number.isSafeInteger(body.revision)||body.revision<0||!validateState(body.state))return error('Некорректное сохранение путешествия.',400);
   // One conditional statement prevents stale admin tabs from overwriting changes.
   const result=await db.prepare('UPDATE camp_state SET document = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?').bind(JSON.stringify(body.state),now,body.revision).run();
   if(!result.meta?.changes)return error('Данные уже изменились в другой вкладке. Обновите страницу и повторите действие.',409);
   return json({revision:body.revision+1});
  }
  return error('Маршрут не найден.',404);
 }catch(err){return error(err.status?err.message:'Сервер не смог выполнить запрос.',err.status||500);}
}
export async function securePage(html){
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(script)));
 const hash=btoa(String.fromCharCode(...bytes));
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`}});
}
export async function snapshotPage(html,db){const row=await stateRecord(db,Date.now());const escaped=row.document.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');return html.replace('<div id="app"></div>',`<div id="app" data-snapshot="${escaped}"></div>`);}
