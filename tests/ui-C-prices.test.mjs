// Area C (Prices): page order, first-screen limit, chart panel, picker, imported panel, setup card and CSS block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderPriceView } from '../dist/lib/price-view.js';
import { renderPriceSetup } from '../dist/lib/price-setup.js';
import { parsePriceImport, buildPriceView } from '../dist/lib/prices.js';
import { createDeskTools } from '../dist/lib/desk-tools.js';

const parse = html => JSON.parse(execFileSync('python3', [fileURLToPath(new URL('./fixtures/html-tree.py', import.meta.url))], { input: html, encoding: 'utf8' }));
const all = (node, predicate) => typeof node === 'string' ? [] : [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(child, predicate))];
const plain = node => typeof node === 'string' ? node : node.children.map(plain).join('');
const classes = node => (node.attrs.class || '').split(/\s+/);
const elements = node => node.children.filter(child => typeof child !== 'string');
const at = '2026-10-17T18:00:00Z';
const exampleModel = () => {
  const raw = readFileSync(new URL('../docs/examples/synthetic-price-import.json', import.meta.url), 'utf8');
  const imported = parsePriceImport(raw, { at });
  return buildPriceView(imported.series[0], { at });
};
// A small view model in the shape buildPriceView returns, for states the synthetic example cannot reach.
const synthetic = ({ days = 2, missing = 1, delay = null, sessionStatus = 'calendar_unknown', ...rest } = {}) => ({
  status: 'partial', symbol: 'TEST', currency: 'USD', priceBasis: 'unadjusted', volumeBasis: 'shares',
  points: ['2026-10-14', '2026-10-16'].slice(-days).map((session, index) => ({ session, open: 10, high: 12, low: 9, close: 11, volume: 100, breakBefore: index > 0, actions: [] })),
  source: { provider: 'Test fixture', dataset: 'Synthetic unit test', url: null, capturedAt: '2026-10-17T10:00:00Z', publishedAt: null, channel: 'manual_import' },
  freshness: { captureStatus: 'stale', sessionStatus, expectedLatestSession: '2026-10-16', declaredDelayMinutes: delay },
  gaps: { status: missing ? 'incomplete' : 'complete', missingSessions: ['2026-10-13', '2026-10-15'].slice(2 - missing) },
  comparison: { status: 'unavailable', reason: 'benchmark_missing' }, chartTrust: 'manual_import', issues: [], warnings: [], ...rest,
});
const rowsOf = html => Object.fromEntries(all(all(parse(html), node => node.attrs['data-state-key'] === 'prices:provenance')[0], node => node.tag === 'div' && node.children.some(child => child.tag === 'dt')).map(node => node.children.map(plain)));
const options = [{ symbol: 'IBM', label: 'IBM · International Business Machines' }, { symbol: 'TSLA', label: 'TSLA · Tesla' }];
const desk = html => all(parse(html), node => classes(node).includes('price-desk'))[0];
// One label per top-level block, in document order.
const blocks = html => elements(desk(html)).map(node => {
  if (classes(node).includes('price-lede')) return 'lede';
  if (all(node, child => child.attrs['data-price-form'] === 'selection').length) return 'picker';
  if (classes(node).includes('desk-feedback')) return 'feedback';
  if (classes(node).includes('hosted-price-panel')) return 'chart';
  if (node.attrs['aria-labelledby'] === 'imported-price-heading') return 'imported';
  if (node.tag === 'details' && node.attrs['data-state-key'] === 'prices:setup') return 'setup';
  return `other:${node.tag}`;
});

