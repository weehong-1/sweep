'use strict';

// End-to-end tests for Sweep.
//
//   node tests/e2e/run.js            every installed browser (Brave, Chrome, Edge, Firefox)
//   node tests/e2e/run.js chrome     one browser: brave, chrome, edge or firefox
//   node tests/e2e/run.js chromium   every installed Chromium browser
//
// Run build.ps1 first (test.ps1 does both). Each browser starts with a new
// throwaway profile in the system temp folder, which is deleted afterwards, so
// your own browsing data is never touched. Needs Node 22 or newer; no packages.
//
// Browser paths can be overridden with SWEEP_BRAVE, SWEEP_CHROME, SWEEP_EDGE and SWEEP_FIREFOX.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scenario = require('./scenario');

const { BROWSERS, GROUPS } = require('./browsers');

async function runOne(name) {
  const browser = BROWSERS[name];
  const results = [];
  const check = (title, pass, detail = '') => {
    results.push({ title, pass: Boolean(pass) });
    const extra = !pass && detail ? `  -> ${detail}` : '';
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${title}${extra}`);
  };

  const exe = browser.exe();
  if (!exe) return { name, skipped: 'not installed', results };
  if (!fs.existsSync(path.join(browser.extDir, 'manifest.json'))) {
    return { name, skipped: `${browser.extDir} is missing, run build.ps1 first`, results };
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `sweep-e2e-${name}-`));
  let driver;
  try {
    driver = await browser.launch({ exe, extDir: browser.extDir, profileDir });
    console.log(`\n${name}: ${driver.label}`);
    await scenario(driver, check);
  } catch (error) {
    if (!driver) console.log(`\n${name}:`);
    check('scenario ran to the end', false, error.message);
  } finally {
    if (driver) await driver.quit().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      console.log(`  (could not delete ${profileDir})`);
    }
  }
  return { name, skipped: '', results };
}

// If the event loop ever runs dry before the summary, say so instead of exiting 0.
let finished = false;
process.on('exit', (code) => {
  if (!finished && code === 0) {
    console.error('\nThe test run stopped before finishing.');
    process.exitCode = 1;
  }
});

(async () => {
  const args = process.argv.slice(2);
  const unknown = args.filter((n) => !BROWSERS[n] && !GROUPS[n]);
  if (unknown.length) {
    console.error(`Unknown browser: ${unknown.join(', ')}. Use brave, chrome, edge, firefox or chromium.`);
    finished = true;
    process.exit(2);
  }
  const wanted = args.length ? [...new Set(args.flatMap((n) => GROUPS[n] || [n]))] : Object.keys(BROWSERS);
  // Naming a browser makes it required; otherwise a missing one is just skipped.
  const required = new Set(args.filter((n) => BROWSERS[n]));

  const summaries = [];
  for (const name of wanted) summaries.push(await runOne(name));

  console.log('\nSummary');
  let failed = 0;
  let ran = 0;
  for (const { name, skipped, results } of summaries) {
    if (skipped) {
      console.log(`  ${name}: ${required.has(name) ? 'NOT RUN' : 'skipped'} (${skipped})`);
      if (required.has(name)) failed++;
      continue;
    }
    ran++;
    const bad = results.filter((r) => !r.pass);
    failed += bad.length;
    console.log(`  ${name}: ${results.length - bad.length}/${results.length} passed`);
    for (const r of bad) console.log(`    FAIL  ${r.title}`);
  }
  finished = true;
  process.exit(failed || !ran ? 1 : 0);
})();
