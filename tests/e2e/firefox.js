'use strict';

// Driver for Firefox over WebDriver BiDi. The extension is installed as a
// temporary add-on into a throwaway profile. Test sites are host names the
// profile maps to this machine, served by a local HTTP server.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { HOSTS, sitePage, sleep } = require('./site');

const BIDI_PORT = 9352;
const WEB_PORT = 8377;
const UUID = '11111111-2222-4333-8444-555555555555';
const BASE = `moz-extension://${UUID}/`;

const PREFS = {
  // A fixed internal id so the extension's page URLs are known in advance.
  'extensions.webextensions.uuids': JSON.stringify({ 'sweep@personal.local': UUID }),
  // Keep settings across the restart in the middle of the scenario.
  'extensions.webextensions.keepStorageOnUninstall': true,
  'extensions.webextensions.keepUuidOnUninstall': true,
  // Accept the optional cookie permission prompt automatically.
  'extensions.webextOptionalPermissionPrompts': false,
  'network.dns.localDomains': HOSTS.join(','),
  'dom.security.https_first': false,
  'dom.security.https_only_mode': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.aboutwelcome.enabled': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'startup.homepage_welcome_url': 'about:blank',
  'datareporting.policy.dataSubmissionEnabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.sessionstore.resume_from_crash': false,
  'browser.tabs.warnOnClose': false,
  'browser.warnOnQuit': false,
};

