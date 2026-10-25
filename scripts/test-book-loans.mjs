// Build without embedded Supabase variables first. All requests use this isolated fixture.
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const collectionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requests=[];
let loan=null,failWrite=false;
function cookie(id) {
  const exp=Math.floor(Date.now()/1000)+3600;
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,aud:'authenticated',exp}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.signature';
  return 'sb-127-auth-token=base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id}})).toString('base64url');
}
const mock=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
  const token=req.headers.authorization?.split(' ')[1];
  const id=token?.includes('.')?JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub:null;
  res.setHeader('content-type','application/json');
  if(url.pathname==='/auth/v1/user')res.end(JSON.stringify({id,aud:'authenticated',email:id+'@example.test',app_metadata:{},user_metadata:{},identities:[]}));
  else if(url.pathname==='/rest/v1/collections')res.end(JSON.stringify(id===owner?[{id:collectionId,slug:'loan-test'}]:[]));
  else if(url.pathname==='/rest/v1/public_collections')res.end(JSON.stringify([{id:collectionId,slug:'loan-test',name:'Loan test',description:null,book_count:1,author_count:1}]));
  else if(url.pathname==='/rest/v1/public_catalogue')res.end(JSON.stringify([{legacy_id:'B1',title:'Book one',author:'Author',category:'Fiction',language:'en',reading_status:'radar',cover_url:null}]));
  else if(url.pathname==='/rest/v1/book_loans'){
    assert.equal(id,owner);assert.equal(url.searchParams.get('collection_id'),'eq.'+collectionId);
    res.end(JSON.stringify(loan?[{...loan,copy:{legacy_id:'B1'}}]:[]));
  } else if(url.pathname==='/rest/v1/rpc/set_owned_book_loan'){
    assert.equal(id,owner);
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);assert.equal(body.target_collection_id,collectionId);assert.equal(body.target_legacy_id,'B1');
    if(failWrite){res.statusCode=500;res.end(JSON.stringify({message:'Fixture failure'}));return;}
    loan=body.new_status==='none'?null:{status:body.new_status,person_name:body.contact_name};res.end('null');
  }else{res.statusCode=404;res.end('{}');}
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3118'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-loan-key'},stdio:['ignore','pipe','pipe'],
});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const origin='http://127.0.0.1:3118';
const load=id=>fetch(origin+'/collections/loan-test',{headers:id?{cookie:cookie(id)}:{},signal:AbortSignal.timeout(8000)});
const save=(body,id=owner,headers={})=>fetch(origin+'/api/book-loan',{method:'POST',headers:{origin,'content-type':'application/json',...(id?{cookie:cookie(id)}:{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
const payload={slug:'loan-test',legacyId:'B1',status:'loaned_out',personName:'  PrivateBorrowerXYZ  '};
try{
  for(let i=0;i<100&&!logs.includes('Ready');i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(logs.includes('Ready'),logs);
  const initial=await(await load(owner)).text();assert.ok(initial.includes('Loan status'));
  const before=requests.length;
  const out=await save(payload);assert.equal(out.status,200);assert.deepEqual(await out.json(),{success:true});
  assert.deepEqual(requests.slice(before),['/auth/v1/user','/rest/v1/collections','/rest/v1/rpc/set_owned_book_loan'],'save acknowledges without rendering the collection');
  const own=await load(owner);assert.match(own.headers.get('cache-control'),/private/);
  assert.ok((await own.text()).includes('PrivateBorrowerXYZ'),'owner reload retains saved loan');
  const count=requests.filter(p=>p==='/rest/v1/book_loans').length;
  for(const id of [null,other])assert.ok(!(await(await load(id)).text()).includes('PrivateBorrowerXYZ'),'private contact must not enter public HTML or RSC');
  assert.equal(requests.filter(p=>p==='/rest/v1/book_loans').length,count,'visitor requests do not read loan contacts');
  const writes=()=>requests.filter(p=>p==='/rest/v1/rpc/set_owned_book_loan').length;
  const written=writes();
  for(const[body,id,headers]of[
    [payload,null,{}],[payload,other,{}],[payload,owner,{origin:'https://foreign.test'}],[payload,owner,{'content-type':'text/plain'}],
    [null,owner,{}],[{...payload,status:'invalid'},owner,{}],[{...payload,personName:{}},owner,{}],[{...payload,personName:'x'.repeat(121)},owner,{}],
  ]){const denied=await save(body,id,headers);assert.ok(denied.status>=400);assert.ok((await denied.json()).error);}
  assert.equal(writes(),written,'invalid or unauthorized requests never invoke the write RPC');
  const borrowed=await save({...payload,status:'loaned_in',personName:'PrivateLenderXYZ'});assert.equal(borrowed.status,200);
  assert.equal(loan.status,'loaned_in');assert.equal(loan.person_name,'PrivateLenderXYZ');
  failWrite=true;const failed=await save({...payload,status:'none',personName:null});assert.ok(failed.status>=400);assert.equal(loan.person_name,'PrivateLenderXYZ');
  failWrite=false;const cleared=await save({...payload,status:'none',personName:'Stale contact'});assert.equal(cleared.status,200);assert.equal(loan,null);
  assert.ok(!(await(await load(owner)).text()).includes('PrivateLenderXYZ'));
  console.log(JSON.stringify({result:'pass',checks:['loan-out/in persistence','owner-only HTML and RSC','private cache headers','no collection render on save','CSRF/validation/auth checks','save failure preserves data','return clears contact']}));
}finally{server.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
