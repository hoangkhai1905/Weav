/**
 * The id inside a pasted Google Sheets, Docs or Drive link, so people can paste the link they have instead of
 * digging the id out of it. Anything that is not such a link (an id, a {{ }} mapping, plain text) comes back as is.
 *
 *   https://docs.google.com/spreadsheets/d/<id>/edit#gid=0   → <id>
 *   https://drive.google.com/file/d/<id>/view                 → <id>
 *   https://drive.google.com/drive/folders/<id>               → <id>
 *   https://drive.google.com/open?id=<id>                     → <id>
 */
export function idFromGoogleLink(text: string): string {
  const value = text.trim();
  if (!/^https?:\/\/(docs|drive)\.google\.com\//i.test(value)) return text;
  const match = value.match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/) ?? value.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return match ? match[1] : text;
}
