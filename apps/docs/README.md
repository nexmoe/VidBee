# VidBee Docs

Documentation site for VidBee, powered by [Fumapress](https://press.fumadocs.dev/docs).

## Development

```bash
cd external/vidbee
pnpm dev:docs
```

Open http://localhost:3000 to preview the docs.

## Build

```bash
cd external/vidbee
pnpm build:docs
```

Static output is written to `dist/`.

## Content

- `content/`: MDX documentation (en at root, `zh/`, `fr/`, `ru/` for translations)
- `public/`: Static assets (screenshots, icons)
- `press.config.tsx`: Site configuration, i18n, plugins
- `source.config.ts`: MDX collection schema
