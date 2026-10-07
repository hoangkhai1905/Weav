import { translations, useI18nStore } from '../../stores/i18n.store';
import { errorMessageKey } from '../../components/ui/status';

/** Friendly sentence for an ApiError (by code, then HTTP status); the raw backend message is never shown. */
export function friendlyErrorMessage(error: unknown): string {
  const dict = translations[useI18nStore.getState().language];
  const e = error as { code?: unknown; status?: unknown } | null;
  return dict[
    errorMessageKey(
      {
        code: typeof e?.code === 'string' ? e.code : undefined,
        status: typeof e?.status === 'number' ? e.status : undefined,
      },
      (key) => Boolean(dict[key]),
    )
  ];
}
