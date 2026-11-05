import { useEffect } from 'react';
import { useNavigationContainerRef, useRouter } from 'expo-router';

/**
 * Clears a one-shot route parameter (a Home shortcut) once the screen has applied it, so the same
 * shortcut works again later. On a cold web deep link the screen renders before the root navigator
 * is ready, so the clear waits for the container's `ready` event instead of throwing.
 */
export function useClearRouteParam(name: string, value: string | undefined): void {
  const router = useRouter();
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    if (value === undefined) return undefined;
    const clear = () => router.setParams({ [name]: undefined });
    if (navigation.isReady()) {
      clear();
      return undefined;
    }
    return navigation.addListener('ready', clear);
  }, [name, value, router, navigation]);
}
