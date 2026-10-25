import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCategoryTags, categoryTags } from "./category-tags";
import { parseManualGenaiImport } from "./manual-genai-import";

test("category tags normalize aliases, spacing and duplicates without merging distinct subjects", () => {
  assert.deepEqual(normalizeCategoryTags(["  fantasy ","FANTASY","sci-fi","graphic novels","children's books"]),
    ["Fantasy","Science Fiction","Comics & Graphic Novels","Children's Books"]);
  assert.deepEqual(categoryTags(undefined,"Fiction"),["Fiction"]);
  assert.deepEqual(categoryTags([],"Fiction"),["Uncategorized"]);
  assert.deepEqual(categoryTags(undefined,"Αταξινόμητα"),["Uncategorized"]);
  for (const invalid of [null,"Fantasy",[""],[2],["a".repeat(81)],Array(9).fill("Fantasy")]) assert.throws(()=>normalizeCategoryTags(invalid),/categories/);
});

test("manual imports retain old payload compatibility but validate and keep supplied tags", () => {
  const book={position:1,title:"Dune",authors:["Frank Herbert"],confidence:.9};
  const parse=(categories: unknown,include=true)=>parseManualGenaiImport({schemaVersion:"mylibrary.shelfie.v1",books:[{...book,...(include?{categories}:{})}]}).books[0];
  assert.equal(parse(undefined,false).categories,undefined);
  assert.equal(JSON.stringify(parse(undefined,false)).includes("categories"),false,"old payload checksums retain their original fields");
  assert.deepEqual(parse(["fiction","science fiction"]).categories,["Fiction","Science Fiction"]);
  assert.throws(()=>parse(["Fantasy",false]),/categories/);
});
