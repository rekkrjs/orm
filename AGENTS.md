# Release conventions

- Always name Git tags and GitHub Releases with a leading `v`, using
  `vMAJOR.MINOR.PATCH` (for example, `v1.1.1`). Never publish a bare
  `MAJOR.MINOR.PATCH` tag.
- Every GitHub Release must include hand-written notes explaining what changed,
  why it matters, relevant compatibility or opt-in details, and how the release
  was verified. Never publish a release containing only an auto-generated
  changelog link.
