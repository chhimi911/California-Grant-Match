# CA Grant Match

CA Grant Match is a free, single-page website that matches Californians with open or soon-to-open opportunities from the official California Grants Portal. It uses one static HTML page, browser-side filtering, and a dependency-free Node refresh script.

## Run locally

Node 18 or newer is required for the built-in `fetch` API.

```bash
cd /Users/jigmechhimi/aiuntangled/ca-grant-match
node scripts/refresh.js
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Stop the server with `Control-C`.

## Data refresh

Run this whenever you want to regenerate the checked-in static data file:

```bash
cd /Users/jigmechhimi/aiuntangled/ca-grant-match
node scripts/refresh.js
```

The script:

1. Calls the official CKAN `package_show` endpoint to discover the current active CSV DataStore resource ID.
2. Paginates through every `datastore_search` record in batches of 500.
3. Verifies the live schema before transforming data. The verified source fields include `AgencyDept`, `Categories`, `ApplicantType`, `Geography`, `OpenDate`, `ApplicationDeadline`, `EstAmounts`, and `GrantURL`.
4. Keeps records that are open or scheduled to open within 90 days and whose deadline has not passed.
5. Atomically replaces `public/grants.json` only after a complete, non-empty refresh. A failed refresh logs a loud error, exits unsuccessfully, and leaves the last good file untouched.

## Deploy to Netlify

The frontend has no compile step. Netlify’s build command only refreshes `public/grants.json` before publishing the static folder.

```bash
cd /Users/jigmechhimi/aiuntangled/ca-grant-match
node scripts/refresh.js
npx netlify-cli@latest login
npx netlify-cli@latest init
npx netlify-cli@latest deploy --build --prod
```

The repository includes `netlify.toml`, which publishes the current directory and schedules `refresh-grants` weekly.

### Enable persistent weekly production updates

Netlify Functions have an ephemeral filesystem, so a scheduled function cannot directly overwrite a previously deployed static asset. The function safely verifies and normalizes fresh data in `/tmp`, then requests a new deploy through a Netlify build hook. A successful rebuild atomically publishes the fresh `grants.json`; a failed refresh or build leaves the previous production deploy live.

For a Git-connected Netlify site:

1. In Netlify, open **Project configuration → Build & deploy → Continuous deployment → Build hooks**.
2. Add a hook named `CA Grant Match weekly refresh` for the production branch and copy its URL.
3. Store that URL as a Netlify environment variable, then redeploy the function:

```bash
cd /Users/jigmechhimi/aiuntangled/ca-grant-match
npx netlify-cli@latest env:set NETLIFY_BUILD_HOOK_URL 'PASTE_THE_BUILD_HOOK_URL_HERE'
npx netlify-cli@latest deploy --build --prod
```

Without that environment variable, the scheduled function still performs and logs the weekly data validation, but correctly warns that no static production rebuild was requested.

## Validation commands

```bash
cd /Users/jigmechhimi/aiuntangled/ca-grant-match
node --check scripts/refresh.js
node --check netlify/functions/refresh-grants.js
node scripts/refresh.js
```

The production UI was browser-checked at desktop and 375px phone width for loading, default Small Business matching, applicant/category/county filter changes, deadline sorting, empty state behavior, external Apply links, and console errors.

## Visual asset

`public/assets/hero-california-coast.jpg` and `public/assets/poppy-mark.png` are original raster images generated for this project with OpenAI Imagegen. No SVG assets are used.
