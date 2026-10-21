import type { Page, Route } from '@playwright/test';

export const GATEWAY = 'http://localhost:3000';

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Starts the page already signed in as an admin (access token only), in English so assertions can use exact text. */
export async function signedInAs(page: Page, profile: { id: string; email: string; displayName: string | null }) {
  const stored = JSON.stringify({ accessToken: 'a1', profile: { ...profile, systemRole: 'ADMIN' } });
  await page.addInitScript((value) => {
    sessionStorage.setItem('weav_admin_session', value);
    localStorage.setItem('weav_admin_lang', 'EN');
  }, stored);
}
