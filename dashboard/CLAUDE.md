# The Called — setter dashboard

Next 15 App Router, React 19 server components and server actions, Postgres
via Drizzle, Auth.js with Google. Deployed on Railway from the branch named in
`DEPLOYMENT.md`, which builds and migrates itself on boot.

## Keep the Help page current

**`src/app/(app)/help/page.tsx` is the team's manual, and it ships with the
thing it describes. Any change to how the team uses the dashboard belongs in
it, in the same commit.**

It used to live in a separate shared document, which went stale the moment
anything moved and needed a second account to open. The whole point of moving
it here was that it stops being a thing somebody has to remember to update, so
treat it as part of the feature rather than as documentation about it.

What counts as a change to how the team uses it:

- a new page, tab or button they will touch
- a step that is now automatic, or one that no longer is
- anything that changes whose job something is
- a name on screen changing

What does not: refactors, tests, performance, anything they cannot see.

The page has a setter half and an admin half (`isAdmin`). Put admin-only
plumbing — backups, imports, merges, viewing as somebody — under **Running
it**, so a setter is not told about buttons they do not have.

## Conventions worth keeping

- **Plain dates are `text` as `YYYY-MM-DD`**, read in `America/New_York` via
  `src/lib/dates.ts`. A date-only value from Airtable is stored at **noon** UTC
  so it lands on the same calendar day whichever way a timezone shifts it.
- **A blank is not a zero.** A number nobody entered stays null; a rate with an
  unknown half is null rather than 0, so nothing reads as a result that is not.
- **Never guess between two answers.** Adopting a lead, linking a post-call
  report, merging: act only when exactly one candidate fits, otherwise leave it
  for a person. That rule is why those queues are trusted.
- **Imports fill gaps and never overwrite.** Calendly owns bookings, post-call
  reports own outcomes, the Airtable tracker fills what neither has said.
- **Extract the rule from the plumbing.** Anything with real logic goes in a
  module with no database attached (`outcomeRules`, `mergePlan`, `assignRules`,
  `reelMetrics`, `viewAsRules`, `postCallMatch`) so it can be tested directly;
  `@/` aliases do not resolve under the test runner.
- **`currentUser()` from `src/lib/session.ts`, never `auth()` directly.** It is
  what makes viewing as somebody real rather than cosmetic. Server actions go
  through `requireUser` / `requireAdmin`, which refuse while viewing as.

## Checks before committing

```
npx tsc --noEmit
TEST_DATABASE_URL=... DATABASE_URL=... npm test
DATABASE_URL=... npx next build
```

The build genuinely catches things the other two do not — adding tables has
split the instrumentation chunk before now. Check its route list against the
pages on disk: a build can report success and still be missing a route.
