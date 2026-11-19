'use strict';

const { api, t, TYPES } = Sweep;

const RANGE_LABELS = [
  ['hour', 'rangeHourShort'],
  ['day', 'rangeDayShort'],
  ['week', 'rangeWeekShort'],
  ['month', 'rangeMonthShort'],
  ['all', 'rangeAllShort'],
];
const SVG_NS = 'http://www.w3.org/2000/svg';

const els = {
  range: document.getElementById('range'),
  types: document.getElementById('types'),
  status: document.getElementById('status'),
  settings: document.getElementById('settings'),
  run: document.getElementById('run'),
  runIcon: document.getElementById('runIcon'),
  runLabel: document.getElementById('runLabel'),
  count: document.getElementById('count'),
  updateNote: document.getElementById('updateNote'),
};

let state = { range: 'all', types: {} };
let extras = { whitelist: [], useWhitelist: false, keepWhatsApp: false, keepTelegram: false, autoClean: false, updateCheck: false };
let doneTimer = 0;

// Browser update check: the last answer from SweepUpdate.check() (or { error: true }),
// whether this browser has a release list at all, and whether to say "up to date"
// out loud, which is only done right after the check is switched on here.
let update = null;
let updateSupported = true;
let announceUpdate = false;

// The row of small buttons under the time range: whitelist, WhatsApp, Telegram, auto-clean, update check.
const quick = document.getElementById('quick');

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function save() {
  return Sweep.saveSettings({ range: state.range, types: state.types });
}

// ---- Is there anything to clear? ----
// Each tile gets a dot when its kind of data has something to clear in the
// chosen time range. Sweep.needsCleaning() explains how that is known.
async function refreshMarkers() {
  const run = ++markerRun;
  let found = {};
  try {
    found = await Sweep.needsCleaning(state.range);
  } catch {
    // Leave the tiles unmarked rather than guess.
  }
  if (run !== markerRun) return; // a newer answer is already on its way
  hasData = found;
  for (const tile of els.types.querySelectorAll('.tile')) markTile(tile);
  els.types.dataset.marked = '1';
}

function markTile(tile) {
  const dirty = hasData[tile.dataset.type] === true;
  tile.classList.toggle('has-data', dirty);
  tile.title = tile.dataset.type in hasData ? t(dirty ? 'hasData' : 'noData') : '';
}

let hasData = {};
let markerRun = 0;

// ---- Keep lists: what is in an item, and what to never clear ----
// The magnifier on a tile opens this view in place of the main one. It is one
// list of sites (see Sweep.foundSites) with a switch on each: on means the
// site is never cleared for this item. The box above the list searches it and
// adds a site that is not in it.
const detail = {
  root: document.getElementById('detail'),
  back: document.getElementById('detailBack'),
  title: document.getElementById('detailTitle'),
  note: document.getElementById('detailNote'),
  picker: document.getElementById('detailPicker'),
  form: document.getElementById('keepForm'),
  input: document.getElementById('keepInput'),
  filter: document.getElementById('keepFilter'),
  list: document.getElementById('siteList'),
  status: document.getElementById('detailStatus'),
};

let keep = {}; // { typeId: [host, ...] }
let detailType = null;
let foundSites = []; // [{ host, count }], the fullest first
// The hosts in the order they are listed. It is set when the view opens and
// then left alone, so a row does not jump away when its switch is flipped.
let siteOrder = [];
let keepFilter = 'all'; // or 'kept'

const keptHosts = () => keep[detailType.id] || [];

function setDetailStatus(text, isError = false) {
  detail.status.textContent = text;
  detail.status.classList.toggle('error', isError);
}

// Kept sites first, then the rest with the fullest on top.
function orderSites() {
  const kept = keptHosts();
  const found = foundSites.map((site) => site.host);
  siteOrder = [
    ...kept.filter((host) => !found.includes(host)),
    ...found.filter((host) => kept.includes(host)),
    ...found.filter((host) => !kept.includes(host)),
  ];
}

