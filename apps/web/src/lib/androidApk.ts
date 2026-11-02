// Set at build time (VITE_ANDROID_APK_URL, e.g. a GitHub Release asset); the download link stays hidden without it.
const raw = String(import.meta.env.VITE_ANDROID_APK_URL ?? '').trim();

export const ANDROID_APK_URL = raw.startsWith('https://') ? raw : '';
