# Changesets

Use `bun run changeset` in PRs that affect the published `sideffect` package.

Use `bun run changeset:status` to inspect pending release notes.

Use `bun run changeset:version` to prepare a release commit that updates `packages/sideffect/package.json` and `packages/sideffect/CHANGELOG.md`.

Publishing is explicit: manually dispatch the publish workflow and type the exact `publish sideffect@<version>` confirmation.