// What the box holds: a site name when it reads as one, otherwise plain text
// to look for. "https://Example.com/page" reads as the site example.com.
function typedQuery() {
  const raw = detail.input.value.trim().toLowerCase();
  if (!raw) return { text: '', site: null };
  const { domains, invalid } = Sweep.parseWhitelist(raw);
  const site = domains.length === 1 && !invalid.length ? domains[0] : null;
  return { text: site || raw, site };
}

function siteRow(host, isKept, count) {
  const row = el('li', isKept ? 'site kept' : 'site');
  row.dataset.host = host;
  const label = el('label');
  label.title = host;
  const toggle = el('input', 'switch');
  toggle.type = 'checkbox';
  toggle.checked = isKept;
  toggle.setAttribute('role', 'switch');
  toggle.addEventListener('change', () => {
    setKept(toggle.checked ? [...keptHosts(), host] : keptHosts().filter((other) => other !== host), host);
  });
  // A letter stands in for the site's icon; fetching real ones would mean going online.
  label.append(el('span', 'avatar', host.replace(/^www\./, '').charAt(0)), el('span', 'host', host));
  if (count !== undefined) label.append(el('span', 'count', String(count)));
  label.append(toggle);
  row.append(label);
  return row;
}

function renderSites() {
  const kept = keptHosts();
  const counts = new Map(foundSites.map((site) => [site.host, site.count]));
  const { text, site } = typedQuery();
  const shown = siteOrder.filter((host) => (keepFilter === 'all' || kept.includes(host)) && host.includes(text));

  const scrolled = detail.list.scrollTop;
  detail.list.textContent = '';

  if (site && !siteOrder.includes(site)) {
    // Typed in full and not in the list: offer to add it.
    const row = el('li', 'add');
    const button = el('button', '', t('keepAddSite', [site]));
    button.type = 'button';
    button.prepend(icon('plus'));
    button.addEventListener('click', addTyped);
    row.append(button);
    detail.list.append(row);
  } else if (!shown.length) {
    detail.list.append(el('li', 'empty', t(text ? 'keepNoMatch' : keepFilter === 'kept' ? 'keepNoneKept' : 'keepNoneFound')));
  }
  for (const host of shown) detail.list.append(siteRow(host, kept.includes(host), counts.get(host)));
  detail.list.scrollTop = scrolled;

  for (const radio of detail.filter.querySelectorAll('input')) radio.checked = radio.value === keepFilter;
  detail.filter.querySelector('[data-count="all"]').textContent = String(siteOrder.length);
  detail.filter.querySelector('[data-count="kept"]').textContent = String(kept.length);
}

function keepNoteKey(typeId) {
  return { history: 'keepNoteHistory', downloads: 'keepNoteDownloads', cookies: 'keepNoteCookies' }[typeId] || 'keepNoteSites';
}

// Only reached from the magnifier, which a tile has only when its data can be
// kept site by site (see Sweep.canKeep).
async function openDetail(type) {
  detailType = type;
  foundSites = [];
  keepFilter = 'all';
  detail.input.value = '';
  document.body.classList.add('detail-open');
  detail.root.hidden = false;
  detail.title.textContent = `${t('type_' + type.id)} · ${t('keepKept')}`;
  detail.note.textContent = t(keepNoteKey(type.id));
  detail.root.dataset.loaded = '0';
  setDetailStatus('');

  orderSites();
  renderSites();
  try {
    const sites = await Sweep.foundSites(type.id);
    if (detailType !== type) return; // another item was opened meanwhile
    foundSites = sites;
  } catch {
    // No permission or no such API: sites can still be typed in.
  }
  orderSites();
  renderSites();
  detail.root.dataset.loaded = '1';
}

function closeDetail() {
  detailType = null;
  document.body.classList.remove('detail-open');
  detail.root.hidden = true;
  renderTypes(); // the magnifiers show which items have a keep list
  refreshMarkers();
}

