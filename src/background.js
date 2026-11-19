'use strict';

// Chromium runs this file as a service worker and must pull in clean.js itself.
// Firefox runs it as an event page and lists clean.js in the manifest instead.
if (typeof importScripts === 'function') importScripts('clean.js');

const { api } = Sweep;

// Extensions get no reliable "browser is closing" event, so auto-clean runs
// twice: a best-effort pass when the last window closes (the browser may exit
// before it finishes), and a guaranteed pass on the next startup.
async function autoClean() {
  try {
    const settings = await Sweep.loadSettings();
    if (settings.autoClean) await Sweep.clean(settings, { allTime: true });
  } catch (error) {
    console.warn('Sweep auto-clean failed:', error);
  }
}

api.runtime.onStartup.addListener(autoClean);

api.windows.onRemoved.addListener(async () => {
  const windows = await api.windows.getAll();
  if (windows.length === 0) autoClean();
});

// The popup asks the background to clean, so closing the popup mid-way does
// not interrupt the work.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== api.runtime.id) return undefined;
  // Pages ask which build the background is from (see Sweep.ensureFresh).
  if (message?.type === 'build') {
    sendResponse(Sweep.BUILD);
    return undefined;
  }
  if (message?.type !== 'clean') return undefined;
  Sweep.loadSettings()
    .then((settings) => Sweep.clean(settings))
    .then(
      (cleaned) => sendResponse({ ok: true, cleaned }),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) }),
    );
  return true;
});