// `install` says how Sweep gets into the profile:
//   "temporary"    load the unpacked folder `extDir` on every start (the default; gone on restart)
//   "permanent"    install the signed .xpi at `extDir` once; it then survives restarts, which is
//                  the only setup where runtime.onStartup really fires
//   "preinstalled" the profile already has it; just attach
module.exports = async function launchFirefox({ exe, extDir, profileDir, install = 'temporary' }) {
  let installedPermanently = false;
  fs.writeFileSync(
    path.join(profileDir, 'user.js'),
    Object.entries(PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'),
  );

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(sitePage((req.headers.host || '').split(':')[0]));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(WEB_PORT, resolve); });

  let send;
  let exited;
  let chrome; // the browser UI's own context, used to open extension pages
  let version = '';

  async function start() {
    // System access lets the test open moz-extension:// tabs, which BiDi otherwise refuses to navigate to.
    const proc = spawn(exe, ['-profile', profileDir, '-no-remote', '-wait-for-browser', '--remote-debugging-port', String(BIDI_PORT), 'about:blank'],
      { stdio: 'ignore', env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
    exited = new Promise((resolve) => proc.on('exit', resolve));
    running = true;

    let ws;
    for (let i = 0; i < 120 && !ws; i++) {
      try {
        ws = await new Promise((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${BIDI_PORT}/session`);
          socket.onopen = () => resolve(socket);
          socket.onerror = () => reject(new Error('not ready'));
        });
      } catch { await sleep(500); }
    }
    if (!ws) throw new Error('Firefox did not open its remote-control port.');

    let seq = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(`${m.error}: ${m.message}`)); else p.resolve(m.result);
    };
    ws.onclose = () => {
      for (const p of pending.values()) p.reject(new Error('The browser connection closed.'));
      pending.clear();
    };
    send = (method, params = {}) => new Promise((resolve, reject) => {
      // A closed socket drops messages silently; fail instead of waiting forever.
      if (ws.readyState !== WebSocket.OPEN) { reject(new Error('The browser connection is closed.')); return; }
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const session = await send('session.new', { capabilities: {} });
    version = session.capabilities?.browserVersion || '';
    if (install === 'temporary') {
      await send('webExtension.install', { extensionData: { type: 'path', path: extDir } });
    } else if (install === 'permanent' && !installedPermanently) {
      await send('webExtension.install', { extensionData: { type: 'archivePath', path: extDir }, 'moz:permanent': true });
      installedPermanently = true;
    }
    await sleep(1500);
    chrome = (await send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts[0].context;
  }

  let running = false;

  // Safe to call more than once.
  async function stop() {
    if (!running) return;
    running = false;
    await Promise.race([send('browser.close').catch(() => {}), sleep(5000)]);
    await Promise.race([exited, sleep(15000)]);
    await sleep(1500); // let Firefox release the profile's database files
  }

  // Only readable while Firefox is closed.
  function historyUrls() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(profileDir, 'places.sqlite'), { readOnly: true });
    try {
      const like = HOSTS.map((h) => `url LIKE '%${h.split('.').slice(-2).join('.')}%'`).join(' OR ');
      return db.prepare(`SELECT url FROM moz_places WHERE visit_count > 0 AND (${like})`).all().map((row) => row.url);
    } finally {
      db.close();
    }
  }

  // Cookies for the test sites straight from the profile. Only readable while Firefox is closed.
  function cookiesOnDisk() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(profileDir, 'cookies.sqlite'), { readOnly: true });
    try {
      const like = HOSTS.map((h) => `host LIKE '%${h.split('.').slice(-2).join('.')}'`).join(' OR ');
      return db.prepare(`SELECT host, name FROM moz_cookies WHERE ${like}`).all().map((row) => `${row.host}:${row.name}`).sort();
    } finally {
      db.close();
    }
  }

  async function open(url) {
    let context;
    if (url.startsWith('moz-extension:')) {
      const before = new Set((await send('browsingContext.getTree', {})).contexts.map((c) => c.context));
      const opened = await send('script.evaluate', {
        expression: `(() => { const tab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); gBrowser.selectedTab = tab; })()`,
        target: { context: chrome }, awaitPromise: false,
      });
      if (opened.type !== 'success') throw new Error('Could not open an extension tab.');
      for (let i = 0; i < 40 && !context; i++) {
        await sleep(250);
        context = (await send('browsingContext.getTree', {})).contexts.find((c) => !before.has(c.context) && c.url === url)?.context;
      }
      if (!context) throw new Error('Extension page did not load: ' + url);
      await sleep(600); // extension pages render after an async settings read
    } else {
      ({ context } = await send('browsingContext.create', { type: 'tab' }));
      await send('browsingContext.navigate', { context, url, wait: 'complete' });
    }

    const page = {
      async eval(expression) {
        const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context }, awaitPromise: true });
        if (r.type !== 'success') throw new Error(r.exceptionDetails?.text || JSON.stringify(r));
        return r.result.type === 'string' ? JSON.parse(r.result.value) : undefined;
      },
      // A real pointer click, so Firefox treats it as user input (needed for permissions.request).
      async click(selector) {
        const point = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
        await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
          { type: 'pointerMove', x: point.x, y: point.y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
        await send('input.releaseActions', { context });
      },
      close: () => send('browsingContext.close', { context }),
    };
    return page;
  }

  try {
    await start();
  } catch (error) {
    server.close();
    throw error;
  }

  return {
    name: 'firefox',
    label: `Firefox/${version}`,
    isFirefox: true,
    errors: [],
    // For tests that close and reopen the browser themselves.
    stop,
    start,
    historyUrls,
    cookiesOnDisk,
    openExt: (file) => open(BASE + file),

    async openSite(host, pathname) {
      const page = await open(`http://${host}:${WEB_PORT}${pathname}`);
      for (let i = 0; i < 60; i++) {
        if (await page.eval(`document.title === 'ready'`).catch(() => false)) break;
        await sleep(150);
      }
      return page;
    },

    async cookies() {
      const { cookies } = await send('storage.getCookies', {});
      return cookies
        .filter((c) => HOSTS.some((h) => c.domain.replace(/^\./, '').endsWith(h.split('.').slice(-2).join('.'))))
        .map((c) => `${c.domain}:${c.name}`).sort();
    },

    // Runs the background script's startup handler through the event page.
    async autoClean() {
      const page = await open(BASE + 'options.html');
      await page.eval(`browser.runtime.getBackgroundPage().then((bg) => bg.autoClean()).then(() => true)`);
      await page.close();
    },

    // Closes Firefox, reads the history database, and starts Firefox again
    // (the temporary add-on is reinstalled; its settings are kept).
    async restartAndReadHistory() {
      await stop();
      const urls = historyUrls();
      await start();
      return urls;
    },

    async quitAndReadHistory() {
      await stop();
      server.close();
      return historyUrls();
    },

    async quit() {
      await stop();
      server.close();
    },
  };
};
