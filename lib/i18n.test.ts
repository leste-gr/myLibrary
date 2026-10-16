import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { translator, parseLocale } from "./i18n/shared";
import { el } from "./i18n/el";

test("English is the default; translation preserves interpolated book data", () => {
  assert.equal(parseLocale(undefined), "en");
  assert.equal(parseLocale("fr"), "en");
  assert.equal(parseLocale("el"), "el");
  assert.equal(translator("en")("My collections"), "My collections");
  assert.equal(translator("el")("My collections"), "Οι συλλογές μου");
  assert.equal(translator("el")("Import {0} books", [32]), "Εισαγωγή 32 βιβλίων");
  assert.equal(translator("el")("Book 7: title is too long."), "Βιβλίο 7: το title είναι πολύ μεγάλο.");
  assert.equal(translator("en")("Οι κωδικοί δεν ταιριάζουν."), "Passwords do not match.");
  assert.equal(translator("el")("Permanently delete “{0}” from the collection?", ["Dune {1}"]), "Να διαγραφεί οριστικά το βιβλίο «Dune {1}» από τη συλλογή;");
});

test("all literal interface messages have Greek translations with matching placeholders", () => {
  for (const directory of ["app", "components"]) {
    for (const file of readdirSync(directory, { recursive: true }).filter(path => /\.tsx?$/.test(String(path)))) {
      const path = `${directory}/${file}`;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          assert.ok(Object.hasOwn(el, key), `${path}: missing Greek translation for ${key}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const [key, value] of Object.entries(el)) {
    assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), key);
  }
});
