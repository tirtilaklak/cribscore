import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriceView,normalizePriceSeries,parsePriceImport} from '../dist/lib/prices.js';

// Schema fixtures only: these values are not observed market prices.
const at='2026-10-17T10:00:00Z';
const values=[
  {open:'0.0000001',high:'0.0000002',low:'0.00000001',close:'0.00000015'},
  {open:'999999999999.123456',high:'999999999999.123457',low:'999999999999.123454',close:'999999999999.123455'}
];
const raw=prices=>({schemaVersion:'cribscore-price-series-v1',id:'synthetic-display-decimals',symbol:'TEST',currency:'USD',sessionTimezone:'America/New_York',interval:'1d',priceBasis:'unadjusted',volumeBasis:'shares',source:{provider:'Synthetic',dataset:'Exact display fixture',url:'https://prices.example/fixture',capturedAt:'2026-10-16T22:00:00Z',publishedAt:null,responseSha256:'a'.repeat(64),channel:'retained_capture'},bars:[{session:'2026-10-16',...prices,volume:null}]});

test('tiny and large exact OHLC strings survive normalization, JSON import and display projection',()=>{
  for(const expected of values){
    const input=raw(expected),before=structuredClone(input);
    const normalized=normalizePriceSeries(input,{at}).series;
    const imported=parsePriceImport(JSON.stringify(normalized),{at}).series[0];
    const roundTrip=parsePriceImport(JSON.stringify(imported),{at}).series[0];
    for(const source of [input,normalized,imported,roundTrip]){
      const view=buildPriceView(source,{at});assert.equal(view.points.length,1);
      assert.deepEqual(view.points[0].decimals,expected);assert.equal(view.latest.closeDecimal,expected.close);
      for(const key of ['open','high','low','close'])assert.equal(view.points[0][key],Number(expected[key]));
      assert.equal(view.latest.close,Number(expected.close));assert.equal(view.eligibleForRanking,false);assert.equal(view.paperMarksEligible,false);
      assert.equal(view.latest.capturedAt,input.source.capturedAt);
    }
    assert.deepEqual(input,before);
  }
});

test('display exact values are detached from canonical bars and absent prices remain absent',()=>{
  const normalized=normalizePriceSeries(raw(values[1]),{at}).series,before=structuredClone(normalized);
  const view=buildPriceView(normalized,{at});assert.notEqual(view.points[0].decimals,normalized.bars[0].decimals);
  view.points[0].decimals.close='1';assert.deepEqual(normalized,before);assert.equal(view.latest.closeDecimal,values[1].close);
  assert.equal(buildPriceView(normalized,{at}).points[0].decimals.close,values[1].close);
  const missing=buildPriceView(null,{at});assert.deepEqual(missing.points,[]);assert.equal(missing.latest,null);
});
