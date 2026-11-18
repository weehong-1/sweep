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

    // Shown when this kind of data has something to clear.
    tile.append(box, badge, text, el('span', 'dot'));
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
});

Sweep.loadSettings().then(
  (settings) => {
    state = { range: settings.range, types: settings.types };
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
