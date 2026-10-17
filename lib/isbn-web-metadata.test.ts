import assert from "node:assert/strict";
import test from "node:test";
import { extractExactIsbnMetadata } from "./isbn-web-metadata";
const isbn="9789189143739";
const html=(nodes:unknown)=>`<script type="application/ld+json">${JSON.stringify(nodes)}</script>`;
test("web metadata requires the chosen ISBN on the same Book or Product",()=>{
 assert.equal(extractExactIsbnMetadata(html([{"@type":"Book",isbn:"9780140328721",name:"Wrong book"},{"@type":"Organization",isbn,name:"Shop"}]),isbn),null);
 assert.deepEqual(extractExactIsbnMetadata(html({"@graph":[{"@type":"Book",isbn:"9780140328721",name:"Wrong book"},{"@type":"Book",isbn,name:"Blade Runner: The Roleplaying Game Core Rules",author:{name:"Tomas Härenstam"},publisher:{name:"Free League"},datePublished:"2022",inLanguage:"ENG"}]}),isbn),{title:"Blade Runner: The Roleplaying Game Core Rules",authors:["Tomas Härenstam"],publishers:["Free League"],publishedDate:"2022",language:"en"});
});
test("product descriptions can supply an explicit ISBN but page-wide identifiers cannot",()=>{
 const product={"@type":"Product",name:"Blade Runner RPG Core Rulebook",description:`Hardcover ISBN: ${isbn}`,brand:{name:"Retail shop"}};
 assert.equal(extractExactIsbnMetadata(html(product),isbn)?.title,product.name);
 assert.deepEqual(extractExactIsbnMetadata(html(product),isbn)?.publishers,[],"a retailer brand is not a publisher");
 assert.equal(extractExactIsbnMetadata(`${isbn}${html({...product,description:"No ISBN"})}`,isbn),null);
});
