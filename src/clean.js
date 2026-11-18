'use strict';

// Shared by the popup, the settings page and the background script.
// Exposes a single global, `Sweep`.
(() => {
  // Firefox exposes `browser`; Chromium (Chrome, Brave, Edge) exposes `chrome`.
  // Both return promises under Manifest V3.
  const api = globalThis.browser ?? globalThis.chrome;
  const IS_FIREFOX = typeof api.runtime.getBrowserInfo === 'function';

  // `on` is the first-run default.
  // `chromiumOnly`: Firefox has no such data type and silently ignores it.
  // `firefoxOnly`: Chromium ignores `passwords` since Chrome 144.
  // `chromiumExtra`: extra Chromium data types removed together with this one.
  // `fxAllTimeOnly`: in Firefox, localStorage rejects a time range, and
  //   indexedDB / serviceWorkers ignore it and delete everything. To avoid
  //   deleting more than was asked for, these are only offered for "all time".
  const TYPES = [
    { id: 'history', on: true },
    { id: 'downloads', on: true },
    { id: 'cache', on: true, chromiumExtra: ['cacheStorage'] },
    { id: 'formData', on: true },
    { id: 'cookies', on: false },
    { id: 'localStorage', on: false, fxAllTimeOnly: true },
    { id: 'indexedDB', on: true, fxAllTimeOnly: true },
    { id: 'serviceWorkers', on: false, fxAllTimeOnly: true },
    { id: 'fileSystems', on: true, chromiumOnly: true },
    { id: 'passwords', on: false, danger: true, firefoxOnly: true },
  ].filter((type) => !(IS_FIREFOX ? type.chromiumOnly : type.firefoxOnly));

  const HOUR = 60 * 60 * 1000;
  const RANGES = {
    hour: HOUR,
    day: 24 * HOUR,
    week: 7 * 24 * HOUR,
    month: 28 * 24 * HOUR,
    all: 0,
  };

  // Chromium data types that accept `excludeOrigins`. The HTTP cache accepts it
  // too, but the whitelist is about staying signed in, so the cache is always
  // cleared in full.
  const SITE_DATA = new Set([
    'cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'cacheStorage',
  ]);

  // WhatsApp Web and Telegram Web keep their session keys in IndexedDB and
  // local storage on these hosts; clearing them means signing in again.
  // Chromium can leave one origin out of a removal. Firefox cannot (its API
  // only takes a list of hosts to clear, and an extension cannot list every
  // host that has storage), so these options are Chromium-only.
  const KEEP_SITES = {
    keepWhatsApp: ['web.whatsapp.com'],
    keepTelegram: ['web.telegram.org'],
  };
  const KEEP_SITES_SUPPORTED = !IS_FIREFOX;

  // Firefox only: needed to list cookie hosts so whitelisted ones can be skipped.
  const COOKIE_PERMISSIONS = { permissions: ['cookies'], origins: ['<all_urls>'] };

  // `substitutions` fill $1, $2, ... in the message.
  const t = (key, substitutions) => api.i18n.getMessage(key, substitutions) || key;

  function isBlocked(type, range) {
    return IS_FIREFOX && Boolean(type.fxAllTimeOnly) && range !== 'all';
  }

  async function loadSettings() {
    const stored = await api.storage.local.get(['range', 'types', 'autoClean', 'updateCheck', 'whitelist', 'useWhitelist', ...Object.keys(KEEP_SITES)]);
    const types = {};
    for (const type of TYPES) {
      const saved = stored.types?.[type.id];
      types[type.id] = typeof saved === 'boolean' ? saved : type.on;
    }
    const whitelist = Array.isArray(stored.whitelist) ? stored.whitelist : [];
    return {
      range: stored.range in RANGES ? stored.range : 'all',
      types,
      autoClean: stored.autoClean === true,
      // Off unless asked for: it is the only feature that uses the network (see update.js).
      updateCheck: stored.updateCheck === true,
      whitelist,
      // The list can be switched off without deleting it. Settings saved before
      // the switch existed count as on when they have a list.
      useWhitelist: typeof stored.useWhitelist === 'boolean' ? stored.useWhitelist : whitelist.length > 0,
      keepWhatsApp: KEEP_SITES_SUPPORTED && stored.keepWhatsApp === true,
      keepTelegram: KEEP_SITES_SUPPORTED && stored.keepTelegram === true,
    };
  }

  // The user's whitelist (when switched on) plus any built-in hosts that are switched on.
  function protectedHosts(settings) {
    const hosts = settings.useWhitelist ? [...settings.whitelist] : [];
    if (KEEP_SITES_SUPPORTED) {
      for (const [key, siteHosts] of Object.entries(KEEP_SITES)) {
        if (!settings[key]) continue;
        for (const host of siteHosts) if (!hosts.includes(host)) hosts.push(host);
      }
    }
    return hosts;
  }

  function saveSettings(partial) {
    return api.storage.local.set(partial);
  }

  // Turns free text (one entry per line, or comma separated) into bare host
  // names. Accepts pasted URLs and "*.example.com" / ".example.com" forms.
  function parseWhitelist(text) {
    const domains = [];
    const invalid = [];
    for (const raw of text.split(/[\s,]+/)) {
      if (!raw) continue;
      const stripped = raw.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*?\./, '');
      let host = '';
      try {
        host = new URL('https://' + stripped).hostname.replace(/\.$/, '');
      } catch {
        // falls through to the invalid check below
      }
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
        invalid.push(raw);
      } else if (!domains.includes(host)) {
        domains.push(host);
      }
    }
    return { domains, invalid };
  }

  function isWhitelisted(host, whitelist) {
    return whitelist.some((entry) => host === entry || host.endsWith('.' + entry));
  }

  // Firefox: every host that currently has cookies, minus whitelisted ones.
  async function firefoxCookieHostsExcept(whitelist) {
    if (!(await api.permissions.contains(COOKIE_PERMISSIONS))) {
      throw new Error(t('errCookiePermission'));
    }
    const hosts = new Set();
    for (const store of await api.cookies.getAllCookieStores()) {
      const cookies = await api.cookies.getAll({
        storeId: store.id,
        firstPartyDomain: null, // include cookies under first-party isolation
        partitionKey: {}, // include partitioned and unpartitioned cookies
      });
      for (const cookie of cookies) {
        const host = cookie.domain.replace(/^\./, '');
        if (!isWhitelisted(host, whitelist)) hosts.add(host);
      }
    }
    return [...hosts];
  }

  function chromiumJobs(since, data, whitelist) {
    const kept = {};
    const rest = {};
    for (const id of Object.keys(data)) {
      (whitelist.length && SITE_DATA.has(id) ? kept : rest)[id] = true;
    }
    const jobs = [];
    if (Object.keys(kept).length) {
      const excludeOrigins = whitelist.flatMap((host) => [`https://${host}`, `http://${host}`]);
      jobs.push(() => api.browsingData.remove({ since, excludeOrigins }, kept));
    }
    if (Object.keys(rest).length) {
      jobs.push(() => api.browsingData.remove({ since }, rest));
    }
    return jobs;
  }

  function firefoxJobs(since, data, whitelist) {
    const rest = { ...data };
    const jobs = [];
    if (whitelist.length && rest.cookies) {
      delete rest.cookies;
      jobs.push(async () => {
        const hostnames = await firefoxCookieHostsExcept(whitelist);
        if (hostnames.length) {
          await api.browsingData.remove({ since, hostnames }, { cookies: true });
        }
      });
    }
    if (Object.keys(rest).length) {
      jobs.push(() => api.browsingData.remove({ since }, rest));
    }
    return jobs;
  }

  // ---- Is there anything to clear? ----
  // The browser only lets an extension look at two kinds of data: browsing
  // history and download history. For everything else (cache, cookies, form
  // data, site storage, passwords) Sweep infers it: a type has something to
  // clear if it was never cleared, or if pages were visited since it last was.
  // Two things are remembered for that, per type:
  //   cleanedAt  when it was last cleared in full
  //   pending    known to hold data even though the history no longer shows why

  // True when a page other than Sweep's own was visited after `time`.
  // When that cannot be told, assume yes.
  async function visitedSince(time) {
    try {
      const own = api.runtime.getURL('');
      const pages = await api.history.search({ text: '', startTime: time, maxResults: 25 });
      return pages.some((page) => !page.url.startsWith(own));
    } catch {
      return true;
    }
  }

  async function downloadedSince(time) {
    try {
      const query = time ? { startedAfter: new Date(time).toISOString(), limit: 1 } : { limit: 1 };
      return (await api.downloads.search(query)).length > 0;
    } catch {
      return true;
    }
  }

  // Resolves to { typeId: boolean } for the time range chosen in the popup.
  async function needsCleaning(range) {
    const since = range === 'all' ? 0 : Date.now() - RANGES[range];
    const { cleanedAt = {}, pending = {} } = await api.storage.local.get(['cleanedAt', 'pending']);
    const asked = new Map();
    const visited = (time) => {
      if (!asked.has(time)) asked.set(time, visitedSince(time));
      return asked.get(time);
    };

    const result = {};
    await Promise.all(TYPES.map(async ({ id }) => {
      if (id === 'history') {
        result[id] = await visited(since);
      } else if (id === 'downloads') {
        result[id] = await downloadedSince(since);
      } else if (pending[id] === true || !cleanedAt[id]) {
        // Holds data of unknown age: certainly something for "all time", and
        // for a shorter range only if there was browsing inside it.
        result[id] = since ? await visited(since) : true;
      } else {
        result[id] = await visited(Math.max(cleanedAt[id], since));
      }
    }));
    return result;
  }

  // Resolves to false when nothing was selected, true when everything was
  // removed, and rejects with the combined error text otherwise.
  async function clean(settings, { allTime = false } = {}) {
    const range = allTime ? 'all' : settings.range;
    const since = range === 'all' ? 0 : Date.now() - RANGES[range];

    const data = {};
    for (const type of TYPES) {
      if (!settings.types[type.id] || isBlocked(type, range)) continue;
      data[type.id] = true;
      if (!IS_FIREFOX) for (const extra of type.chromiumExtra ?? []) data[extra] = true;
    }
    if (Object.keys(data).length === 0) return false;

    // Before anything is removed: a type left out of this clean keeps its data,
    // but wiping the history also wipes the evidence of that. Note it down first.
    const { cleanedAt = {}, pending = {} } = await api.storage.local.get(['cleanedAt', 'pending']);
    if (data.history) {
      for (const { id } of TYPES) {
        if (data[id] || id === 'history' || id === 'downloads' || pending[id] || !cleanedAt[id]) continue;
        if (await visitedSince(cleanedAt[id])) pending[id] = true;
      }
      await api.storage.local.set({ pending });
    }

    const jobs = (IS_FIREFOX ? firefoxJobs : chromiumJobs)(since, data, protectedHosts(settings));
    const results = await Promise.allSettled(jobs.map((job) => job()));
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || String(result.reason));
    if (errors.length) throw new Error(errors.join(' '));

    // A type is clear again if all of it was removed: either the range was
    // "all time", or it was already clear before the range began.
    const now = Date.now();
    for (const { id } of TYPES) {
      if (!data[id]) continue;
      if (range === 'all' || (cleanedAt[id] >= since && !pending[id])) {
        cleanedAt[id] = now;
        delete pending[id];
      }
    }
    await api.storage.local.set({ cleanedAt, pending });
    return true;
  }

  globalThis.Sweep = {
    api,
    IS_FIREFOX,
    TYPES,
    RANGES,
    COOKIE_PERMISSIONS,
    KEEP_SITES,
    KEEP_SITES_SUPPORTED,
    t,
    isBlocked,
    loadSettings,
    saveSettings,
    parseWhitelist,
    needsCleaning,
    clean,
  };
})();
