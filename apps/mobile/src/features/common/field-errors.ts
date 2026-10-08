/**
 * Backend validation errors arrive as error.details = [{ field, message }]. This turns them into a
 * { field: message } map so a screen can show each message under its own input. Gateway-made
 * details can be plain strings; those have no field and are ignored here.
 */
export function fieldErrorsFromError(error: unknown): Record<string, string> {
  const details = (error as { details?: unknown } | null)?.details;
  const result: Record<string, string> = {};
  if (!Array.isArray(details)) return result;
  for (const item of details) {
    if (typeof item !== 'object' || item === null) continue;
    const { field, message } = item as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && field && typeof message === 'string' && !(field in result)) {
      result[field] = message;
    }
  }
  return result;
}
