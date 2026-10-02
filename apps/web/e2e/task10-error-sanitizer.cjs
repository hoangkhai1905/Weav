const MAX_ERROR_MESSAGE_LENGTH = 236;
const TASK10_LOCAL_ORIGIN = 'http://task10.invalid';

function sanitizeTask10Error(error) {
  const rawName = typeof error?.name === 'string' ? error.name : 'Error';
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'Error';
  let message = typeof error?.message === 'string' ? error.message : '';

  message = message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi, '[sensitive field redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/[\r\n\t\u0000-\u001f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (message.length > MAX_ERROR_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`;
  }
  return `${name}: ${message}`;
}

function sanitizeTask10Path(value) {
  if (typeof value !== 'string' || !value) return '[invalid-path]';

  let pathname;
  try {
    pathname = new URL(value, TASK10_LOCAL_ORIGIN).pathname || '/';
  } catch {
    return '[invalid-path]';
  }

  let redactNextSegment = false;
  return pathname.split('/').map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* Keep malformed encoding opaque. */ }

    if (redactNextSegment) {
      redactNextSegment = false;
      return ':redacted';
    }
    if (/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|cookie|session)$/i.test(decoded)) {
      redactNextSegment = true;
      return decoded.toLowerCase();
    }
    if (/(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|cookie)\s*[=:]/i.test(decoded)) {
      return ':redacted';
    }
    if (/^Bearer\s+/i.test(decoded)) return ':redacted';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(decoded)) return ':id';
    if (/^\d{4,}$/.test(decoded)) return ':id';
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(decoded)) return ':redacted';
    if (/^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(decoded)) return ':redacted';
    if (/^[A-Za-z0-9_-]{32,}$/.test(decoded)) return ':redacted';
    return segment;
  }).join('/') || '/';
}

function safeEvidencePart(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : fallback;
}

function formatTask10HttpSummary({ method, url, status }) {
  const safeMethod = typeof method === 'string' && /^[A-Za-z]{3,10}$/.test(method) ? method.toUpperCase() : 'UNKNOWN';
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
  return `${safeMethod} ${sanitizeTask10Path(url)} ${safeStatus}`;
}

function formatTask10HttpFailure({ label, phase, method, url, status }) {
  const safeLabel = safeEvidencePart(label, 'browser');
  const safePhase = safeEvidencePart(phase, 'unknown-phase');
  const safeMethod = typeof method === 'string' && /^[A-Za-z]{3,10}$/.test(method) ? method.toUpperCase() : 'UNKNOWN';
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
  return `${safeLabel} phase=${safePhase} response ${safeMethod} ${sanitizeTask10Path(url)} status=${safeStatus}`;
}

function formatTask10ConsoleFailure({ label, phase, locationUrl, message }) {
  const safeLabel = safeEvidencePart(label, 'browser');
  const safePhase = safeEvidencePart(phase, 'unknown-phase');
  const location = sanitizeTask10Path(locationUrl);
  const safeMessage = sanitizeTask10Error({ name: 'ConsoleError', message });
  return `${safeLabel} phase=${safePhase} console location=${location} message=${safeMessage}`;
}

module.exports = {
  sanitizeTask10Error,
  sanitizeTask10Path,
  formatTask10HttpSummary,
  formatTask10HttpFailure,
  formatTask10ConsoleFailure,
};