test('Prices reads lede, picker, feedback, chart, imported prices, then the price-feed setup', () => {
  assert.deepEqual(blocks(renderPriceView()), ['lede', 'picker', 'chart', 'imported', 'setup']);
  assert.deepEqual(blocks(renderPriceView(null, { symbol: 'IBM', symbolOptions: options, feedback: 'Chart requested.' })), ['lede', 'picker', 'feedback', 'chart', 'imported', 'setup']);
  assert.deepEqual(blocks(renderPriceView(exampleModel(), { feedback: 'Imported 1 daily series.' })), ['lede', 'picker', 'feedback', 'chart', 'imported', 'setup']);
  const imported = all(parse(renderPriceView(exampleModel())), node => node.attrs['aria-labelledby'] === 'imported-price-heading')[0];
  assert.deepEqual(all(imported, node => node.tag === 'details').map(node => node.attrs['data-state-key']), ['prices:daily-values', 'prices:comparison', 'prices:provenance', 'prices:import'], 'provenance and import stay inside the imported panel');
  assert.deepEqual(all(imported, node => node.tag === 'summary').map(plain), ['Daily prices and volume', 'Benchmark comparison', 'Source, timing and adjustments', 'Import daily price data']);
});

test('the first screen states the chart-only limit before any control', () => {
  const lede = elements(desk(renderPriceView()))[0];
  assert.equal(lede.tag, 'p');
  assert.equal(plain(lede), 'Charts and imported prices are for viewing only. The journal never uses them.');
  assert.equal(lede.attrs.role, undefined);
});

test('the chart heading is the focus target after the chart replaces its load button', () => {
  const dom = parse(renderPriceView(null, { symbol: 'IBM', symbolOptions: options }));
  const heading = all(dom, node => node.attrs.id === 'hosted-price-heading')[0];
  assert.equal(heading.tag, 'h2');
  assert.equal(heading.attrs.tabindex, '-1');
  assert.ok('data-focus-fallback' in heading.attrs);
  assert.equal(plain(heading), 'IBM chart');
  assert.equal(all(dom, node => 'data-focus-fallback' in node.attrs).length, 1);
});

test('the idle chart box holds one load button and nothing loads before it is pressed', () => {
  for (const status of ['idle', 'requested']) {
    const dom = parse(renderPriceView(null, { symbol: 'IBM', symbolOptions: options, hosted: { status, url: 'https://www.tradingview.com/chart/?symbol=NYSE%3AIBM' } }));
    const box = all(dom, node => node.attrs.id === 'hosted-price-chart')[0];
    assert.equal(box.attrs['data-hosted-status'], status);
    const buttons = all(box, node => node.attrs['data-price-action'] === 'load-hosted');
    assert.equal(buttons.length, 1);
    assert.equal(plain(buttons[0]), 'Load IBM chart');
    assert.equal(all(box, node => node.tag === 'p').length, 0, 'idle box is the button only');
    assert.equal(all(dom, node => ['iframe', 'script', 'svg'].includes(node.tag)).length, 0);
    assert.doesNotMatch(plain(dom), /Loading the hosted chart|hosted chart is loading|Hosted chart is ready/);
  }
  const fallback = parse(renderPriceView());
  assert.equal(plain(all(fallback, node => node.attrs.id === 'hosted-price-heading')[0]), 'Company chart');
  assert.equal(plain(all(fallback, node => node.attrs['data-price-action'] === 'load-hosted')[0]), 'Load chart');
  const failed = parse(renderPriceView(null, { symbol: 'IBM', hosted: { status: 'unavailable', message: 'Synthetic frame failure.' } }));
  const box = all(failed, node => node.attrs.id === 'hosted-price-chart')[0];
  assert.match(plain(box), /^Synthetic frame failure\.Try the chart again$/);
});

