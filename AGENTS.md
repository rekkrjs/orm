# Release conventions

- Always name Git tags and GitHub Releases with a leading `v`, using
  `vMAJOR.MINOR.PATCH` (for example, `v1.1.1`). Never publish a bare
  `MAJOR.MINOR.PATCH` tag.
- Every GitHub Release must include hand-written notes explaining what changed,
  why it matters, relevant compatibility or opt-in details, and how the release
  was verified. Never publish a release containing only an auto-generated
  changelog link.
- Write every GitHub Release in English: title and notes. This applies to new
  releases and to edits of existing ones, regardless of the language used in the
  request.

# Git operations

- Do not commit, create tags or releases, or push anything unless the user asks
  for that operation explicitly in the current request. A previous request to
  publish does not authorize later commits or pushes.

# Testing conventions

A green test is worth something only if it would turn red with the code wrong.
The recurring failure mode of this suite is tests that cannot fail: they pin
what the code does, run somewhere friendlier than a user's machine, or check
that something happened rather than what. Positive assertions alone let whole
classes of defect sit under a green suite. Constrain the blast radius too.

- Take the expectation from the requirement, not from the code. Derive the
  expected value from the spec, the bug report or the database's documented
  behaviour, never from running the code and pasting its output. A test that
  pins current behaviour protects the defect: the `date` cast serialized with a
  time, and managed timestamps dropped their milliseconds, under tests and docs
  that asserted exactly that. If a test only passes by pinning something that
  looks wrong, do not freeze it; say so.
- A regression test must fail without its fix. Check it before applying the
  fix, or by reverting the fix for a moment; a test that passes on both sides
  does not cover the defect.
- Test under the user's conditions, not friendlier ones. These differences are
  already there, and no test notices them on its own:
  - Most tests run on SQLite, which does not enforce column types or `VARCHAR`
    lengths, keeps dates as zone-less text, and has no fractional seconds to
    round. `LIKE` and ordering treat case and accents differently on each
    database.
  - The process time zone. A value that is right in UTC can be a day off west
    of it. CI runs the suite in seven zones; locally, set `TZ` when a change
    touches dates.
  - Bun and Node.js use different drivers (`bun:sql` and `bun:sqlite`; `pg`,
    `mysql2` and `node:sqlite`), which can return different types for the
    same column.
  - The suite runs from the repository checkout. A user installs the packed
    package into a directory where nothing exists yet.
  - Tests connect as a database superuser, which bypasses row-level security
    and grants.

  When a change depends on one of these, reproduce it in the test: run it on
  every driver through the driver contract, set the process time zone, use
  data with accents and values at the column's limit, install the packed
  tarball, or switch to a role without privileges, as the RLS tenancy test
  does. If it cannot be reproduced, say so when handing the work over.
- Assert the exact result and the absence of extras. `toBeDefined()`,
  `toBeTruthy()`, `toContain()` or exit code 0 prove that something answered,
  not that it answered correctly. Assert the exact value (`toBe`, `toEqual`),
  what must not appear (`not.`), and the counts that expose an extra effect:
  rows, jobs, or statements seen through `DB.listen`. A CLI step that must
  succeed also asserts an empty `stderr`.
- Assert what must stay untouched. After a destructive or mutating operation,
  assert that neighboring state survived: sibling key spaces, other subsystems,
  and `Object.prototype`. Checking that a flush deleted its own key proves it
  deleted something, not that it deleted only that.
- Test the shipped defaults. Isolation hygiene that injects unique prefixes,
  schemas, or databases hides collisions that exist only at the default values.
  Keep the isolated tests, and add at least one that runs the real defaults.
- Cross subsystems that share a resource. Cache, queue, and search over one
  Redis, or several migrators over one database, must be exercised together and
  not only on their own.
- Overlap and nest scopes. Every temporary scope needs a test with two
  concurrent entries that exit out of order, and one with a nested re-entry.
  Sequential tests pass trivially on state that is not actually isolated.
- Exercise low-level APIs on their own terms. When a guarantee is enforced by a
  high-level wrapper, test the lower API directly with a real callback that
  observes the effect. A test passing an empty callback validates argument
  sanitization and nothing else.
- Put destructive operations under contention. Drops, resets, and rebuilds need
  a test where a competitor holds the lock, asserting that a failed attempt
  destroyed nothing.
- Enforce invariants globally, not per boundary. When a threat class is guarded
  at one entry point, assert it as a shared invariant so every other entry point
  inherits the check instead of repeating the guard.

# Repository conventions

- Keep temporary workaround documentation in `.tmp_hacks/`, and point related
  code, tests, and diagnostic scripts to that directory.
- Use `tmp_agents/` for scratch work: experiments, probes, throwaway
  reproduction scripts, and any intermediate output. It is git-ignored, create
  it if it is missing, and prefer it over `/tmp` or the repository root.
- Treat everything in `tmp_agents/` as disposable. Its contents may be deleted
  at any time without warning, so never leave there anything the repository is
  expected to keep. Work that must survive belongs in the tree: durable
  workaround notes in `.tmp_hacks/`, and regression coverage in `tests/`.
