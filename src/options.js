'use strict';

const { api, t, IS_FIREFOX, COOKIE_PERMISSIONS } = Sweep;

// One switch per built-in "stay signed in" site: keepWhatsApp, keepTelegram.
const KEEP_KEYS = Object.keys(Sweep.KEEP_SITES);
// Switches take effect as soon as they are flipped. Only the whitelist, which
// is typed, waits for the Save button.
const SWITCH_KEYS = ['autoClean', 'updateCheck', 'useWhitelist', ...KEEP_KEYS];

const els = {
  whitelist: document.getElementById('whitelist'),
  hint: document.getElementById('whitelistHint'),
  status: document.getElementById('status'),
  save: document.getElementById('save'),
};

// True while the whitelist box holds edits that have not been saved.
let whitelistDirty = false;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

async function saveSwitch(key, checked) {
  try {
    await Sweep.saveSettings({ [key]: checked });
    setStatus(t('statusSaved'));
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
}

async function saveWhitelist() {
  // parseWhitelist is synchronous on purpose: Firefox only allows
  // permissions.request() while the click is still being handled.
  const { domains, invalid } = Sweep.parseWhitelist(els.whitelist.value);
  if (invalid.length) {
    setStatus(`${t('errInvalid')} ${invalid.join(', ')}`, true);
    return;
  }

  try {
    let granted = true;
    if (IS_FIREFOX) {
      if (domains.length) {
        granted = await api.permissions.request(COOKIE_PERMISSIONS);
      } else {
        await api.permissions.remove(COOKIE_PERMISSIONS);
      }
    }
    // Saving a list turns it on; saving an empty one turns it off.
    await Sweep.saveSettings({ whitelist: domains, useWhitelist: domains.length > 0 });
    whitelistDirty = false;
    els.whitelist.value = domains.join('\n');
    setStatus(t(granted ? 'statusSaved' : 'errCookiePermission'), !granted);
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
}

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(node.dataset.i18n);
}
els.hint.textContent = t(IS_FIREFOX ? 'whitelistHintFirefox' : 'whitelistHintChromium');
for (const key of KEEP_KEYS) {
  document.getElementById(key + 'Note').textContent = t(Sweep.KEEP_SITES_SUPPORTED ? key + 'Note' : 'keepSitesNoteFirefox');
  document.getElementById(key).disabled = !Sweep.KEEP_SITES_SUPPORTED;
}
// The update check names who it contacts, which depends on the browser.
SweepUpdate.detect().then((browser) => {
  const noteKey = { chrome: 'updateNoteChrome', brave: 'updateNoteBrave', firefox: 'updateNoteFirefox' }[browser.id] || 'updateNoteUnsupported';
  document.getElementById('updateCheckNote').textContent = t(noteKey);
  document.getElementById('updateCheck').disabled = !browser.id;
}, () => {});
document.documentElement.lang = api.i18n.getUILanguage();
document.title = `${t('extName')} · ${t('optTitle')}`;

for (const key of SWITCH_KEYS) {
  const box = document.getElementById(key);
  box.addEventListener('change', () => saveSwitch(key, box.checked));
}
els.whitelist.addEventListener('input', () => { whitelistDirty = true; });
els.save.addEventListener('click', saveWhitelist);

// Follow changes made elsewhere (the popup's buttons, another settings tab).
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of SWITCH_KEYS) {
    if (changes[key]) document.getElementById(key).checked = changes[key].newValue === true;
  }
  if (changes.whitelist && !whitelistDirty) {
    els.whitelist.value = (changes.whitelist.newValue || []).join('\n');
  }
});

Sweep.loadSettings().then(
  (settings) => {
    for (const key of SWITCH_KEYS) document.getElementById(key).checked = settings[key];
    els.whitelist.value = settings.whitelist.join('\n');
  },
  (error) => setStatus(error?.message || String(error), true),
);
