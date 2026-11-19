'use strict';

// Shared by the popup, the settings page and the background script.
// Exposes a single global, `Sweep`.
(() => {
  // Firefox exposes `browser`; Chromium (Chrome, Brave, Edge) exposes `chrome`.
  // Both return promises under Manifest V3.
  const api = globalThis.browser ?? globalThis.chrome;
  const IS_FIREFOX = typeof api.runtime.getBrowserInfo === 'function';

  // A fingerprint of the source, filled in by build.ps1. When the files of an
  // unpacked extension change, the browser keeps running the old background
  // script while pages load the new files; comparing the two shows a page that
  // it is ahead of the background.
  const BUILD = '__BUILD__';

  // Called by pages as they open. If the background script is from another
  // build, reloads the whole extension (once per build, so it cannot loop) and
  // resolves to true; the page is closed by the reload.
  async function ensureFresh() {
    let running;
    try {
      running = await api.runtime.sendMessage({ type: 'build' });
    } catch {
      // An old background script does not know the question.
    }
    if (running === BUILD) return false;
    try {
      const { reloadedFor } = await api.storage.local.get('reloadedFor');
      if (reloadedFor === BUILD) return false;
      await api.storage.local.set({ reloadedFor: BUILD });
      api.runtime.reload();
      return true;
    } catch {
      return false;
    }
  }

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
    const stored = await api.storage.local.get(['range', 'types', 'autoClean', 'updateCheck', 'whitelist', 'useWhitelist', 'keep', ...Object.keys(KEEP_SITES)]);
    const types = {};
    for (const type of TYPES) {
      const saved = stored.types?.[type.id];
      types[type.id] = typeof saved === 'boolean' ? saved : type.on;
    }
    const whitelist = Array.isArray(stored.whitelist) ? stored.whitelist : [];
    // Per-item keep lists: { typeId: [host, ...] }.
    const keep = {};
    for (const type of TYPES) {
      const list = stored.keep?.[type.id];
      keep[type.id] = Array.isArray(list) ? list.filter((host) => typeof host === 'string') : [];
    }
    return {
      keep,
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

  // ---- Per-item keep lists ----
  // Besides the cookie whitelist, each kind of data can have its own list of
  // sites that are never cleared (`settings.keep[typeId]`, host names; a host
  // also covers its subdomains). What the browser allows differs:
  //   history, downloads            Sweep removes the entries one by one and skips kept sites
  //   Chromium cache and site data  the browser leaves the listed origins out of the removal
  //   Firefox cookies               like the whitelist: only the other hosts are cleared
  // Form data and passwords cannot be kept per site in any browser, and in
  // Firefox neither can the cache or site storage.
  const KEEPABLE = new Set(IS_FIREFOX
    ? ['history', 'downloads', 'cookies']
    : ['history', 'downloads', 'cache', 'cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems']);
  const canKeep = (typeId) => KEEPABLE.has(typeId);
  const keepFor = (settings, typeId) => (canKeep(typeId) ? settings.keep?.[typeId] || [] : []);

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // Runs `task` over `items`, a few at a time.
  async function inBatches(items, task, size = 40) {
    for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(task));
  }

  // Removes every page visited since `since` whose site is not kept. deleteUrl
  // forgets the whole address, including visits from before `since`.
  async function removeHistoryExcept(since, kept) {
    const pages = await api.history.search({ text: '', startTime: since, maxResults: 100000 });
    await inBatches(pages.filter((page) => !isWhitelisted(hostOf(page.url), kept)), (page) => api.history.deleteUrl({ url: page.url }));
  }

  // Removes the record (not the file) of every download since `since` whose site is not kept.
  async function removeDownloadsExcept(since, kept) {
    const query = since ? { startedAfter: new Date(since).toISOString(), limit: 0 } : { limit: 0 };
    const items = await api.downloads.search(query);
    await inBatches(items.filter((item) => !isWhitelisted(hostOf(item.finalUrl || item.url), kept)), (item) => api.downloads.erase({ id: item.id }));
  }

  // History and downloads that have a keep list are taken out of `data` and
  // handled here; without one the browser's own removal is used, which is faster.
  function itemJobs(since, data, settings) {
    const jobs = [];
    const history = keepFor(settings, 'history');
    if (data.history && history.length) {
      delete data.history;
      jobs.push(() => removeHistoryExcept(since, history));
    }
    const downloads = keepFor(settings, 'downloads');
    if (data.downloads && downloads.length) {
      delete data.downloads;
      jobs.push(() => removeDownloadsExcept(since, downloads));
    }
    return jobs;
  }

  function chromiumJobs(since, data, settings) {
    const rest = { ...data };
    const jobs = itemJobs(since, rest, settings);
    const whitelist = protectedHosts(settings);

    // Kinds of data that keep the same sites share one removal.
    const groups = new Map();
    for (const id of Object.keys(rest)) {
      // cacheStorage has no tile of its own: it follows the whitelist like the
      // rest of the site data, and the keep list of the Cache tile it rides with.
      const own = keepFor(settings, id === 'cacheStorage' ? 'cache' : id);
      const hosts = [...new Set([...(SITE_DATA.has(id) ? whitelist : []), ...own])].sort();
      const key = hosts.join(' ');
      if (!groups.has(key)) groups.set(key, { hosts, types: {} });
      groups.get(key).types[id] = true;
    }
    for (const { hosts, types } of groups.values()) {
      const options = hosts.length
        ? { since, excludeOrigins: hosts.flatMap((host) => [`https://${host}`, `http://${host}`]) }
        : { since };
      jobs.push(() => api.browsingData.remove(options, types));
    }
    return jobs;
  }

  function firefoxJobs(since, data, settings) {
    const rest = { ...data };
    const jobs = itemJobs(since, rest, settings);
    const cookieKeep = [...new Set([...protectedHosts(settings), ...keepFor(settings, 'cookies')])];
    if (cookieKeep.length && rest.cookies) {
      delete rest.cookies;
      jobs.push(async () => {
        const hostnames = await firefoxCookieHostsExcept(cookieKeep);
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

  // The sites the keep-list picker offers for a kind of data, most frequent
  // first: [{ host, count }]. Downloads are listed from the download history.
  // Everything else is listed from the browsing history, because the browser
  // lets an extension list neither the cache nor cookies nor site storage.
  async function foundSites(typeId) {
    const counts = new Map();
    const add = (url) => {
      const host = /^https?:/.test(url || '') ? hostOf(url) : '';
      if (host.includes('.')) counts.set(host, (counts.get(host) || 0) + 1);
    };
    if (typeId === 'downloads') {
      for (const item of await api.downloads.search({ limit: 0 })) add(item.finalUrl || item.url);
    } else {
      for (const page of await api.history.search({ text: '', startTime: 0, maxResults: 5000 })) add(page.url);
    }
    return [...counts]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  }

  // ---- Is there anything to clear? ----
  // The browser only lets an extension look at two kinds of data: browsing
  // history and download history. For everything else (cache, cookies, form
  // data, site storage, passwords) Sweep infers it: a type has something to
  // clear if it was never cleared, or if pages were visited since it last was.
  // Two things are remembered for that, per type:
  //   cleanedAt  when it was last cleared in full
  //   pending    known to hold data even though the history no longer shows why

  // True when a page other than Sweep's own, and not on a kept site, was
  // visited after `time`. When that cannot be told, assume yes.
  async function visitedSince(time, kept = []) {
    try {
      const own = api.runtime.getURL('');
      // With kept sites the newest pages may all be kept ones, so look further.
      const pages = await api.history.search({ text: '', startTime: time, maxResults: kept.length ? 2000 : 25 });
      return pages.some((page) => !page.url.startsWith(own) && !isWhitelisted(hostOf(page.url), kept));
    } catch {
      return true;
    }
  }

  async function downloadedSince(time, kept = []) {
    try {
      const query = { limit: kept.length ? 0 : 1 };
      if (time) query.startedAfter = new Date(time).toISOString();
      const items = await api.downloads.search(query);
      return items.some((item) => !isWhitelisted(hostOf(item.finalUrl || item.url), kept));
    } catch {
      return true;
    }
  }

  // Resolves to { typeId: boolean } for the time range chosen in the popup.
  async function needsCleaning(range) {
    const since = range === 'all' ? 0 : Date.now() - RANGES[range];
    const { cleanedAt = {}, pending = {} } = await api.storage.local.get(['cleanedAt', 'pending']);
    const settings = await loadSettings();
    const asked = new Map();
    const visited = (time) => {
      if (!asked.has(time)) asked.set(time, visitedSince(time));
      return asked.get(time);
    };

    const result = {};
    await Promise.all(TYPES.map(async ({ id }) => {
      if (id === 'history') {
        // Kept sites stay behind after a clean and are not "something to clear".
        result[id] = await visitedSince(since, keepFor(settings, 'history'));
      } else if (id === 'downloads') {
        result[id] = await downloadedSince(since, keepFor(settings, 'downloads'));
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

    const jobs = (IS_FIREFOX ? firefoxJobs : chromiumJobs)(since, data, settings);
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
    BUILD,
    ensureFresh,
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
    canKeep,
    foundSites,
    needsCleaning,
    clean,
  };
})();
