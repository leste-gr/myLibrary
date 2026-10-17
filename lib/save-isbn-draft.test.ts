import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveIsbnDraft } from "./save-isbn-draft";
import type { IsbnEditionMetadata } from "./isbn-edition";

const empty: IsbnEditionMetadata = {title:null,authors:[],publishers:[],publishedDate:null,language:null};
test("a selected candidate draft prefers exact ISBN details and snapshots them without publishing", async () => {
  const calls: unknown[] = [];
  const chain = { select(){return chain;}, eq(column:string,value:string){calls.push([column,value]);return chain;}, async maybeSingle(){return {data:null,error:null};} };
  const supabase = { from(table:string){assert.equal(table,"editions");return chain;}, async rpc(name:string,args:unknown){calls.push([name,args]);return {error:null};} } as unknown as SupabaseClient;
  const exact = {...empty,title:"Matilda",authors:["Roald Dahl"],publishers:["Puffin"]};
  await saveIsbnDraft(supabase,"copy-id","9780140328721",{id:"candidate-id",title:"Original imperfect title",publishers:[],published_date:null},async()=>exact);
  assert.deepEqual(calls,[["isbn13","9780140328721"],["save_owned_isbn_draft",{target_copy_id:"copy-id",target_isbn:"9780140328721",edition_metadata:exact,target_candidate_id:"candidate-id"}]]);
});

test("provider outages still save manual ISBN drafts using available cached details", async () => {
  let saved: unknown;
  const chain = {select(){return chain;},eq(){return chain;},async maybeSingle(){return {data:{title:"Cached edition",publishers:["Publisher"],published_date:"2001",language:"en",metadata:{authors:["Known author"]}},error:null};}};
  const supabase = {from(){return chain;},async rpc(name:string,args:unknown){saved=args;return {error:null};}} as unknown as SupabaseClient;
  await saveIsbnDraft(supabase,"copy-id","9780140328721",undefined,async()=>empty);
  assert.deepEqual(saved,{target_copy_id:"copy-id",target_isbn:"9780140328721",target_candidate_id:null,edition_metadata:{title:"Cached edition",authors:["Known author"],publishers:["Publisher"],publishedDate:"2001",language:"en"}});
});

test("candidate metadata remains usable when exact-ISBN providers are unavailable", async () => {
  let saved: {edition_metadata:IsbnEditionMetadata} | undefined;
  const chain = {select(){return chain;},eq(){return chain;},async maybeSingle(){return {data:null,error:null};}};
  const supabase = {from(){return chain;},async rpc(name:string,args:{edition_metadata:IsbnEditionMetadata}){saved=args;return {error:null};}} as unknown as SupabaseClient;
  await saveIsbnDraft(supabase,"copy-id","9780140328721",{id:"candidate-id",title:"Matilda",authors:["Roald Dahl"],language:"en",publishers:["Puffin"],published_date:"1988"},async()=>empty);
  assert.deepEqual(saved?.edition_metadata,{title:"Matilda",authors:["Roald Dahl"],language:"en",publishers:["Puffin"],publishedDate:"1988"});
});
