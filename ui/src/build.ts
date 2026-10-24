/** The website build (`npm run build:web`), as opposed to the desktop app, the dev server and plain builds. */
export const IS_WEBSITE = import.meta.env.MODE === 'web';

/** The privacy notice of the deployment, set with `VITE_PRIVACY_URL` at build time; unset in builds others host. */
export const PRIVACY_NOTICE_URL: string | undefined = import.meta.env.VITE_PRIVACY_URL || undefined;
