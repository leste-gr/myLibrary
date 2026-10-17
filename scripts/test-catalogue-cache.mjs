// Run after npm run build. This starts a local mock database and a local Next
// server only; generated sessions and mutations never reach production.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const requests=[];
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const alphaId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let deleted=false;
function cookie(id){
 const exp=Math.floor(Date.now()/1000)+3600;
 const token=[{alg:'HS256',typ:'JWT'},{sub:id,aud:'authenticated',exp}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.signature';
 return 'sb-127-auth-token=base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:id+'@example.test'}})).toString('base64url');
}
const mock=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
 res.setHeader('content-type','application/json');
 if(url.pathname==='/auth/v1/user') {
   const token=req.headers.authorization?.split(' ')[1];
   const id=token?JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub:null;
   res.end(JSON.stringify({id,email:id+'@example.test',aud:'authenticated',app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()}));
 } else if(url.pathname==='/rest/v1/collections') {
   const allowed=!deleted&&url.searchParams.get('owner_id')==='eq.'+owner;
   res.end(JSON.stringify(allowed?[{id:alphaId,slug:'alpha'}]:[]));
 } else if(url.pathname==='/rest/v1/rpc/delete_owned_collection') {
   deleted=true;res.end('null');
 } else if(url.pathname==='/rest/v1/public_collections') {
   const slug=url.searchParams.get('slug')?.slice(3);
   const rows=['alpha','beta'].filter(s=>(!deleted||s!=='alpha')&&(!slug||s===slug)).map(s=>({id:s==='alpha'?alphaId:s,slug:s,name:`Library ${s}`,description:null,book_count:1,author_count:1}));
   res.end(JSON.stringify(rows));
 } else if(url.pathname==='/rest/v1/public_catalogue') {
   const slug=url.searchParams.get('collection_slug')?.slice(3);
   res.end(JSON.stringify(slug==='missing'?[]:[{legacy_id:`${slug}-book`,title:`Unique ${slug} title`,author:'Test author',series:null,language:'en',category:'Test',publisher:null,cover_url:null,isbn13:null,notes:'UNUSED_PRIVATE_NOTES'}]));
 } else {res.statusCode=404;res.end('{}');}
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3108'],{windowsHide:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-public-test-key'},stdio:['ignore','pipe','pipe']});
let logs='';next.stdout.on('data',d=>logs+=d);next.stderr.on('data',d=>logs+=d);
try {
 for(let i=0;i<100&&!logs.includes('Ready');i++)await new Promise(r=>setTimeout(r,100));
 if(!logs.includes('Ready'))throw Error('Local server did not start: '+logs);
 const load=async(path,options)=>{const start=performance.now(),r=await fetch('http://127.0.0.1:3108'+path,options),html=await r.text();return {r,html,ms:Math.round(performance.now()-start)};};
 const home=await load('/');assert.equal(home.r.status,200);assert.ok(home.html.includes('Library alpha'));
 const afterFirst=requests.length;
 await load('/');assert.equal(requests.length,afterFirst,'directory reads must be reused across requests');
 const cold=await load('/collections/alpha');assert.ok(cold.html.includes('Unique alpha title'));assert.ok(!cold.html.includes('UNUSED_PRIVATE_NOTES'));assert.ok(!cold.html.includes('Editing enabled'));
 const afterCollection=requests.length;
 const warm=await load('/collections/alpha');assert.equal(requests.length,afterCollection,'collection metadata and books must be reused across requests');
 const beta=await load('/collections/beta');assert.ok(beta.html.includes('Unique beta title'));assert.ok(!beta.html.includes('Unique alpha title'),'cache must isolate collection slugs');
 const missing=await load('/collections/missing');assert.ok(!missing.html.includes('Unique alpha title'));assert.ok(missing.html.includes('NEXT_HTTP_ERROR_FALLBACK;404')||missing.r.status===404);
 const ownerPage=await load('/collections/alpha',{headers:{cookie:cookie(owner)}});assert.ok(ownerPage.html.includes('Editing enabled'));
 const otherPage=await load('/collections/alpha',{headers:{cookie:cookie(other)}});assert.ok(!otherPage.html.includes('Editing enabled'),'owner privileges must never be cached for another user');
 const anonAgain=await load('/collections/alpha');assert.ok(!anonAgain.html.includes('Editing enabled'));
 const mine=await load('/?view=mine',{headers:{cookie:cookie(owner)}});assert.ok(mine.html.includes('Library alpha'));assert.ok(!mine.html.includes('Library beta'));
 const manifest=JSON.parse(fs.readFileSync('.next/server/server-reference-manifest.json','utf8'));
 const actionId=Object.entries(manifest.node).find(([,entry])=>entry.exportedName==='deleteCollection')[0];
 const form=new FormData();form.set('$ACTION_ID_'+actionId,'');form.set('collectionId',alphaId);
 const deletion=await fetch('http://127.0.0.1:3108/collections/alpha',{method:'POST',headers:{cookie:cookie(owner)},body:form,redirect:'manual'});
 assert.equal(deletion.status,303,await deletion.text());
 const fresh=await load('/');assert.ok(!fresh.html.includes('Library alpha'),'existing mutation revalidation must expire the directory cache immediately');
 const removed=await load('/collections/alpha');assert.ok(!removed.html.includes('Unique alpha title'),'deleted collection must no longer render from cache');
 assert.ok(!logs.includes('Error:'),logs);
 console.log(JSON.stringify({result:'pass',coldLocalMs:cold.ms,warmLocalMs:warm.ms,databaseRequests:requests},null,2));
} finally {next.kill();await new Promise(r=>mock.close(r));}
