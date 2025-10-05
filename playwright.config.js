// playwright.config.js

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  // Tell Playwright to only look for test files in the 'e2e' directory.
  testDir: './e2e',

  // Optional: A bit more time for each test to run, good for extensions.
  timeout: 60 * 1000, 
});