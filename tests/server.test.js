import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDatabase,createLocalServer } from '../server/local.js';
import { handleApi, digest } from '../server/api.js';
async function fixture(t,{password=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'orbita-auth-')),db=localDatabase(join(dir,'test.sqlite'));
 const secret=randomBytes(24).toString('base64url'),env=password?{ADMIN_PASSWORD:secret}:{};
 const server=createLocalServer({database:db,env});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});
 const call=(path,{cookie,csrf,body,method='GET',originHeader=origin,...opts}={})=>fetch(origin+path,{method,headers:{...(method!=='GET'?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...opts.headers},...(body?{body:JSON.stringify(body)}:{})});
 const login=async()=>{const r=await call('/api/login',{method:'POST',body:{password:secret}});assert.equal(r.status,200);const body=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:body.csrfToken,response:r};};
 return {db,filename:join(dir,'test.sqlite'),server,origin,secret,env,call,login};
}
test('public visitors read shared state but every unauthenticated write is rejected',async t=>{
 const {call}=await fixture(t);const response=await call('/api/state');assert.equal(response.status,200);const saved=await response.json();
 assert.equal((await (await call('/api/session')).json()).role,'viewer');
 for(const path of ['/api/state','/api/logout'])assert.equal((await call(path,{method:path.endsWith('state')?'PUT':'POST',body:{state:saved.state,revision:0},cookie:'orbita_session=forged',csrf:'fake',headers:{'X-Role':'admin'}})).status,401);
 assert.deepEqual(await (await call('/api/state')).json(),saved);
});
test('only the password owner receives an HttpOnly session; passwords and tokens are not in HTML',async t=>{
 const {call,login,secret}=await fixture(t);assert.equal((await call('/api/login',{method:'POST',body:{password:'incorrect-password'}})).status,401);
 const auth=await login();assert.match(auth.response.headers.get('set-cookie'),/HttpOnly/);assert.match(auth.response.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal((await (await call('/api/session',{cookie:auth.cookie})).json()).role,'admin');
 const page=await call('/');const html=await page.text();assert.ok(!html.includes(secret));assert.ok(!html.includes(auth.csrf));assert.ok(!html.includes(auth.cookie));assert.match(page.headers.get('content-security-policy'),/script-src 'sha256-/);assert.equal(page.headers.get('x-frame-options'),'DENY');
});
test('admin writes require CSRF verification and reject cross-origin requests',async t=>{
 const {call,login}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();saved.state.alliances[0].caps+=10;
 for(const opts of [{},{csrf:'wrong'},{csrf:auth.csrf,originHeader:'https://other.example'}])assert.equal((await call('/api/state',{method:'PUT',body:saved,cookie:auth.cookie,...opts})).status,403);
 const ok=await call('/api/state',{method:'PUT',body:saved,...auth});assert.equal(ok.status,200);assert.equal((await ok.json()).revision,1);
 assert.equal((await(await call('/api/state')).json()).state.alliances[0].caps,saved.state.alliances[0].caps);
});
test('stale or simultaneous admin writes cannot overwrite the latest revision',async t=>{
 const {call,login}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();
 const one=structuredClone(saved),two=structuredClone(saved);one.state.shift.name='Первое изменение';two.state.shift.name='Второе изменение';
 const responses=await Promise.all([call('/api/state',{method:'PUT',body:one,...auth}),call('/api/state',{method:'PUT',body:two,...auth})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal((await(await call('/api/state')).json()).revision,1);
});
test('bad imported states and negative currency are rejected by the server',async t=>{
 const {call,login}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();const bad=structuredClone(saved);bad.state.alliances[0].caps=-10;
 assert.equal((await call('/api/state',{method:'PUT',body:bad,...auth})).status,400);assert.deepEqual(await(await call('/api/state')).json(),saved);
});
test('logout invalidates the server-side session immediately',async t=>{
 const {call,login}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();assert.equal((await call('/api/logout',{method:'POST',body:{},...auth})).status,200);
 assert.equal((await(await call('/api/session',{cookie:auth.cookie})).json()).role,'viewer');assert.equal((await call('/api/state',{method:'PUT',body:saved,...auth})).status,401);
});
test('expired sessions and login flooding are denied',async t=>{
 const {db,env,call,login,origin}=await fixture(t),auth=await login();await db.prepare('UPDATE admin_sessions SET expires_at = 0').run();assert.equal((await(await call('/api/session',{cookie:auth.cookie})).json()).role,'viewer');
 for(let i=0;i<10;i++)assert.equal((await call('/api/login',{method:'POST',body:{password:'wrong'}})).status,401);
 const limited=await call('/api/login',{method:'POST',body:{password:'wrong'}});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 // Cloud worker sessions on HTTPS always receive Secure cookies.
 const request=new Request('https://camp.example/api/login',{method:'POST',headers:{Origin:'https://camp.example','Content-Type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD})});
 const response=await handleApi(request,{...env,ORBITA_DB:db},{ip:'separate-ip'});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure/);
});
test('missing admin configuration never opens registration or editing',async t=>{
 const {call}=await fixture(t,{password:false});assert.deepEqual(await(await call('/api/session')).json(),{role:'viewer',configured:false});assert.equal((await call('/api/login',{method:'POST',body:{password:'any-password'}})).status,503);assert.equal((await call('/api/state')).status,200);
});
test('SQLite survives server restarts; internal source and database paths stay private',async t=>{
 const {call,login,db,filename}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();saved.state.shift.name='Сохранённая смена';assert.equal((await call('/api/state',{method:'PUT',body:saved,...auth})).status,200);
 for(const path of ['/server/local.js','/data/orbita.sqlite','/.env','/src/main.js'])assert.equal((await call(path)).status,404);
 const reopened=localDatabase(filename);const row=await reopened.prepare('SELECT document FROM camp_state WHERE id=1').first();reopened.close();assert.equal(JSON.parse(row.document).shift.name,'Сохранённая смена');
 const hashes=await db.prepare('SELECT token_hash FROM admin_sessions').first();assert.ok(!auth.cookie.includes(hashes.token_hash));
});
test('viewer download is a standalone snapshot of current server data',async t=>{
 const {call,login}=await fixture(t),auth=await login(),saved=await(await call('/api/state')).json();saved.state.shift.name='Копия <без скриптов>';await call('/api/state',{method:'PUT',body:saved,...auth});
 const response=await call('/readonly.html'),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/orbita-readonly.html/);assert.match(html,/data-snapshot=/);assert.match(html,/Копия &lt;без скриптов&gt;/);assert.ok(!html.includes(auth.csrf));
});

test('changing the admin password revokes all previous sessions',async t=>{
 const {call,login,db,env}=await fixture(t),auth=await login();
 const request=new Request('https://camp.example/api/session',{headers:{Cookie:auth.cookie}});
 const response=await handleApi(request,{...env,ADMIN_PASSWORD:randomBytes(24).toString('base64url'),ORBITA_DB:db});
 assert.equal((await response.json()).role,'viewer');
});
