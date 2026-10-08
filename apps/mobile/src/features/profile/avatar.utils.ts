/** Mirrors the Identity avatar rules: JPEG, PNG or WebP, at most 2 MiB (the server re-checks both). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface PickedImage {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

export type AvatarCheck =
  | { ok: true; file: { uri: string; name: string; type: string } }
  | { ok: false; problem: 'type' | 'size' };

/** Picker mime type if it is allowed, else the one implied by the file extension. */
function resolveMime(image: PickedImage): string | null {
  const declared = image.mimeType?.split(';')[0].trim().toLowerCase();
  if (declared) {
    const normalized = declared === 'image/jpg' ? 'image/jpeg' : declared;
    return EXTENSION_BY_MIME[normalized] ? normalized : null;
  }
  const ext = (image.fileName || image.uri).split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? null;
}

/** Client-side pre-check so people get a friendly message instead of a 400 after a slow upload. */
export function checkAvatarImage(image: PickedImage): AvatarCheck {
  const type = resolveMime(image);
  if (!type) return { ok: false, problem: 'type' };
  if (typeof image.fileSize === 'number' && image.fileSize > AVATAR_MAX_BYTES) return { ok: false, problem: 'size' };
  return { ok: true, file: { uri: image.uri, name: `avatar.${EXTENSION_BY_MIME[type]}`, type } };
}
