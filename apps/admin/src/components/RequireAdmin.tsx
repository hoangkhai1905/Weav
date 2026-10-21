import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getProfile } from '../lib/session';

/** Sends visitors without an admin session to the sign-in page. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  return getProfile() ? <>{children}</> : <Navigate to="/login" replace />;
}
