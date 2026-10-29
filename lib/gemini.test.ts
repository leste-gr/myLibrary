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

test("image search candidates require positive visual verification before saving",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();
  let calls=0;const fetched:string[]=[];
  const result=await discoverGeminiCover({title:"A book",author:"Author",language:"en"},{
    generate:async()=>{calls++;if(calls===1)return reply({indices:[0]});return reply({matches:true,reason:"Title and author match the cover."});},
    search:async()=>[{url:"https://publisher.example/cover.jpg",source:"https://publisher.example/book",label:"A book Author"}],
    resource:async(url)=>{fetched.push(String(url));return {bytes:Uint8Array.from(image).buffer,contentType:"image/jpeg",finalUrl:String(url)};},
  });
  assert.equal(result.coverUrl,"https://publisher.example/cover.jpg");assert.equal(result.sourceUrl,"https://publisher.example/book");assert.equal(result.queries.length,1);assert.equal(calls,2);assert.deepEqual(fetched,["https://publisher.example/cover.jpg"]);
});

test("empty real search results never cause guessed image fetches or saved covers",async()=>{
  const result=await discoverGeminiCover({title:"Book",author:"Author",language:"en"},{generate:async()=>reply({queries:["Book Author cover"]}),search:async()=>[],resource:async()=>{throw new Error("Must not fetch invented URLs");}});
  assert.equal(result.coverUrl,null);assert.deepEqual(result.queries,["Book Author"]);
});

test("library candidates remain usable when retail source pages are unavailable",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();let calls=0;
  const result=await discoverGeminiCover({title:"The Hobbit",author:"Tolkien",language:"en"},{
    generate:async()=>{calls++;return calls===1?reply({indices:[0]}):reply({matches:true,reason:"The cover identifies the requested book."});},
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

test("provider failure returns unified no-cover result without retrying",async()=>{
  let searches=0,catalogues=0;
  const result=await discoverGeminiCover({title:"Book",author:"Author",language:"en"},{
    search:async()=>{searches++;throw new Error("provider rate limit");},
    resource:async()=>{catalogues++;throw new Error("catalogue unavailable");},
    generate:async()=>{throw new Error("Should not verify invented candidates");},
  });
  assert.equal(searches,1);assert.equal(catalogues,1);
  assert.equal(result.coverUrl,null);assert.equal(result.notes,"No suitable cover found.");
});

test("wrong-work and corrupt images are never saved; catalogue is a fallback",async()=>{
  const image=await sharp({create:{width:100,height:150,channels:3,background:"white"}}).jpeg().toBuffer();
  let generated=0,searches=0,catalogues=0;
  const result=await discoverGeminiCover({title:"Book",author:"Author",language:"en"},{
    search:async()=>{searches++;return [{url:"https://publisher.example/wrong.jpg",source:"https://publisher.example/book",label:"Book"},{url:"https://publisher.example/corrupt.jpg",source:"https://publisher.example/book",label:"Book"}];},
    generate:async()=>++generated===1?reply({indices:[0,1]}):reply({matches:false,reason:"Different work"}),
    resource:async url=>{
      if(String(url).includes("search.json")){catalogues++;return {bytes:new TextEncoder().encode('{"docs":[]}').buffer,contentType:"application/json",finalUrl:String(url)};}
      return {bytes:String(url).includes("corrupt")?new ArrayBuffer(2):Uint8Array.from(image).buffer,contentType:"image/jpeg",finalUrl:String(url)};
    },
  });
  assert.equal(result.coverUrl,null);assert.equal(searches,1);assert.equal(catalogues,1);assert.equal(result.notes,"No suitable cover found.");
});

test("missing-author placeholders never pollute Dragon searches or catalogue lookups",async()=>{
  for(const author of ["Άγνωστος","Unknown","Unknown author","  άγνωστος συγγραφέας  ",""]){
    let searches=0,catalogues=0;
    const book={title:"Dragon #292",author,language:"en",series:"Dragon",volume:"292"};
    const result=await discoverGeminiCover(book,{
      search:async(query,language)=>{searches++;assert.equal(query,"Dragon #292");assert.equal(language,"en");return [];},
      resource:async url=>{catalogues++;assert.equal(new URL(url).searchParams.has("author"),false);return {bytes:new TextEncoder().encode('{"docs":[]}').buffer,contentType:"application/json",finalUrl:String(url)};},
    });
    assert.equal(searches,1);assert.equal(catalogues,1);assert.deepEqual(result.queries,["Dragon #292"]);
    assert.equal(book.author,author);
  }
});
