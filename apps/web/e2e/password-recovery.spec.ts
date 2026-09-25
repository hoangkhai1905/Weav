import { expect, test, type Page, type Route } from '@playwright/test';

const CHALLENGE_ID = 'A'.repeat(43);
const RESET_TOKEN = 'B'.repeat(43);

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function gotoRecovery(page: Page) {
  await page.goto('/forgot-password');
  await expect(page.getByTestId('password-recovery-page')).toBeVisible();
}

test.describe('web password recovery HTTP integration', () => {
  test('sends the exact OTP payload and keeps the forgot response generic', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/auth/forgot-password', async (route) => {
      requests += 1;
      await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const requestPromise = page.waitForRequest((request) => (
      request.url().includes('/api/auth/forgot-password') && request.method() === 'POST'
    ));
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    const request = await requestPromise;
    await responsePromise;

    expect(request.postDataJSON()).toEqual({ email: 'person@example.com' });
    expect(requests).toBe(1);
    await expect(page.getByText('If the account is eligible, recovery instructions may be sent to the account email.')).toBeVisible();
    await expect(page.getByText(/email was sent/i)).toHaveCount(0);
  });

  test('validates confirmation and prevents duplicate verify/reset submits', async ({ page }) => {
    let verifyRequests = 0;
    let resetRequests = 0;
    await page.route('**/api/auth/forgot-password', async (route) => {
      await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202);
    });
    await page.route('**/api/auth/otp/verify', async (route) => {
      verifyRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      await fulfillJson(route, { purpose: 'PASSWORD_RESET', resetToken: RESET_TOKEN, expiresIn: 300 });
    });
    await page.route('**/api/auth/reset-password', async (route) => {
      resetRequests += 1;
      await fulfillJson(route, null, 204);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await responsePromise;
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await page.getByLabel('Verification code').fill('123456');
    await page.getByLabel('New password', { exact: true }).fill('new-password-123');
    await page.getByLabel('Confirm new password').fill('different-password');
    await page.getByTestId('complete-reset-button').click();
    await expect(page.getByRole('alert')).toContainText('Passwords do not match');
    expect(verifyRequests).toBe(0);

    await page.getByLabel('Confirm new password').fill('new-password-123');
    const verifyRequestPromise = page.waitForRequest((request) => (
      request.url().includes('/api/auth/otp/verify') && request.method() === 'POST'
    ));
    const resetRequestPromise = page.waitForRequest((request) => (
      request.url().includes('/api/auth/reset-password') && request.method() === 'POST'
    ));
    await page.getByTestId('complete-reset-button').dblclick();
    const verifyRequest = await verifyRequestPromise;
    const resetRequest = await resetRequestPromise;
    await expect(page).toHaveURL(/\/login$/);
    expect(verifyRequests).toBe(1);
    expect(resetRequests).toBe(1);
    expect(verifyRequest.postDataJSON()).toEqual({ challengeId: CHALLENGE_ID, code: '123456' });
    expect(resetRequest.postDataJSON()).toEqual({ resetToken: RESET_TOKEN, newPassword: 'new-password-123' });
  });

  test('maps invalid/expired OTP safely and preserves input', async ({ page }) => {
    await page.route('**/api/auth/forgot-password', async (route) => {
      await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202);
    });
    await page.route('**/api/auth/otp/verify', async (route) => {
      await fulfillJson(route, { error: 'OTP challenge is invalid' }, 400);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await responsePromise;
    await page.getByLabel('Verification code').fill('123456');
    await page.getByLabel('New password', { exact: true }).fill('new-password-123');
    await page.getByLabel('Confirm new password').fill('new-password-123');
    await page.getByTestId('complete-reset-button').click();

    await expect(page.getByRole('alert')).toContainText('code is invalid or expired');
    await expect(page.getByLabel('Verification code')).toHaveValue('123456');
    await expect(page.getByLabel('New password', { exact: true })).toHaveValue('new-password-123');
  });

  test('does not issue a resend request during server cooldown and handles rate limit', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/auth/forgot-password', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202);
        return;
      }
      await fulfillJson(route, { error: 'Too many requests' }, 429);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await responsePromise;
    await expect(page.getByTestId('resend-reset-button')).toBeDisabled();
    await page.getByTestId('resend-reset-button').click({ force: true });
    expect(requestCount).toBe(1);
    await expect(page.getByTestId('cooldown-message')).toContainText('60');
  });

  test('maps a server rate limit without losing the recovery draft', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/auth/forgot-password', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 0 }, 202);
        return;
      }
      await fulfillJson(route, { error: 'Too many requests' }, 429);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const firstResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await firstResponse;
    await expect(page.getByTestId('resend-reset-button')).toBeEnabled();

    const limitedResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('resend-reset-button').click();
    await limitedResponse;
    await expect(page.getByRole('alert')).toContainText('Too many recovery attempts');
    await expect(page.getByLabel('Verification code')).toBeVisible();
    expect(requestCount).toBe(2);
  });

  test('maps an invalid reset grant and preserves password input after verify succeeds', async ({ page }) => {
    await page.route('**/api/auth/forgot-password', async (route) => {
      await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 0 }, 202);
    });
    await page.route('**/api/auth/otp/verify', async (route) => {
      await fulfillJson(route, { purpose: 'PASSWORD_RESET', resetToken: RESET_TOKEN, expiresIn: 300 });
    });
    await page.route('**/api/auth/reset-password', async (route) => {
      await fulfillJson(route, { error: 'Reset grant is invalid' }, 400);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const requestResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/forgot-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await requestResponse;
    await page.getByLabel('Verification code').fill('123456');
    await page.getByLabel('New password', { exact: true }).fill('new-password-123');
    await page.getByLabel('Confirm new password').fill('new-password-123');
    const resetResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/reset-password') && response.request().method() === 'POST'
    ));
    await page.getByTestId('complete-reset-button').click();
    await resetResponse;

    await expect(page.getByRole('alert')).toContainText('password reset request is invalid or expired');
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByLabel('New password', { exact: true })).toHaveValue('new-password-123');
    await expect(page.getByLabel('Confirm new password')).toHaveValue('new-password-123');
  });

  test('ignores a late forgot response after the recovery flow is unmounted', async ({ page }) => {
    let resolveRequest: (() => void) | undefined;
    await page.route('**/api/auth/forgot-password', async (route) => {
      await new Promise<void>((resolve) => {
        resolveRequest = resolve;
      });
      await fulfillJson(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202);
    });

    await gotoRecovery(page);
    await page.getByLabel('Email address').fill('person@example.com');
    const requestStarted = page.waitForRequest((request) => (
      request.url().includes('/api/auth/forgot-password') && request.method() === 'POST'
    ));
    await page.getByTestId('request-reset-button').click();
    await requestStarted;
    await page.goto('/login');
    resolveRequest?.();
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('If the account is eligible, recovery instructions may be sent to the account email.')).toHaveCount(0);
  });
});
