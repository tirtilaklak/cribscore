import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const servedRoot = path.join(root, 'dist');

async function servedFiles(directory = servedRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Served payload cannot link to files outside its privacy review: ${target}`);
    return entry.isDirectory() ? servedFiles(target) : [target];
  }))).flat();
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const expanded = raw.length === 3 ? raw.split('').map((character) => character + character).join('') : raw;
  const channels = expanded.match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('served entrypoint is a real HTML document with basic document accessibility', async () => {
  const html = await readFile(path.join(servedRoot, 'index.html'), 'utf8');
  assert.match(html, /<!doctype\s+html\s*>/i, 'An HTML doctype is required');
  assert.match(html, /<html\b[^>]*\blang\s*=\s*["']en(?:-[A-Za-z]+)?["']/i, 'Set the document language');
  assert.match(html, /<meta\b(?=[^>]*\bname\s*=\s*["']viewport["'])(?=[^>]*\bcontent\s*=\s*["'][^"']*width=device-width)[^>]*>/i, 'Use a device-width viewport');
  assert.doesNotMatch(html, /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*(?:user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[;,\s"']))/i, 'Do not disable browser zoom');
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  assert.ok(title && /cribscore/i.test(title), 'The tab title must identify Cribscore');
});

test('local entrypoint assets resolve within the served directory', async () => {
  const html = await readFile(path.join(servedRoot, 'index.html'), 'utf8');
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]).filter((value) => !/^(?:https?:|data:|#|\/\/)/i.test(value));
  assert.ok(assets.length > 0, 'The interface must reference its actual local styles or script');
  for (const value of assets) {
    const pathname = decodeURIComponent(value.split(/[?#]/)[0]);
    const target = path.resolve(servedRoot, pathname.replace(/^\//, ''));
    assert.ok(target.startsWith(servedRoot + path.sep), `Asset escapes served directory: ${value}`);
    assert.ok((await stat(target)).isFile(), `Asset missing: ${value}`);
  }
});

test('document head names a same-origin icon and consistent sharing metadata without external images', async () => {
  const html = await readFile(path.join(servedRoot, 'index.html'), 'utf8');
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head, 'A head element is required');
  const meta = (selector) => head.match(new RegExp(`<meta\\b[^>]*\\b(?:name|property)\\s*=\\s*["']${selector}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)[1].trim();
  const icon = head.match(/<link\b[^>]*\brel\s*=\s*["']icon["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  assert.equal(icon, './favicon.svg');
  assert.ok((await stat(path.join(servedRoot, 'favicon.svg'))).isFile(), 'The icon must be served from the site');
  assert.ok(meta('description'), 'A description is required');
  assert.equal(meta('og:title'), title);
  assert.equal(meta('og:description'), meta('description'));
  assert.equal(meta('og:type'), 'website');
  assert.equal(meta('og:url'), 'https://cribscore.co/');
  assert.equal(meta('twitter:card'), 'summary');
  assert.equal(meta('og:image'), undefined, 'Sharing previews must not pull an external image');
  assert.doesNotMatch(head, /https?:\/\/(?!cribscore\.co\/)/i, 'The head may not reference other hosts');
});

test('page landmarks and skip destination support keyboard reading order', async () => {
  const html = await readFile(path.join(servedRoot, 'index.html'), 'utf8');
  assert.equal([...html.matchAll(/<main\b/gi)].length, 1, 'Use one main landmark');
  assert.equal([...html.matchAll(/<h1\b/gi)].length, 1, 'Use one primary page heading');
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs break accessible relationships');
  const skip = html.match(/<a\b[^>]*href\s*=\s*["']#([^"']+)["'][^>]*>\s*Skip[^<]*<\/a>/i);
  assert.ok(skip, 'Repeated navigation needs a keyboard skip link');
  assert.ok(ids.includes(skip[1]), 'The skip target must exist');
  const mainId = html.match(/<main\b[^>]*\bid\s*=\s*["']([^"']+)["']/i)?.[1];
  assert.equal(skip[1], mainId, 'The skip link should take the user to main content');
  assert.match(html, /<main\b[^>]*\btabindex\s*=\s*["']-1["']/i, 'Allow the skip destination to receive focus');
});

test('all initial controls expose accessible names and horizon selection', async () => {
  const html = await readFile(path.join(servedRoot, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attributes = match[1];
    const content = match[2].replace(/<[^>]+\baria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '').replace(/<[^>]+>/g, '').trim();
    assert.ok(content || /\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(attributes), 'Each button needs a meaningful name');
  }
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const input = match[0];
    const id = input.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    const prefix = html.slice(0, match.index);
    const insideLabel = prefix.lastIndexOf('<label') > prefix.lastIndexOf('</label>');
    const explicitLabel = id && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${id}["']`, 'i').test(html);
    assert.ok(insideLabel || explicitLabel || /\baria-label(?:ledby)?\s*=/i.test(input), 'Search inputs need a persistent label');
  }
  const horizons = [...html.matchAll(/<button\b(?=[^>]*\bdata-horizon\s*=\s*["'](next_day|next_week)["'])([^>]*)>/gi)];
  assert.equal(horizons.length, 2, 'Expose next trading day and next five sessions as separate choices');
  assert.match(html, /<[^>]+\brole\s*=\s*["']group["'][^>]*\baria-label\s*=\s*["']Research horizon["']/i, 'Give the horizon choices a named semantic group');
  assert.equal(horizons.filter((match) => /\baria-pressed\s*=\s*["']true["']/i.test(match[2])).length, 1, 'Expose one selected research horizon');
  for (const match of horizons) assert.match(match[2], /\baria-pressed\s*=\s*["'](?:true|false)["']/i);
});

test('primary text colors meet normal-text contrast against main surfaces', async () => {
  const css = await readFile(path.join(servedRoot, 'style.css'), 'utf8');
  const colorToken = (name) => [...css.matchAll(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\\b`, 'gi'))].at(-1)?.[1];
  const foregrounds = ['ink', 'muted'].map((name) => ({ name, color: colorToken(name) }));
  const surfaces = ['paper', 'white'].map((name) => ({ name, color: colorToken(name) }));
  for (const token of [...foregrounds, ...surfaces]) assert.ok(token.color, `Color token ${token.name} is required for this check`);
  for (const foreground of foregrounds) {
    for (const surface of surfaces) {
      const ratio = contrast(foreground.color, surface.color);
      assert.ok(ratio >= 4.5, `${foreground.name} on ${surface.name}: ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
});

test('served payload excludes private retained files and local workspace paths', async () => {
  const files = await servedFiles();
  assert.ok(files.length > 0, 'The served directory cannot be empty');
  const forbidden = [
    /\/(?:Users|home)\/[^/]+\//i,
    /libfile_[a-f0-9]{32}/i,
    /Investment Conversation Full Transcript/i,
    /cribscore-builder-handoff\.json/i
  ];
  for (const file of files) {
    assert.doesNotMatch(file, /\.(?:pdf|zip|docx|xlsx)$/i, `Private reference documents must not be served: ${path.relative(servedRoot, file)}`);
    if (!/\.(?:html?|css|m?js|json|svg|txt)$/i.test(file)) continue;
    const content = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `Private reference in ${path.relative(servedRoot, file)}`);
    }
  }
});
