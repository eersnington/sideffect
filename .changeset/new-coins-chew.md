---
"sideffect": patch
---

- Remove TypeScript from the Sideffect runtime dependency graph to reduce install size.
- Lazy-load the consuming project's TypeScript parser only when the Vite workflow discovery adapter scans workflow files.
- Avoid a TypeScript peer range so beta and RC releases are not blocked by npm prerelease range matching.
