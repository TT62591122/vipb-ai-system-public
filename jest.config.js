/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 15000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  globalSetup: './tests/setup.js',
  globalTeardown: './tests/teardown.js',
};
