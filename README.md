# Luna — Private Cycle Tracker

A Flo-style period and cycle tracker that runs entirely in the browser. Built for private use. **No accounts. No server. No analytics.** Logs stay in `localStorage` on the device that opened the page.

Live (after Pages is enabled): https://crowserainance.github.io/Menstruation-Tracker/

## What this is

Luna is a **static Progressive Web App (PWA)**. Open the URL in any modern browser on phone, tablet, or desktop — Android, iOS, Windows, macOS, Linux — and the same features work. Install it to the home screen for an app-like shell; offline caching is handled by the service worker.

## What this foundation includes

- Today view: cycle day, phase, countdown to next period, estimated ovulation
- Month calendar with period / predicted period / fertile window / ovulation
- Daily log: flow, period start/end, symptoms, mood, notes
- Insights: average cycle from history, range, upcoming dates
- Optional 4-digit PIN lock (SHA-256, checked only on this device)
- **Portable JSON backup** — download, copy, or share, then import on any other device
- Installable PWA (Add to Home Screen on Android / iOS Safari)
- GitHub Pages workflow

## Cross-platform access

| Platform | How to use |
| --- | --- |
| Android | Chrome → open Pages URL → menu → **Add to Home screen** |
| iPhone / iPad | Safari → Share → **Add to Home Screen** |
| Desktop | Any Chromium/Firefox/Safari browser; optional install via the address-bar install icon |
| Offline | After first visit, the service worker serves the shell from cache |

There is no native store build. The web app *is* the multi-platform client.

## Backup: local export & reusable import

Data never leaves the browser unless you export it. Settings → **Backup & transfer** supports:

1. **Download JSON** — saves `luna-backup-YYYY-MM-DD.json` locally
2. **Copy JSON** — puts the same portable backup on the clipboard
3. **Share backup** — uses the device Share sheet when available (phones)
4. **Import file** / **Paste JSON** — restores a backup on this device (replaces local data)

The export is a reusable envelope any Luna instance can import:

```json
{
  "format": "luna-cycle-backup",
  "version": 1,
  "exportedAt": "2026-09-15T12:00:00.000Z",
  "app": "Luna",
  "data": {
    "version": 1,
    "onboarded": true,
    "settings": {
      "displayName": "",
      "typicalCycle": 28,
      "typicalPeriod": 5,
      "lutealDays": 14,
      "pinHash": ""
    },
    "cycles": [{ "start": "2026-08-20", "end": "2026-08-24" }],
    "days": {
      "2026-08-20": {
        "flow": "medium",
        "symptoms": ["Cramps"],
        "mood": "Low",
        "notes": ""
      }
    }
  }
}
```

Older raw `version: 1` state files (without the `format` wrapper) still import.

To move history to a second device: export on device A → transfer the file or pasted JSON → import on device B.

## How predictions work

- Cycle length uses the average of the last complete cycles (up to 6) once at least two cycles exist; otherwise the number entered in settings (default 28).
- Next period = last logged period start + cycle length (rolled forward past today).
- Estimated ovulation = next period minus luteal length (default 14 days).
- Fertile window = 5 days before ovulation through 1 day after.

These are calendar estimates, not lab results. Do **not** use this as contraception or medical diagnosis.

## Privacy

- Cycle data never leaves the browser unless you export a JSON file.
- The source code in this repo is public. The *data* is not in the repo.
- A PIN only hides the UI on that device. It is not encryption. Anyone with device access and devtools can still read `localStorage`.
- Clearing site data, switching browsers, or using private mode will look like a fresh install. Export a backup first.

## Enable GitHub Pages (one-time)

Repo → **Settings** → **Pages** → Source: **GitHub Actions**.
The workflow in `.github/workflows/pages.yml` publishes on every push to `main`.

If the first Actions run fails with an environment error, open **Settings → Pages** once so GitHub creates the `github-pages` environment, then re-run the workflow.

## Local preview

Any static server from the repo root:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Next extras worth adding later

- Browser notifications a day or two before a predicted period
- Optional temperature / LH test logging
- Cycle-length chart
- Encrypted backup file (passworded ZIP or WebCrypto)
- Shared read-only partner view via a manually copied export
