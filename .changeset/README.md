# Changesets

Use `bun run changeset` in PRs that affect either published Sideffect package:

- `sideffect`
- `@sideffect/lint`

Use `bun run changeset:status` to inspect pending release notes.

Use `bun run changeset:version` to prepare a release commit. `sideffect` and `@sideffect/lint` are a fixed release set and must keep the same version number.

Publishing is explicit: manually dispatch the publish workflow and type the exact `publish sideffect@<version> and @sideffect/lint@<version>` confirmation.
