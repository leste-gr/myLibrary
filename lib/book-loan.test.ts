import assert from "node:assert/strict";
import test from "node:test";
import { parseBookLoanChange } from "./book-loan";

test("loan input normalizes optional contacts and clears contacts on return", () => {
  const input = { slug: "alpha",legacyId: "B1",status: "loaned_out",personName: "  Alex  " };
  assert.deepEqual(parseBookLoanChange(input),{ ...input,personName: "Alex" });
  assert.equal(parseBookLoanChange({ ...input,status: "loaned_in",personName: "   " })?.personName,null);
  assert.equal(parseBookLoanChange({ ...input,status: "none" })?.personName,null);
  assert.equal(parseBookLoanChange({ ...input,personName: "😀".repeat(120) })?.personName?.length,240);
  for (const value of [null,[],{}, { ...input,status: null },{ ...input,status: "read" },{ ...input,slug: 42 },
    { ...input,legacyId: "" },{ ...input,personName: {} },{ ...input,personName: "x".repeat(121) }]) {
    assert.equal(parseBookLoanChange(value),null);
  }
});
