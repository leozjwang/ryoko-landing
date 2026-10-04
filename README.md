# Ryoko landing page

Static Astro landing page with an interactive web recreation of the iPhone interface. Standalone landing-page repository. The iOS design reference is [stormhack26 at `d376313`](https://github.com/DanielOu1208/stormhack26/tree/d376313) (October 3, 2026), including its implementation tracker.

## Run

Use Node 24. From this directory:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:8877. `npm run build` creates `dist/`; `npm run preview` serves that build on the same port when the dev server is stopped. Not deployed.

## iOS references

- `Theme.swift`: system fonts, monochrome controls, 20-point margins, 24-point cards and time-of-day colors.
- `MapView`, `MapSearchBar`, `MapSheetPanel`: map-first home, floating search, round controls, three sheet heights, persistent five-tab bar.
- `NearbyView`: place title, preview banner, phrase, romanization, reason, Show/Flip and quick actions.
- `TranslatePanes`: upright/face-to-face layout and language pills.
- `MimoView`: centered 82-point avatar, starters, phrase links and place cards that open Map.

Custom SVG icons, not exported SF Symbols. This is a recreation from source, not a screenshot or native build.

## Live versus sample

**Live:** map tiles, pan/zoom, submitted search, nearby places, layer filters, details, directions links and optional browser location following. Right-click/long-press drops a pin. The location button starts `watchPosition` only after a click and browser permission; following stops on a second click, manual map drag, hidden page or page exit. Location stays in page memory; requesting a map area sends the area to map providers. Movement tracking still needs a physical-device check.

**Samples:** Nearby phrases, Mimo replies, profile controls and Translate's conversation. No Ryoko server calls or microphone access. Japanese/Chinese examples use broad demo coordinate bounds, not a production language resolver. From Mimo demonstrates sharing real returned places through a sample reply. Preview time changes the wash and label, not opening-hours predictions. There is no arbitrary live translation or personalized recommendation service in this static sample.

## Providers

URLs are configurable in `public/map-config.json`:

- [Leaflet](https://leafletjs.com/) 1.9.4 renders the map.
- [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) tiles use normal browser caching and visible attribution; no prefetch/offline downloads.
- [Photon](https://github.com/komoot/photon) handles explicit searches with session caching and a 1.2-second per-page throttle; no autocomplete requests.
- [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) supplies up to 45 places within 700 m. One startup request, then Search this area or Reset; ten-second throttle, session cache, cancellation and timeouts.

Public endpoints are best-effort services for this low-traffic local sample. Before public launch, configure providers or a shared caching/rate-limiting service for expected traffic. The iPhone uses MapKit; this preview uses OpenStreetMap without app credentials.

## Files and assets

- `src/pages/index.astro`: landing page and original tea walkthrough.
- `src/components/AppPreview.astro`: five-tab phone UI.
- `src/scripts/app-preview.ts`: map and preview behavior.
- `src/styles/app-preview.css`: native-inspired styles; `global.css`: landing styles.
- Existing `public/assets/ryoko-to-mimo.svg`: 1.5-second morph with replay/reduced motion.
- Mimo's bloub attribution: `public/assets/THIRD_PARTY_NOTICES.md`.
- Tokyo photograph: [Patrick Beznoska on Unsplash](https://unsplash.com/photos/people-walk-down-a-quiet-street-in-japan-MvrOfWJ8HrY).

## Validation

Static build and strict TypeScript check pass. Browser checks cover desktop/mobile layouts, live tiles, Photon search, nearby data, washroom filtering, Map-to-Nearby, Show/Flip, time preview, Translate layout/sample playback and Mimo-to-Map. GPS movement requires visitor permission and physical-device verification.

The standalone copy also passed a clean `npm ci` and build. The inherited dependency lockfile currently reports four npm audit findings (one critical, two high, one low). Dependency upgrades and applicability review remain follow-up work before deployment; extraction preserves the tested dependency versions.
