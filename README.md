# World Radio

A single-page globe tuner for live internet radio.

Drag or swipe the Earth, use the latitude/longitude tuning knobs, then jump to the nearest available station. You can also choose a random station and filter the directory by genre, country, or language.

## Features

- Interactive 3D Earth with mouse, touch, and pinch controls, with a mobile-safe canvas and reduced mobile GPU load
- Up to 1,400 visible, clickable radio-station dots across the globe
- Selected stations recenter the crosshair on the resolved city and display city + country
- Globe-release auto tuning to the nearest cached station
- Fast nearest-station search using the already-loaded station map before any network fallback
- Random-station discovery
- Swipeable/wheelable radio-reel filters for genre, country, city, and language
- Country-aware city tuning that recenters the globe before nearest/random station searches
- Automatic stream fallback when a station fails, with a 5-second connection timeout
- HLS playback support through hls.js
- Responsive layout for desktop, tablet, and mobile
- No build step; deploy directly with GitHub Pages

## Data and libraries

Station data comes from the community-maintained [Radio Browser](https://www.radio-browser.info/) directory. The globe is rendered with [Globe.GL](https://globe.gl/). Selected-station city names are resolved from station coordinates with OpenStreetMap's Nominatim service, with client-side caching and rate limiting.

## Run locally

Because browsers restrict some network requests from `file://` pages, serve the folder over HTTP:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Publish with GitHub Pages

In the repository, open **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

The site will be available at:

`https://mattsimoto.github.io/world-radio/`

## Browser playback note

GitHub Pages is HTTPS. Browsers block radio streams that are available only over plain HTTP, so World Radio prioritizes HTTPS streams and automatically tries another matching station when a stream cannot be played. Some stations may also reject browser playback or require formats a particular browser does not support.
