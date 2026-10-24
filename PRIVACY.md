# Privacy

OpenLogs analyses World of Warcraft combat logs on your own device. There is no account, no upload, no cookies, no analytics and no tracking.

The website [openlogs.gg](https://openlogs.gg) and the web app at [app.openlogs.gg](https://app.openlogs.gg) are covered by their [privacy notice](https://openlogs.gg/privacy.html). This page covers the desktop app and builds you make yourself. Questions go to privacy@openlogs.gg.

## Desktop app

**Your combat logs.** The app reads a log directly from your disk and analyses it on your device. The log is never sent anywhere. Logs contain the character names of everyone in your group; they stay on your device as well.

**What is stored on your device.** The app keeps the same data as the web app, in its own browser storage:

| What | Kept until |
|---|---|
| Settings: theme, UI size, report and replay options, saved time ranges | You change or delete them |
| The index of each opened log, so it opens again without being read twice; it contains the character names from that log | The 20 most recently used are kept, older ones are removed |
| The recent list: file name, size, zone, start time, number of pulls and when you opened it, and a handle that lets the app reopen the file | The 12 most recent are kept |

None of it leaves your device. Removing a log from the recent list deletes its entry there; its index stays until it is no longer among the 20 most recently used. A log that changed on disk gets a new index when you open it again, and the old one ages out the same way. To delete everything, delete the folder `%LOCALAPPDATA%\gg.openlogs.desktop` and, if it exists, `%APPDATA%\gg.openlogs.desktop`, which earlier versions used.

**Images from the Wowhead CDN.** Unlike the web app, the desktop app loads spell, class and boss images and map art from `wow.zamimg.com`, the image server of Wowhead (ZAM Network LLC, USA). To load an image, the app sends the usual request data to that server: your IP address, the time, the image requested and browser details such as the user agent. See the [Wowhead privacy policy](https://www.wowhead.com/privacy) for how they handle this data. Without a network connection the app still works; missing images show the initials of their name instead.

All other game data ships with the app. OpenLogs has no auto-updater and sends no other requests itself. It runs in Microsoft's WebView2 runtime, which can contact Microsoft on its own, for example for SmartScreen checks and its own updates; see the [Microsoft privacy statement](https://www.microsoft.com/privacy/privacystatement). Installers are downloaded from GitHub; see [GitHub's privacy statement](https://github.com/site/privacy).

## Your own builds

The dev server and `npm --prefix ui run build` load the images from the Wowhead CDN like the desktop app; `npm --prefix ui run build:web` serves them itself and links the privacy notice given in `VITE_PRIVACY_URL` at build time. If you host a build for others, you are responsible for its privacy notice.

Last updated: 24 October 2026
