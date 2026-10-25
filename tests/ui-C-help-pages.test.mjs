// Area C (help pages): both guides share the app's look and the private-preview line, the import guide stays
// link-free, the setup guide quotes the app's own messages, and every documented rejection message is real.
// Adapted from the help audit's proposed tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderPriceSetup } from '../dist/lib/price-setup.js';

const read = name => readFileSync(new URL(`../dist/help/${name}`, import.meta.url), 'utf8');
const parse = html => JSON.parse(execFileSync('python3', [fileURLToPath(new URL('./fixtures/html-tree.py', import.meta.url))], { input: html, encoding: 'utf8' }));
const all = (node, predicate) => typeof node === 'string' ? [] : [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(child, predicate))];
const plain = node => typeof node === 'string' ? node : node.children.map(plain).join('');
const importDoc = parse(read('price-import.html'));
const setupDoc = parse(read('market-data-setup.html'));
const styleOf = doc => { const styles = all(doc, node => node.tag === 'style'); assert.equal(styles.length, 1); return plain(styles[0]); };
const cspOf = doc => all(doc, node => node.tag === 'meta' && node.attrs['http-equiv'] === 'Content-Security-Policy')[0]?.attrs.content || '';
const withoutPre = doc => { const strip = node => typeof node === 'string' ? node : { ...node, children: node.children.filter(child => typeof child === 'string' || child.tag !== 'pre').map(strip) }; return plain(strip(doc)); };
// The app's private-preview line, with "unvalidated" explained on its first use on each help page (charter glossary).
const g1 = 'Private preview of unvalidated research (not proven to work; a test may have failed). Nothing here is a forecast or a recommendation.';
const withoutGlosses = text => text.replace(/ \([^)]*\)/g, '');

