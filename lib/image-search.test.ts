import assert from "node:assert/strict";
import test from "node:test";
import {searchCoverImages} from "./image-search";

test("Greek query uses localized Google Images and retains original URL and source",async()=>{
  const old=process.env.SERPER_API_KEY;process.env.SERPER_API_KEY="fixture-secret";
  try {
    const result=await searchCoverImages("ΙΚΑΝΟΙ ΓΙΑ ΟΛΑ ΚΛΑΣ ΕΚΜΑΝ","Greek",undefined,async(url,init)=>{
      assert.equal(url,"https://google.serper.dev/images");assert.equal(init?.redirect,"error");
      assert.equal((init?.headers as Record<string,string>)["X-API-KEY"],"fixture-secret");
      assert.deepEqual(JSON.parse(String(init?.body)),{q:"ΙΚΑΝΟΙ ΓΙΑ ΟΛΑ ΚΛΑΣ ΕΚΜΑΝ",gl:"gr",hl:"el",num:10});
      return Response.json({images:[
        {imageUrl:"https://publisher.example/cover.jpg",link:"https://bookshop.example/book",title:"Ικανοί για όλα",thumbnailUrl:"https://thumbnail.example/small.jpg"},
        {imageUrl:"https://publisher.example/cover.jpg",link:"https://bookshop.example/book"},
        {imageUrl:"http://127.0.0.1/private",link:"https://bookshop.example/book"},
        {imageUrl:"https://publisher.example/other.jpg",link:"http://localhost/private"},null,
      ]});
    });
    assert.deepEqual(result,[{url:"https://publisher.example/cover.jpg",source:"https://bookshop.example/book",label:"Ικανοί για όλα"}]);
  }finally{if(old===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=old;}
});

test("provider errors are sanitized and never retried",async()=>{
  const old=process.env.SERPER_API_KEY;process.env.SERPER_API_KEY="fixture-secret";let calls=0;
  try {
    await assert.rejects(()=>searchCoverImages("Public book","en",undefined,async()=>{calls++;return new Response("fixture-secret",{status:429});}),/^Error: No suitable cover found\.$/);
    assert.equal(calls,1);
  }finally{if(old===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=old;}
});

test("explicit English language wins over Greek script; unknown language can infer Greek",async()=>{
  const old=process.env.SERPER_API_KEY;process.env.SERPER_API_KEY="fixture-secret";
  try{
    for(const [language,query,gl,hl] of [
      ["en","Dragon #292 Άγνωστος","us","en"],
      ["English","English book Ελληνικό όνομα","us","en"],
      ["el-GR","Greek book transliterated","gr","el"],
      ["Unknown","Ελληνικός τίτλος","gr","el"],
      ["","Dragon #292","us","en"],
    ])await searchCoverImages(query,language,undefined,async(_url,init)=>{
      const body=JSON.parse(String(init?.body));assert.equal(body.gl,gl);assert.equal(body.hl,hl);
      return Response.json({images:[]});
    });
  }finally{if(old===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=old;}
});

test("invalid image URLs are excluded while later candidates remain available",async()=>{
  const old=process.env.SERPER_API_KEY;process.env.SERPER_API_KEY="fixture-secret";
  try{
    const result=await searchCoverImages("Book","en",undefined,async()=>Response.json({images:[
      {imageUrl:"http://localhost/private",link:"https://example.com/book"},
      {imageUrl:"https://example.com/second.jpg",link:"https://example.com/book"},
    ]}));
    assert.equal(result[0]?.url,"https://example.com/second.jpg");
  }finally{if(old===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=old;}
});
