import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderPriceView } from '../dist/lib/price-view.js';
import { parsePriceImport, buildPriceView } from '../dist/lib/prices.js';

const help = readFileSync(new URL('../dist/help/price-import.html', import.meta.url), 'utf8');
const parse = html => JSON.parse(execFileSync('python3', [fileURLToPath(new URL('./fixtures/html-tree.py', import.meta.url))], { input: html, encoding: 'utf8' }));
const all = (node, predicate) => typeof node === 'string' ? [] : [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(child, predicate))];
const plain = node => typeof node === 'string' ? node : node.children.map(plain).join('');
const document = parse(help);
const exampleText = plain(all(document, node => node.tag === 'pre')[0]);
const example = JSON.parse(exampleText);
// This clock assesses an explicitly invented historical format example.
const at = '2026-10-17T18:00:00Z';

test('import disclosure links to a real same-site guide without navigating the tab holding imported data', () => {
  const view = parse(renderPriceView());
  const disclosure = all(view, node => node.attrs['data-state-key'] === 'prices:import')[0];
  const links = all(disclosure, node => node.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, './help/price-import.html');
  assert.equal(links[0].attrs.target, '_blank');
  assert.deepEqual(links[0].attrs.rel.split(' ').sort(), ['noopener', 'noreferrer']);
  assert.match(plain(links[0]), /JSON format guide and example.*opens in a new tab/);
  assert.equal(new URL(links[0].attrs.href, 'https://example.test/').pathname, '/help/price-import.html');
  assert.equal(new URL(links[0].attrs.href, 'https://example.test/index.html').pathname, '/help/price-import.html');
  assert.equal(all(disclosure, node => node.tag === 'form' && node.attrs['data-price-form'] === 'import').length, 1);
  assert.equal(all(disclosure, node => node.tag === 'input')[0].attrs.accept, '.json,application/json');
  assert.match(plain(disclosure), /A valid import replaces all currently imported datasets/);
  assert.match(plain(disclosure), /Data stays only in this tab and is cleared on reload/);
});

test('help is accessible static text with one inert, clearly synthetic example and a valid style CSP', () => {
  assert.equal(all(document, node => node.tag === 'html')[0].attrs.lang, 'en');
  assert.equal(all(document, node => node.tag === 'main').length, 1);
  assert.equal(all(document, node => node.tag === 'h1').length, 1);
  assert.equal(all(document, node => node.tag === 'pre').length, 1);
  assert.equal(all(document, node => node.tag === 'pre')[0].attrs.tabindex, '0');
  assert.ok(all(document, node => node.tag === 'th').every(node => node.attrs.scope === 'row'));
  assert.equal(all(document, node => ['script', 'iframe', 'form', 'input', 'button', 'img', 'object', 'embed', 'link', 'base'].includes(node.tag)).length, 0);
  assert.equal(all(document, node => Object.keys(node.attrs).some(key => /^on/i.test(key) || ['src', 'srcdoc', 'download'].includes(key))).length, 0);
  assert.equal(all(document, node => node.tag === 'a').length, 0, 'No dataset download or provider request from the reference');
  const csp = all(document, node => node.tag === 'meta' && node.attrs['http-equiv'] === 'Content-Security-Policy')[0].attrs.content;
  const style = plain(all(document, node => node.tag === 'style')[0]);
  assert.ok(csp.includes(`style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.match(plain(document), /Every value, symbol and timestamp in this example is invented/);
  assert.match(plain(document), /Reading this page does not import anything/);
  assert.match(plain(document), /Imported data is chart context only/);
});

test('embedded example is byte-identical to the previously validated synthetic guide example and passes the real import contract', () => {
  assert.equal(createHash('sha256').update(exampleText).digest('hex'), 'ad24aec4c6a5de3b408aa2661fe0e9f723f3fcd5fb46463d6591efe4ec647856');
  const result = parsePriceImport(exampleText, { at });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, []);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].source.channel, 'manual_import');
  assert.equal(result.series[0].source.url, null);
  assert.equal(result.series[0].source.responseSha256, null);
  assert.equal(result.series[0].actions.status, 'unknown');
  for (const key of ['paperMarksEligible', 'eligibleForRanking', 'automaticTrading']) assert.equal(result[key], false);
  for (let index = 0; index < example.bars.length; index++) {
    for (const key of ['open', 'high', 'low', 'close']) assert.equal(result.series[0].bars[index].decimals[key], example.bars[index][key]);
    assert.equal(result.series[0].bars[index].volume, null);
  }
  const model = buildPriceView(result.series[0], { at });
  assert.equal(model.freshness.captureStatus, 'stale');
  assert.equal(model.freshness.sessionStatus, 'calendar_unknown');
  assert.equal(model.paperMarksEligible, false);
  assert.equal(model.latest.closeDecimal, example.bars.at(-1).close);
});

test('documented nullable clocks and single-or-wrapper formats work without inventing source provenance', () => {
  const withoutClocks = structuredClone(example);
  withoutClocks.source.capturedAt = null;
  withoutClocks.source.publishedAt = null;
  for (const bar of withoutClocks.bars) bar.availableAt = null;
  const result = parsePriceImport(JSON.stringify({ schemaVersion: 'cribscore-price-import-v1', series: [withoutClocks] }), { at });
  assert.equal(result.status, 'partial');
  assert.equal(result.series[0].source.capturedAt, null);
  assert.ok(result.series[0].bars.every(bar => bar.availableAt === null));
  assert.equal(buildPriceView(result.series[0], { at }).freshness.captureStatus, 'unknown');
  const bad = structuredClone(example);
  bad.bars[0].availableAt = 'not-a-time';
  const rejected = parsePriceImport(JSON.stringify(bad), { at });
  assert.equal(rejected.status, 'invalid');
  assert.ok(rejected.issues.includes('bar_availability_invalid'));
  assert.match(plain(document), /an invalid value rejects the file/);
  assert.match(plain(document), /If it is omitted or null, the parser uses capture, then known publication, or leaves availability unknown/);
});
