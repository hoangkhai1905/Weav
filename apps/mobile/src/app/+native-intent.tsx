import { routeForSystemPath } from '../features/auth/google-sign-in';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  return routeForSystemPath(path, initial);
}
