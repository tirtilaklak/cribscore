import assert from 'node:assert/strict';
import {boot,retained,stock} from './continued-research-harness.mjs';
// Area B fix-round scenarios on the actual ESM app in the offline DOM: the stock desk as the
// running app renders it, wrapper included.
const ranking=/Ranked upside|Top pick|stock-shortlist|aria-label="[^"]*(?:rank|pick|upside)/i;
const clocks={upcoming:'2026-10-17T04:00:00Z',in_progress:'2026-10-19T15:00:00Z',archived:'2026-10-24T00:00:00Z'};
const scenarios={
  async 'desk-wrapper-adds-no-ranking-language'(){
    for(const [state,at] of Object.entries(clocks)){
      const app=await boot({at});
      for(const horizon of ['next_day','next_week']){
        if(horizon==='next_week')app.click(app.query('[data-horizon="next_week"]'));
        for(const query of ['','TXN','zzzz']){
          app.input(query);
          const html=app.html();
          assert.match(html,/<div class="stock-desk">/,`${state}/${horizon}/${query}: the desk rendered`);
          assert.match(html,/No stock is eligible\./,`${state}/${horizon}/${query}: the lede rendered`);
          assert.doesNotMatch(html,ranking,`${state}/${horizon}/${JSON.stringify(query)}: the desk and its wrapper add no ranking language`);
        }
        app.input('');
      }
    }
  },
  async 'desk-wrapper-adds-no-ranking-language-current-window'(){
    // The same rule on the current snapshot, at clocks taken from its own horizons.
    const h=stock.event_evidence.horizons,shift=(value,ms)=>new Date(Date.parse(value)+ms).toISOString();
    const current={upcoming:shift(h.entry_at_utc,-3600000),in_progress:shift(h.entry_at_utc,60000),archived:shift(h.week_exit_at_utc,60000)};
    const label={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot'};
    for(const [state,at] of Object.entries(current)){
      const app=await boot({at});
      for(const horizon of ['next_day','next_week']){
        if(horizon==='next_week')app.click(app.query('[data-horizon="next_week"]'));
        for(const query of ['','KO','zzzz']){
          app.input(query);
          const html=app.html();
          assert.match(html,/<div class="stock-desk">/,`${state}/${horizon}/${query}: the desk rendered`);
          assert.match(html,/No stock is eligible\./,`${state}/${horizon}/${query}: the lede rendered`);
          assert.doesNotMatch(html,ranking,`${state}/${horizon}/${JSON.stringify(query)}: the desk and its wrapper add no ranking language`);
        }
        app.input('');
        assert.match(app.html(),new RegExp(`<span class="tag neutral">${label[state]}</span>`),`${state}/${horizon}: the status follows the clock`);
      }
    }
  },
  async 'empty-desk-search-offers-clear-search'(){
    const app=await boot({at:clocks.archived,stockPayload:retained});
    app.input('zzzz');
    let html=app.html();
    assert.match(html,/<div class="search-empty"><h3>No matches for this search\.<\/h3><p>Try a shorter search, or clear it\.<\/p><button class="text-button" data-clear-search>Clear search<\/button><\/div>/);
    assert.doesNotMatch(html,/class="card stock-card"|class="card event-list"|No matching stocks|No matching events\./);
    assert.match(html,/Forecast unavailable for every case\./,'the forecast limit stays with an empty result');
    assert.match(app.live(),/ready for “zzzz”\. 0 results shown\./);
    app.click(app.query('[data-clear-search]'));
    html=app.html();
    assert.equal(app.query('#research-search').value,'','Clear search empties the field');
    assert.equal((html.match(/class="card stock-card"/g)||[]).length,6,'every case returns');
    assert.equal((html.match(/class="event-item"/g)||[]).length,5,'every earnings call returns');
    assert.doesNotMatch(html,/search-empty/);
    assert.equal(app.document.activeElement.id,'research-search','focus returns to the search field');
  },
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name),`known scenario ${name}`);await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
