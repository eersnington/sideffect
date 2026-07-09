---
"sideffect": patch
---

- Replace TypeScript-based workflow discovery with the bundled `oxc-parser` runtime dependency.
- Select Oxc raw-transfer mode once per discovery run when the current runtime supports it.
- Keep workflow read, parse, and resolution failures typed until the Vite boundary.
