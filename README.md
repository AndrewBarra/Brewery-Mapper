# Pint Pins: Brewery Mapper

Log the breweries you've been to and see them on a map of the US. You can zoom from the whole country down to the street a brewery is on.

## Features

- **Search by name** to log a brewery. Results come from [Open Brewery DB](https://www.openbrewerydb.org/), a free database of US breweries.
- **Brewery not listed?** Tap **Add it yourself** below the results and enter its name and address. The app finds it on the map. If the exact address can't be found, the pin goes at the center of the city, and the brewery's page says so.
- **One pin per brewery, many visits.** Each visit has a date, a 1–5 star rating, notes and beers tried, and photos.
- **Map** with OpenStreetMap tiles, from the full US (use the **US** button) down to street level.
- **My breweries list.** Filter it, and click a brewery to fly to its spot on the map.
- **Stats:** breweries, states, visits and average rating.
- Works on phones and desktops.

## Where your data lives

Everything is saved **in your browser** (IndexedDB) on the device you use. There's no account and no server. This means:

- Data on your phone and your laptop is separate.
- Clearing site data or browsing privately will lose or hide it.
- Photos are shrunk to at most 1600px before saving to save space.

## Running it locally

There's no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly from disk won't work, because browsers block JavaScript modules on `file://`.)

## Hosting on GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the site on every push to `main`. One-time setup:

1. In the repo on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

The site will be at `https://<your-username>.github.io/brewery-mapper/`.

## Project layout

```
index.html        Page markup and dialogs
css/styles.css    Styles
js/app.js         Map, list, stats, search, and visit forms
js/db.js          IndexedDB storage (breweries, visits, photos)
js/api.js         Open Brewery DB search and Nominatim address lookup
js/photos.js      Photo resizing
icons/            App and home-screen icons (icon.svg is the source)
manifest.webmanifest  Home-screen app settings
vendor/leaflet/   Leaflet 1.9.4 map library (BSD-2-Clause)
```
