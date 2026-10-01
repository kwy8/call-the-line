# Call the Line

*You think it's easy being a line judge?*

A tennis line-judge reflex game. You sit at the end of the sideline at real eye height, the ball comes at you in true perspective, and you call it In or Out after the bounce. Three overrules from the electronic review and the cameras take your chair. Five tournaments, from a clay club open to a Grand Slam final on grass.

## How it's built

One HTML page, no framework, no backend. Canvas 2D with a pinhole-camera projection of a real-size court (ball 6.7 cm, sideline 5 cm, eye height 1.1 m).

```
src/game.html        the game (page body only; also what gets published as a Claude artifact)
src/brand/           final brand files: icon.svg (favicon), logo.svg (header lockup), wordmark.svg,
                     og.png/og.svg (link preview), PNG app icons, Anton font licence
scripts/build.mjs    wraps it into a complete document, adds icon and Open Graph tags, copies both SVGs
www/index.html       built output, deployed to GitHub Pages and packaged by Capacitor
capacitor.config.json
.github/workflows/pages.yml
```

## Run locally

```
npm run dev          # builds www/ and serves it on http://localhost:3000
```

Or just open `www/index.html` after `npm run build`.

## Check

```
npm run check        # game geometry/daily-seed check, then the leaderboard Worker check; no browser or network needed
```

`scripts/check.mjs` loads the script from `src/game.html` in Node with a stubbed page and canvas and a seeded `Math.random`, then generates 300 balls for every seat and tournament (9,000 in all) with the game's own `newBall()`. It fails if in/out doesn't match the sign of the margin, if the bounce mark traced against the judged line disagrees with the call or the reported margin, if a landing spot or the judged line is off screen, or if the daily challenge gives different balls or a different seat for the same date. It also compares the 2026-10-01 daily (seat, match type, first 5 balls) with a frozen fixture, so any change to daily generation fails until the fixture is deliberately regenerated. Run it after changing seats, cameras, `TIERS` or the ball code. It needs the game script to stay one `(function(){ ... })();` block, since that is where it hooks in.

`scripts/check-worker.mjs` runs the leaderboard Worker's request handler against an in-memory KV: one score per player per day, the validation rules, name cleaning, ordering and rank, the rate limit and CORS. `scripts/check.mjs` also plays the game's own scoring to confirm the Worker's score bounds match it.

## Daily leaderboard

The daily has an optional public leaderboard, served by a Cloudflare Worker in `worker/` with one KV namespace. The game talks to it at `API_BASE` (top of the script in `src/game.html`, default `https://api.calltheline.site`) and stays fully playable when it can't be reached: every request times out after 6 s and falls back to a message.

```
POST /daily/score   {day, id, name, score, correct, avgMs}  ->  {accepted, rank, total, top}   (top: today's top 10)
GET  /daily/top?day=YYYY-MM-DD                              ->  {day, total, top}               (top 50)
GET  /daily/rank?day=YYYY-MM-DD&id=...                      ->  {day, rank, total}
```

Browsers may call it only from the origins in `ALLOWED_ORIGIN` in `worker/wrangler.toml` (a comma-separated list; the Worker echoes back the matching origin and sends no CORS headers to any other). Add an origin there and redeploy if the game is served from somewhere new.

Rules: one score per player id per day (later submissions are ignored and the first stands); the score must be possible for that many correct calls out of 20 (between 100 per correct call and the full-speed, unbroken-streak maximum, 9,400 for 20); the day must be yesterday, today or tomorrow in UTC, to cover every timezone; names are cut to 16 characters with control and invisible characters removed; 30 requests per minute per IP. Ties go to the faster average call, then the earlier submission.

Deploy (needs a Cloudflare account; commands are for Wrangler 4, run from the repository root):

```
cd worker
npx wrangler login
npx wrangler kv namespace create LEADERBOARD   # copy the printed id into wrangler.toml, replacing REPLACE_WITH_KV_NAMESPACE_ID
npx wrangler deploy
```

`wrangler.toml` routes the Worker to `api.calltheline.site` as a custom domain, which needs the `calltheline.site` zone in the same Cloudflare account. Without it, delete the `routes` block, deploy, and set `API_BASE` in `src/game.html` to the `*.workers.dev` URL that `wrangler deploy` prints. `npx wrangler tail` streams the Worker's logs. To remove one score: `npx wrangler kv key delete "s:YYYY-MM-DD:<player id>" --binding LEADERBOARD --remote`.

What it stores: per score, the player's random id (made on their device), the display name they chose, the score, correct calls, average call time and submission time. Rate-limit counters hold a hash of the IP for two minutes; raw IPs are not stored. Players who choose "Play without" never send anything. Limits worth knowing: KV is eventually consistent and allows about one write per second per key, so the rate limit is approximate under bursts, and the bounds stop impossible scores but not a determined cheat sending plausible ones.

## Deploy the web version

Push to `main`. The workflow builds `www/` and deploys it to GitHub Pages at https://kwy8.github.io/call-the-line/. First time only: in the repo settings, under Pages, set the source to "GitHub Actions".

## iOS and Android

The apps wrap the same `www/` folder with [Capacitor](https://capacitorjs.com).

```
npm install
npm run cap:add      # once: creates ios/ and android/ (needs Xcode on a Mac, Android Studio)
npm run cap:ios      # build, sync, open in Xcode
npm run cap:android  # build, sync, open in Android Studio
```

Every change to `src/game.html` goes to all three targets: the web on the next push, the apps on the next `cap:sync` and store build.

## Ads

The game has one ad interface (`Ads` in `src/game.html`) with a provider per platform:

| Where | Provider | Rewarded ("one more overrule") | Interstitial (between tournaments) |
|---|---|---|---|
| iOS / Android apps | AdMob via `@capacitor-community/admob` | yes | yes |
| Game portals (CrazyGames) | portal SDK, loaded by the portal | yes | yes |
| Your own site / the artifact | none, ads are skipped | – | – |
| Testing | open the page with `#adsim` | simulated | simulated |

The AdMob unit IDs in `src/game.html` are Google's public **test** units. Before release, create an AdMob account, add both apps, create a rewarded and an interstitial unit per platform, and paste the IDs into `UNITS`. Add your AdMob app IDs to `Info.plist` (`GADApplicationIdentifier`) and `AndroidManifest.xml` (`com.google.android.gms.ads.APPLICATION_ID`) as the plugin's README describes. EU consent is requested through Google's UMP at first ad; keep a privacy policy URL ready for both stores.

## Tuning

Difficulty lives in the `TIERS` table at the top of the script in `src/game.html`: landing distance, speed range, minimum margin from the line, and the call window per tournament.
