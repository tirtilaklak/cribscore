import test from 'node:test';
import assert from 'node:assert/strict';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {renderPriceView} from '../dist/lib/price-view.js';

test('journal overview describes current app-open observations and unavailable automatic tracking inputs',()=>{
  const html=renderJournalView({entries:[],summary:{},assumptions:[]});
  assert.match(html,/Assessments are recorded while this app is open\./);
  assert.match(html,/An observed assessment with no eligible suggestion is recorded as an abstention\./);
  assert.match(html,/Automatic paper tracking requires a connected, reviewed publisher and price feed; those inputs are currently unavailable\./);
  assert.match(html,/Missing prices stay pending\./);
  assert.doesNotMatch(html,/Eligible published suggestions become paper decisions|Paper by default/);
});

test('import disclosure describes immediate whole-batch tab-only import with canonical JSON and size limit',()=>{
  const html=renderPriceView();
  assert.match(html,/>Import price data<\/button>/);
  assert.doesNotMatch(html,/>Review imported prices<\/button>/);
  assert.match(html,/canonical Cribscore price JSON \(up to 2 MiB\)/);
  assert.match(html,/A valid import replaces all currently imported datasets\./);
  assert.match(html,/Data stays only in this tab and is cleared on reload\./);
  assert.match(html,/Keep your original file\./);
  assert.match(html,/Imported values do not become verified journal prices\./);
});