test('a company with no TradingView chart gets a plain sentence instead of a load button that cannot work', () => {
  // pricesHTML passes hostedChartURL(symbol), which is null for symbols outside the chart list (DEMO, for example).
  const dom = parse(renderPriceView(exampleModel(), { symbol: 'DEMO', hosted: { status: 'idle', url: null, symbol: 'DEMO' } }));
  const box = all(dom, node => node.attrs.id === 'hosted-price-chart')[0];
  assert.equal(all(dom, node => node.attrs['data-price-action'] === 'load-hosted').length, 0);
  assert.equal(plain(box), 'Cribscore has no TradingView chart for DEMO.');
  assert.equal(all(dom, node => ['iframe', 'script'].includes(node.tag)).length, 0);
  assert.match(plain(dom), /Open chart at TradingView \(opens in a new tab\)/, 'the external link stays');
  const unsafe = renderPriceView(null, { symbol: 'X<Y', hosted: { status: 'idle', url: null } });
  assert.match(unsafe, /no TradingView chart for X&lt;Y\./);
  assert.doesNotMatch(unsafe, /X<Y/);
  for (const hosted of [undefined, { status: 'idle' }, { status: 'requested', url: 'https://www.tradingview.com/chart/?symbol=NYSE%3AIBM' }]) {
    const kept = parse(renderPriceView(null, { symbol: 'IBM', ...(hosted ? { hosted } : {}) }));
    assert.equal(all(kept, node => node.attrs['data-price-action'] === 'load-hosted').length, 1, 'a chart url, or no hosted state at all, keeps the button');
    assert.doesNotMatch(plain(kept), /no TradingView chart/);
  }
});

test('chart panel copy names the separate site, and the delay line follows the chart box', () => {
  const dom = parse(renderPriceView(null, { symbol: 'IBM', symbolOptions: options }));
  const panel = all(dom, node => classes(node).includes('hosted-price-panel'))[0];
  const parts = elements(panel);
  assert.equal(plain(all(panel, node => classes(node).includes('eyebrow'))[0]), 'Market chart');
  assert.equal(plain(all(panel, node => classes(node).includes('desk-badge'))[0]), 'TradingView');
  assert.equal(plain(parts[1]), 'This chart loads from TradingView, a separate site, only when you ask.');
  assert.equal(parts[2].attrs.id, 'hosted-price-chart');
  assert.ok(classes(parts[3]).includes('desk-source'));
  assert.match(plain(parts[3]), /^Open chart at TradingView \(opens in a new tab\) ↗ Prices may be delayed\. For NYSE and Nasdaq stocks, TradingView shows Cboe One data \(prices from Cboe’s own stock exchanges only\)\.$/);
  assert.doesNotMatch(plain(dom), /price action/i);
});

test('the outcome line can take keyboard focus, so a long message that scrolls inside it can be read', () => {
  const feedback = all(parse(renderPriceView(null, { symbol: 'IBM', feedback: 'Import rejected: bars shape invalid.' })), node => classes(node).includes('desk-feedback'));
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].tag, 'p');
  assert.equal(feedback[0].attrs.tabindex, '0');
  assert.equal(feedback[0].attrs.role, undefined, 'no competing live region');
  assert.equal(feedback[0].attrs['aria-live'], undefined);
  assert.equal(plain(feedback[0]), 'Import rejected: bars shape invalid.');
  assert.equal(all(parse(renderPriceView(null, { symbol: 'IBM' })), node => classes(node).includes('desk-feedback')).length, 0, 'no empty focus stop without a message');
});

