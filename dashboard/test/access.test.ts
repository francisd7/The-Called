import { strict as assert } from "node:assert";
import { test } from "node:test";
import { signInRefusal } from "../src/lib/access.ts";

const row = (
  over: Partial<{ email: string; active: boolean; role: string }> = {},
) => ({
  email: "a@b.com",
  active: true,
  role: "setter",
  ...over,
});

test("an active setter or admin gets in", () => {
  assert.equal(signInRefusal(row(), "a@b.com"), null);
  assert.equal(signInRefusal(row({ role: "admin" }), "a@b.com"), null);
});

test("somebody with no row does not", () => {
  assert.match(
    signInRefusal(null, "nobody@x.com") ?? "",
    /not in the users table/,
  );
});

test("a deactivated person does not", () => {
  assert.match(
    signInRefusal(row({ active: false }), "a@b.com") ?? "",
    /not active/,
  );
});

test("a closer is refused by role, even while active", () => {
  // This is the whole point of the split: a closer has to be active so their
  // name is in the Closer dropdown, and must still not be able to sign in.
  const refusal = signInRefusal(
    row({ role: "closer", active: true }),
    "n@b.com",
  );
  assert.match(refusal ?? "", /closer/i);
});

test("an inactive closer is still refused", () => {
  assert.notEqual(
    signInRefusal(row({ role: "closer", active: false }), "n@b.com"),
    null,
  );
});
