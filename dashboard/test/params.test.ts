import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validDay, validSetterFilter, validUuid } from "../src/lib/params.ts";

const FALLBACK = "2026-01-01";

test("a real day passes through", () => {
  assert.equal(validDay("2026-09-28", FALLBACK), "2026-09-28");
});

test("a day of the right shape that is not a real date is refused", () => {
  // The shape check alone let these reach Postgres, which threw and 500d the
  // page. Both match /^\d{4}-\d{2}-\d{2}$/.
  assert.equal(validDay("2026-13-99", FALLBACK), FALLBACK);
  assert.equal(validDay("2026-02-31", FALLBACK), FALLBACK);
  assert.equal(validDay("2026-00-10", FALLBACK), FALLBACK);
});

test("a leap day is a real day in a leap year and not otherwise", () => {
  assert.equal(validDay("2028-02-29", FALLBACK), "2028-02-29");
  assert.equal(validDay("2026-02-29", FALLBACK), FALLBACK);
});

test("junk, empty and missing all fall back", () => {
  for (const v of ["hello", "", "2026-9-8", "2026/09/08", null, undefined]) {
    assert.equal(validDay(v, FALLBACK), FALLBACK);
  }
});

test("undefined can be the fallback, for a filter that is simply absent", () => {
  assert.equal(validDay(undefined, undefined), undefined);
  assert.equal(validDay("nonsense", undefined), undefined);
});

test("a uuid passes and anything else does not", () => {
  assert.equal(
    validUuid("4f31acd9-4ddb-4ad6-8364-07cb5fb32da6"),
    "4f31acd9-4ddb-4ad6-8364-07cb5fb32da6",
  );
  for (const v of [
    "abc",
    "",
    null,
    undefined,
    "4f31acd9-4ddb-4ad6-8364",
    "'; drop table leads;--",
  ]) {
    assert.equal(validUuid(v), undefined);
  }
});

test("the unassigned sentinel survives the setter guard", () => {
  // "none" is what the Unassigned option in the filter dropdown sends, and the
  // lead queries read it as "setter is null". Running it through validUuid
  // dropped it, so the filter silently showed every lead instead of none of
  // them - applied, and doing nothing.
  assert.equal(validSetterFilter("none"), "none");
  assert.equal(
    validSetterFilter("4f31acd9-4ddb-4ad6-8364-07cb5fb32da6"),
    "4f31acd9-4ddb-4ad6-8364-07cb5fb32da6",
  );
  for (const v of ["abc", "", null, undefined, "None", "NONE"]) {
    assert.equal(validSetterFilter(v), undefined);
  }
});
