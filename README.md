# Evil Spotify

An Android-first offline music player that scans the phone for MP3s, plays local tracks, and saves playlists on the device.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/evil-music-player run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The music player does not require a server or account; library and playlist data stay on the device.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Expo SDK 57, React Native, Expo Router
- Local audio: `expo-audio`; device music access: `expo-media-library`
- Playlist persistence: AsyncStorage
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/evil-music-player/app/` — mobile screens and local playback UI
- `artifacts/evil-music-player/constants/colors.ts` — red and charcoal theme tokens
- `artifacts/evil-music-player/app.json` — Expo, audio background-service, and Android media permission configuration

## Architecture decisions

- The app scans Android's media library for `.mp3` files and filters out other audio formats.
- Playlists are stored locally; removing a playlist never deletes music files from the phone.
- Background audio and lock-screen controls are configured with `expo-audio`.

## Product

- Find MP3s already stored on the phone, play them offline, and organize them into playlists.
- Save and manage playlists locally, with playback controls available while the screen is locked.

## User preferences

- Keep the app focused on local offline MP3 playback with a red, original visual identity.

## Gotchas

- Expo's browser preview cannot read phone media; scan and playback require Android device access.
- Replit can preview the Expo app but does not currently export Android APK files.
- Native background playback settings are applied when building an Android binary; Expo Go preview may not reflect all native app configuration.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