// Replaces the keep list of the open item and saves it. `focusHost` is the row
// whose switch was just flipped, so the keyboard stays on it.
async function setKept(hosts, focusHost) {
  const type = detailType;
  keep = { ...keep, [type.id]: [...new Set(hosts)] };
  // A newly typed site goes on top, where it can be seen.
  for (const host of keep[type.id]) if (!siteOrder.includes(host)) siteOrder.unshift(host);
  renderSites();
  if (focusHost) detail.list.querySelector(`li[data-host="${CSS.escape(focusHost)}"] input`)?.focus();
  // Firefox can only spare cookies when it may list them, and only lets an
  // extension ask for that while a click is being handled, so ask first.
  let granted = true;
  if (Sweep.IS_FIREFOX && type.id === 'cookies' && hosts.length) {
    granted = await api.permissions.request(Sweep.COOKIE_PERMISSIONS);
  }
  await Sweep.saveSettings({ keep });
  setDetailStatus(granted ? '' : t('errCookiePermission'), !granted);
}

// Keeps what is typed in the box, if it is a site.
function addTyped() {
  const { domains, invalid } = Sweep.parseWhitelist(detail.input.value);
  if (invalid.length) {
    setDetailStatus(`${t('errInvalid')} ${invalid.join(', ')}`, true);
    return;
  }
  if (!domains.length) return;
  detail.input.value = '';
  setKept([...keptHosts(), ...domains]);
}

for (const [value, labelKey] of [['all', 'keepAll'], ['kept', 'keepKeptShort']]) {
  const label = el('label');
  const radio = el('input');
  radio.type = 'radio';
  radio.name = 'keepFilter';
  radio.value = value;
  radio.addEventListener('change', () => {
    keepFilter = value;
    renderSites();
  });
  const text = el('span', '', `${t(labelKey)} `);
  const count = el('b');
  count.dataset.count = value;
  text.append(count);
  label.append(radio, text);
  detail.filter.append(label);
}
detail.filter.setAttribute('aria-label', t('keepKept'));
detail.input.placeholder = t('keepSearch');
detail.input.setAttribute('aria-label', t('keepSearch'));

detail.back.addEventListener('click', closeDetail);
detail.input.addEventListener('input', () => {
  setDetailStatus('');
  renderSites();
});
detail.form.addEventListener('submit', (event) => {
  event.preventDefault();
  addTyped();
});

function selectedCount() {
  return TYPES.filter((type) => state.types[type.id] && !Sweep.isBlocked(type, state.range)).length;
}

function updateRunButton() {
  const count = selectedCount();
  els.count.textContent = String(count);
  els.run.disabled = count === 0 || els.run.classList.contains('busy');
}

function renderRange() {
  els.range.textContent = '';
  for (const [value, labelKey] of RANGE_LABELS) {
    const label = el('label');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'range';
    radio.value = value;
    radio.checked = state.range === value;
    radio.addEventListener('change', () => {
      state.range = value;
      save();
      renderTypes();
      refreshMarkers();
    });
    label.append(radio, el('span', '', t(labelKey)));
    els.range.append(label);
  }
}

function renderTypes() {
  els.types.textContent = '';
  for (const type of TYPES) {
    const blocked = Sweep.isBlocked(type, state.range);
    const tile = el('label', 'tile');
    tile.dataset.type = type.id;
    if (type.danger) tile.classList.add('danger');
    if (blocked) tile.classList.add('off');

    const box = el('input');
    box.type = 'checkbox';
    box.checked = state.types[type.id] && !blocked;
    box.disabled = blocked;
    box.addEventListener('change', () => {
      state.types[type.id] = box.checked;
      save();
      updateRunButton();
    });

    const badge = el('span', 'ico');
    badge.append(icon(type.id));

    const text = el('span', 'txt');
    text.append(el('span', 'name', t('type_' + type.id)));
    if (blocked) text.append(el('small', '', t('allTimeOnly')));

    // The dot on the icon shows when this kind of data has something to clear.
    badge.append(el('span', 'dot'));

    tile.append(box, badge, text);

    // The magnifier opens the list of what is here and what to always keep,
    // and is lit when the item has such a list. Data the browser can only
    // clear all at once (form data, for one) has nothing to show, so no magnifier.
    if (Sweep.canKeep(type.id)) {
      const look = el('button', (keep[type.id] || []).length ? 'look on' : 'look');
      look.type = 'button';
      look.dataset.look = type.id;
      look.title = t('keepLook');
      look.setAttribute('aria-label', `${t('type_' + type.id)}: ${t('keepLook')}`);
      look.append(icon('search'));
      look.addEventListener('click', (event) => {
        event.preventDefault(); // the tile is a label; do not toggle its checkbox
        event.stopPropagation();
        openDetail(type);
      });
      tile.append(look);
    }
    markTile(tile);
    els.types.append(tile);
  }
  updateRunButton();
}

