# Sweep privacy policy

Sweep is a browser extension that clears browsing data. This policy describes what it does with information on your device.

## Summary

Sweep does not collect, store on any server, sell or share any information about you. It has no account, no analytics and no advertising. Everything it does happens in your own browser.

## What Sweep accesses

- **Browsing data you ask it to clear.** When you press Clean, or when automatic cleaning is on, Sweep tells the browser to remove the kinds of data you selected: history, download history, cache, form data, cookies and site storage. Apart from what is described below for history and downloads, Sweep does not read the contents of that data.
- **Browsing history and download history.** Sweep uses these in three ways, all on your device:
  - It asks the browser whether there are history entries and download entries in the time range you chose, and whether pages were visited since the last clean, to show a dot on the items that have something to clear.
  - When you open an item's keep list, it shows you the names of the sites in your history (for Downloads, the sites you downloaded from) and how many entries each has, so you can choose sites that are never cleared.
  - When you have chosen sites to keep for history or downloads, it removes the entries one by one and leaves those of the kept sites. For downloads it removes the record only, never the downloaded file.

  Site names are shown only to you, in the popup. Sweep does not transmit addresses, site names or file names anywhere.
- **Cookie host names (Firefox only, and only if you use the cookie whitelist or keep cookies for some sites).** To leave those sites alone, Sweep lists which sites have cookies. It does not read cookie values.

## What Sweep stores

Sweep saves its own settings in the browser's local extension storage on your device: the kinds of data you selected, the time range, your cookie whitelist, the names of the sites you chose to keep for each kind of data, the on/off switches, the time each kind of data was last cleared, and the result of the last browser update check. These settings are not synced and never leave your device. Removing the extension removes them.

## Network use

Sweep uses the network for one optional feature, which is off unless you switch it on: **Check for browser updates**. When it is on, Sweep requests a public list of browser releases, at most once every 6 hours, to compare against your browser's version:

- Chrome: Google's version history service (`versionhistory.googleapis.com`)
- Brave: the public release information for Brave on GitHub (`api.github.com`)
- Firefox: Mozilla's product details service (`product-details.mozilla.org`)

The request contains no information about you or your browsing. As with any web request, the service receiving it can see your IP address. With the feature off, Sweep makes no network requests at all.

## Changes

If this policy changes, the new version will be published at the same address.

## Contact

Questions about this policy can be sent to the developer through <https://github.com/weehong-1/sweep/issues>, or through the contact details on the extension's store page.
