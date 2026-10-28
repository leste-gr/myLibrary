// Build with fixture Supabase URL http://127.0.0.1:3130 and key test-anon first.
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const cid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',iid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',nid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let target=cid,creates=0,imports=0;const calls=[];
function cookie(id){const exp=Math.floor(Date.now()/1000)+3600;const token=[{alg:'HS256',typ:'JWT'},{sub:id,aud:'authenticated',exp}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.signature';return 'sb-127-auth-token=base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id}})).toString('base64url');}
const db=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const token=req.headers.authorization?.split(' ')[1];const id=token?.includes('.')?JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub:null;
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3125');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,x-client-info,content-type,prefer');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');if(req.method==='OPTIONS'){res.end();return;}
 res.setHeader('Content-Type','application/json');
 if(url.pathname==='/auth/v1/user')return res.end(JSON.stringify({id,aud:'authenticated',email:'owner@example.test',app_metadata:{},user_metadata:{},identities:[]}));
 if(url.pathname==='/rest/v1/collections'){
  if(req.method==='POST'){let body='';for await(const b of req)body+=b;const input=JSON.parse(body);assert.equal(input.owner_id,owner);assert.equal(input.name,'New collection from photo');target=nid;creates++;return res.end(JSON.stringify({id:nid,slug:'new-shelf',name:input.name}));}
  const data=id===owner?[{id:target,slug:target===nid?'new-shelf':'existing-shelf',name:'Existing shelf'}]:[];
  return res.end(JSON.stringify(data));
 }
 if(url.pathname==='/rest/v1/rpc/import_gemini_books'){
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);assert.equal(id,owner);target=body.target_collection_id;assert.equal(body.payload.books[0].title,'Photo book');assert.deepEqual(body.payload.books[0].categories,['Fiction','Fantasy']);imports++;return res.end(JSON.stringify({importId:iid,imported:1,duplicate:false}));
 }
 if(url.pathname==='/rest/v1/manual_genai_imports')return res.end(JSON.stringify(id===owner?[{id:iid,collection_id:target}]:[]));
 res.end('[]');
});await new Promise(r=>db.listen(3130,'127.0.0.1',r));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3125'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${db.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anon',GEMINI_API_KEY:'fixture-key-only'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);let browser;const origin='http://127.0.0.1:3125';
try{
 for(let i=0;i<100&&!logs.includes('Ready');i++)await new Promise(r=>setTimeout(r,100));assert.ok(logs.includes('Ready'),logs);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [width,locale,newCollection] of [[320,'el',false],[390,'en',true],[1280,'en',false]]){
  target=cid;const context=await browser.newContext({viewport:{width,height:850},isMobile:width<768,hasTouch:width<768});
  await context.addCookies([{name:'sb-127-auth-token',value:cookie(owner).split('=')[1],url:origin},{name:'mylibrary-language',value:locale,url:origin}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let next=0;
  await page.route('**/api/gemini/analyse',route=>route.fulfill({json:{payload:{schemaVersion:'mylibrary.shelfie.v1',books:[{position:1,title:'Photo book',authors:['Author'],categories:['Fiction','Fantasy'],confidence:.9}]}}}));
  await page.route('**/api/gemini/covers',route=>{const body=route.request().postDataJSON();calls.push(body.action);if(body.action==='next')next++;return route.fulfill({json:{jobs:[{id:iid,status:next?'found':'pending',attempts:next?1:0,outcome:next?{notes:'Title verified',coverUrl:'https://example.test/cover.jpg',sources:[{title:'Publisher',url:'https://example.test/book'}]}:{},copy:{legacy_id:'B1',work:{title:'Photo book'}}}]}});});
  await page.goto(origin+'/shelfies/gemini?collection=existing-shelf');
  await page.locator('#shelf-photos').setInputFiles({name:'shelf.jpg',mimeType:'image/jpeg',buffer:Buffer.from('fixture-upload-intercepted')});
  await page.locator('input[name=consent]').check();await page.locator('.gemini-photo-form button').click();
  await page.locator('.review-book').waitFor();assert.equal(await page.locator('.review-book input').count()>2,true);
  if(newCollection){await page.locator('#destination').selectOption('new');await page.locator('#collection-name').fill('New collection from photo');}
  else assert.equal(await page.locator('#destination').inputValue(),cid);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.review-form button[type=submit]').click();await page.waitForURL('**/gemini/covers?importId='+iid,{timeout:8000}).catch(async e=>{console.log('UI failure:',await page.locator('.form-error').allTextContents(),'imports',imports,'URL',page.url(),'errors',errors);throw e;});
  await page.waitForFunction(()=>document.querySelector('.gemini-job-list>li>span')?.textContent?.match(/Cover found|Βρέθηκε εξώφυλλο/));
  assert.ok(next>0);assert.equal(await page.locator('.gemini-job-list').textContent().then(t=>t.includes('Photo book')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);if(width===320)await page.screenshot({path:'/tmp/gemini-mobile-progress.png',fullPage:true});
  console.log(JSON.stringify({width,locale,newCollection,result:'pass'}));await context.close();
 }
 assert.equal(creates,1);assert.equal(imports,3);assert.ok(calls.includes('next'));
 const api=(path,id,body,extra={})=>fetch(origin+path,{method:'POST',headers:{origin, ...(id?{cookie:cookie(id)}:{}),...extra},body});
 assert.equal((await api('/api/gemini/analyse',null,new FormData())).status,401);
 assert.equal((await api('/api/gemini/analyse',owner,new FormData(),{origin:'https://evil.test'})).status,403);
 assert.equal((await api('/api/gemini/analyse',owner,new FormData())).status,400);
 const broken=new FormData();broken.set('consent','yes');broken.append('photos',new Blob(['bad'],{type:'image/jpeg'}),'bad.jpg');assert.equal((await api('/api/gemini/analyse',owner,broken)).status,400);
 const denied=await api('/api/gemini/covers',other,JSON.stringify({action:'next',importId:iid}),{'Content-Type':'application/json'});assert.equal(denied.status,404);
 console.log('Authentication, ownership, consent, origin and corrupt-photo checks: pass');
}finally{await browser?.close();server.kill();db.closeAllConnections();await new Promise(r=>db.close(r));}
