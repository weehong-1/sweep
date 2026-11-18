'use strict';

// Looks up the newest release of the browser Sweep is running in.
//
// This is the only code in Sweep that uses the network, and it runs only when
// the user has switched "Check for browser updates" on. Each lookup is one GET
// to the browser maker's public release list; nothing about the user is sent.
// Exposes a single global, `SweepUpdate`.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const CHECK_EVERY = 6 * 60 * 60 * 1000;

  // Compares dotted version numbers: negative, zero or positive like a sort callback.
  function compareVersions(a, b) {
    const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const diff = (x[i] || 0) - (y[i] || 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
  }

  // Chrome's release list is per platform.
  function chromePlatform({ os, arch }) {
    if (os === 'win') return arch === 'arm64' ? 'win_arm64' : arch === 'x86-64' ? 'win64' : 'win';
    if (os === 'mac') return arch === 'arm64' ? 'mac_arm64' : 'mac';
    if (os === 'linux') return 'linux';
    return null;
  }

  // `parse` turns the response into { version, display }, or null when the
  // response names no usable release.
  const SOURCES = {
    chrome: {
      name: 'Chrome',
      updatePage: 'chrome://settings/help',
      url: (platform) => `https://versionhistory.googleapis.com/v1/chrome/platforms/${platform}/channels/stable/versions/all/releases?filter=endtime=none&order_by=version%20desc&pageSize=20`,
      // Chrome rolls a release out to a growing fraction of people. Only count
      // one that has reached everyone, so the badge never announces an update
      // that Chrome itself would not offer yet.
      parse(json) {
        const versions = (json.releases || []).filter((r) => r.fraction >= 1).map((r) => r.version).sort(compareVersions);
        const version = versions.pop();
        return version ? { version, display: version } : null;
      },
    },
    brave: {
      name: 'Brave',
      updatePage: 'chrome://settings/help',
      // Brave tells extensions only its Chromium major version (as "157.0.0.0"),
      // so the comparison is by major version and smaller updates go unnoticed.
      majorOnly: true,
      url: () => 'https://api.github.com/repos/brave/brave-browser/releases/latest',
      // The release is named like "Release v1.99.57 (Chromium 157.0.8103.79)".
      parse(json) {
        const chromium = /Chromium (\d+(?:\.\d+)*)/.exec(json.name || '');
        if (!chromium) return null;
        const brave = String(json.tag_name || '').replace(/^v/, '');
        const engine = `Chromium ${parseInt(chromium[1], 10)}`;
        // Shown next to "you have Chromium 157", so name the engine too.
        return { version: chromium[1], display: brave ? `${brave} (${engine})` : engine };
      },
    },
    firefox: {
      name: 'Firefox',
      updatePage: null, // extensions cannot open Firefox's about: pages
      url: () => 'https://product-details.mozilla.org/1.0/firefox_versions.json',
      parse(json) {
        const version = json.LATEST_FIREFOX_VERSION;
        return version ? { version, display: version } : null;
      },
    },
  };

  function isNewer(source, current, latest) {
    if (source.majorOnly) return parseInt(latest, 10) > parseInt(current, 10);
    return compareVersions(latest, current) > 0;
  }

  // Which browser this is and its version. `id` is null for browsers without a
  // release list above (Edge, Firefox forks, other Chromium builds).
  async function detect() {
    if (typeof api.runtime.getBrowserInfo === 'function') {
      const info = await api.runtime.getBrowserInfo();
      const id = info.name === 'Firefox' ? 'firefox' : null;
      return { id, name: info.name, version: info.version, shown: info.version, platform: null };
    }
    const platform = chromePlatform(await api.runtime.getPlatformInfo());
    const data = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
    const versionOf = (brand) => (data.fullVersionList || []).find((b) => b.brand === brand)?.version;
    if (typeof navigator.brave?.isBrave === 'function' && (await navigator.brave.isBrave())) {
      const version = versionOf('Brave') || versionOf('Chromium') || '';
      return { id: 'brave', name: 'Brave', version, shown: `Chromium ${parseInt(version, 10) || ''}`.trim(), platform };
    }
    const chrome = versionOf('Google Chrome');
    if (chrome && platform) return { id: 'chrome', name: 'Chrome', version: chrome, shown: chrome, platform };
    const other = versionOf('Microsoft Edge') || versionOf('Chromium') || '';
    return { id: null, name: versionOf('Microsoft Edge') ? 'Edge' : 'Chromium', version: other, shown: other, platform };
  }

  // Resolves to { supported, name, shown, latest, available, updatePage }.
  // Uses the stored answer when it is recent and was made for this version;
  // `force` always asks again. Rejects when the lookup fails.
  async function check(force = false) {
    const me = await detect();
    if (!me.id) return { supported: false, name: me.name, shown: me.shown };
    const source = SOURCES[me.id];
    const result = (info) => ({ supported: true, name: source.name, shown: me.shown, latest: info.display, available: info.available, updatePage: source.updatePage });

    const { updateInfo } = await api.storage.local.get('updateInfo');
    if (!force && updateInfo && updateInfo.current === me.version && Date.now() - updateInfo.checkedAt < CHECK_EVERY) {
      return result(updateInfo);
    }

    const response = await fetch(source.url(me.platform), { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const found = source.parse(await response.json());
    const info = {
      checkedAt: Date.now(),
      current: me.version,
      latest: found ? found.version : me.version,
      display: found ? found.display : me.shown,
      available: found ? isNewer(source, me.version, found.version) : false,
    };
    await api.storage.local.set({ updateInfo: info });
    return result(info);
  }

  globalThis.SweepUpdate = { SOURCES, compareVersions, chromePlatform, isNewer, detect, check };
})();
