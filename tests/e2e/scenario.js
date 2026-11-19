'use strict';

// The end-to-end scenario, shared by both browsers. `d` is a driver from
// chromium.js or firefox.js; `check(name, pass, detail)` records one result.
const { READ_STORAGE, sleep } = require('./site');

const API = '(globalThis.browser ?? chrome)';
const SITES = ['keep.test', 'app.keep.test', 'tracker.test'];
const COOKIE_PERMISSIONS = `{ permissions: ['cookies'], origins: ['<all_urls>'] }`;

// Everything the popup shows, read in one go.
const POPUP_VIEW = `(() => {
  const body = document.body.getBoundingClientRect();
  const inset = (selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return [Math.round(r.left - body.left), Math.round(body.right - r.right)];
  };
  // The keep-list view is hidden until a magnifier is clicked; its title is filled in then.
  const texts = [...document.querySelectorAll('h1, h2, .segmented span, .tile .name, .tile small, #runLabel')].filter((e) => !e.closest('#detail')).map((e) => e.textContent.trim());
  return {
    tiles: [...document.querySelectorAll('.tile')].map((t) => ({
      type: t.dataset.type,
      checked: t.querySelector('input').checked,
      disabled: t.querySelector('input').disabled,
      hint: t.querySelector('small')?.textContent || '',
      hasData: t.classList.contains('has-data'),
      dotShown: getComputedStyle(t.querySelector('.dot')).display !== 'none',
    })),
    segments: [...document.querySelectorAll('.segmented span')].map((s) => s.textContent),
    range: document.querySelector('.segmented input:checked')?.value,
    count: document.getElementById('count').textContent,
    quick: Object.fromEntries([...document.querySelectorAll('.quick button')].map((b) => [b.dataset.key, { on: b.classList.contains('on'), disabled: b.disabled, count: b.querySelector('.n')?.textContent || '', alert: Boolean(b.querySelector('.n.alert')), label: b.title }])),
    note: { hidden: document.getElementById('updateNote').hidden, text: document.querySelector('#updateNote span').textContent, button: !document.querySelector('#updateNote button').hidden },
    quickFits: (() => {
      const row = document.querySelector('.quick').getBoundingClientRect();
      const widths = [...document.querySelectorAll('.quick button')].map((b) => Math.round(b.getBoundingClientRect().width));
      const above = document.querySelector('.segmented').getBoundingClientRect();
      const below = document.querySelector('.tiles').getBoundingClientRect();
      return row.top > above.bottom && row.bottom < below.top && widths.length === 5 && Math.max(...widths) - Math.min(...widths) <= 1;
    })(),
    untranslated: [...texts, ...[...document.querySelectorAll('.quick button')].map((b) => b.title)].filter((x) => !x || /^(type_|[a-z]+[A-Z][A-Za-z]*( \(\d+\))?$)/.test(x)),
    clipped: [...document.querySelectorAll('.segmented span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    wrapped: [...document.querySelectorAll('.tile:not(.off) .name')].filter((e) => e.getBoundingClientRect().height > 22).map((e) => e.textContent),
    insets: [inset('.top'), inset('.segmented'), inset('.quick'), inset('.tiles'), inset('#run')],
    width: Math.round(body.width),
    height: Math.round(body.height),
  };
})()`;

async function seed(d, hosts) {
  for (const host of hosts) {
    const page = await d.openSite(host, '/?seed');
    await page.close();
  }
}

async function storageOf(d, host) {
  const page = await d.openSite(host, '/read');
  const state = await page.eval(READ_STORAGE);
  await page.close();
  return state;
}

const cookiesFor = (list, domain) => list.filter((c) => c.split(':')[0].replace(/^\./, '').endsWith(domain));
const hasStorage = (s) => s.ls === 'v' && s.idb.includes('d');
const noStorage = (s) => s.ls === null && s.idb.length === 0;

