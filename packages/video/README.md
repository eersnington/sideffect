# Sideffect Promo Video

A Remotion composition for a short `npm i sideffect` promo. The video introduces the public API with a typed workflow snippet, then shows how the Vite adapter turns workflow layers into Cloudflare workflow bindings.

## Commands

**Install Dependencies**

```console
bun install
```

**Start Preview**

```console
bun run dev
```

**Render video**

```console
bun run render
```

**Render a preview frame**

```console
bun run still
```

## Composition

- `SideffectPromo`: 1920x1080, 30fps, 17 seconds.

## Storyline

- Install: `npm i sideffect`.
- API: `Schema`, `Step.make`, `Workflow.make`, and `workflow.toLayer`.
- Build path: source workflow layer to Vite discovery to Cloudflare binding.
- Outro: `sideffect` and the install command.
