'use strict';

// Checks "clean automatically when the browser closes" against a real install.
//
// Automated loads never get runtime.onStartup, so this test needs Sweep
// installed by hand, once, in a dedicated test profile (kept in
// sweep/.test-profiles, separate from your own browser data):
//
//   node tests/e2e/installed.js open chrome     opens the test profile with the "Load unpacked"
//                                                folder dialog showing; pick sweep/dist/chromium
//   node tests/e2e/installed.js check chrome    turns auto-clean on, visits test sites, closes the
//                                                browser, reopens it, and looks at what is left
//
// Works for brave, chrome and edge.
//
// Firefox only installs signed add-ons permanently, so it has no "open" step:
//
//   .sign-firefox.ps1                          gets sweep/signed/*.xpi from Mozilla (once per version)
//   node tests/e2e/installed.js check firefox    installs that .xpi in the test profile if needed,
//                                                then runs the same close-and-reopen check
//
// Test sites are answered locally; nothing goes to the network.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, BROWSERS } = require('./browsers');
const launchChromium = require('./chromium');
const launchFirefox = require('./firefox');
const { SITES, seed, storageOf, cookiesFor, noStorage, saveSettings, usePopup } = require('./scenario');
const { sleep } = require('./site');

const [, , command, name] = process.argv;
const browser = BROWSERS[name];
if (!['open', 'check'].includes(command) || !browser || (name === 'firefox' && command === 'open')) {
  console.error('Usage: node tests/e2e/installed.js open <brave|chrome|edge>');
  console.error('       node tests/e2e/installed.js check <brave|chrome|edge|firefox>');
  process.exit(2);
}
const exe = browser.exe();
if (!exe) {
  console.error(`${name} is not installed.`);
  process.exit(2);
}
const profileDir = path.join(ROOT, '.test-profiles', name);

// A port per browser, so two test profiles can be open for installing at once.
const INSTALL_PORT = { brave: 9371, chrome: 9372, edge: 9373 }[name];

// A minimal DevTools connection to a browser that is already running.
async function connect(port, tries) {
  let info;
  for (let i = 0; i < tries && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(500); }
  }
  if (!info) return null;
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed.')); });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
  };
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('closed')); pending.clear(); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('closed')); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { send, close: () => ws.close() };
}

// Opens the test profile on its extensions page with developer mode on and the
// "Load unpacked" folder dialog already showing. Picking the folder is the one
// step only a person can do.
async function open() {
  spawn(exe, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${INSTALL_PORT}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: 'ignore', detached: true }).unref();
  const cdp = await connect(INSTALL_PORT, 60);
  if (!cdp) throw new Error('The browser did not start (is this test profile already open?).');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome://extensions/' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(1500);
  const evaluate = (expression, awaitPromise) => cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, sessionId);
  await evaluate(`chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })`, true);
  const installed = await evaluate(`chrome.developerPrivate.getExtensionsInfo().then((list) => list.some((e) => e.name === 'Sweep' && e.location === 'UNPACKED'))`, true);
  if (installed.result?.value) {
    console.log(`${name}: Sweep is already installed in the test profile. Close the window and run "check".`);
  } else {
    await evaluate(`void chrome.developerPrivate.loadUnpacked({ failQuietly: true }).catch(() => {})`, false);
    console.log(`${name}: a folder dialog is open. Choose ${path.join(ROOT, 'dist', 'chromium')}`);
  }
  cdp.close();
}

// Closes the test profile if "open" left it running.
async function closeIfOpen() {
  const cdp = await connect(INSTALL_PORT, 1);
  if (!cdp) return;
  await cdp.send('Browser.close').catch(() => {});
  await sleep(4000);
}

// Cookies for the test sites straight from the profile's cookie database.
// Only readable while the browser is closed.
function cookiesOnDisk() {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(profileDir, 'Default', 'Network', 'Cookies');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(`SELECT host_key, name FROM cookies WHERE host_key LIKE '%.test'`).all().map((row) => `${row.host_key}:${row.name}`).sort();
  } finally {
    db.close();
  }
}

