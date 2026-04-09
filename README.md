# Scatter Rehab

Scatter Rehab is a Next.js Progressive Web App (PWA) that simulates a card-suit slot experience for entertainment and practice only.

Important: no real money is used or represented.

## Features

- 5 reels x 4 rows card-suit slot layout
- Local-only virtual credits with persistent storage
- Admin panel for direct credit injection in demo mode
- Reel animations, line/scatter payouts, and session stats
- Installable PWA with offline support after first successful load
- Sass Modules with BEM-style class naming

## Tech Stack

- Next.js (App Router, TypeScript)
- Sass for styling
- next-pwa for service worker and offline shell
- Vitest for unit tests

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Open http://localhost:3000

Note: service worker is disabled in development and enabled in production builds.

## Production Build

```bash
npm run build
npm run start
```

## Test

```bash
npm run test
```

## PWA Behavior

- Manifest is served from `app/manifest.ts`
- Offline fallback route: `/offline`
- Install prompt appears when browser conditions are met

## Compliance and Scope

- This app does not process payments.
- This app does not involve real-money gambling.
- Credits have no cash-out pathway and are stored only in browser local storage.