function renderQuick() {
  quick.textContent = '';
  const add = ({ key, iconName, label, on, disabled = false, count = 0, alert = false, onClick }) => {
    const button = el('button', on ? 'on' : '');
    button.type = 'button';
    button.dataset.key = key;
    button.title = label;
    button.disabled = disabled;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(on));
    button.append(icon(iconName));
    if (alert) button.append(el('span', 'n alert', '1'));
    else if (count) button.append(el('span', 'n', String(count)));
    button.addEventListener('click', onClick);
    quick.append(button);
  };
  const toggle = (key) => async () => {
    extras[key] = !extras[key];
    renderQuick();
    await Sweep.saveSettings({ [key]: extras[key] });
  };

  // Switches the whitelist on or off. Switched on with nothing in it, it also
  // opens the settings page, where the domains are typed.
  add({
    key: 'whitelist',
    iconName: 'shield',
    label: `${t('whitelistLabel')} (${extras.whitelist.length})`,
    on: extras.useWhitelist,
    count: extras.useWhitelist ? extras.whitelist.length : 0,
    onClick: async () => {
      await toggle('useWhitelist')();
      if (extras.useWhitelist && extras.whitelist.length === 0) api.runtime.openOptionsPage();
    },
  });
  for (const [key, iconName] of [['keepWhatsApp', 'chat'], ['keepTelegram', 'plane']]) {
    add({
      key,
      iconName,
      label: t(Sweep.KEEP_SITES_SUPPORTED ? key : 'keepSitesNoteFirefox'),
      on: extras[key],
      disabled: !Sweep.KEEP_SITES_SUPPORTED,
      onClick: toggle(key),
    });
  }
  add({
    key: 'autoClean',
    iconName: 'repeat',
    label: t('autoClean'),
    on: extras.autoClean,
    onClick: toggle('autoClean'),
  });
  // Lit while the check is on; the red badge means a newer browser version is out.
  add({
    key: 'updateCheck',
    iconName: 'update',
    label: t(updateSupported ? 'updateCheck' : 'updateNoteUnsupported'),
    on: extras.updateCheck,
    disabled: !updateSupported,
    alert: extras.updateCheck && Boolean(update?.available),
    onClick: async () => {
      await toggle('updateCheck')();
      announceUpdate = extras.updateCheck;
      await refreshUpdate(true);
    },
  });
}

// The line under the buttons: what the update check found, and a way to act on it.
function renderUpdateNote() {
  const note = els.updateNote;
  const text = note.querySelector('span');
  const button = note.querySelector('button');
  const show = (message, { alert = false, page = null } = {}) => {
    text.textContent = message;
    note.classList.toggle('alert', alert);
    button.hidden = !page;
    button.onclick = page ? () => api.tabs.create({ url: page }) : null;
    note.hidden = false;
  };

  if (!extras.updateCheck || !update) {
    note.hidden = true;
  } else if (update.error) {
    if (announceUpdate) show(t('updateFailed')); else note.hidden = true;
  } else if (update.available) {
    const message = t('updateAvailable', [update.name, update.latest, update.shown]);
    show(update.updatePage ? message : `${message} ${t('updateHowFirefox')}`, { alert: true, page: update.updatePage });
  } else if (announceUpdate) {
    show(t('updateNone', [update.name, update.shown]));
  } else {
    note.hidden = true;
  }
}

