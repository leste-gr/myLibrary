import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { analyseShelfPhotos, discoverGeminiCover, generateGemini, type GeminiReply } from "./gemini";
const reply=(value:unknown,grounded=false):GeminiReply=>({candidates:[{content:{parts:[{text:JSON.stringify(value)}]},...(grounded?{groundingMetadata:{webSearchQueries:["book author cover"],groundingChunks:[{web:{uri:"https://publisher.example/book",title:"Book source"}}]}}:{})}]});
const payload={schemaVersion:"mylibrary.shelfie.v1",books:[{position:1,title:"A book",authors:["Author"],categories:["Fiction"],confidence:.9,coverUrl:"https://guess.example/cover.jpg",isbn:"9780261102217"}]};

test("photo analysis validates and strips metadata before sending; no cover guesses enter the import",async()=>{
  const image=await sharp({create:{width:20,height:30,channels:3,background:"white"}}).jpeg().toBuffer();
  let sent="";
  const result=await analyseShelfPhotos([new File([image],"private-name.jpg",{type:"image/jpeg"})],async(parts,options)=>{sent=JSON.stringify(parts);assert.equal(options?.json,true);return reply(payload);});
  assert.equal(result.books[0].coverUrl,null);assert.equal(result.books[0].isbn,null);assert.deepEqual(result.books[0].categories,["Fiction"]);
  assert.ok(sent.includes('inlineData'));assert.ok(!sent.includes('private-name'));
  await assert.rejects(()=>analyseShelfPhotos([new File(["bad"],"bad.jpg",{type:"image/jpeg"})]),/could not be read/);
  await assert.rejects(()=>analyseShelfPhotos([]),/up to 3/);
});

test("LLM-planned search browses source images and requires positive visual verification",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();
  let calls=0;const fetched:string[]=[];
  const result=await discoverGeminiCover({title:"A book",author:"Author",language:"en"},{
    generate:async()=>{calls++;if(calls===1)return reply({queries:["A book Author cover"]});if(calls===2)return reply({indices:[0]});return reply({matches:true,reason:"Title and author match the cover."});},
    search:async()=>["https://publisher.example/book"],
    resource:async(url)=>{fetched.push(String(url));if(String(url).includes("search.json"))throw new Error("Fixture has no library candidates");return String(url).endsWith('/book')?{bytes:new TextEncoder().encode('<meta property="og:image" content="/cover.jpg">').buffer,contentType:"text/html",finalUrl:String(url)}:{bytes:Uint8Array.from(image).buffer,contentType:"image/jpeg",finalUrl:String(url)};},
  });
  assert.equal(result.coverUrl,"https://publisher.example/cover.jpg");assert.equal(result.sourceUrl,"https://publisher.example/book");assert.equal(result.queries.length,1);assert.equal(calls,3);assert.equal(fetched.length,3);
});

test("empty real search results never cause guessed image fetches or saved covers",async()=>{
  const result=await discoverGeminiCover({title:"Book",author:"Author",language:"en"},{generate:async()=>reply({queries:["Book Author cover"]}),search:async()=>[],resource:async()=>{throw new Error("Must not fetch invented URLs");}});
  assert.equal(result.coverUrl,null);assert.deepEqual(result.queries,["Book Author cover"]);
});

test("library candidates remain usable when retail source pages are unavailable",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();let calls=0;
  const result=await discoverGeminiCover({title:"The Hobbit",author:"Tolkien",language:"en"},{
    generate:async()=>{calls++;return calls===1?reply({queries:["The Hobbit Tolkien cover"]}):calls===2?reply({indices:[0]}):reply({matches:true,reason:"The cover identifies the requested book."});},
    search:async()=>[],
    resource:async url=>String(url).includes("search.json")?{bytes:new TextEncoder().encode(JSON.stringify({docs:[{key:"/works/OL123W",title:"The Hobbit",author_name:["Tolkien"],cover_i:123}]})).buffer,contentType:"application/json",finalUrl:String(url)}:{bytes:Uint8Array.from(image).buffer,contentType:"image/jpeg",finalUrl:String(url)},
  });
  assert.equal(result.coverUrl,"https://covers.openlibrary.org/b/id/123-L.jpg?default=false");assert.equal(result.sourceUrl,"https://openlibrary.org/works/OL123W");
});

test("API errors never expose credentials or upstream error bodies",async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY="private-test-key";
  globalThis.fetch=async(_url,init)=>{assert.equal((init?.headers as Record<string,string>)["x-goog-api-key"],"private-test-key");const body=JSON.parse(String(init?.body));assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,"low");assert.equal(body.generationConfig.temperature,undefined);return new Response('private-test-key upstream detail',{status:429});};
  try{await assert.rejects(()=>generateGemini([{text:"hello"}]),error=>error instanceof Error&&/rate limited/.test(error.message)&&!error.message.includes("private-test-key"));}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;}
});
