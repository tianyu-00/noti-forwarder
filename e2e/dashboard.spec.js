// Browser test: what the user sees. Log in, add a phone, see a message arrive live, find it.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const ADMIN = { username: 'e2e-admin', password: 'e2e-test-password-123' };

test('log in, add a phone, see its message arrive live, search, sign out', async ({ page, request }) => {
  const phoneName = `Browser phone ${randomUUID().slice(0, 6)}`;
  const sender = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;

  // A wrong password is refused with a message.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  // The right one gets in.
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Add phone' })).toBeVisible();

  // Add phone shows a single-use security key; the "phone" uses it to pair.
  await page.getByRole('button', { name: 'Add phone' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img', { name: 'Pairing QR code' })).toBeVisible();
  const code = (await dialog.locator('dt:has-text("Security key") + dd').innerText()).trim();
  expect(code.length).toBeGreaterThanOrEqual(16);

  const paired = await request.post('/api/v1/pair', {
    data: { code, name: phoneName, model: 'test', appVersion: '0.0.0', hardwareId: randomUUID() },
  });
  expect(paired.status()).toBe(201);
  const { token } = await paired.json();

  // The dashboard learns about the phone without a reload, and the dialog closes by itself.
  await expect(page.getByRole('navigation', { name: 'Phones' }).getByText(phoneName)).toBeVisible();
  await expect(dialog).toBeHidden();

  // The phone sends a text with a code; it shows up live as a conversation.
  const sent = await request.post('/api/v1/messages', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      messages: [
        {
          id: randomUUID(),
          type: 'sms',
          app: 'sms',
          sender,
          body: 'Your code is 482913. Do not share it.',
          receivedAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(sent.status()).toBe(201);
  const row = page.getByRole('button', { name: new RegExp(sender.replace('+', '\\+')) }).first();
  await expect(row).toBeVisible();

  // Opening it shows the message as plain text, with the code to copy.
  await row.click();
  const thread = page.getByRole('region', { name: sender });
  await expect(thread.getByText('Your code is', { exact: false })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Copy code' })).toBeVisible();

  // Search narrows the list; clearing it brings the conversation back.
  await page.getByRole('searchbox', { name: 'Search' }).or(page.getByLabel('Search')).first().fill('no-such-text-anywhere');
  await expect(page.getByRole('button', { name: new RegExp(sender.replace('+', '\\+')) })).toHaveCount(0);
  await page.getByLabel('Search').fill('482913');
  await expect(page.getByRole('button', { name: new RegExp(sender.replace('+', '\\+')) }).first()).toBeVisible();

  // Signing out returns to the login page, and a reload stays signed out.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
