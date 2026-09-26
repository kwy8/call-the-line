# Call the Line

*You think it's easy being a line judge?*

A tennis line-judge reflex game. You sit at the end of the sideline at real eye height, the ball comes at you in true perspective, and you call it In or Out after the bounce. Three overrules from the electronic review and the cameras take your chair. Five tournaments, from a clay club open to a Grand Slam final on grass.

## How it's built

One HTML page, no framework, no backend. Canvas 2D with a pinhole-camera projection of a real-size court (ball 6.7 cm, sideline 5 cm, eye height 1.1 m).

```
src/game.html        the game (page body only; also what gets published as a Claude artifact)
scripts/build.mjs    wraps it into a complete document
www/index.html       built output, deployed to GitHub Pages and packaged by Capacitor
capacitor.config.json
.github/workflows/pages.yml
```

## Run locally

```
npm run dev          # builds www/ and serves it on http://localhost:3000
```

Or just open `www/index.html` after `npm run build`.

## Deploy the web version

Push to `main`. The workflow builds `www/` and deploys it to GitHub Pages. First time only: in the repo settings, under Pages, set the source to "GitHub Actions".

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
