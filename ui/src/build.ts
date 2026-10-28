/** The website build (`npm run build:web`), as opposed to the desktop app, the dev server and plain builds. */
export const IS_WEBSITE = import.meta.env.MODE === 'web';

/** The privacy notice of the deployment, set with `VITE_PRIVACY_URL` at build time; unset in builds others host. */
export const PRIVACY_NOTICE_URL: string | undefined = import.meta.env.VITE_PRIVACY_URL || undefined;

/** Where users of this build get its source code, as the AGPL asks of anyone who hosts it; forks point it at their own. */
export const SOURCE_URL = 'https://github.com/Shaydera/OpenLogs';

/** The version of this build, from `ui/package.json`, which the desktop app takes its version from too. */
export const APP_VERSION: string = __APP_VERSION__;

/** Running inside the Tauri desktop app, not in a browser (the dev server included). */
export const IN_DESKTOP_APP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The releases of this build's repository; the desktop app's capabilities let it open only these pages. */
export const RELEASES_URL = `${SOURCE_URL}/releases/`;

export const RELEASES_API_URL = `${SOURCE_URL.replace('https://github.com/', 'https://api.github.com/repos/')}/releases?per_page=100`;
