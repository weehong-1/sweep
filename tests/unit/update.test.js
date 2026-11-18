'use strict';

// Unit tests for the pure parts of src/update.js: reading each browser maker's
// release list and deciding whether a version is newer. Run with `node --test`.
// The payloads are trimmed copies of real responses.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../src/update.js');
const { SOURCES, compareVersions, chromePlatform, isNewer } = globalThis.SweepUpdate;

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('158.0.8127.37', '157.0.8103.51'), 1);
  assert.equal(compareVersions('157.0.8103.51', '157.0.8103.79'), -1);
  assert.equal(compareVersions('157.0.8103.9', '157.0.8103.10'), -1);
  assert.equal(compareVersions('160.0.1', '160.0.1'), 0);
  assert.equal(compareVersions('160.0', '160.0.1'), -1);
  assert.equal(compareVersions('161.0', '160.0.1'), 1);
});

test('chromePlatform maps the platform info to a release list', () => {
  assert.equal(chromePlatform({ os: 'win', arch: 'x86-64' }), 'win64');
  assert.equal(chromePlatform({ os: 'win', arch: 'x86-32' }), 'win');
  assert.equal(chromePlatform({ os: 'win', arch: 'arm64' }), 'win_arm64');
  assert.equal(chromePlatform({ os: 'mac', arch: 'arm64' }), 'mac_arm64');
  assert.equal(chromePlatform({ os: 'mac', arch: 'x86-64' }), 'mac');
  assert.equal(chromePlatform({ os: 'linux', arch: 'x86-64' }), 'linux');
  assert.equal(chromePlatform({ os: 'cros', arch: 'x86-64' }), null);
});

test('Chrome: newest release that has reached everyone', () => {
  const json = { releases: [
    { version: '158.0.8127.37', fraction: 1 },
    { version: '158.0.8127.37', fraction: 0 },
    { version: '158.0.8127.36', fraction: 0.1 },
    { version: '157.0.8103.80', fraction: 0.1 },
    { version: '157.0.8103.79', fraction: 0.8 },
  ] };
  assert.deepEqual(SOURCES.chrome.parse(json), { version: '158.0.8127.37', display: '158.0.8127.37' });
});

test('Chrome: a release still rolling out is not announced', () => {
  const json = { releases: [
    { version: '159.0.8200.10', fraction: 0.25 },
    { version: '158.0.8127.37', fraction: 1 },
  ] };
  assert.equal(SOURCES.chrome.parse(json).version, '158.0.8127.37');
  assert.equal(SOURCES.chrome.parse({ releases: [{ version: '159.0.8200.10', fraction: 0.25 }] }), null);
  assert.equal(SOURCES.chrome.parse({}), null);
});

test('Chrome: any newer version counts as an update', () => {
  assert.equal(isNewer(SOURCES.chrome, '157.0.8103.51', '158.0.8127.37'), true);
  assert.equal(isNewer(SOURCES.chrome, '157.0.8103.51', '157.0.8103.79'), true);
  assert.equal(isNewer(SOURCES.chrome, '158.0.8127.37', '158.0.8127.37'), false);
  assert.equal(isNewer(SOURCES.chrome, '158.0.8127.37', '157.0.8103.79'), false);
});

test('Brave: Chromium version and Brave version from the release name', () => {
  const json = { tag_name: 'v1.99.57', name: 'Release v1.99.57 (Chromium 157.0.8103.79) ' };
  assert.deepEqual(SOURCES.brave.parse(json), { version: '157.0.8103.79', display: '1.99.57 (Chromium 157)' });
  assert.deepEqual(SOURCES.brave.parse({ name: 'Release (Chromium 158.0.8127.37)' }), { version: '158.0.8127.37', display: 'Chromium 158' });
  assert.equal(SOURCES.brave.parse({ tag_name: 'v1.99.57', name: 'Release v1.99.57' }), null);
});

test('Brave: only a new major version counts, because Brave reports 157.0.0.0', () => {
  assert.equal(isNewer(SOURCES.brave, '157.0.0.0', '157.0.8103.79'), false);
  assert.equal(isNewer(SOURCES.brave, '157.0.0.0', '158.0.8127.37'), true);
  assert.equal(isNewer(SOURCES.brave, '158.0.0.0', '157.0.8103.79'), false);
});

test('Firefox: latest release version', () => {
  const json = { FIREFOX_ESR: '153.7.0esr', LATEST_FIREFOX_DEVEL_VERSION: '161.0b4', LATEST_FIREFOX_VERSION: '160.0.1' };
  assert.deepEqual(SOURCES.firefox.parse(json), { version: '160.0.1', display: '160.0.1' });
  assert.equal(SOURCES.firefox.parse({}), null);
  assert.equal(isNewer(SOURCES.firefox, '160.0.1', '160.0.1'), false);
  assert.equal(isNewer(SOURCES.firefox, '160.0', '160.0.1'), true);
  assert.equal(isNewer(SOURCES.firefox, '160.0.1', '161.0'), true);
});
