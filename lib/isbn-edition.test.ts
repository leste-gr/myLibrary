import assert from "node:assert/strict";
import test from "node:test";
import { lookupIsbnEdition } from "./isbn-edition";

const isbn = "9780140328721";
test("chosen ISBN metadata combines exact Open Library and Google records", async () => {
  const requests: URL[] = [];
  const fetcher = (async (input: URL) => {
    requests.push(input);
    return Response.json(input.hostname === "openlibrary.org" ? {
      [`ISBN:${isbn}`]: { title: "Matilda", authors: [{name:"Roald Dahl"}], publishers: [{name:"Puffin"}], publish_date: "1988" },
    } : { items: [{ volumeInfo: { title:"Unrelated result", language:"fr", industryIdentifiers:[{identifier:"9780261102217"}] } },
      { volumeInfo: { title:"Matilda", language:"en", industryIdentifiers:[{identifier:"0140328726"}] } }] });
  }) as typeof fetch;
  assert.deepEqual(await lookupIsbnEdition(isbn, fetcher), { title:"Matilda", authors:["Roald Dahl"], publishers:["Puffin"], publishedDate:"1988", language:"en" });
  assert.equal(requests.find(url => url.hostname === "openlibrary.org")?.searchParams.get("bibkeys"), `ISBN:${isbn}`);
  assert.equal(requests.find(url => url.hostname === "www.googleapis.com")?.searchParams.get("q"), `isbn:${isbn}`);
});

test("provider failures leave unknown edition details empty, without borrowing another ISBN", async () => {
  const fetcher = (async (input: URL) => input.hostname === "openlibrary.org"
    ? new Response("Unavailable", {status:503})
    : Response.json({items:[{volumeInfo:{title:"Wrong book",authors:["Wrong author"],industryIdentifiers:[{identifier:"9780261102217"}]}}]})) as typeof fetch;
  assert.deepEqual(await lookupIsbnEdition(isbn, fetcher), {title:null,authors:[],publishers:[],publishedDate:null,language:null});
  const quotaLimited = (async () => new Response("Quota exceeded", {status:429})) as typeof fetch;
  assert.deepEqual(await lookupIsbnEdition(isbn, quotaLimited), {title:null,authors:[],publishers:[],publishedDate:null,language:null});
});
