# Luna — Private Cycle Tracker

A Flo-style period and cycle tracker that runs entirely in the browser. Built for private use. **No accounts. No server. No analytics.** Logs stay in `localStorage` on the device that opened the page.

Live (after Pages is enabled): https://crowserainance.github.io/Menstruation-Tracker/

## What this is

Luna is a **static Progressive Web App (PWA)** with a bright seashell + light-red UI. Open the URL in any modern browser on phone, tablet, or desktop. Install it to the home screen for an app-like shell; offline caching is handled by the service worker.

## Features

- Today view: cycle day, phase, countdown, ovulation estimate, period-ahead banner
- **Period bag checklist** (pads, liners, wipes, pain relief, spare underwear, and more)
- Month calendar with period / predicted / fertile / ovulation markers
- Daily log: flow, **pain 0–10**, symptoms, mood, notes
- Insights: average cycle, range, upcoming dates
- **Period-ahead reminders** with strong local notifications (`requireInteraction`, vibration, renotify)
- Optional 4-digit PIN lock
- Heavy on-device storage: save + read-back verify, storage size panel
- Portable backup: pretty JSON, human-readable text summary, preview-before-import
- Installable PWA + GitHub Pages workflow

## Cross-platform access

| Platform | How to use |
| --- | --- |
| Android | Chrome → open Pages URL → menu → **Add to Home screen** |
| iPhone / iPad | Safari → Share → **Add to Home Screen** |
| Desktop | Any Chromium/Firefox/Safari browser; optional install via the address-bar install icon |
| Offline | After first visit, the service worker serves the shell from cache |

## Reminders

Settings → **Period reminders**:

1. Enable period-ahead alerts
2. Choose lead days (1–5)
3. Allow browser notifications when prompted
4. Use **Test alert** to verify a strong notification

Reminders are checked when Luna opens, when the tab becomes visible again, and about every 30 minutes while open. True background push without a server is limited by browsers; keep the PWA installed for the best results.

## Backup: local export & reusable import

Settings → **Backup & transfer**:

1. **Download JSON** — pretty-printed portable backup
2. **Download text** — human-readable summary for easy reading
3. **Copy JSON** / **Share backup**
4. **Import file** / **Paste** → readable preview → **Confirm replace**

On-device storage panel shows saved size, cycle/day counts, last saved time, and a verify button.

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
      "remindersEnabled": true,
      "remindDaysBefore": 2,
      "pinHash": ""
    },
    "bag": [{ "id": "pads", "label": "Pads / napkins", "packed": false }],
    "cycles": [{ "start": "2026-08-20", "end": "2026-08-24" }],
    "days": {
      "2026-08-20": {
        "flow": "medium",
        "pain": 6,
        "symptoms": ["Cramps"],
        "mood": "Low",
        "notes": ""
      }
    }
  }
}
```

## How predictions work

- Cycle length uses the average of the last complete cycles (up to 6) once at least two cycles exist; otherwise the number entered in settings (default 28).
- Next period = last logged period start + cycle length (rolled forward past today).
- Estimated ovulation = next period minus luteal length (default 14 days).
- Fertile window = 5 days before ovulation through 1 day after.

These are calendar estimates, not lab results. Do **not** use this as contraception or medical diagnosis.

## Privacy

- Cycle data never leaves the browser unless you export a file.
- A PIN only hides the UI on that device. It is not encryption.
- Clearing site data looks like a fresh install — export a backup first.

## Enable GitHub Pages (one-time)

Repo → **Settings** → **Pages** → Source: **GitHub Actions**.

## Local preview

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
