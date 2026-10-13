import { handleApi, securePage, snapshotPage } from './api.js';
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/'))return handleApi(request,env,{ip:request.headers.get('CF-Connecting-IP')||'unknown'});
  if(url.pathname==='/health')return new Response('ok',{headers:{'Content-Type':'text/plain'}});
  if(!['/','/index.html','/readonly.html'].includes(url.pathname)||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
  const asset=await env.ASSETS.fetch(new Request(`${url.origin}/index.html`));if(!asset.ok)return asset;
  let html=await asset.text();if(url.pathname==='/readonly.html')html=await snapshotPage(html,env.ORBITA_DB);
  const response=await securePage(html);if(url.pathname==='/readonly.html')response.headers.set('Content-Disposition','attachment; filename="orbita-readonly.html"');
  return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
 }
};
