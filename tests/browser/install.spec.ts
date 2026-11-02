import { test, expect, type Page } from '@playwright/test';

const installDialog = (page: Page) => page.getByRole('dialog', { name: 'Install DonDocs', exact: true });
const installBanner = (page: Page) => page.getByRole('status').filter({ hasText: 'Install DonDocs for offline' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // A returning visitor avoids the unrelated welcome letter. Do not seed
    // install state or import app modules: use the rendered controls throughout.
    localStorage.setItem('browser-test-visitor', 'returning');
    // Native eligibility/engagement heuristics are outside our control. Keep
    // genuine prompts from racing the deterministic API fixtures below.
    window.addEventListener('beforeinstallprompt', event => {
      if (event.isTrusted) event.stopImmediatePropagation();
    }, { capture: true });
  });
});

async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
}

async function openHelpLauncher(page: Page) {
  // Wait for closing modal animations to release the background accessibility
  // tree before deciding whether the mobile workspace launcher is present.
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
}

async function openHelp(page: Page) {
  await openHelpLauncher(page);
  await page.getByRole('tab', { name: 'Support', exact: true }).click();
}

async function openInstallFromHelp(page: Page) {
  await openHelp(page);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
}

async function searchInstall(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Command search' }).fill('Install app');
}

async function capturePrompt(page: Page, outcome: 'accepted' | 'dismissed' | 'error' = 'accepted') {
  return page.evaluate(outcome => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    let calls = 0;
    Object.assign(event, {
      prompt: async () => {
        calls += 1;
        document.documentElement.dataset.installPromptCalls = String(calls);
        document.documentElement.dataset.installUserActivation = String(navigator.userActivation.isActive);
        if (outcome === 'error') throw new Error('Simulated expired install prompt');
      },
      userChoice: Promise.resolve({ outcome: outcome === 'dismissed' ? 'dismissed' : 'accepted' }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, outcome);
}

test('Help install opens usable browser-specific instructions without a native prompt', async ({ page }, testInfo) => {
  await start(page);
  await openInstallFromHelp(page);
  const dialog = installDialog(page);
  await expect(dialog).toBeVisible();
  const project = testInfo.project.name;
  if (project === 'firefox') {
    await expect(dialog).toContainText('keep using it right here');
  } else if (project === 'webkit') {
    await expect(dialog).toContainText('File → Add to Dock');
  } else if (['mobile-safari', 'ipad-safari', 'mobile-chrome-ios'].includes(project)) {
    await expect(dialog).toContainText('Share');
    await expect(dialog).toContainText('Add to Home Screen');
    if (project === 'mobile-chrome-ios') await expect(dialog).toContainText("Chrome's toolbar");
  } else if (project === 'mobile-chrome') {
    await expect(dialog).toContainText('Add to Home screen');
  } else {
    await expect(dialog).toContainText('install icon');
  }
  // Verify the real Radix focus trap and close control, not only store flags.
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeFocused();
});

test('command search install opens instructions and Escape returns to the editor', async ({ page }) => {
  await start(page);
  await searchInstall(page);
  await expect(page.getByRole('option', { name: 'Install app…', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Install app…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Command search' }).press('Enter');
  await expect(installDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(installDialog(page)).toBeHidden();
});

test('manual iOS banner opens instructions and its dismissal survives reload', async ({ page }, testInfo) => {
  test.skip(!['mobile-safari', 'ipad-safari', 'mobile-chrome-ios'].includes(testInfo.project.name), 'iOS manual install affordance');
  await start(page);
  await installBanner(page).getByRole('button', { name: 'Install', exact: true }).click();
  await expect(installDialog(page)).toContainText('Add to Home Screen');
  await installDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss install suggestion' }).click();
  await expect(installBanner(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
  await expect(installBanner(page)).toBeHidden();
  // Snoozing the passive banner must not disable the explicit Help action.
  await openInstallFromHelp(page);
  await expect(installDialog(page)).toBeVisible();
});

test('getting-started install row follows platform capability and opens the prompt or instructions', async ({ page, browserName }, testInfo) => {
  await start(page);
  const native = browserName === 'chromium';
  if (native) await capturePrompt(page, 'error');
  await openHelpLauncher(page);
  await page.getByRole('button', { name: 'Getting started', exact: true }).click();
  const checklist = page.getByRole('dialog', { name: 'Getting started', exact: true });
  await expect(checklist).toBeVisible();
  const row = checklist.getByRole('button', { name: 'Install the app — not started', exact: true });
  if (native || ['mobile-safari', 'ipad-safari', 'mobile-chrome-ios'].includes(testInfo.project.name)) {
    await row.click();
    await expect(checklist).toBeHidden();
    await expect(installDialog(page)).toBeVisible();
    if (native) await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '1');
  } else {
    await expect(row).toHaveCount(0);
  }
});

test.describe('Chromium install API contract (synthetic browser events)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'beforeinstallprompt is a Chromium API');

  for (const outcome of ['accepted', 'dismissed', 'error'] as const) {
    test(`banner invokes the prompt once: ${outcome}`, async ({ page }) => {
      await start(page);
      expect(await capturePrompt(page, outcome)).toBe(true);
      await installBanner(page).getByRole('button', { name: 'Install', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '1');
      await expect(page.locator('html')).toHaveAttribute('data-install-user-activation', 'true');
      await expect(installBanner(page)).toBeHidden();
      if (outcome === 'error') {
        await expect(installDialog(page)).toBeVisible();
        await installDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
      } else {
        await expect(installDialog(page)).toBeHidden();
      }
      // Accepted/dismissed/error all consume the single-use event. A second
      // attempt must use instructions and never invoke the stale event again.
      await openInstallFromHelp(page);
      await expect(installDialog(page)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '1');
    });
  }

  test('appinstalled removes install actions and the captured event', async ({ page }) => {
    await start(page);
    await capturePrompt(page);
    await expect(installBanner(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(installBanner(page)).toBeHidden();
    await openHelp(page);
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Help', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await searchInstall(page);
    await expect(page.getByRole('option', { name: 'Install app…', exact: true })).toHaveCount(0);
  });

  test('captured prompt never survives a page reload', async ({ page }) => {
    await start(page);
    await capturePrompt(page);
    await expect(installBanner(page)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
    await expect(installBanner(page)).toBeHidden();
    await openInstallFromHelp(page);
    await expect(installDialog(page)).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-install-prompt-calls');
  });
});

for (const mode of ['display-mode', 'ios-standalone'] as const) {
  test(`installed startup hides install actions (${mode})`, async ({ page }) => {
    await page.addInitScript(mode => {
      if (mode === 'ios-standalone') {
        Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      } else {
        const matchMedia = window.matchMedia.bind(window);
        window.matchMedia = query => {
          const result = matchMedia(query);
          if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true });
          return result;
        };
      }
    }, mode);
    await start(page);
    await expect(installBanner(page)).toBeHidden();
    await openHelp(page);
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Help', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await searchInstall(page);
    await expect(page.getByRole('option', { name: 'Install app…', exact: true })).toHaveCount(0);
  });
}

test('production manifest, icons, and service worker are available', async ({ page, request }) => {
  await start(page);
  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestURL).toBeTruthy();
  const response = await request.get(manifestURL!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ display: 'standalone', scope: '/', start_url: '/' });
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((icon: { sizes: string }) => icon.sizes === size);
    expect(icon).toBeTruthy();
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
    expect((await image.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state;
  })).toBe('activated');
});
