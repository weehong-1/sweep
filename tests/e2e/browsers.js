'use strict';

// Where each supported browser lives, and which build of the extension it takes.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const env = process.env;
const firstExisting = (candidates) => candidates.filter(Boolean).find((p) => fs.existsSync(p));

const pf = env.ProgramFiles;
const pf86 = env['ProgramFiles(x86)'];
const local = env.LOCALAPPDATA;
const win = (base, ...parts) => base && path.join(base, ...parts);
const chromiumTarget = (candidates) => ({
  launch: require('./chromium'),
  extDir: path.join(ROOT, 'dist', 'chromium'),
  exe: () => firstExisting(candidates),
});

const BROWSERS = {
  brave: chromiumTarget([
    env.SWEEP_BRAVE,
    win(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    win(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/brave-browser',
  ]),
  chrome: chromiumTarget([
    env.SWEEP_CHROME,
    win(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    win(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    win(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ]),
  edge: chromiumTarget([
    env.SWEEP_EDGE,
    win(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    win(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]),
  firefox: {
    launch: require('./firefox'),
    extDir: path.join(ROOT, 'dist', 'firefox'),
    exe: () => firstExisting([
      env.SWEEP_FIREFOX,
      win(pf, 'Mozilla Firefox', 'firefox.exe'),
      win(local, 'Mozilla Firefox', 'firefox.exe'),
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      '/usr/bin/firefox',
    ]),
  },
};

// "chromium" means every Chromium browser that is installed.
const GROUPS = { chromium: ['brave', 'chrome', 'edge'] };

module.exports = { ROOT, BROWSERS, GROUPS };