// Changes settings through the real settings page and saves with a real click.
async function saveSettings(d, changes) {
  const page = await d.openExt('options.html');
  if ('whitelist' in changes) {
    await page.eval(`(() => { document.getElementById('whitelist').value = ${JSON.stringify(changes.whitelist)}; })()`);
  }
  for (const key of ['autoClean', 'keepWhatsApp', 'keepTelegram']) {
    if (!(key in changes)) continue;
    const box = await page.eval(`(() => { const b = document.getElementById('${key}'); return { checked: b.checked, disabled: b.disabled }; })()`);
    if (!box.disabled && box.checked !== changes[key]) await page.click('#' + key);
  }
  await page.click('#save');
  await sleep(1000);
  const out = await page.eval(`(async () => ({
    status: document.getElementById('status').textContent,
    isError: document.getElementById('status').classList.contains('error'),
    whitelistSwitch: document.getElementById('useWhitelist').checked,
    keepDisabled: ['keepWhatsApp', 'keepTelegram'].every((k) => document.getElementById(k).disabled),
    untranslated: [...document.querySelectorAll('h1 small, strong, .note, .heading, #save')].map((e) => e.textContent.trim()).filter((x) => !x || /^[a-z]+[A-Z][A-Za-z]*$/.test(x)),
    stored: await ${API}.storage.local.get(),
    permitted: await ${API}.permissions.contains(${COOKIE_PERMISSIONS}).catch(() => null),
  }))()`);
  await page.close();
  return out;
}

// Drives the popup with real clicks: optionally pick a range, tick everything, press Clean.
async function usePopup(d, { range, tickAll = false, toggle = [], toggleTiles = [], run = true } = {}) {
  const page = await d.openExt('popup.html');
  for (const key of [].concat(toggle)) await page.click(`.quick button[data-key="${key}"]`);
  for (const type of toggleTiles) await page.click(`.tile[data-type="${type}"]`);
  if (range) await page.click(`.segmented label:has(input[value="${range}"])`);
  if (tickAll) {
    const types = await page.eval(`[...document.querySelectorAll('.tile')].filter((t) => !t.querySelector('input').checked && !t.querySelector('input').disabled).map((t) => t.dataset.type)`);
    for (const type of types) await page.click(`.tile[data-type="${type}"]`);
  }
  // The "has data" dots arrive a moment after the popup opens.
  for (let i = 0; i < 15 && !(await page.eval(`document.getElementById('types').dataset.marked === '1'`)); i++) await sleep(200);
  await sleep(200);
  const view = await page.eval(POPUP_VIEW);
  let result = null;
  let sawSpinner = false;
  if (run) {
    await page.click('#run');
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      result = await page.eval(`(() => { const b = document.getElementById('run'); const s = document.getElementById('status'); const icon = document.getElementById('runIcon'); return { done: b.classList.contains('done'), busy: b.classList.contains('busy'), spinner: icon.getAttribute('href') === '#i-spinner' && getComputedStyle(icon.closest('svg')).animationName === 'spin', status: s.textContent, isError: s.classList.contains('error') }; })()`);
      if (result.busy && result.spinner) sawSpinner = true;
      if (result.done || (!result.busy && result.status)) break;
    }
    result.sawSpinner = sawSpinner;
  }
  // What the same popup shows once the clean is over (the dots are refreshed).
  let after = null;
  if (run) {
    await sleep(600);
    after = await page.eval(POPUP_VIEW);
  }
  await page.close();
  return { view, result, after };
}

// The tiles marked as having something to clear, as "history,cookies,...".
const marked = (view) => view.tiles.filter((t) => t.hasData && t.dotShown).map((t) => t.type).join(',');
const allTypes = (view) => view.tiles.map((t) => t.type);

module.exports = scenario;
Object.assign(module.exports, { SITES, seed, storageOf, cookiesFor, hasStorage, noStorage, saveSettings, usePopup });

