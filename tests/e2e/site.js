'use strict';

// Fake sites used by the end-to-end tests. They are answered locally (request
// interception in Chromium, a localhost server in Firefox), so no test ever
// touches the network — including web.whatsapp.com and web.telegram.org, which are only host names here.
const HOSTS = ['keep.test', 'app.keep.test', 'tracker.test', 'web.whatsapp.com', 'web.telegram.org'];

// "/?seed" stores a host cookie, a domain-wide cookie, a local storage entry and
// an IndexedDB database, then sets the title to "ready". Any other path only
// sets the title, so the test can read what is left.
function sitePage(host) {
  return `<!doctype html><meta charset="utf-8"><title>${host}</title><script>
const secure = location.protocol === 'https:' ? '; secure' : '';
if (location.search === '?seed') {
  localStorage.setItem('k', 'v');
  document.cookie = 'host=1; max-age=86400' + secure;
  document.cookie = 'wide=1; domain=' + location.hostname.split('.').slice(-2).join('.') + '; max-age=86400' + secure;
  const open = indexedDB.open('d', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('s');
  open.onsuccess = () => {
    const tx = open.result.transaction('s', 'readwrite');
    tx.objectStore('s').put('v', 'k');
    tx.oncomplete = () => { open.result.close(); document.title = 'ready'; };
  };
} else {
  document.title = 'ready';
}
</script>${host}`;
}

// Evaluated in a site page: what storage the site still has.
const READ_STORAGE = `(async () => ({
  ls: localStorage.getItem('k'),
  idb: (await indexedDB.databases()).map((d) => d.name),
}))()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { HOSTS, sitePage, READ_STORAGE, sleep };
