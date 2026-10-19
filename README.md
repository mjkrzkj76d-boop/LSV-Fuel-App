# LSV Fuel Soundings (offline PWA)

An installable, offline-first web app for tank soundings on Logistics Support Vessels. It recreates the corrected spreadsheet *My Fuel Calculator (Plus) - corrected.xlsx*:

- soundings in feet and inches, converted to gallons, percent full, liters, and short, long and metric tons
- usable fuel (total minus each storage tank's unpumpable bottom)
- trim correction from bow and stern drafts
- needed-to-fill (to each tank's fill limit)
- a fuel converter
- **OUT OF RANGE** and **CHECK SOUNDINGS** warnings
- a burn-rate log with endurance and range (from ship logs, not TM data)

**The app ships with NO vessel data.** On first run it shows an empty screen with *Import vessel data*. You load a vessel-data JSON file privately. It is validated and then stored only in that device's browser storage (localStorage). The app has no backend, no accounts, no analytics, and makes no outside network calls. A Content-Security-Policy restricts it to its own origin, and the service worker caches only the app's own files.

> Unofficial calculation aid. The vessel's official sounding tables and technical manuals govern.

---

## ⚠️ Restricted data: read first

- The real LSV vessel-data file (tank capacities and inch→gallon tables) is **restricted**.
  - Its tank capacities match TM 55-1915-200-10-1 (2018), which is **Distribution C** (U.S. Government agencies and their contractors only).
  - The source marking of the sounding tables has not been confirmed.
  - Handle the file as Distribution C.
- Keep it **out of this folder, out of any git repo, and off any public host.** On the build box it lives at `/workspace/lsv-private/lsv6-vessel-data.json`, outside the app.
- Hand the file to authorized users directly, e.g. on a government device, by approved file transfer, or on removable media. Each person then imports it on their own phone.
- The vessel's `distributionMarking` text is shown in the app header whenever data is loaded.
- Exports and backups made in the app contain the same data. Handle them the same way.
- Screenshots of the app with data loaded show that data too. `screenshots/` is git-ignored and **not** included in the zip.

---

## Folder contents

```
index.html              app shell (strict CSP, iOS/Android meta tags)
styles.css              UI (dark, large touch targets; adapted from LSV6_Soundings_Calculator.html)
calc.js                 calculation engine + vessel-data validator (pure JS, also runs in Node)
app.js                  UI, local storage, import/export, burn log
sw.js                   offline service worker (cache-first app shell)
manifest.webmanifest    install manifest
icons/                  192/512/maskable/apple-touch icons
docs/vessel-data.schema.json        JSON Schema documentation of the vessel-data format
docs/example-vessel-FICTIONAL.json  made-up 3-tank demo file for trying the app
tests/unit.test.js      Node unit tests (sample-day reproduction, validator, burn rate, converter)
tests/smoke.mjs         headless Chrome smoke test (Playwright)
tests/serve.js          tiny local static server for testing
```

---

## Hosting on GitHub Pages (only if your unit approves)

The app contains no vessel data, so the code itself can be hosted publicly. Check with your unit first if you want even the code kept private.

Pushes to `main` publish this directory with GitHub Pages, source **Deploy from a branch**, branch `main`, folder `/ (root)`. An empty `.nojekyll` file at the repo root makes Pages serve the files as-is. The live app is:

https://mjkrzkj76d-boop.github.io/LSV-Fuel-App/

GitHub Pages serves a project site under `/LSV-Fuel-App/`. HTML assets, the manifest `start_url` and `scope`, and the service worker scope and cache list are all relative to the app directory, so they stay inside that subpath. Do not commit vessel JSON, backups, or screenshots. `.gitignore` excludes `lsv-private/`, `*vessel-data*.json` (the fictional example in `docs/` is the exception), and `screenshots/`.

**To update:** change the files and bump `CACHE` in `sw.js` (e.g. `lsv-fuel-v1.0.1`) and `APP_VERSION` in `app.js`. Phones pick up the new version on the next launch while online.

Any other static HTTPS host works the same way, as long as these files stay together in one directory. Relative URLs follow that directory.

---

## Install on a phone

The first visit must be online so the app files can be cached. After that it works with no connectivity.

**iPhone / iPad (Safari)**
1. Open the app URL in **Safari**. Chrome on iOS can also install it on iOS 16.4+, but Safari is the most reliable.
2. Tap **Share** (square with an arrow), then **Add to Home Screen**, then **Add**.
3. Launch it from the new **LSV Fuel** icon. It opens full-screen and works offline.
4. Data imported in the home-screen app is separate from data imported in a Safari tab. Import inside the installed app.
5. iOS can clear storage for web apps that go unused for weeks. **Export a full backup** (Data tab) now and then and keep it somewhere approved.

**Android (Chrome)**
1. Open the app URL in **Chrome**.
2. Tap **Install app** when prompted, or use **⋮ → Add to Home screen / Install app**.
3. Launch it from the app drawer or home screen. It works offline.

---

## Loading vessel data

1. Get the vessel-data JSON from an authorized source and save it on the device, e.g. in the Files app (iOS) or Downloads (Android).
2. Open the app and tap **Import vessel data**, then pick the file.
   - If the picker won't select the file (some iOS versions grey out `.json`), open the file, copy all of its text, and use **Or paste JSON** instead.
3. The app checks the file against the schema. It lists every problem if the file is rejected, and nothing is stored.
4. Once loaded:
   - The header shows the vessel name and distribution marking.
   - **Data tab → Choose JSON file** replaces the vessel data. You are asked to confirm, and your log is kept.
   - **Export vessel data** or **Export full backup** (vessel data, burn log and current entries) saves a file. Importing a full backup restores everything.
   - **Delete vessel data from this device** removes it. You are then asked whether to also delete the log and entries.

To try the app without restricted data, import `docs/example-vessel-FICTIONAL.json`.

### Building the LSV-6 file (restricted, done off this folder)

`/workspace/lsv-private/make_vessel_json.py` builds the vessel JSON from *My Fuel Calculator (Plus) - corrected.xlsx*. It reads the Master tables (recalculating with LibreOffice if needed) and parses capacities, fill limits, unpumpable volumes, density, liters/gal and trim constants from the workbook formulas.

```
python3 make_vessel_json.py "My Fuel Calculator (Plus) - corrected.xlsx" -o lsv6-vessel-data.json
python3 check_json_vs_xlsx.py lsv6-vessel-data.json "My Fuel Calculator (Plus) - corrected.xlsx"
```

---

## Vessel-data format (`lsv-fuel-vessel/1`)

The full rules are in `docs/vessel-data.schema.json`, and the app enforces them with `LSVCalc.validateVesselData`.

| Field | Meaning |
|---|---|
| `schema` | must be `"lsv-fuel-vessel/1"` |
| `vessel.name` | shown in the header |
| `distributionMarking` | handling marking text shown in the header (empty string if public) |
| `constants` | `densityLbPerGal` (7.175), `litersPerGal` (3.7853), `trimVesselLengthFt` (272.75), `trimTankLengthFt` (40), `trimDivisor` (2), `trimSign` (`stern-minus-bow`), `fuelTotalFillLimitPct` (93), `lookup` (`floor` = Excel approximate VLOOKUP, or `interpolate`), plus optional converter factors |
| `tanks[]` | `id`, `name`, `type` (`fuel`/`waste`/`lube`/`hydraulic`), `capacityGal` (or null), `fillLimitPct` (or null), `unpumpableGal`, `trimCorrected`, `stepIn` (0.25), `maxIn`, optional `sumGroup` (`sludgeRequest`), `gallons[]` (value at 0, 0.25, … maxIn inches; must not decrease) |

### Calculation rules (same as the corrected spreadsheet)

- **Total inches** = ft × 12 + in. For `trimCorrected` tanks, the trim correction is added: `((stern − bow) × tankLen/vesselLen × 12) ÷ divisor`. It is applied only when all four draft fields are filled.
- **Gallons** come from the table, rounded down to the 0.25″ row (like Excel's approximate VLOOKUP). Below 0 or above `maxIn` gives **OUT OF RANGE**.
- **Fuel totals:**
  - Total = sum of the fuel tanks.
  - Capacity = sum of the fuel tables' last values.
  - Usable = total − Σ unpumpable.
  - Needed for N% = capacity × N% − total.
  - Tons = gal × density ÷ 2000 / 2240 / 2204.62.
- If any fuel tank is blank, invalid or out of range, totals show **CHECK SOUNDINGS**.
  - This is stricter than the spreadsheet, which treats a blank as 0″.
- **Needed-to-fill** per tank = capacity × fill limit − gallons. The tab also shows the sum over the fuel tanks.

### Burn-rate log (from ship logs, not TM data)

- **Save round** stores:
  - from the current soundings: the timestamp (Soundings date/time, or now), fuel on board (ROB) and usable fuel
  - from the form: engine-hour meter reading, fuel received since the last round, fuel transferred off, and a note
- For each interval:
  - burn = previous ROB − ROB + received − transferred off
  - hours = change in engine-hour reading, or clock hours if the readings are missing or unchanged
- Average rate = Σ burn ÷ Σ hours.
- Endurance = latest usable fuel ÷ average rate.
- Range = endurance × planned speed (kn).
- **Export log CSV** saves the log.

---

## Testing

```
npm install                    # playwright-core (dev only)
npm test                       # unit tests; set LSV_VESSEL_JSON=/path/to/lsv6-vessel-data.json
npm run smoke                  # headless Chrome; CHROME_PATH=/usr/bin/google-chrome, writes screenshots/
```

The unit and smoke tests load the private vessel JSON (`LSV_VESSEL_JSON`) and a **restricted expected-values fixture** (`LSV_EXPECTED`, default `/workspace/lsv-private/lsv6-sample-day.expected.json`). Both live outside this folder, so no vessel figures are in the bundle. With the fixture present, the tests reproduce the corrected spreadsheet's sample day (17/4/2024):
- total, usable and needed-to-fill
- the trim correction
- every per-tank gallon value
- tons and liters
- the sludge total

They also cover out-of-range and CHECK SOUNDINGS states, converter factors, burn-rate math, validator rejects, and a scan that no LSV capacities are in the bundle. Without the private files, the vessel-specific tests are skipped and the generic ones still run.

## Open items carried over from the spreadsheet review

These are left as the spreadsheet has them and can be changed in the vessel JSON when decided:
- density 7.175 vs the TM's implied 7.0 lb/gal
- 272.75 ft LOA vs 256 ft LBP for trim
- trim sign and the 40 ft tank length
- the 93/95% fill limits
- per-tank capacities that differ from TM 55-1915-200-10-1 WP 0023 (#2 Port, lube and waste tanks). See the private review notes.
