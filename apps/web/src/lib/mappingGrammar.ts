// Mirrors workflow-service MappingResolver.parsePath and DefinitionValidator.isCredentialField,
// so the builder only offers or accepts names the server will accept.

/** A property name: letters, digits, `_` and `$` (Character.isLetterOrDigit in MappingResolver). */
export const PROPERTY = /^[\p{L}\p{N}_$]+$/u;

/** One path segment: a name followed by any number of `[n]` list positions (0..9999, no leading zero). */
const SEGMENT = /^[\p{L}\p{N}_$]+(\[(0|[1-9]\d{0,3})\])*$/u;

/** True when `{{ ...<path> }}` can address it: dot-separated segments, `[n]` allowed. */
export const isValidPath = (path: string): boolean => path !== '' && path.split('.').every((segment) => SEGMENT.test(segment));

/** A field name that can be the single segment of a mapping path (no dot, dash, space...). */
export const isReferenceableName = (name: string): boolean => PROPERTY.test(name);

/** The server rejects any config key that looks like a credential (CREDENTIAL_FIELD_NOT_ALLOWED). */
export const isCredentialKey = (name: string): boolean => {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['authorization', 'basicauth', 'cookie', 'token', 'bearer', 'password', 'passwd', 'secret', 'credential',
    'apikey', 'accesskey', 'privatekey', 'signingkey'].some((word) => n.includes(word)) || n === 'auth' || n.endsWith('auth');
};
