# AST benchmark

Compares a small TypeScript baseline with the current production Oxc workflow discovery. It also serves as the standalone Oxc benchmark.

```text
same fixture files
       │
       ├── TypeScript baseline
       ├── Oxc standard
       └── Oxc raw transfer
              │
              ├── parse only
              └── full discovery
```

The TypeScript discovery path only implements the syntax used by these fixtures. It is useful as a stable comparison point, not as a replacement for the old production collector. Each run checks that both implementations find the same workflow names before recording timings.

## Run

Bun, without raw transfer:

```sh
bun run --cwd workbench/ast-bench bench
```

Node, including raw transfer when supported:

```sh
bun run --cwd workbench/ast-bench bench:node
```

Smaller local run:

```sh
bun run --cwd workbench/ast-bench bench:node -- --iterations 10 --warmup 3
```

Available fixtures: `many-small-files`, `few-large-files`, and `re-export-graph`. Select one with `--fixture <name>`.

Read `parse-only` results when comparing parsers. Full-discovery results also include each implementation's AST traversal and output shaping.
