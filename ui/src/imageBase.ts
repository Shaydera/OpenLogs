/** The website serves the game images itself (`npm run images`), so it sends no request to a third party. */
export const IMAGE_BASE = import.meta.env.MODE === 'web' ? `${import.meta.env.BASE_URL}images/` : 'https://wow.zamimg.com/images/wow/';

/** The URL of a path from `imagePaths.ts`. */
export const imageUrl = (path: string): string => `${IMAGE_BASE}${path.split('/').map(encodeURIComponent).join('/')}`;
