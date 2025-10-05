// e2e/extension.spec.js

const { test, expect, chromium } = require('playwright/test');
const path = require('path');
const { exec } = require('child_process');

const extensionPath = path.join(__dirname, '..');

const MOCK_RATES = {
  result: "success",
  rates: { "USD": 1, "JPY": 150.0, "EUR": 0.92, "GBP": 0.78 }
};

test.describe('Currency Converter E2E Test with Playwright', () => {
  let browserContext;
  let extensionId;
  let page;
  let serverProcess;

  // --- SETUP: Runs ONCE before all tests ---
  test.beforeAll(async () => {
    serverProcess = exec('npm run serve:e2e');
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    page = await browserContext.newPage();
    const backgroundPage = browserContext.serviceWorkers().length
      ? browserContext.serviceWorkers()[0]
      : await browserContext.waitForEvent('serviceworker');
    extensionId = backgroundPage.url().split('/')[2];
  });

  // --- RESET & MOCK: Runs before EACH test to ensure isolation ---
  test.beforeEach(async () => {
    // Reset the extension's storage to a clean state
    const backgroundPage = browserContext.serviceWorkers()[0];
    await backgroundPage.evaluate(() => {
      chrome.storage.sync.clear();
      chrome.storage.sync.set({
        isActive: false, fromCurrency: 'auto', toCurrency: 'JPY', cardIssuer: 'none'
      });
    });

    // Mock the API for every test
    await browserContext.route('https://open.er-api.com/v6/latest/USD', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RATES) });
    });
  });

  // --- CLEANUP: Runs ONCE after all tests ---
  test.afterAll(async () => {
    await browserContext.close();
    serverProcess.kill();
  });

  // --- TEST CASE 1: "Happy Path" ---
  test('should convert prices when enabled', async () => {
    const popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.locator('#toggleConversion').click();
    await popupPage.close();

    await page.goto('http://localhost:8888/test-page.html');
    const priceElement = page.locator('p', { hasText: '$10.00' });
    await expect(priceElement).toContainText('(¥1,500)');
  });

  // --- TEST CASE 2: Disabling the conversion ---
  test('should restore original prices when disabled', async () => {
    // First, enable and verify conversion
    let popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.locator('#toggleConversion').click();
    await popupPage.close();
    
    await page.goto('http://localhost:8888/test-page.html');
    const priceElement = page.locator('p', { hasText: '$10.00' });
    await expect(priceElement).toContainText('(¥1,500)');

    // Now, open the popup again and disable the conversion
    popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.locator('#toggleConversion').click();
    await popupPage.close();

    // Reload the page to force it to read the new "disabled" state
    await page.reload();

    await expect(priceElement).not.toContainText('(¥1,500)');
    await expect(priceElement).toHaveText('Price: $10.00');
  });

  // --- TEST CASE 3 (Previously 4): Changing the target currency ---
  test('should update prices when the target currency is changed', async () => {
    // Enable conversion to JPY first
    let popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.locator('#toggleConversion').click();
    await popupPage.close();

    await page.goto('http://localhost:8888/test-page.html');
    const priceElement = page.locator('p', { hasText: '$10.00' });
    await expect(priceElement).toContainText('(¥1,500)');

    // Now, open the popup again and change the currency to EUR
    popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.selectOption('#toCurrency', 'EUR');
    await popupPage.close();
    
    // Reload the page to apply the new setting
    await page.reload();

    // Verify the new EUR conversion (10 * 0.92 = 9.2, which rounds to 9)
    await expect(priceElement).toContainText('(€9)');
  });
});