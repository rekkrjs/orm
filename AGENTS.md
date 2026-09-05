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

The recurring failure mode of this suite is that tests assert what an operation
must do and never what it must not touch. Positive assertions alone let whole
classes of defect sit under a green suite. Constrain the blast radius too.

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
- A regression test must fail without its fix. Verify it fails against the
  parent commit; a test that passes on both sides does not cover the defect.

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