async function scenario(d, check) {
  // ---------- 1. Popup UI ----------
  let { view, result } = await usePopup(d);
  const types = view.tiles.map((t) => t.type);
  check('popup: 9 data types and 5 time ranges', types.length === 9 && view.segments.length === 5, types.join(','));
  check(
    d.isFirefox ? 'popup: Firefox shows passwords, hides file systems' : 'popup: Chromium shows file systems, hides passwords',
    d.isFirefox ? types.includes('passwords') && !types.includes('fileSystems') : types.includes('fileSystems') && !types.includes('passwords'),
  );
  check('popup: every label is translated (no raw message keys)', view.untranslated.length === 0, view.untranslated.join(', '));
  check('popup: no time-range label is cut off', view.clipped.length === 0, view.clipped.join(', '));
  check('popup: 380px wide with equal 14px side padding on every row', view.width === 380 && view.insets.every(([l, r]) => l === 14 && r === 14), JSON.stringify(view.insets));
  check('popup: every item name fits on one line beside its magnifier', view.wrapped.length === 0, view.wrapped.join(', '));
  check('popup: fits a browser popup (at most 600px tall)', view.height <= 600, `${view.height}px`);
  check('popup: badge shows how many items are selected', view.count === String(view.tiles.filter((t) => t.checked).length), view.count);
  check('popup: whitelist, WhatsApp, Telegram, auto-clean and update buttons form one row of five equal buttons under the time range', Object.keys(view.quick).join() === 'whitelist,keepWhatsApp,keepTelegram,autoClean,updateCheck' && view.quickFits, JSON.stringify(view.quick));
  check('popup: the five buttons start off', Object.values(view.quick).every((q) => !q.on));
  check('popup: Clean with the default selection finishes', Boolean(result?.done), result?.status);
  check('popup: a spinner turns on the Clean button while it works', result?.sawSpinner === true);

  // ---------- 2. Settings page ----------
  let saved = await saveSettings(d, { whitelist: 'Keep.test\nhttps://www.foo.test/x\n*.bar.test', autoClean: false });
  check('settings: every label is translated', saved.untranslated.length === 0, saved.untranslated.join(', '));
  check('settings: whitelist is normalised and stored', JSON.stringify(saved.stored.whitelist) === JSON.stringify(['keep.test', 'www.foo.test', 'bar.test']) && !saved.isError, JSON.stringify(saved.stored.whitelist));
  check('settings: saving a list switches the whitelist on', saved.stored.useWhitelist === true && saved.whitelistSwitch === true);
  if (d.isFirefox) check('settings: Firefox grants the cookie permission on save', saved.permitted === true);
  saved = await saveSettings(d, { whitelist: 'not a domain' });
  check('settings: invalid entry is rejected and the old list kept', saved.isError && saved.stored.whitelist.length === 3, saved.status);

  // ---------- 3. Cleaning with a cookie whitelist ----------
  await saveSettings(d, { whitelist: 'keep.test' });
  await seed(d, SITES);
  let cookies = await d.cookies();
  check('seed: 5 cookies across the three test sites', cookies.length === 5, cookies.join(' '));
  const cleaned = await usePopup(d, { range: 'all', tickAll: true });
  ({ view, result } = cleaned);
  // After visiting sites: everything but downloads (nothing was downloaded) has something to clear.
  const allButDownloads = allTypes(view).filter((type) => type !== 'downloads').join(',');
  check('has data: after browsing, every tile except downloads is marked', marked(view) === allButDownloads, marked(view));
  check('has data: right after cleaning everything, no tile is marked', marked(cleaned.after) === '', marked(cleaned.after));
  check('whitelist clean: finishes', Boolean(result?.done), result?.status);
  check('whitelist clean: whitelist button is lit and shows 1 domain', view.quick.whitelist.on && view.quick.whitelist.count === '1', JSON.stringify(view.quick.whitelist));
  cookies = await d.cookies();
  check('whitelist clean: tracker.test cookies removed', cookiesFor(cookies, 'tracker.test').length === 0, cookies.join(' '));
  check('whitelist clean: keep.test and subdomain cookies kept', cookiesFor(cookies, 'keep.test').length === 3, cookies.join(' '));
  let tracker = await storageOf(d, 'tracker.test');
  let keep = await storageOf(d, 'keep.test');
  const sub = await storageOf(d, 'app.keep.test');
  check('whitelist clean: tracker.test storage removed', noStorage(tracker), JSON.stringify(tracker));
  if (d.isFirefox) {
    check('whitelist clean: Firefox whitelist covers cookies only, storage cleared', noStorage(keep), JSON.stringify(keep));
  } else {
    check('whitelist clean: keep.test storage kept (exact host)', hasStorage(keep), JSON.stringify(keep));
    check('whitelist clean: unlisted subdomain storage removed', noStorage(sub), JSON.stringify(sub));
  }

  // ---------- 3a. "Has data" markers ----------
  {
    // The storage checks above visited the sites again.
    ({ view } = await usePopup(d, { run: false }));
    check('has data: browsing again marks the tiles again', marked(view) === allButDownloads, marked(view));

    // Clean everything except cookies. The history that showed there was
    // browsing is wiped, but cookies must stay marked.
    await seed(d, SITES);
    const partial = await usePopup(d, { toggleTiles: ['cookies'] });
    check('has data: a type left out of a clean stays marked after the history is gone', marked(partial.after) === 'cookies', marked(partial.after));
    ({ view } = await usePopup(d, { toggleTiles: ['cookies'], run: false }));
    check('has data: the mark survives reopening the popup', marked(view) === 'cookies', marked(view));
  }

  // ---------- 3b. The whitelist can be switched off and on from the popup ----------
  {
    const settingsTab = await d.openExt('options.html');
    const whitelistState = () => settingsTab.eval(`(async () => ({ checked: document.getElementById('useWhitelist').checked, stored: (await ${API}.storage.local.get('useWhitelist')).useWhitelist, list: document.getElementById('whitelist').value }))()`);

    await seed(d, SITES);
    ({ view, result } = await usePopup(d, { toggle: 'whitelist' }));
    let state = await whitelistState();
    cookies = await d.cookies();
    check('whitelist off: popup button goes dark, settings switch follows, list is kept', !view.quick.whitelist.on && state.checked === false && state.stored === false && state.list === 'keep.test', JSON.stringify(state));
    check('whitelist off: keep.test cookies are cleared like any other site', Boolean(result?.done) && cookies.length === 0, cookies.join(' '));

    ({ view } = await usePopup(d, { toggle: 'whitelist', run: false }));
    state = await whitelistState();
    check('whitelist on again: popup button lights with its count, settings switch follows', view.quick.whitelist.on && view.quick.whitelist.count === '1' && state.checked === true && state.stored === true, JSON.stringify(state));
    await settingsTab.close();
  }

  // ---------- 3c. Per-item keep lists (the magnifier on each tile) ----------
  {
    const setStored = async (values) => {
      const page = await d.openExt('options.html');
      await page.eval(`${API}.storage.local.set(${JSON.stringify(values)})`);
      await page.close();
    };
    const historySites = async () => {
      const page = await d.openExt('popup.html');
      const sites = await page.eval(`Sweep.foundSites('history').then((list) => list.map((site) => site.host).sort())`);
      await page.close();
      return sites;
    };

    await seed(d, SITES);
    const popup = await d.openExt('popup.html');
    const picker = () => popup.eval(`(() => ({
      open: document.body.classList.contains('detail-open'),
      loaded: document.getElementById('detail').dataset.loaded,
      title: document.getElementById('detailTitle').textContent,
      note: document.getElementById('detailNote').textContent,
      pickerShown: !document.getElementById('detailPicker').hidden,
      found: [...document.querySelectorAll('#foundList option:not(:disabled)')].map((o) => o.value),
      kept: [...document.querySelectorAll('#keptList option:not(:disabled)')].map((o) => o.value),
      status: document.getElementById('detailStatus').textContent,
      width: Math.round(document.body.getBoundingClientRect().width),
      height: Math.round(document.body.getBoundingClientRect().height),
    }))()`);
    const openItem = async (type) => {
      await popup.click(`.tile[data-type="${type}"] .look`);
      let state;
      for (let i = 0; i < 25; i++) {
        state = await picker();
        if (state.open && state.loaded === '1') break;
        await sleep(150);
      }
      return state;
    };
    const stored = () => popup.eval(`${API}.storage.local.get('keep').then((s) => s.keep || {})`);

    // History: what is found, and moving a site across with the Add button.
    let item = await openItem('history');
    check('keep list: the magnifier opens a two-list picker that fits a browser popup', item.open && item.pickerShown && item.width <= 800 && item.height <= 600, `${item.width}x${item.height}`);
    check('keep list: the left list shows the sites in the history', SITES.every((host) => item.found.includes(host)), item.found.join(','));
    check('keep list: the note is translated', item.note.length > 20 && !/^keep[A-Z]/.test(item.note) && !/keep[A-Z]/.test(item.title), item.title);
    await popup.eval(`(() => { for (const o of document.getElementById('foundList').options) o.selected = o.value === 'tracker.test'; })()`);
    await popup.click('#keepAdd');
    await sleep(500);
    item = await picker();
    check('keep list: Add moves the selected site to "Always keep" and stores it', item.kept.join() === 'tracker.test' && !item.found.includes('tracker.test') && ((await stored()).history || []).join() === 'tracker.test', JSON.stringify(item.kept));
    await popup.click('#detailBack');
    await sleep(300);
    check('keep list: back returns to the main view and lights the magnifier of that item',
      await popup.eval(`!document.body.classList.contains('detail-open') && document.querySelector('.tile[data-type="history"] .look').classList.contains('on') && !document.querySelector('.tile[data-type="cache"] .look').classList.contains('on')`));

    // Cookies: typing a site instead of picking one.
    await openItem('cookies');
    await popup.eval(`(() => { document.getElementById('keepInput').value = 'https://Tracker.test/some/page'; })()`);
    await popup.click('#keepForm button');
    await sleep(700);
    item = await picker();
    check('keep list: a typed address is cleaned up and added', item.kept.join() === 'tracker.test' && ((await stored()).cookies || []).join() === 'tracker.test' && item.status === '', `${item.kept.join()} ${item.status}`);
    await popup.eval(`(() => { document.getElementById('keepInput').value = 'not a site'; })()`);
    await popup.click('#keepForm button');
    await sleep(300);
    check('keep list: something that is not a site is refused', (await picker()).kept.join() === 'tracker.test' && (await picker()).status !== '');
    await popup.click('#detailBack');

    // Form data cannot be kept site by site: the picker says so instead.
    item = await openItem('formData');
    check('keep list: items that cannot be kept per site explain why instead of showing the picker', item.open && !item.pickerShown && item.note.length > 20, item.note);
    await popup.click('#detailBack');
    await popup.close();

    // Cleaning everything now spares the kept site's history and cookies.
    ({ view, result } = await usePopup(d));
    cookies = await d.cookies();
    const left = await historySites();
    check('keep list: cleaning finishes', Boolean(result?.done), result?.status);
    check('keep list: the kept site stays in the history, the other sites are removed', left.join() === 'tracker.test', left.join(','));
    check('keep list: the kept site keeps its cookies', cookiesFor(cookies, 'tracker.test').length === 2, cookies.join(' '));
    ({ view } = await usePopup(d, { run: false }));
    check('keep list: history that is only kept sites is not marked as something to clear', !marked(view).split(',').includes('history'), marked(view));

    // Each item has its own list: keep local storage for a site, but not its IndexedDB.
    if (!d.isFirefox) {
      await setStored({ keep: { localStorage: ['tracker.test'] } });
      await seed(d, ['tracker.test']);
      ({ result } = await usePopup(d));
      const own = await storageOf(d, 'tracker.test');
      check('keep list: lists are per item (local storage kept, IndexedDB of the same site cleared)', Boolean(result?.done) && own.ls === 'v' && own.idb.length === 0, JSON.stringify(own));
    }

    // Removing a site from the list, with the Remove button.
    await setStored({ keep: { history: ['tracker.test', 'keep.test'] } });
    const again = await d.openExt('popup.html');
    await again.click('.tile[data-type="history"] .look');
    await sleep(900);
    await again.eval(`(() => { for (const o of document.getElementById('keptList').options) o.selected = o.value === 'tracker.test'; })()`);
    await again.click('#keepRemove');
    await sleep(500);
    const afterRemove = await again.eval(`${API}.storage.local.get('keep').then((s) => (s.keep.history || []).join())`);
    await again.close();
    check('keep list: Remove takes a site off the list', afterRemove === 'keep.test', afterRemove);

    // Leave no keep lists or leftovers behind for the steps that follow.
    await setStored({ keep: {} });
    await usePopup(d);
  }

  // ---------- 4. Firefox: whitelist without the cookie permission ----------
  if (d.isFirefox) {
    await seed(d, SITES);
    const page = await d.openExt('options.html');
    await page.eval(`${API}.permissions.remove(${COOKIE_PERMISSIONS})`);
    await page.close();
    ({ result } = await usePopup(d));
    cookies = await d.cookies();
    tracker = await storageOf(d, 'tracker.test');
    check('no cookie permission: popup reports an error', Boolean(result?.isError), result?.status);
    check('no cookie permission: cookies are left untouched', cookies.length === 5, cookies.join(' '));
    check('no cookie permission: other data is still cleaned', noStorage(tracker), JSON.stringify(tracker));
  }

  // ---------- 5. Time range ----------
  saved = await saveSettings(d, { whitelist: '' });
  check('settings: saving an empty list switches the whitelist off', saved.stored.useWhitelist === false && saved.whitelistSwitch === false);
  if (d.isFirefox) check('settings: clearing the whitelist drops the cookie permission', saved.permitted === false);
  await seed(d, SITES);
  ({ view, result } = await usePopup(d, { range: 'hour' }));
  cookies = await d.cookies();
  tracker = await storageOf(d, 'tracker.test');
  check('last hour: finishes and removes fresh cookies', Boolean(result?.done) && cookies.length === 0, cookies.join(' ') || result?.status);
  if (d.isFirefox) {
    const off = view.tiles.filter((t) => t.disabled);
    check('last hour: Firefox disables the three all-time-only items with a hint', off.length === 3 && off.every((t) => !t.checked && t.hint), off.map((t) => t.type).join(','));
    check('last hour: badge leaves the disabled items out', view.count === String(view.tiles.filter((t) => t.checked).length), view.count);
    check('last hour: Firefox leaves storage alone', hasStorage(tracker), JSON.stringify(tracker));
  } else {
    check('last hour: fresh storage removed', noStorage(tracker), JSON.stringify(tracker));
  }
  await usePopup(d, { range: 'all', run: false });

  // ---------- 6. Stay signed in to WhatsApp Web / Telegram Web ----------
  const WA = 'web.whatsapp.com';
  const TG = 'web.telegram.org';
  if (d.isFirefox) {
    saved = await saveSettings(d, { keepWhatsApp: true, keepTelegram: true });
    ({ view } = await usePopup(d, { run: false }));
    const buttons = [view.quick.keepWhatsApp, view.quick.keepTelegram];
    check('stay signed in: both options disabled in Firefox (settings and popup), never stored as on',
      saved.keepDisabled && saved.stored.keepWhatsApp !== true && saved.stored.keepTelegram !== true && buttons.every((q) => q.disabled && !q.on));
  } else {
    const siteState = async (host) => {
      const storage = await storageOf(d, host);
      const kept = cookiesFor(await d.cookies(), host.split('.').slice(-2).join('.')).length;
      return { ...storage, cookies: kept };
    };
    const allKept = (state) => hasStorage(state) && state.cookies === 2;
    const allGone = (state) => noStorage(state) && state.cookies === 0;

    // Both on, switched from the popup buttons.
    await seed(d, [WA, TG, 'tracker.test']);
    ({ view, result } = await usePopup(d, { toggle: ['keepWhatsApp', 'keepTelegram'] }));
    saved = await saveSettings(d, {});
    check('stay signed in: both switched on from the popup buttons and stored', saved.stored.keepWhatsApp === true && saved.stored.keepTelegram === true);
    check('stay signed in: both popup buttons are lit', view.quick.keepWhatsApp.on && view.quick.keepTelegram.on, JSON.stringify(view.quick));
    let wa = await siteState(WA);
    let tg = await siteState(TG);
    tracker = await siteState('tracker.test');
    check('WhatsApp on: cookies, local storage and IndexedDB all kept', Boolean(result?.done) && allKept(wa), JSON.stringify(wa));
    check('Telegram on: cookies, local storage and IndexedDB all kept', allKept(tg), JSON.stringify(tg));
    check('both on: other sites still fully cleared', allGone(tracker), JSON.stringify(tracker));

    // Only Telegram on: the two options are independent.
    await saveSettings(d, { keepWhatsApp: false });
    ({ result } = await usePopup(d));
    wa = await siteState(WA);
    tg = await siteState(TG);
    check('WhatsApp off, Telegram on: WhatsApp cleared, Telegram still kept', Boolean(result?.done) && allGone(wa) && allKept(tg), JSON.stringify({ wa, tg }));

    // Both off.
    await saveSettings(d, { keepTelegram: false });
    ({ result } = await usePopup(d));
    tg = await siteState(TG);
    check('Telegram off: cleared like any other site', Boolean(result?.done) && allGone(tg), JSON.stringify(tg));
  }

  // ---------- 6b. Popup buttons and settings switches stay in sync ----------
  {
    const settingsTab = await d.openExt('options.html');
    const popupTab = await d.openExt('popup.html');
    const switchOn = (page) => page.eval(`document.getElementById('autoClean').checked`);
    const buttonOn = (page) => page.eval(`document.querySelector('.quick button[data-key="autoClean"]').classList.contains('on')`);

    await popupTab.click('.quick button[data-key="autoClean"]');
    await sleep(600);
    check('sync: a popup button flips the switch on an already-open settings page', (await switchOn(settingsTab)) === true && (await buttonOn(popupTab)) === true);

    const secondSettingsTab = await d.openExt('options.html');
    await secondSettingsTab.click('#autoClean');
    await sleep(600);
    const stored = await secondSettingsTab.eval(`${API}.storage.local.get('autoClean')`);
    check('sync: a settings switch saves at once, without pressing Save', stored.autoClean === false);
    check('sync: the open popup and the other settings tab follow', (await buttonOn(popupTab)) === false && (await switchOn(settingsTab)) === false);

    await settingsTab.close();
    await popupTab.close();
    await secondSettingsTab.close();
  }

  // ---------- 6c. Browser update check ----------
  // The answers are planted in storage, so these checks need no network. Only
  // the last one, marked "live", really asks the browser maker's release list.
  // The Update button is not clicked: on Chrome and Brave it opens the page
  // that starts updating the browser installed on this machine.
  {
    const setStored = async (values) => {
      const page = await d.openExt('options.html');
      await page.eval(`${API}.storage.local.set(${JSON.stringify(values)})`);
      await page.close();
    };
    const getStored = async (keys) => {
      const page = await d.openExt('options.html');
      const values = await page.eval(`${API}.storage.local.get(${JSON.stringify(keys)})`);
      await page.close();
      return values;
    };

    const probe = await d.openExt('popup.html');
    const me = await probe.eval('SweepUpdate.detect()');
    await probe.close();
    check('update check: recognises this browser and its version', Boolean(me.id) && /^\d+(\.\d+)+/.test(me.version), JSON.stringify(me));

    ({ view } = await usePopup(d, { run: false }));
    check('update check: off by default, no badge, no note', !view.quick.updateCheck.on && !view.quick.updateCheck.alert && view.note.hidden, JSON.stringify(view.quick.updateCheck));
    check('update check: nothing is looked up while it is off', (await getStored(['updateInfo'])).updateInfo === undefined);

    await setStored({ updateCheck: true, updateInfo: { checkedAt: Date.now(), current: me.version, latest: '999.0.0.0', display: '999.0.0.0', available: true } });
    ({ view } = await usePopup(d, { run: false }));
    check('update available: button lit with a red badge', view.quick.updateCheck.on && view.quick.updateCheck.alert && view.quick.updateCheck.count === '1', JSON.stringify(view.quick.updateCheck));
    check('update available: the note names the new version, fully translated', !view.note.hidden && view.note.text.includes('999.0.0.0') && !/update[A-Z]/.test(view.note.text), view.note.text);
    check('update available: popup still fits a browser popup (at most 600px tall)', view.height <= 600, `${view.height}px`);
    check(d.isFirefox ? 'update available: Firefox says where to update instead of offering a button' : 'update available: an Update button is offered', view.note.button === !d.isFirefox, view.note.text);

    await setStored({ updateInfo: { checkedAt: Date.now(), current: me.version, latest: me.version, display: me.shown, available: false } });
    ({ view } = await usePopup(d, { run: false }));
    check('up to date: button lit, no badge, no note', view.quick.updateCheck.on && !view.quick.updateCheck.alert && view.note.hidden, JSON.stringify(view.quick.updateCheck));

    ({ view } = await usePopup(d, { toggle: 'updateCheck', run: false }));
    check('update check: switches off from the popup', (await getStored(['updateCheck'])).updateCheck === false && !view.quick.updateCheck.on && view.note.hidden);

    const started = Date.now();
    const live = await d.openExt('popup.html');
    await live.click('.quick button[data-key="updateCheck"]');
    let liveView;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      liveView = await live.eval(POPUP_VIEW);
      if (!liveView.note.hidden) break;
    }
    const info = (await getStored(['updateInfo'])).updateInfo;
    await live.close();
    check('live: switching on asks the release list and the popup reports the answer',
      !liveView.note.hidden && Boolean(info) && info.checkedAt >= started && /^\d+(\.\d+)+/.test(info.latest) && liveView.quick.updateCheck.alert === info.available,
      `${liveView.note.text} ${JSON.stringify(info)}`);
    console.log(`        (${liveView.note.text})`);
    await setStored({ updateCheck: false });
  }

  // ---------- 7. Auto-clean ----------
  // Automated loads are not persistent installs, so runtime.onStartup never
  // fires. The startup handler is called directly instead.
  await saveSettings(d, { whitelist: 'keep.test', autoClean: false });
  await seed(d, SITES);
  if (d.restartAndReadHistory) {
    const urls = await d.restartAndReadHistory();
    check('history control: visits to the test sites were recorded', urls.some((u) => u.includes('tracker.test')), `${urls.length} urls`);
  } else {
    const text = await d.liveHistory();
    check('history control: visits to the test sites were recorded', text.includes('tracker.test'));
  }
  await d.autoClean();
  cookies = await d.cookies();
  check('auto-clean off: nothing is removed', cookies.length === 5, cookies.join(' '));

  ({ view } = await usePopup(d, { toggle: 'autoClean', run: false }));
  saved = await saveSettings(d, {});
  check('auto-clean: switched on from the popup button and stored', saved.stored.autoClean === true && !saved.isError, saved.status);
  check('auto-clean: whitelist and auto-clean buttons are lit', view.quick.autoClean.on && view.quick.whitelist.on, JSON.stringify(view.quick));
  await d.autoClean();
  cookies = await d.cookies();
  check('auto-clean on: tracker.test cookies removed', cookiesFor(cookies, 'tracker.test').length === 0, cookies.join(' '));
  check('auto-clean on: whitelisted keep.test cookies kept', cookiesFor(cookies, 'keep.test').length === 3, cookies.join(' '));

  // ---------- 8. History is gone ----------
  if (d.liveHistory) {
    const text = await d.liveHistory();
    check('history: emptied by the clean', !text.includes('tracker.test') && !text.includes('keep.test'));
    check('no script errors in any extension page', d.errors.length === 0, d.errors.join(' | '));
    await d.quit();
  } else {
    const urls = await d.quitAndReadHistory();
    check('history: emptied by the clean', urls.length === 0, urls.join(' '));
  }
}