test('every rejection message the import guide names is one the parser can produce, and every reachable one is named', () => {
  const source = readFileSync(new URL('../dist/lib/prices.js', import.meta.url), 'utf8');
  const dts = all(importDoc, node => node.tag === 'dt').map(plain).filter(text => !text.startsWith('“'));
  const named = dts.flatMap(text => text.split(', ')).map(text => text.trim().replaceAll(' ', '_'));
  assert.ok(named.length >= 30, `expected the full list, got ${named.length}`);
  for (const code of named) {
    const literal = code.replace(/^source_(capturedAt|publishedAt)_invalid$/, 'source_${key}_invalid');
    assert.ok(source.includes(`'${code}'`) || source.includes(literal), `help names an unknown code: ${code}`);
  }
  const region = source.slice(source.indexOf('function sourceFields'), source.indexOf('function inspectCalendar'));
  const emitted = [...region.matchAll(/(?:issues\.push\(|fail\(|\[(?:\.\.\.issues,)?)'([a-z]+(?:_[a-z]+)+)'/g)].map(match => match[1])
    .filter(code => /_(invalid|required|failed|key|deep|series|capture|inconsistent|unsupported|missing|duplicate)$/.test(code));
  // Not reachable from the upload form: CSV is never sent, the clock is the app's own, and the import
  // path always rebuilds source with channel "manual_import".
  const internal = new Set(['assessment_clock_invalid', 'csv_metadata_required', 'csv_header_invalid', 'import_format_unsupported', 'source_channel_invalid', 'source_metadata_required']);
  for (const code of new Set(emitted)) if (!internal.has(code)) assert.ok(named.includes(code), `parser code missing from help: ${code}`);
  const appMessage = readFileSync(new URL('../dist/lib/desk-tools.js', import.meta.url), 'utf8').includes("'Choose a JSON price file under 2 MiB.'");
  assert.ok(appMessage && dts.length < all(importDoc, node => node.tag === 'dt').length, 'the quoted app message is the real one');
});

test('the import guide stays link-free and tells the reader how to get back', () => {
  assert.equal(all(importDoc, node => node.tag === 'a').length, 0, 'No dataset download or provider request from the reference');
  const main = all(importDoc, node => node.tag === 'main')[0];
  const blocks = main.children.filter(child => typeof child !== 'string');
  const h1 = blocks.findIndex(node => node.tag === 'h1');
  assert.equal(plain(blocks[h1]), 'Prepare a daily price file');
  assert.equal(blocks[h1 + 1].tag, 'p');
  assert.equal(plain(blocks[h1 + 1]), 'This guide opened in a new tab. Close this tab to return to Prices. Your imported prices stay in the app tab.');
  assert.equal(plain(all(importDoc, node => node.tag === 'title')[0]), 'Prepare a daily price file · Cribscore help');
  assert.match(withoutPre(importDoc), /It is only for practicing the format\. It is not real market data, past or present\. It has no verified source, trading calendar, record of splits and dividends, or chart link\./);
  assert.match(withoutPre(importDoc), /Its link “How to set up the price feed” opens the setup guide\./);
});

test('the setup guide is accessible static text with a matching CSP, a same-tab way back and honest limits', () => {
  assert.equal(all(setupDoc, node => node.tag === 'html')[0].attrs.lang, 'en');
  assert.equal(all(setupDoc, node => node.tag === 'main').length, 1);
  assert.equal(all(setupDoc, node => node.tag === 'h1').length, 1);
  assert.equal(plain(all(setupDoc, node => node.tag === 'title')[0]), 'Set up the price feed · Cribscore help');
  assert.equal(all(setupDoc, node => ['script', 'iframe', 'form', 'input', 'button', 'img', 'object', 'embed', 'base'].includes(node.tag)).length, 0);
  assert.equal(all(setupDoc, node => Object.keys(node.attrs).some(key => /^on/i.test(key) || ['src', 'srcdoc', 'download'].includes(key))).length, 0);
  const links = all(setupDoc, node => node.tag === 'link');
  assert.deepEqual(links.map(node => [node.attrs.rel, node.attrs.href, node.attrs.type]), [['icon', '../favicon.svg', 'image/svg+xml']]);
  const csp = cspOf(setupDoc);
  assert.ok(csp.includes(`style-src 'sha256-${createHash('sha256').update(styleOf(setupDoc)).digest('base64')}'`));
  for (const directive of ["default-src 'none'", "img-src 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(directive), directive);
  const base = 'https://example.test/help/market-data-setup.html';
  const anchors = all(setupDoc, node => node.tag === 'a');
  for (const a of anchors) {
    const url = new URL(a.attrs.href, base);
    if (url.origin === 'https://example.test') { assert.ok(!('target' in a.attrs), 'same-site links stay in this tab'); continue; }
    assert.equal(url.protocol, 'https:');
    assert.equal(a.attrs.target, '_blank');
    assert.deepEqual(a.attrs.rel.split(' ').sort(), ['noopener', 'noreferrer']);
    assert.equal(plain(all(a, node => (node.attrs.class || '') === 'sr-only')[0]), ' (opens in a new tab)');
  }
  const back = anchors.filter(a => { const url = new URL(a.attrs.href, base); return url.pathname === '/index.html' && url.hash === '#prices'; });
  assert.equal(back.length, 1);
  assert.equal(plain(back[0]).replace('←', ''), 'Back to Prices');
  assert.ok(anchors.some(a => a.attrs.href === 'https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf'));
  const text = plain(setupDoc);
  for (const pattern of [/Price capture is currently off\./, /This check reads configuration status only\. It does not contact Alpaca or download prices\./, /are not enough on their own\. They do not make data ready for journal valuation/, /Do not assume a free plan covers every operation\./, /Keep credentials out of source files and browser inputs\./, /still need to be verified before capture can be turned on\./, /at least 15 minutes old/, /Captured data starts out unreviewed\. On its own, it never makes a stock eligible \(passed every check needed before a stock can be ranked\)\. On its own, it never creates a paper trade \(a practice trade with no real money\) or a real trade\./, /They are daily reference prices\. Nobody promises you could trade at them in the opening or closing auction\./, /Incomplete or inconsistent histories stay unavailable\./])
    assert.match(text, pattern);
  const main = all(setupDoc, node => node.tag === 'main')[0].children.filter(child => typeof child !== 'string');
  const lead = main.findIndex(node => (node.attrs.class || '') === 'lead');
  assert.equal(plain(main[lead + 1]), 'This page opened in a new tab. Close it to return to Prices. The Back to Prices link opens a second copy of the app.', 'the tab line comes right after the lead');
  assert.ok((main[lead + 2].attrs.class || '').split(/\s+/).includes('notice'), 'then the price-capture notice');
});

test('the setup guide quotes the Prices page messages exactly', () => {
  const app = ['unchecked', 'loading', 'unavailable', 'setup_required', 'configured_unverified']
    .map(status => plain(parse(renderPriceSetup({ status, reasons: status === 'setup_required' ? ['credentials_missing_or_invalid', 'rights_review_missing'] : [] }))));
  const results = all(setupDoc, node => node.tag === 'dl').at(-1);
  const quotes = [...plain(results).matchAll(/“([^”]+)”/g)].map(match => match[1]);
  assert.equal(quotes.length, 5);
  for (const quote of quotes) assert.ok(app.some(text => text.includes(quote)), `not an app message: ${quote}`);
  const run = plain(setupDoc).match(/open Prices\. Expand Price-feed setup at the bottom of the page and select Check data setup\./);
  assert.ok(run, 'the steps name the real summary and button');
  assert.ok(app.every(text => text.startsWith('Price-feed setup')) && app[0].includes('Check data setup'));
});

test('both guides share one light style text with the app tokens and carry the private-preview line', () => {
  assert.equal(styleOf(importDoc), styleOf(setupDoc));
  for (const doc of [importDoc, setupDoc]) {
    const style = styleOf(doc);
    assert.ok(cspOf(doc).includes(`style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`));
    assert.ok(cspOf(doc).includes("default-src 'none'"));
    assert.match(style, /color-scheme:light[;}]/);
    assert.doesNotMatch(style, /prefers-color-scheme|color-scheme:light dark/);
    for (const token of ['--paper:#f5f4ef', '--ink:#1d2926', '--muted:#56655e', '--green:#315d49']) assert.ok(style.includes(token), token);
    assert.doesNotMatch(style, /&|<\//);
    assert.equal(all(doc, node => node.tag === 'meta' && node.attrs.name === 'referrer')[0]?.attrs.content, 'no-referrer');
    const header = all(doc, node => node.tag === 'header')[0];
    assert.ok(header && all(doc, node => node.tag === 'main')[0], 'header and main');
    assert.equal(all(header, node => (node.attrs.class || '') === 'top-status').map(plain)[0], g1);
  }
  // Without its gloss, the help line is the app's own top-bar sentence.
  const app = parse(readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'));
  assert.equal(withoutGlosses(g1), withoutGlosses(plain(all(app, node => node.attrs.id === 'workspace-date')[0])));
});

test('the import example stays one focusable, named region with its byte-identical text', () => {
  const pres = all(importDoc, node => node.tag === 'pre');
  assert.equal(pres.length, 1);
  assert.deepEqual([pres[0].attrs.tabindex, pres[0].attrs.role, pres[0].attrs['aria-label']], ['0', 'region', 'Synthetic import example JSON']);
  assert.equal(createHash('sha256').update(plain(pres[0])).digest('hex'), 'ad24aec4c6a5de3b408aa2661fe0e9f723f3fcd5fb46463d6591efe4ec647856');
});

test('no help sentence runs over 25 words', () => {
  // Each block element ends a line, so a heading, a term and its definition never merge into one sentence.
  const blocks = new Set(['p', 'li', 'dt', 'dd', 'h1', 'h2', 'h3', 'th', 'td', 'caption', 'summary', 'tr']);
  const lines = node => typeof node === 'string' ? node.replace(/\s+/g, ' ') : node.tag === 'pre' ? '\n' : node.children.map(lines).join('') + (blocks.has(node.tag) ? '\n' : '');
  for (const doc of [importDoc, setupDoc]) {
    const sentences = lines(all(doc, node => node.tag === 'main')[0]).split('\n')
      .flatMap(line => line.trim().split(/(?<=[.?!][”"]?)\s+(?=[A-Z“"(0-9])/)).map(sentence => sentence.trim()).filter(Boolean);
    assert.ok(sentences.length > 40, 'the whole page was read');
    for (const sentence of sentences) assert.ok(sentence.split(' ').length <= 25, `long sentence: ${sentence}`);
  }
});

test('help copy keeps the owner voice rules outside the pinned example', () => {
  for (const doc of [importDoc, setupDoc]) {
    const text = withoutPre(doc);
    assert.doesNotMatch(text, /—/, 'No em dashes');
    assert.doesNotMatch(text, /\b(delve|leverage|seamless|robust|unlock|empower|elevate|landscape|journey|crucial|pivotal|tapestry|realm|embark|streamline|cutting-edge|game-changer|harness|foster|showcase|comprehensive|holistic|synergy)\b|dive into|in today.s|at the end of the day/i);
    assert.doesNotMatch(text, /, not [a-z]|\bnot [^.<]{1,40}\bbut\b/, 'No pivots');
    assert.doesNotMatch(text, /\b(upside|opportunity|signal|suggestion|price action|trading journal)\b/i);
  }
});

test('help terms get a plain explanation where they first appear', () => {
  const mainText = doc => withoutPre(all(doc, node => node.tag === 'main')[0]);
  const firstUse = (text, term, glossed) => {
    const at = text.search(term);
    assert.ok(at >= 0, `missing term ${term}`);
    assert.ok(text.slice(at).startsWith(glossed), `first use of ${term} needs its explanation: ${text.slice(at, at + 60)}`);
  };
  firstUse(mainText(importDoc), /\bJSON\b/, 'JSON file (a plain-text format for structured data)');
  firstUse(mainText(importDoc), /\bbars?\b/, 'bar (one trading day’s prices and volume)');
  firstUse(mainText(setupDoc), /API key and secret/, 'API key and secret (the two access codes a data provider gives an account)');
  firstUse(mainText(setupDoc), /raw price and volume basis/, 'raw price and volume basis (whether values were adjusted for splits or dividends)');
  firstUse(mainText(setupDoc), /\bJSON\b/, 'JSON (a plain-text format for structured data)');
  firstUse(mainText(setupDoc), /\bAlpaca\b/, 'Alpaca (a company that provides stock market data)');
  firstUse(mainText(setupDoc), /\beligible\b/, 'eligible (passed every check needed before a stock can be ranked)');
  firstUse(mainText(setupDoc), /\bpaper trade/, 'paper trade (a practice trade with no real money)');
  firstUse(mainText(importDoc), /\bpaper trade/, 'paper trade (a practice trade with no real money)');
  firstUse(mainText(importDoc), /\bAlpaca\b/, 'Alpaca bars (Alpaca is a company that provides stock market data)');
  firstUse(mainText(importDoc), /\bcorporate action/, 'corporate action (an event like a split or dividend that changes shares)');
  // "unvalidated" first appears in each page's header line, where the glossary explanation follows it.
  for (const doc of [importDoc, setupDoc]) firstUse(withoutPre(doc), /\bunvalidated\b/, 'unvalidated research (not proven to work; a test may have failed)');
});
