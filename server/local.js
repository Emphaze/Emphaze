import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi,securePage,snapshotPage } from './api.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function localDatabase(filename){const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');sqlite.exec(readFileSync(resolve(root,'migrations/0001_initial.sql'),'utf8'));if(!sqlite.prepare('PRAGMA table_info(admin_sessions)').all().some(c=>c.name==='credential_hash'))sqlite.exec(readFileSync(resolve(root,'migrations/0002_session_password_revision.sql'),'utf8'));return {
 prepare(sql){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};return statement;},close(){sqlite.close();}
 };}
export function createLocalServer({database,env={},html=readFileSync(resolve(root,'index.html'),'utf8')}={}){
 return createServer(async(req,res)=>{try{
  const origin=env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
  const url=new URL(req.url,origin);const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
  const options={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
  const request=new Request(url,options);let response;
  if(url.pathname.startsWith('/api/'))response=await handleApi(request,{...env,ORBITA_DB:database},{ip:req.socket.remoteAddress});
  else if(url.pathname==='/health')response=new Response('ok');
  else if(['GET','HEAD'].includes(req.method)&&['/','/index.html','/readonly.html'].includes(url.pathname)){
   let page=html;if(url.pathname==='/readonly.html')page=await snapshotPage(page,database);response=await securePage(page);
   if(url.pathname==='/readonly.html')response.headers.set('Content-Disposition','attachment; filename="orbita-readonly.html"');
  }else response=new Response('Not found',{status:404});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Сервер не смог выполнить запрос.'}));}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dataDir=resolve(process.env.DATA_DIR||resolve(root,'data'));mkdirSync(dataDir,{recursive:true,mode:0o700});
 const database=localDatabase(resolve(dataDir,'orbita.sqlite'));
 const server=createLocalServer({database,env:process.env});
 server.listen(Number(process.env.PORT||8081),process.env.HOST||'0.0.0.0',()=>console.log(`Orbita server listening on port ${Number(process.env.PORT||8081)}; admin ${process.env.ADMIN_PASSWORD?.length>=12?'configured':'not configured (view only)'}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{database.close();process.exit(0);}));
}