test('the picker keeps its form hooks and applies with one secondary button', () => {
  const html = renderPriceView(null, { symbol: 'TSLA', symbolOptions: options, rangeSessions: 60 });
  assert.match(html, /<option value="TSLA" selected>/);
  assert.match(html, /<option value="60" selected>60 trading days<\/option>/);
  const form = all(parse(html), node => node.attrs['data-price-form'] === 'selection')[0];
  assert.deepEqual(all(form, node => node.tag === 'label').map(node => node.children[0]), ['Company', 'Imported days to show']);
  assert.deepEqual(all(form, node => node.tag === 'select').map(node => node.attrs.id), ['price-symbol', 'price-range']);
  assert.deepEqual(all(all(form, node => node.attrs.id === 'price-range')[0], node => node.tag === 'option').map(plain), ['20 trading days', '60 trading days', '120 trading days', 'All days in the file']);
  const buttons = all(form, node => node.tag === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(plain(buttons[0]), 'Apply');
  assert.equal(buttons[0].attrs.type, 'submit');
  assert.deepEqual(classes(buttons[0]), ['desk-button', 'desk-button-secondary']);
});

test('one filled button per panel', () => {
  const dom = parse(renderPriceView(null, { symbol: 'IBM', symbolOptions: options }));
  const filled = node => node.tag === 'button' && classes(node).includes('desk-button') && !classes(node).includes('desk-button-secondary');
  const panels = elements(desk(renderPriceView(null, { symbol: 'IBM', symbolOptions: options })));
  assert.deepEqual(panels.map(panel => all(panel, filled).length), [0, 0, 1, 1, 0], 'lede, picker, chart, imported, setup');
  assert.equal(all(dom, filled).length, 2);
});

test('the empty imported panel names its next step and keeps the pinned headings', () => {
  const dom = parse(renderPriceView());
  const panel = all(dom, node => node.attrs['aria-labelledby'] === 'imported-price-heading')[0];
  assert.equal(plain(all(panel, node => classes(node).includes('eyebrow'))[0]), 'Your price file');
  assert.equal(plain(all(panel, node => node.tag === 'h2')[0]), 'Imported daily prices');
  const empty = all(panel, node => classes(node).includes('desk-empty'))[0];
  assert.equal(plain(all(empty, node => node.tag === 'h3')[0]), 'No imported price history');
  assert.equal(plain(all(empty, node => node.tag === 'p')[0]), 'Import a daily price file to see it here. It stays in this tab until you reload. Use Import daily price data below.');
  // A server capture is never called the owner's file, and its empty state does not ask for an import.
  const retained = parse(renderPriceView({ status: 'unavailable', points: [], source: { channel: 'retained_capture' }, issues: [] }));
  const retainedPanel = all(retained, node => node.attrs['aria-labelledby'] === 'imported-price-heading')[0];
  assert.equal(plain(all(retainedPanel, node => classes(node).includes('eyebrow'))[0]), 'Server capture');
  assert.equal(plain(all(retainedPanel, node => node.tag === 'h2')[0]), 'Retained daily prices');
  const retainedEmpty = all(retainedPanel, node => classes(node).includes('desk-empty'))[0];
  assert.equal(plain(all(retainedEmpty, node => node.tag === 'h3')[0]), 'Retained price history unavailable');
  assert.equal(plain(all(retainedEmpty, node => node.tag === 'p')[0]), 'A source-backed daily dataset is needed before this panel can show prices.');
  assert.doesNotMatch(plain(retainedPanel), /Your price file|Import a daily price file to see it here/);
});

test('without a dataset the provenance disclosure holds one sentence; any model keeps every row', () => {
  const provenance = html => all(parse(html), node => node.attrs['data-state-key'] === 'prices:provenance')[0];
  const none = provenance(renderPriceView());
  assert.equal(plain(all(none, node => node.tag === 'summary')[0]), 'Source, timing and adjustments');
  assert.equal(plain(none), 'Source, timing and adjustmentsSource details appear after you import a file for this company. Paper marks (the checked prices the journal uses to value practice trades) remain unavailable.');
  assert.equal(all(none, node => node.tag === 'dl').length, 0);
  for (const model of [{ status: 'unavailable', points: [], issues: [] }, exampleModel()]) {
    const rows = all(all(provenance(renderPriceView(model)), node => node.tag === 'dl')[0], node => node.tag === 'div');
    assert.equal(rows.length, 16);
    assert.deepEqual(rows.at(-1).children.map(plain), ['Paper marks', 'Unavailable']);
  }
});

test('the gap note states the limit as its own sentence', () => {
  const text = plain(parse(renderPriceView(exampleModel())));
  assert.match(text, /Calendar coverage is unknown\. A continuous line does not prove that no trading days are missing\./);
  assert.doesNotMatch(text, /coverage is unknown;/);
  assert.match(text, /This dataset has not been verified for journal valuation\. Paper marks remain unavailable\./);
  // The pinned notice stays word for word; a plain sentence after it explains the term.
  assert.match(text, /Paper marks remain unavailable\. Paper marks are the checked prices the journal uses to value practice trades\./);
});

test('the imported panel says trading day where it said session, and counts read correctly at one', () => {
  const one = renderPriceView(synthetic({ days: 1, missing: 1, delay: 1, sessionStatus: 'current_completed_session' }));
  const oneDom = parse(one);
  assert.equal(plain(all(oneDom, node => node.tag === 'figcaption')[0]), 'Approximate daily close · USD · 1 trading day');
  assert.match(plain(all(oneDom, node => node.tag === 'desc')[0]), /^1 trading day, 2026-10-16 through 2026-10-16\. USD prices\. Breaks mark missing trading days or corporate actions\./);
  assert.match(plain(oneDom), /1 expected trading day is missing\. The line breaks at known gaps\./);
  assert.match(plain(oneDom), /Latest completed trading day included/);
  assert.equal(rowsOf(one)['Declared delay'], '1 minute');
  const two = renderPriceView(synthetic({ days: 2, missing: 2, delay: 15, sessionStatus: 'behind_completed_session' }));
  const twoDom = parse(two);
  assert.equal(plain(all(twoDom, node => node.tag === 'figcaption')[0]), 'Approximate daily close · USD · 2 trading days');
  assert.match(plain(twoDom), /2 expected trading days are missing\. The line breaks at known gaps\./);
  assert.equal(rowsOf(two)['Declared delay'], '15 minutes');
  assert.equal(rowsOf(two)['Trading-day coverage'], 'Latest completed trading day missing');
  assert.equal(rowsOf(two)['Expected latest trading day'], '2026-10-16');
  assert.equal(rowsOf(renderPriceView(synthetic()))['Trading-day coverage'], 'Trading-day coverage unknown');
  const compared = renderPriceView(synthetic({ comparison: { status: 'available', benchmarkSymbol: 'SPY', basis: 'descriptive_price_index', points: [{ session: '2026-10-14', targetIndex: 100, benchmarkIndex: 100 }, { session: '2026-10-16', targetIndex: 101, benchmarkIndex: 99 }] } }));
  assert.deepEqual(all(parse(compared), node => node.tag === 'thead').map(head => plain(all(head, node => node.tag === 'th')[0])), ['Trading day', 'Trading day']);
  assert.match(plain(parse(compared)), /Indexed to 100 on the first shared trading day\./);
  // "Price session" and "Volume session" name the market session a price comes from (regular or extended hours), so they stay.
  for (const html of [one, two, compared]) assert.doesNotMatch(plain(parse(html)).replace(/Price session|Volume session/g, ''), /\bsessions?\b/i);
});

test('comparison reasons and data warnings read as plain sentences, never as codes', () => {
  const source = readFileSync(new URL('../dist/lib/prices.js', import.meta.url), 'utf8');
  const comparison = source.slice(source.indexOf('function indexedComparison'), source.indexOf('export function buildPriceView'));
  const reasons = [...new Set([...comparison.matchAll(/empty\('([a-z_]+)'\)/g)].map(match => match[1])), 'price_series_unavailable'];
  assert.ok(reasons.length >= 10 && source.includes("reason:'price_series_unavailable'"), `expected every comparison reason, got ${reasons.length}`);
  const comparisonText = model => plain(all(parse(renderPriceView(model)), node => node.attrs['data-state-key'] === 'prices:comparison')[0]);
  for (const reason of reasons) {
    const text = comparisonText(synthetic({ comparison: { status: 'unavailable', reason } }));
    const sentence = text.replace(/^Benchmark comparisonComparable benchmark history is unavailable\. /, '');
    assert.notEqual(sentence, text, `${reason} keeps the pinned first sentence`);
    assert.match(sentence, /^[A-Z][^_]*\.$/, `${reason} reads as a sentence`);
    assert.ok(!sentence.toLowerCase().includes(reason.replaceAll('_', ' ')), `${reason} is not printed as a code`);
  }
  assert.match(comparisonText(synthetic({ comparison: { status: 'unavailable', reason: 'matching_basis_required' } })), /Comparable benchmark history is unavailable\. Reason: matching basis required\.$/, 'an unknown reason still shows');
  // Warning codes are pushed one by one, added on a condition, or listed after an adapter's own warnings.
  const listed = [...source.matchAll(/unique\(\[\.\.\.[a-z.]*warnings,((?:'[a-z_]+',)+)/g)].flatMap(match => [...match[1].matchAll(/'([a-z_]+)'/g)]);
  const warnings = [...new Set([...source.matchAll(/warnings\.push\('([a-z_]+)'\)/g), ...source.matchAll(/\?\['([a-z_]+)'\]:\[\]/g), ...listed].map(match => match[1]))];
  assert.ok(warnings.length >= 16, `expected every warning, got ${warnings.length}`);
  const provenance = all(parse(renderPriceView(synthetic({ warnings: [...warnings, 'synthetic_new_warning'] }))), node => node.attrs['data-state-key'] === 'prices:provenance')[0];
  const items = all(provenance, node => node.tag === 'li').map(plain);
  assert.equal(items.length, warnings.length + 1);
  warnings.forEach((code, index) => {
    assert.match(items[index], /^[A-Z][^_]*\.$/, `${code} reads as a sentence`);
    assert.ok(!items[index].toLowerCase().includes(code.replaceAll('_', ' ')), `${code} is not printed as a code`);
  });
  assert.equal(items.at(-1), 'synthetic new warning', 'an unknown warning still shows');
});

test('the price basis reads in plain words on the badge and in the source rows', () => {
  for (const [priceBasis, label] of [['unadjusted', 'Not adjusted for splits or dividends'], ['split_adjusted', 'Adjusted for splits'], ['total_return_adjusted', 'Adjusted for splits and dividends'], ['unknown', 'Adjustment unknown']]) {
    const html = renderPriceView(synthetic({ priceBasis }));
    const panel = all(parse(html), node => node.attrs['aria-labelledby'] === 'imported-price-heading')[0];
    assert.equal(plain(all(panel, node => classes(node).includes('desk-badge'))[0]), label);
    assert.equal(rowsOf(html)['Price basis'], label);
  }
  assert.equal(rowsOf(renderPriceView({ status: 'unavailable', points: [], issues: [] }))['Price basis'], 'Unavailable');
  // Lookups use own keys only, so a code that names an object method still prints as plain words.
  const odd = renderPriceView(synthetic({ priceBasis: 'constructor', warnings: ['toString'], comparison: { status: 'unavailable', reason: 'hasOwnProperty' } }));
  assert.equal(rowsOf(odd)['Price basis'], 'constructor');
  assert.match(plain(parse(odd)), /Reason: hasOwnProperty\./);
  assert.deepEqual(all(all(parse(odd), node => node.attrs['data-state-key'] === 'prices:provenance')[0], node => node.tag === 'li').map(plain), ['toString']);
  assert.doesNotMatch(odd, /native code|function /);
});

test('the import disclosure keeps its five pinned sentences, adds a plain gloss and keeps one guide link', () => {
  const disclosure = all(parse(renderPriceView()), node => node.attrs['data-state-key'] === 'prices:import')[0];
  const paragraphs = all(disclosure, node => node.tag === 'p').map(plain);
  assert.equal(paragraphs[0], 'Choose canonical Cribscore price JSON (up to 2 MiB), including source, capture time and adjustment basis. A valid import replaces all currently imported datasets. Data stays only in this tab and is cleared on reload. Keep your original file. Imported values do not become verified journal prices.');
  assert.equal(paragraphs[1], 'Canonical JSON is the exact file layout shown in the guide below.');
  assert.equal(all(disclosure, node => node.tag === 'a').length, 1);
  assert.equal(all(disclosure, node => node.tag === 'label')[0].children[0], 'Price file (JSON)');
  assert.equal(plain(all(disclosure, node => node.tag === 'button')[0]), 'Import price data');
});

test('price-feed setup is a card disclosure with plain copy and every pinned phrase', () => {
  const copy = {
    unchecked: 'Check whether a price feed is set up on the server.',
    loading: 'Checking the price-feed setup…',
    unavailable: 'Price-feed setup could not be checked. Select Check data setup to try again.',
    setup_required: 'Alpaca setup is incomplete. Price capture remains off.',
    configured_unverified: 'Alpaca settings are present. The connection has not been tested, so price capture remains off.',
  };
  for (const [status, message] of Object.entries(copy)) {
    const dom = parse(renderPriceSetup({ status, reasons: status === 'setup_required' ? ['credentials_missing_or_invalid', 'rights_review_missing'] : [] }));
    const details = dom.children[0];
    assert.equal(details.tag, 'details');
    assert.deepEqual(classes(details), ['card', 'desk-panel', 'desk-disclosure', 'price-setup']);
    assert.equal(details.attrs['data-state-key'], 'prices:setup');
    assert.equal(plain(all(details, node => node.tag === 'summary')[0]), 'Price-feed setup');
    const status_ = all(details, node => 'data-price-setup-status' in node.attrs)[0];
    assert.equal(plain(status_), message);
    assert.equal(status_.attrs.role, undefined);
    assert.equal(status_.attrs['aria-live'], undefined);
    const button = all(details, node => node.attrs.id === 'price-check-setup')[0];
    assert.deepEqual(classes(button), ['desk-button', 'desk-button-secondary']);
    assert.equal(plain(button), status === 'loading' ? 'Checking setup…' : 'Check data setup');
    assert.equal(button.attrs['aria-disabled'], status === 'loading' ? 'true' : undefined);
    assert.equal(button.attrs.disabled, undefined);
    const link = all(details, node => node.tag === 'a')[0];
    assert.equal(link.attrs.href, './help/market-data-setup.html');
    assert.equal(link.attrs.target, '_blank');
    assert.deepEqual(link.attrs.rel.split(' ').sort(), ['noopener', 'noreferrer']);
    assert.equal(plain(link), 'How to set up the price feed (opens in a new tab) ↗');
    assert.match(plain(details), /Valuing journal trades needs more checked inputs\. They are share identities, a trading calendar, the price basis and split and dividend records\. Chart data cannot supply them\./);
  }
  const items = all(parse(renderPriceSetup({ status: 'setup_required', reasons: ['credentials_missing_or_invalid', 'rights_review_missing'] })), node => node.tag === 'li').map(plain);
  assert.deepEqual(items, ['Your Alpaca credentials are missing or invalid. These are the API key and secret (two access codes from Alpaca, the market-data provider).', 'A current source-access and account-entitlement review is required. That review checks what your data plan allows.']);
});

test('every new-tab link on Prices says so to screen readers and hides its arrow glyph', () => {
  const model = exampleModel();
  model.source.url = 'https://prices.example/fixture';
  const links = all(parse(renderPriceView(model, { symbol: 'DEMO', hosted: { status: 'idle', url: 'https://www.tradingview.com/chart/' } })), node => node.tag === 'a');
  assert.deepEqual(links.map(plain), ['Open chart at TradingView (opens in a new tab) ↗', 'Open data source (opens in a new tab) ↗', 'JSON format guide and example (opens in a new tab) ↗', 'How to set up the price feed (opens in a new tab) ↗']);
  for (const link of links) {
    assert.equal(link.attrs.target, '_blank');
    assert.deepEqual(link.attrs.rel.split(' ').sort(), ['noopener', 'noreferrer']);
    assert.equal(plain(all(link, node => node.attrs.class === 'sr-only')[0]), ' (opens in a new tab)');
    assert.deepEqual(all(link, node => node.attrs['aria-hidden'] === 'true').map(plain), ['↗']);
    assert.ok(link.children.every(child => typeof child !== 'string' || !child.includes('↗')), 'no bare glyph in the accessible name');
  }
});

test('pricesHTML adds no footer note; its limits live in the lede and the import disclosure', () => {
  const document = { querySelector: () => null, addEventListener() {}, removeEventListener() {}, createElement() { throw Error('No chart frame expected'); } };
  let requests = 0;
  const app = createDeskTools({ document, fetch: () => { requests++; throw Error('No request expected'); } });
  try {
    const html = app.html('prices');
    assert.doesNotMatch(html, /desk-muted">Imported price data stays in this tab|display-only/);
    assert.equal(html.match(/class="price-lede"/g).length, 1);
    assert.match(html, /<\/details>\s*<\/div>$/, 'the setup card closes the page');
    assert.deepEqual(blocks(html), ['lede', 'picker', 'chart', 'imported', 'setup']);
    assert.equal(requests, 0);
  } finally { app.destroy(); }
});

test('the area C stylesheet block fixes the plot row and reserves chart space only on request', () => {
  const css = readFileSync(new URL('../dist/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* == area:C prices == */'), end = css.indexOf('/* == end area:C == */');
  assert.ok(start > 0 && end > start, 'one area C block');
  const block = css.slice(start, end);
  assert.match(block, /\.price-plot-layout\{grid-template-rows:minmax\(0,1fr\)\}/);
  assert.match(block, /\.hosted-price-chart\{min-height:0;/);
  assert.match(block, /\.hosted-price-chart\[data-hosted-status="requested"\]\{min-height:460px\}/);
  assert.match(block, /@media\(max-width:680px\)\{\s*\.hosted-price-chart\[data-hosted-status="requested"\]\{min-height:410px\}/);
  assert.equal(block.match(/min-height:4[16]0px/g).length, 2, 'no other rule reserves chart space');
  assert.match(block, /\.price-desk \.desk-table th:first-child\{position:sticky;left:0;/);
  assert.match(block, /\.price-axis,\.price-date-axis,\.price-desk \.desk-facts dt\{font-size:var\(--t-meta,12px\)\}/);
  // Shared card disclosures drop their vertical padding, so the open setup card keeps its own bottom padding.
  assert.match(block, /\.price-setup\[open\]\{padding-bottom:var\(--space-5,20px\)\}/);
  assert.match(block, /@media\(max-width:680px\)\{[^@]*\.price-setup\[open\]\{padding-bottom:var\(--space-4,16px\)\}/);
  // The range picker shows its whole value at every width; small phones put the company on its own row.
  assert.match(block, /\.price-desk \.desk-selection\{grid-template-columns:minmax\(0,1fr\) minmax\(max-content,\.6fr\) auto\}/);
  assert.match(block, /@media\(max-width:680px\)\{[^@]*\.price-desk \.desk-selection\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)\}/);
  assert.match(block, /@media\(max-width:480px\)\{\s*\.price-desk \.desk-selection\{grid-template-columns:minmax\(0,1fr\) auto\}\s*\.price-desk \.desk-selection>label:first-child\{grid-column:1\/-1\}/);
  assert.match(block, /@media\(max-width:359px\)\{\s*\.price-desk \.desk-selection\{grid-template-columns:minmax\(0,1fr\)\}/);
  // The delay limit is as large as the chart copy; links look like the app's other text actions.
  assert.match(block, /\.hosted-price-panel \.desk-source>span\{[^}]*font-size:var\(--t-body,14px\)/);
  assert.match(block, /\.price-desk \.desk-source a,\.price-desk a\[href\^="\.\/help\/"\]\{[^}]*font-size:var\(--t-small,13px\)[^}]*text-decoration:none/);
  assert.match(block, /\.price-desk \.desk-source a:hover,\.price-desk a\[href\^="\.\/help\/"\]:hover\{text-decoration:underline\}/);
  assert.match(block, /@media\(max-width:680px\)\{[^@]*\.price-desk \.price-value strong\{font-size:var\(--t-title,22px\)\}/);
  assert.doesNotMatch(block, /--(?:ink|muted|paper|white)\s*:/, 'no shared token is redeclared');
  // Colours come from the app tokens; a hex value appears only as a var() fallback.
  const scroll = block.match(/\.price-desk \.desk-table-scroll\{[^}]*\}/)?.[0] || '';
  assert.match(scroll, /var\(--white,#fff\)/);
  assert.match(scroll, /color-mix\(in srgb,var\(--ink,#1d2926\) 19%,transparent\)/);
  assert.doesNotMatch(block.replace(/var\(--[a-z-]+,#[0-9a-f]{3,8}\)/gi, ''), /#[0-9a-f]{3,8}\b/i);
});
