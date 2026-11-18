'use strict';

// Driver for Chromium browsers (Brave, Chrome, Edge) over the DevTools protocol.
// The extension is loaded unpacked into a throwaway profile. Test sites are
// https:// origins answered by request interception, so nothing reaches the network.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { HOSTS, sitePage, sleep } = require('./site');

const PORT = 9351;

// With `preinstalled`, nothing is loaded: the profile must already have Sweep
// installed through "Load unpacked", and the driver only attaches to it. That
// is the one setup where runtime.onStartup really fires.
module.exports = async function launchChromium({ exe, extDir, profileDir, preinstalled = false }) {
  // Google Chrome no longer honours --load-extension, so the extension is loaded
  // with the DevTools command Extensions.loadUnpacked. That command only exists
  // on the pipe transport, so the browser gets a pipe (fds 3 and 4) for loading
  // and the usual port for everything else.
  const common = [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check'];
  let proc;
  if (preinstalled) {
    proc = spawn(exe, [...common, 'about:blank'], { stdio: 'ignore' });
  } else {
    fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
    proc = spawn(exe, [...common, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    proc.stdio[3].on('error', () => {});
    proc.stdio[4].on('error', () => {});
  }
  const exited = new Promise((resolve) => proc.on('exit', resolve));

  // One command over the pipe: messages are JSON terminated by a NUL byte.
  const pipeCommand = (method, params) => new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`${method} timed out.`)), 20000);
    proc.stdio[4].on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id !== 1) continue;
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      }
    });
    proc.stdio[3].write(JSON.stringify({ id: 1, method, params }) + '\0');
  });

  let info;
  for (let i = 0; i < 60 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(500); }
  }
  if (!info) throw new Error('The browser did not open its debugging port.');

  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed.')); });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    // A closed socket drops messages silently; fail instead of waiting forever.
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('The browser connection is closed.')); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('The browser connection closed.'));
    pending.clear();
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method === 'Fetch.requestPaused') {
      const host = new URL(m.params.request.url).host;
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(sitePage(host)).toString('base64'),
      }, m.sessionId).catch(() => {});
    } else if (m.method === 'Runtime.exceptionThrown' && (m.params.exceptionDetails.url || '').startsWith('chrome-extension:')) {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };

  // Looks Sweep up on the browser's own extensions page.
  const findInstalled = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'chrome://extensions/' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await sleep(1500);
    const r = await send('Runtime.evaluate', {
      expression: `chrome.developerPrivate.getExtensionsInfo().then((list) => JSON.stringify(list.filter((e) => e.name === 'Sweep').map((e) => ({ id: e.id, location: e.location, state: e.state }))))`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    await send('Target.closeTarget', { targetId });
    return JSON.parse(r.result?.value || '[]');
  };

  let extensionId;
  try {
    if (preinstalled) {
      const found = await findInstalled();
      const usable = found.find((e) => e.location === 'UNPACKED' && e.state === 'ENABLED');
      if (!usable) {
        throw new Error(found.length ? `Sweep is in this profile but not usable: ${JSON.stringify(found)}` : 'Sweep is not installed in this profile.');
      }
      extensionId = usable.id;
    } else {
      ({ id: extensionId } = await pipeCommand('Extensions.loadUnpacked', { path: extDir }));
    }
  } catch (error) {
    await send('Browser.close').catch(() => {});
    throw new Error(preinstalled ? error.message : `The extension could not be loaded: ${error.message}`);
  }
  const base = `chrome-extension://${extensionId}/`;

  // The extension's own background worker (browsers ship workers of their own).
  const findWorker = async (tries) => {
    for (let i = 0; i < tries; i++) {
      const { targetInfos } = await send('Target.getTargets');
      const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url === base + 'background.js');
      if (worker) return worker;
      await sleep(500);
    }
    return null;
  };
  // An installed extension's worker may simply be idle; a freshly loaded one must start.
  if (!preinstalled && !(await findWorker(30))) {
    await send('Browser.close').catch(() => {});
    throw new Error('The extension loaded but its background service worker did not start.');
  }

  async function open(url, { site = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    await s('Runtime.enable');
    if (site) await s('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await s('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url });

    const page = {
      // Evaluates an expression (may be a promise) and returns its JSON-serialisable value.
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
      },
      // A real mouse click at the centre of the element.
      async click(selector) {
        const point = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
        await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
        await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      },
      close: () => send('Target.closeTarget', { targetId }),
    };

    const ready = site ? `document.title === 'ready'` : `document.readyState === 'complete'`;
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if (await page.eval(ready).catch(() => false)) break;
    }
    if (!site) await sleep(350); // extension pages render after an async settings read
    return page;
  }

  return {
    name: 'chromium',
    label: info.Browser,
    isFirefox: false,
    extensionId,
    errors,
    openExt: (file) => open(base + file),
    openSite: (host, path) => open(`https://${host}${path}`, { site: true }),

    async cookies() {
      const { cookies } = await send('Storage.getCookies');
      return cookies
        .filter((c) => HOSTS.some((h) => c.domain.replace(/^\./, '').endsWith(h.split('.').slice(-2).join('.'))))
        .map((c) => `${c.domain}:${c.name}`).sort();
    },

    // All text on the browser's own history page, shadow DOM included.
    async liveHistory() {
      const page = await open('chrome://history/');
      await sleep(2500);
      const text = await page.eval(`(() => { let s = ''; const walk = (n) => { if (n.nodeType === 3) s += n.textContent + ' '; if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.childNodes) walk(c); }; walk(document); return s; })()`);
      await page.close();
      return text;
    },

    // Runs the background script's startup handler. The service worker may have
    // gone idle, so wake it with a message first.
    async autoClean() {
      const page = await open(base + 'options.html');
      await page.eval(`chrome.runtime.sendMessage({ type: 'wake' }).then(() => null, () => null)`);
      const worker = await findWorker(20);
      if (!worker) throw new Error('Background service worker did not start.');
      const { sessionId } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
      const r = await send('Runtime.evaluate', { expression: 'autoClean()', awaitPromise: true }, sessionId);
      await page.close();
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    },

    // Safe to call more than once.
    async quit() {
      await Promise.race([send('Browser.close').catch(() => {}), sleep(5000)]);
      await Promise.race([exited, sleep(10000)]);
    },
  };
};
