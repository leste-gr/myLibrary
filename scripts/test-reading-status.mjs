// Build first. Only an isolated mock Supabase service receives these writes.
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const collectionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requests=[],held=[];
let status='unread',holdCatalogue=false,failWrite=false;
function cookie(id) {
  const exp=Math.floor(Date.now()/1000)+3600;
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,aud:'authenticated',exp}]
    .map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.signature';
  return 'sb-127-auth-token=base64-'+Buffer.from(JSON.stringify({access_token:token,
    refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id}})).toString('base64url');
}
const mock=http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
  const token=req.headers.authorization?.split(' ')[1];
  const id=token?.includes('.')?JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub:null;
  res.setHeader('content-type','application/json');
  if(url.pathname==='/auth/v1/user') {
    res.end(JSON.stringify({id,aud:'authenticated',email:id+'@example.test',app_metadata:{},user_metadata:{},identities:[]}));
  } else if(url.pathname==='/rest/v1/collections') {
    assert.equal(url.searchParams.get('slug'),'eq.alpha');
    assert.equal(url.searchParams.get('owner_id'),'eq.'+id);
    res.end(JSON.stringify(id===owner?[{id:collectionId,slug:'alpha'}]:[]));
  } else if(url.pathname.startsWith('/rest/v1/rpc/')) {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);
    assert.equal(id,owner);assert.equal(body.target_collection_id,collectionId);
    if(failWrite){res.statusCode=500;res.end(JSON.stringify({message:'Write failed'}));return;}
    status=body.new_status;
    if(url.pathname.endsWith('set_owned_books_reading_status')) {
      assert.deepEqual(body.target_legacy_ids,['book-1','book-2']);res.end('2');
    } else {assert.equal(body.target_legacy_id,'book-1');res.end('null');}
  } else if(url.pathname==='/rest/v1/public_collections') {
    res.end(JSON.stringify([{id:collectionId,slug:'alpha',name:'Test library',description:null,book_count:2,author_count:1}]));
  } else if(url.pathname==='/rest/v1/public_catalogue') {
    if(holdCatalogue){held.push(res);return;}
    res.end(JSON.stringify([{legacy_id:'book-1',title:'Test book',author:'Test author',language:'en',category:'Test',reading_status:status}]));
  } else {res.statusCode=404;res.end('{}');}
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3114'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-reading-test-key'},
  stdio:['ignore','pipe','pipe'],
});
let logs='';server.stdout.on('data',data=>logs+=data);server.stderr.on('data',data=>logs+=data);
const origin='http://127.0.0.1:3114';
const load=()=>fetch(origin+'/collections/alpha',{signal:AbortSignal.timeout(5000)}).then(r=>r.text());
const save=(body,id=owner,headers={})=>fetch(origin+'/api/reading-status',{
  method:'POST',headers:{origin,'content-type':'application/json',...(id?{cookie:cookie(id)}:{}),...headers},
  body:JSON.stringify(body),signal:AbortSignal.timeout(5000),
});
const payload={slug:'alpha',legacyId:'book-1',status:'read'};
try {
  for(let i=0;i<100&&!logs.includes('Ready');i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(logs.includes('Ready'),logs);
  await load();
  holdCatalogue=true;
  const before=requests.length,start=performance.now();
  const response=await save(payload);
  assert.equal(response.status,200,logs);assert.deepEqual(await response.json(),{success:true});
  const saveMs=Math.round(performance.now()-start);
  assert.deepEqual(requests.slice(before),['/auth/v1/user','/rest/v1/collections','/rest/v1/rpc/set_owned_book_reading_status'],
    'save must not repeat auth, reload the catalogue, or render the radar');
  assert.equal(held.length,0,'save must finish even when catalogue reads cannot complete');
  holdCatalogue=false;
  const reads=requests.filter(p=>p==='/rest/v1/public_catalogue').length;
  const fresh=await load();
  assert.ok(fresh.includes('readingStatus\\\":\\\"read'));
  assert.equal(requests.filter(p=>p==='/rest/v1/public_catalogue').length,reads+1,'next visit reloads invalidated public data');
  const bulk=await save({slug:'alpha',legacyIds:['book-1','book-2'],status:'radar'});
  assert.equal(bulk.status,200);assert.deepEqual(await bulk.json(),{updated:2});
  const writes=()=>requests.filter(p=>p.startsWith('/rest/v1/rpc/')).length;
  const written=writes();
  for(const [body,id,headers] of [
    [payload,null,{}],[payload,other,{}],[payload,owner,{origin:'https://foreign.test'}],
    [payload,owner,{'content-type':'text/plain'}],[{...payload,slug:3},owner,{}],
    [{...payload,legacyId:{}},owner,{}],[{...payload,status:'invalid'},owner,{}],
    [{slug:'alpha',legacyIds:['book-1','book-1'],status:'read'},owner,{}],[null,owner,{}],
  ]) {
    const denied=await save(body,id,headers);assert.ok(denied.status>=400);assert.ok((await denied.json()).error);
  }
  assert.equal(writes(),written,'invalid, anonymous, foreign-owner and cross-origin requests cannot write');
  failWrite=true;
  const failure=await save(payload);
  assert.equal(failure.status,400);assert.ok((await failure.json()).error,'failed write lets the selector roll back');
  assert.equal(status,'radar');
  console.log(JSON.stringify({result:'pass',localSaveMs:saveMs,saveDatabaseRequests:3,
    checks:['no page render after save','fresh public data on next visit','single and bulk writes','auth and origin protection','invalid input','write failure']}));
} finally {
  held.forEach(res=>res.end('[]'));server.kill();await new Promise(resolve=>mock.close(resolve));
}
