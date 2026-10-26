// Regression checks on the actual retained public data, not synthetic eligibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const payload=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));
const operating=payload.operating_evidence;
const caseFor=ticker=>{const c=operating.hypotheses.find(c=>c.ticker===ticker);assert.ok(c,`${ticker} case is retained`);return c;};
function stillWithheld(c){
 for(const field of ['rank','expected_return','gain_probability','price_reference'])assert.equal(c[field],null,`${c.ticker}.${field}`);
 for(const field of ['day_eligible','week_rank_eligible','ready_to_trade','liquidity_verified'])assert.equal(c[field],false,`${c.ticker}.${field}`);
 assert.equal(c.market_expectations,'unavailable');assert.equal(c.route_if_other_gates_pass,'B');
 assert.equal(operating.ranked_count,0);assert.equal(operating.predictive_status,'unvalidated');
 assert.equal(operating.publication_gates.ranked_upside_list,'blocked');
 assert.equal(operating.publication_gates.latest_completed_session_OHLCV,'missing');
 assert.equal(operating.publication_gates['60_session_consolidated_liquidity'],'missing');
 assert.equal(operating.publication_gates.all_latest_required_filings_and_later_material_announcements,'partial_review_only');
}

test('PG preserves separate dated annual and FY2027 Q1 Core-EPS references without inventing quarterly dollars or eligibility',()=>{
 const pg=caseFor('PG'),annual=pg.company_reference,q1=annual.quarterly_earnings_guidance;
 assert.equal(annual.period,'FY2027 ending June 30, 2027');assert.equal(annual.source_date,'2026-07-29');
 assert.deepEqual(annual.core_diluted_eps_range,[6.89,7.11]);assert.equal(annual.core_diluted_eps_midpoint,7);
 assert.ok(q1,'the July slide supplies a separate directional Q1 reference');
 assert.equal(q1.period,'FY2027 Q1');assert.equal(q1.issuer_wording,'Q1 EPS -5% or more');
 assert.match(q1.metric_context,/Core EPS/);assert.match(q1.metric_context,/slide 24/);
 assert.equal(q1.source_date,'2026-07-29');assert.equal(q1.source_ref,'pg_fy2026_slides');
 const source=operating.sources[q1.source_ref];assert.ok(source);assert.equal(source.published_date,q1.source_date);
 assert.equal(source.url,'https://www.sec.gov/Archives/edgar/data/80424/000008042426000097/q4fy2026earningsslides.htm');
 assert.equal(source.reviewed_image_url,'https://www.sec.gov/Archives/edgar/data/80424/000008042426000097/q4fy2026earningsslides024.jpg');
 assert.ok(pg.source_refs.includes(q1.source_ref));assert.ok(pg.source_refs.includes('pg_fy2026_results'));
 assert.equal(operating.sources.pg_fy2026_results.published_date,annual.source_date);
 // Preserve the issuer's directional wording; do not convert it to an EPS-dollar
 // range, midpoint, implied return, or a quantified bound with a guessed basis.
 assert.ok(Object.values(q1).every(v=>typeof v==='string'));
 assert.ok(Object.keys(q1).every(k=>!/(?:range|midpoint|(?:^|_)usd(?:_|$)|return|probability|rank)/i.test(k)));
 assert.doesNotMatch(JSON.stringify(q1),/\$\s*\d|USD\s*\d/);
 assert.match(q1.basis,/no quarterly dollar range/i);assert.match(q1.basis,/review remains incomplete/i);
 assert.match(pg.review_limits.join(' '),/No Q1 dollar range/i);assert.doesNotMatch(pg.review_limits.join(' '),/no Q1 EPS guide.*established/i);
 stillWithheld(pg);
});

test('TSLA Part III remains a limited historical source and cannot replace June/Q2 share bases or approve ranking',()=>{
 const tsla=caseFor('TSLA'),source=operating.sources.tsla_10ka,shares=tsla.evidence_chain.find(x=>x.link==='each_share');
 assert.ok(source,'the reviewed Part III amendment has its own source record');
 assert.equal(source.published_date,'2026-04-30');assert.equal(source.type,'SEC_10KA_Part_III');
 assert.equal(source.url,'https://www.sec.gov/Archives/edgar/data/1318605/000110465926053166/tm2611837d1_10ka.htm');
 assert.ok(tsla.source_refs.includes('tsla_10ka'));assert.match(source.access_note,/selected|selective/i);
 assert.match(tsla.review_limits.join(' '),/December 31 ownership denominator.*unreconciled/i);
 assert.match(tsla.review_limits.join(' '),/do not use it as the current EPS denominator/i);
 assert.doesNotMatch(tsla.review_limits.join(' '),/10-K\/A was inventoried but not captured\/read/i);
 assert.equal(tsla.company_reference.period,'Q2 2026 actuals, three months ended June 30');
 assert.equal(tsla.company_reference.is_company_guidance,false);assert.equal(tsla.company_reference.is_consensus,false);
 assert.equal(tsla.company_reference.diluted_eps_usd,0.32);assert.equal(tsla.company_reference.diluted_eps_non_gaap_usd,0.33);
 assert.equal(tsla.company_reference.q3_company_revenue_forecast,null);assert.equal(tsla.company_reference.q3_company_eps_forecast,null);
 assert.match(shares.text,/Q2 diluted weighted shares were 3\.540bn versus 3\.519bn/);
 assert.match(shares.text,/June issued\/outstanding shares of 3\.949bn/);assert.match(shares.text,/different basis/);
 assert.ok(shares.source_refs.includes('tsla_10q'));assert.ok(!shares.source_refs.includes('tsla_10ka'));
 assert.doesNotMatch(shares.text,/3,?752,?191,?774|3\.752191774|3\.751bn/);
 assert.match(tsla.review_limits.join(' '),/no gate attestation|no.*ranking approval/i);
 stillWithheld(tsla);
});
