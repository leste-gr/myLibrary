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

test("API errors never expose credentials or upstream error bodies",async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY="private-test-key";
  globalThis.fetch=async(_url,init)=>{assert.equal((init?.headers as Record<string,string>)["x-goog-api-key"],"private-test-key");const body=JSON.parse(String(init?.body));assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,"low");assert.equal(body.generationConfig.temperature,undefined);return new Response('private-test-key upstream detail',{status:429});};
  try{await assert.rejects(()=>generateGemini([{text:"hello"}]),error=>error instanceof Error&&/rate limited/.test(error.message)&&!error.message.includes("private-test-key"));}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;}
});


test("first Serper image is saved without Gemini or catalogue calls",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();
  const fetched:string[]=[];
  const result=await discoverGeminiCover({title:"A book",author:"Author",language:"en"},{
    search:async()=>[0,1].map(i=>({url:`https://publisher.example/${i}.jpg`,source:"https://publisher.example/book",label:"Book"})),
    resource:async url=>{fetched.push(String(url));return {bytes:Uint8Array.from(image).buffer,contentType:"image/jpeg",finalUrl:String(url)};},
  });
  assert.equal(result.coverUrl,"https://publisher.example/0.jpg");assert.equal(result.notes,"First image search result selected.");
  assert.deepEqual(fetched,["https://publisher.example/0.jpg"]);
});

test("empty, unavailable and unreadable first results keep unified outcome without fallback",async()=>{
  for(const scenario of ["empty","unavailable","corrupt"]){
    let searches=0,downloads=0;
    const result=await discoverGeminiCover({title:"Book",author:"Author",language:"en"},{
      search:async()=>{searches++;if(scenario==="unavailable")throw new Error("provider error");return scenario==="empty"?[]:[0,1].map(i=>({url:`https://publisher.example/${i}.jpg`,source:"https://publisher.example/book",label:"Book"}));},
      resource:async url=>{downloads++;assert.equal(String(url),"https://publisher.example/0.jpg");return {bytes:new ArrayBuffer(2),contentType:"image/jpeg",finalUrl:String(url)};},
    });
    assert.equal(searches,1);assert.equal(downloads,scenario==="corrupt"?1:0);
    assert.equal(result.coverUrl,null);assert.equal(result.notes,"No suitable cover found.");
  }
});

test("missing author placeholders stay out of cover queries",async()=>{
  for(const author of ["Άγνωστος","Unknown","Unknown author",""]){
    const result=await discoverGeminiCover({title:"Dragon #292",author,language:"en"},{search:async(query,language)=>{assert.equal(query,"Dragon #292");assert.equal(language,"en");return [];}});
    assert.deepEqual(result.queries,["Dragon #292"]);
  }
});