async function check() {
  const results = [];
  const record = (title, pass, detail = '') => {
    results.push(Boolean(pass));
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${title}${detail ? `  -> ${detail}` : ''}`);
  };
  const note = (text) => console.log(`  NOTE  ${text}`);
  const start = () => launchChromium({ exe, profileDir, preinstalled: true });

  await closeIfOpen();
  let d = await start();
  console.log(`\n${name}: ${d.label}, Sweep installed as ${d.extensionId}`);

  // --- arrange: auto-clean on, everything ticked, test data present ---
  const saved = await saveSettings(d, { whitelist: 'keep.test', autoClean: true, keepWhatsApp: false, keepTelegram: false });
  record('auto-clean switched on in settings', saved.stored.autoClean === true && !saved.isError, saved.status);
  await usePopup(d, { range: 'all', tickAll: true, run: false });
  await seed(d, SITES);
  let cookies = await d.cookies();
  const history = await d.liveHistory();
  record('before closing: test cookies, storage and history are present', cookies.length === 5 && history.includes('tracker.test'), cookies.join(' '));

  // --- act: close the browser ---
  await d.quit();
  await sleep(3000);
  try {
    const onDisk = cookiesOnDisk();
    const cleanedAtClose = cookiesFor(onDisk, 'tracker.test').length === 0;
    note(cleanedAtClose
      ? 'while closed: tracker.test cookies are already gone from disk (the window-close pass finished)'
      : `while closed: tracker.test cookies are still on disk (${cookiesFor(onDisk, 'tracker.test').length}); the window-close pass did not finish`);
  } catch (error) {
    note(`while closed: could not read the cookie database (${error.message})`);
  }

  // --- assert: reopen and look, without touching the extension ---
  d = await start();
  await sleep(8000);
  cookies = await d.cookies();
  record('after reopening: tracker.test cookies were removed by the startup pass', cookiesFor(cookies, 'tracker.test').length === 0, cookies.join(' '));
  record('after reopening: whitelisted keep.test cookies were kept', cookiesFor(cookies, 'keep.test').length === 3, cookies.join(' '));
  const after = await d.liveHistory();
  record('after reopening: history was emptied', !after.includes('tracker.test') && !after.includes('keep.test'));
  const tracker = await storageOf(d, 'tracker.test');
  record('after reopening: tracker.test storage was removed', noStorage(tracker), JSON.stringify(tracker));
  await d.quit();

  const passed = results.filter(Boolean).length;
  console.log(`\n${name}: ${passed}/${results.length} passed`);
  return passed === results.length;
}

// The same check for Firefox, with the signed .xpi installed permanently.
async function checkFirefox() {
  const results = [];
  const record = (title, pass, detail = '') => {
    results.push(Boolean(pass));
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${title}${detail ? `  -> ${detail}` : ''}`);
  };
  const note = (text) => console.log(`  NOTE  ${text}`);

  const alreadyInstalled = fs.existsSync(path.join(profileDir, 'extensions', 'sweep@personal.local.xpi'));
  let xpi;
  if (!alreadyInstalled) {
    const signedDir = path.join(ROOT, 'signed');
    const files = fs.existsSync(signedDir) ? fs.readdirSync(signedDir).filter((f) => f.endsWith('.xpi')).map((f) => path.join(signedDir, f)) : [];
    if (!files.length) throw new Error('No signed .xpi in sweep/signed. Run sign-firefox.ps1 first.');
    xpi = files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop();
  }
  fs.mkdirSync(profileDir, { recursive: true });

  const d = await launchFirefox({ exe, extDir: xpi, profileDir, install: alreadyInstalled ? 'preinstalled' : 'permanent' });
  console.log(`
${name}: ${d.label}, ${alreadyInstalled ? 'Sweep already installed in the test profile' : `installed ${path.basename(xpi)} permanently`}`);
  try {
    record('the signed add-on is installed as a permanent add-on', fs.existsSync(path.join(profileDir, 'extensions', 'sweep@personal.local.xpi')));

    // --- arrange: auto-clean on, everything ticked, test data present ---
    const saved = await saveSettings(d, { whitelist: 'keep.test', autoClean: true });
    record('auto-clean switched on in settings', saved.stored.autoClean === true && !saved.isError && saved.permitted === true, saved.status);
    await usePopup(d, { range: 'all', tickAll: true, run: false });
    await seed(d, SITES);
    let cookies = await d.cookies();
    record('before closing: test cookies are present', cookies.length === 5, cookies.join(' '));

    // --- act: close the browser ---
    await d.stop();
    const historyBefore = d.historyUrls();
    record('before reopening: visits to the test sites are in the history', historyBefore.some((u) => u.includes('tracker.test')), `${historyBefore.length} urls`);
    try {
      const onDisk = d.cookiesOnDisk();
      const left = cookiesFor(onDisk, 'tracker.test').length;
      note(left === 0
        ? 'while closed: tracker.test cookies are already gone from disk (the window-close pass finished)'
        : `while closed: tracker.test cookies are still on disk (${left}); the window-close pass did not finish`);
    } catch (error) {
      note(`while closed: could not read the cookie database (${error.message})`);
    }

    // --- assert: reopen and look, without touching the extension ---
    await d.start();
    await sleep(8000);
    cookies = await d.cookies();
    record('after reopening: tracker.test cookies were removed by the startup pass', cookiesFor(cookies, 'tracker.test').length === 0, cookies.join(' '));
    record('after reopening: whitelisted keep.test cookies were kept', cookiesFor(cookies, 'keep.test').length === 3, cookies.join(' '));
    const tracker = await storageOf(d, 'tracker.test');
    record('after reopening: tracker.test storage was removed', noStorage(tracker), JSON.stringify(tracker));
    await d.stop();
    // The storage check above visited tracker.test once more, so only the earlier visits count.
    const historyAfter = d.historyUrls().filter((u) => !u.endsWith('/read'));
    record('after reopening: history was emptied', historyAfter.length === 0, historyAfter.join(' '));
  } finally {
    await d.quit().catch(() => {});
  }

  const passed = results.filter(Boolean).length;
  console.log(`
${name}: ${passed}/${results.length} passed`);
  return passed === results.length;
}

if (command === 'open') {
  open().then(
    () => process.exit(0),
    (error) => { console.error(`${name}: ${error.message}`); process.exit(1); },
  );
} else {
  (name === 'firefox' ? checkFirefox() : check()).then(
    (ok) => process.exit(ok ? 0 : 1),
    (error) => { console.error(`\n${name}: ${error.message}`); process.exit(1); },
  );
}
