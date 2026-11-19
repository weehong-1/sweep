# Sweep privacy policy

Sweep is a browser extension that clears browsing data. This policy describes what it does with information on your device.

## Summary

Sweep does not collect, store on any server, sell or share any information about you. It has no account, no analytics and no advertising. Everything it does happens in your own browser.

## What Sweep accesses

- **Browsing data you ask it to clear.** When you press Clean, or when automatic cleaning is on, Sweep tells the browser to remove the kinds of data you selected: history, download history, cache, form data, cookies and site storage. Sweep does not read the contents of that data.
- **Browsing history and download history.** Sweep asks the browser whether there are history entries and download entries in the time range you chose, and whether pages were visited since the last clean. It uses the answer only to show a dot on the items that have something to clear. It does not keep, display or transmit the addresses or file names.
- **Cookie host names (Firefox only, and only if you use the cookie whitelist).** To leave whitelisted sites alone, Sweep lists which sites have cookies. It does not read cookie values.

## What Sweep stores

Sweep saves its own settings in the browser's local extension storage on your device: the kinds of data you selected, the time range, your cookie whitelist, the on/off switches, the time each kind of data was last cleared, and the result of the last browser update check. These settings are not synced and never leave your device. Removing the extension removes them.

## Network use

Sweep uses the network for one optional feature, which is off unless you switch it on: **Check for browser updates**. When it is on, Sweep requests a public list of browser releases, at most once every 6 hours, to compare against your browser's version:

- Chrome: Google's version history service (`versionhistory.googleapis.com`)
- Brave: the public release information for Brave on GitHub (`api.github.com`)
- Firefox: Mozilla's product details service (`product-details.mozilla.org`)

The request contains no information about you or your browsing. As with any web request, the service receiving it can see your IP address. With the feature off, Sweep makes no network requests at all.

## Changes

If this policy changes, the new version will be published at the same address.

## Contact

Questions about this policy can be sent to the developer through the contact details on the extension's Chrome Web Store page.
