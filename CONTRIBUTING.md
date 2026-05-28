# Contributing to YouTube Sub Manager

Thanks for your interest in contributing! This guide will help you get set up and submit your first pull request.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9+
- Chrome or Chromium browser

## Dev Setup

1. Fork and clone the repo:
   ```bash
   git clone https://github.com/<your-username>/youtube-sub-manager.git
   cd youtube-sub-manager
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start the dev server:
   ```bash
   pnpm dev
   ```

4. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** and select the `dist/` folder
   - The extension will hot-reload as you make changes

## Available Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Vite dev server with HMR |
| `pnpm build` | TypeScript check + production build |
| `pnpm test` | Run unit tests (Vitest + happy-dom) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | ESLint on all source files |
| `pnpm format` | Prettier on all source files |

## Branch & PR Conventions

- Create feature branches off `main` with descriptive names (e.g., `fix/subscriber-count-parsing`, `feat/export-opml`)
- Keep pull requests focused — one feature or fix per PR
- Reference related issues in your PR description (e.g., "Closes #12")

## Before Submitting a PR

1. Run the full check suite:
   ```bash
   pnpm test && pnpm lint
   ```
2. Format your code:
   ```bash
   pnpm format
   ```
3. Test the extension manually in Chrome — load unpacked from `dist/` and verify your change works

## Code Style

- **TypeScript strict mode** is enforced (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- **React 18** with JSX transform — no need to import React in every file
- All YouTube DOM selectors live in `src/content/selectors.ts` — if YouTube changes their UI, this is the single file to update
- Content scripts handle all DOM work; the service worker handles message routing and database persistence
- Use [Dexie](https://dexie.org/) for all IndexedDB operations via `src/shared/db.ts`

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design, database schema, message protocol, and component responsibilities.

## Reporting Bugs

Use the [bug report template](https://github.com/germainelry/youtube-sub-manager/issues/new?template=bug_report.md) on GitHub Issues.

## Requesting Features

Use the [feature request template](https://github.com/germainelry/youtube-sub-manager/issues/new?template=feature_request.md) on GitHub Issues.
