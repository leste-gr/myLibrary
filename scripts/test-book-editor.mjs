// Production-server integration check with an isolated mock Supabase service.
// No production sessions or data are used. Run after npm run build.
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const copyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requests = [];
let pendingCandidates, holdCandidates = true, candidateFailure = false;
let title = 'Private editor book';
function cookie(id) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [{alg:'HS256',typ:'JWT'}, {sub:id,aud:'authenticated',exp}]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.signature';
  return 'sb-127-auth-token=base64-' + Buffer.from(JSON.stringify({
    access_token:token, refresh_token:'test-refresh', expires_at:exp, expires_in:3600,
    token_type:'bearer', user:{id,email:id+'@example.test'},
  })).toString('base64url');
}
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url);
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/auth/v1/user') {
    const token = req.headers.authorization?.split(' ')[1];
    const id = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub : null;
    res.end(JSON.stringify({id,email:id+'@example.test',aud:'authenticated',app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()}));
  } else if (url.pathname === '/rest/v1/copies') {
    const allowed = url.searchParams.get('collection.owner_id') === 'eq.'+owner
      && url.searchParams.get('collection.slug') === 'eq.alpha'
      && url.searchParams.get('legacy_id') === 'eq.book-60'
      && url.searchParams.get('select').includes('collection:collections!inner(id,name)');
    if (!allowed) { res.statusCode = 406; res.end(JSON.stringify({code:'PGRST116',message:'No rows'})); return; }
    res.end(JSON.stringify({id:copyId,legacy_id:'book-60',category:'Fiction',language:'en',publisher:null,
      cover_url:null,cover_status:'cover_not_found',owner_cover_path:null,edition_verification_state:'unresolved',
      last_isbn_candidate_search_at:null,last_isbn_search_provider_failures:0,
      collection:{id:'collection-id',name:'Owned collection'},work:{title,author:'Private author'},edition:null,copy_drafts:[],
    }));
  } else if (url.pathname === '/rest/v1/edition_candidates') {
    assert.equal(url.searchParams.get('copy_id'), 'eq.'+copyId);
    if (holdCandidates) { pendingCandidates = res; return; }
    if (candidateFailure) { res.statusCode=400; res.end(JSON.stringify({message:'Unavailable'})); return; }
    res.end('[]');
  } else { res.statusCode=404; res.end('{}'); }
});
await new Promise(resolve => mock.listen(0,'127.0.0.1',resolve));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-p','3112'], {
  windowsHide:true, env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-editor-test-key'},
  stdio:['ignore','pipe','pipe'],
});
let logs='';
server.stdout.on('data', data => logs+=data);
server.stderr.on('data', data => logs+=data);
const endpoint='http://127.0.0.1:3112/collections/alpha/books/book-60';
const load = (url=endpoint, id=owner) => fetch(url, {
  headers:id ? {cookie:cookie(id)} : {}, redirect:'manual', signal:AbortSignal.timeout(8000),
});
try {
  for (let i=0;i<100&&!logs.includes('Ready');i++) await new Promise(resolve => setTimeout(resolve,100));
  assert.ok(logs.includes('Ready'),logs);
  const start=performance.now();
  const response=await load();
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let html='';
  while (!html.includes('Upload your own cover')) {
    const {value,done}=await reader.read();
    assert.equal(done,false,'editor must stream while candidate response is withheld');
    html+=decoder.decode(value,{stream:true});
  }
  const editorMs=Math.round(performance.now()-start);
  assert.ok(html.includes('Private editor book'));
  assert.ok(html.includes('Loading possible editions'));
  assert.ok(html.includes('/collections/alpha#book-book-60'));
  // Release the candidate response only after we have received the editor.
  for (let i=0;i<100&&!pendingCandidates;i++) await new Promise(resolve => setTimeout(resolve,10));
  assert.ok(pendingCandidates,'candidate request should run independently');
  pendingCandidates.end('[]'); pendingCandidates=null; holdCandidates=false;
  while (true) { const {value,done}=await reader.read(); if(done)break; html+=decoder.decode(value,{stream:true}); }
  assert.ok(html.includes('No candidate editions yet.'));
  assert.equal(requests.filter(url=>url.pathname==='/auth/v1/user').length,1,'layout and editor must share one user check');
  assert.equal(requests.filter(url=>url.pathname==='/rest/v1/copies').length,1);
  assert.equal(requests.filter(url=>url.pathname==='/rest/v1/collections').length,0,'collection ownership is joined to the book lookup');

  for (const [url,id] of [[endpoint,other],[endpoint.replace('/alpha/','/wrong-collection/'),owner],[endpoint.replace('book-60','missing'),owner]]) {
    const before=requests.filter(url=>url.pathname==='/rest/v1/edition_candidates').length;
    const denied=await load(url,id), body=await denied.text();
    assert.ok(denied.status===404||body.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
    assert.ok(!body.includes('Private editor book'));
    assert.equal(requests.filter(url=>url.pathname==='/rest/v1/edition_candidates').length,before,'denied requests must not fetch candidates');
  }
  const anonymous=await load(endpoint,null), anonBody=await anonymous.text();
  assert.ok(anonymous.headers.get('location')==='/login'||anonBody.includes('NEXT_REDIRECT'));
  assert.ok(!anonBody.includes('Private editor book'));

  title='Updated private book';
  const fresh=await (await load()).text();
  assert.ok(fresh.includes(title),'private book data must stay fresh across requests');
  candidateFailure=true;
  const partial=await (await load()).text();
  assert.ok(partial.includes('Upload your own cover'));
  assert.ok(partial.includes('Possible editions could not be loaded.'));
  assert.ok(!partial.includes('No candidate editions yet.'),'candidate failures must not look like empty results');
  console.log(JSON.stringify({result:'pass',editorBeforeCandidateResponse:true,localEditorMs:editorMs,checks:['single auth lookup','joined owner/book lookup','anonymous and non-owner denial','collection and book isolation','fresh private data','candidate failure isolation']}));
} finally {
  pendingCandidates?.end('[]');
  server.kill();
  await new Promise(resolve=>mock.close(resolve));
}
