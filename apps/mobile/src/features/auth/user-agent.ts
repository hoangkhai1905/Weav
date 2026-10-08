export interface DeviceInfo {
  browser: string | null;
  os: string | null;
}

/**
 * Turns a raw User-Agent into names a non-technical user recognises ("Chrome" on "Windows").
 * Order matters: Edge and Opera also contain "Chrome", Chrome contains "Safari", iOS contains "Mac OS X".
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent ?? '';
  if (!ua.trim()) return { browser: null, os: null };
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /okhttp/i.test(ua)
              ? 'Weav Android'
              : /Expo|CFNetwork/i.test(ua)
                ? 'Weav'
                : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null;
  return { browser, os };
}