// Asks for the newest browser version when the check is on. `force` skips the stored answer.
async function refreshUpdate(force) {
  if (!extras.updateCheck) {
    update = null;
  } else {
    try {
      update = await SweepUpdate.check(force);
    } catch {
      update = { error: true };
    }
  }
  renderQuick();
  renderUpdateNote();
}

function setRunState(mode) {
  clearTimeout(doneTimer);
  els.run.classList.toggle('busy', mode === 'busy');
  els.run.classList.toggle('done', mode === 'done');
  els.runIcon.setAttribute('href', mode === 'done' ? '#i-check' : mode === 'busy' ? '#i-spinner' : '#i-sparkle');
  els.runLabel.textContent = t(mode === 'busy' ? 'statusCleaning' : mode === 'done' ? 'statusDone' : 'btnClean');
  updateRunButton();
  if (mode === 'done') doneTimer = setTimeout(() => setRunState('idle'), 1800);
}

async function run() {
  setStatus('');
  setRunState('busy');
  const started = Date.now();
  try {
    await save();
    const reply = await api.runtime.sendMessage({ type: 'clean' });
    // Most cleans finish in an instant; keep the spinner up long enough to be seen.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 700 - (Date.now() - started))));
    if (!reply?.ok) throw new Error(reply?.error || 'No response from background script.');
    if (reply.cleaned) {
      setRunState('done');
      refreshMarkers(); // the dots go out, which shows the clean worked
    } else {
      setRunState('idle');
      setStatus(t('statusNothing'), true);
    }
  } catch (error) {
    setRunState('idle');
    setStatus(error?.message || String(error), true);
  }
}

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(node.dataset.i18n);
}
document.documentElement.lang = api.i18n.getUILanguage();
els.settings.title = t('btnSettings');
els.settings.setAttribute('aria-label', t('btnSettings'));
detail.back.title = t('keepBack');
detail.back.setAttribute('aria-label', t('keepBack'));

els.settings.addEventListener('click', () => api.runtime.openOptionsPage());
els.run.addEventListener('click', run);

// Follow changes made on the settings page while the popup is open.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let changed = false;
  let updateSwitched = false;
  for (const key of ['useWhitelist', 'keepWhatsApp', 'keepTelegram', 'autoClean', 'updateCheck']) {
    if (!changes[key]) continue;
    const value = changes[key].newValue === true;
    if (extras[key] === value) continue; // this popup made the change itself
    extras[key] = value;
    changed = true;
    if (key === 'updateCheck') updateSwitched = true;
  }
  if (changes.whitelist) {
    extras.whitelist = changes.whitelist.newValue || [];
    changed = true;
  }
  if (changed) renderQuick();
  if (updateSwitched) refreshUpdate(false);
  // Keep lists changed in another popup or tab.
  if (changes.keep && JSON.stringify(changes.keep.newValue || {}) !== JSON.stringify(keep)) {
    keep = changes.keep.newValue || {};
    if (detailType) {
      // Sites kept elsewhere may not be listed here yet.
      for (const host of keptHosts()) if (!siteOrder.includes(host)) siteOrder.unshift(host);
      renderSites();
    } else {
      renderTypes();
    }
    refreshMarkers();
  }
});

// If the background script is from an older build, this reloads the extension.
Sweep.ensureFresh();

Sweep.loadSettings().then(
  (settings) => {
    state = { range: settings.range, types: settings.types };
    keep = settings.keep;
    extras = { whitelist: settings.whitelist, useWhitelist: settings.useWhitelist, keepWhatsApp: settings.keepWhatsApp, keepTelegram: settings.keepTelegram, autoClean: settings.autoClean, updateCheck: settings.updateCheck };
    renderRange();
    renderQuick();
    renderTypes();
    SweepUpdate.detect().then((browser) => {
      updateSupported = Boolean(browser.id);
      renderQuick();
    }, () => {});
    if (extras.updateCheck) refreshUpdate(false);
    refreshMarkers();
  },
  (error) => setStatus(error?.message || String(error), true),
);
