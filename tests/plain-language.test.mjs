import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {plainLanguage} from '../dist/data/plain-language.js';
import * as research from '../dist/data/research.js';
import * as corpus from '../dist/data/nobel-corpus.js';

const sha256=value=>createHash('sha256').update(value,'utf8').digest('hex');
const words=value=>String(value??'').trim().split(/\s+/).filter(Boolean).length;
const sources=[...research.sources,...corpus.sources].filter((source,index,all)=>all.findIndex(s=>s.id===source.id)===index);
// Every long passage (8 or more words) that the Library, Method and Sources pages render
// from research data, keyed the way the views key it.
function inventory(){
  const items=[];const add=(id,original)=>{if(typeof original==='string'&&words(original)>=8)items.push({id,original});};
  for(const note of corpus.nobelLibrary)for(const field of ['mechanism','takeaway','limits','verificationScope'])add(`library:${note.id}:${field}`,note[field]);
  for(const layer of corpus.methodologyPublic.concentric_layers)for(const field of ['question','result'])add(`method:layer:${layer.id}:${field}`,layer[field]);
  for(const gate of research.studyState.gates)add(`gate:${gate.id}:detail`,gate.detail);
  for(const source of sources)for(const field of ['status','rightsStatus','verificationScope'])add(`registry:${source.id}:${field}`,source[field]);
  return items;
}
// The current original text for a plain-language id, read from the data the app loads.
function originalFor(id){
  const parts=id.split(':');
  if(parts[0]==='library')return corpus.nobelLibrary.find(note=>note.id===parts[1])?.[parts[2]];
  if(parts[0]==='method'&&parts[1]==='layer')return corpus.methodologyPublic.concentric_layers.find(layer=>layer.id===parts[2])?.[parts[3]];
  if(parts[0]==='gate')return research.studyState.gates.find(gate=>gate.id===parts[1])?.[parts[2]];
  if(parts[0]==='registry')return sources.find(source=>source.id===parts[1])?.[parts[2]];
  return undefined;
}
const numbers=value=>String(value).match(/\d+(?:[.,]\d+)*/g)||[];
const banned=/\b(?:delve|leverage|seamless|robust|unlock|empower|elevate|landscape|journey|crucial|pivotal|tapestry|realm|embark|streamline|cutting-edge|game-changer|harness|foster|showcase|comprehensive|holistic|synergy)\b|dive into|in today's|at the end of the day/i;

test('every long research passage on Library, Method and Sources has a plain entry',()=>{
  const items=inventory();
  assert.equal(items.length,147,'the inventory rule still selects the 147 passages whose plain text was checked');
  for(const {id} of items)assert.ok(Object.hasOwn(plainLanguage,id),`plain entry for ${id}`);
  assert.equal(Object.keys(plainLanguage).length,items.length,'no plain entry without a passage');
});

test('each plain entry is pinned to the sha256 of the exact current original',()=>{
  for(const [id,entry] of Object.entries(plainLanguage)){
    const original=originalFor(id);
    assert.equal(typeof original,'string',`${id} resolves to a current original`);
    assert.equal(entry.original_sha256,sha256(original),`${id}: the original changed after its plain text was checked. Check the plain text again, then update original_sha256.`);
  }
});

test('the plain map is frozen and holds only a plain text and a fingerprint per id',()=>{
  assert.ok(Object.isFrozen(plainLanguage));
  for(const [id,entry] of Object.entries(plainLanguage)){
    assert.ok(Object.isFrozen(entry),`${id} is frozen`);
    assert.deepEqual(Object.keys(entry).sort(),['original_sha256','plain'],id);
    assert.equal(typeof entry.plain,'string');assert.ok(entry.plain.trim().length>0,`${id} has text`);
    assert.match(entry.original_sha256,/^[0-9a-f]{64}$/,id);
  }
});

// The number check runs both ways: a plain text keeps every number of its original and adds
// none. It cannot see a swapped order ("10 and 11" as "11 and 10") or a changed number written
// in words ("six" as "four"). Those still need a human check against the original.
test('plain texts keep every number, add none, use no em dash and keep sentences to 25 words',()=>{
  for(const [id,{plain}] of Object.entries(plainLanguage)){
    const original=originalFor(id);
    assert.doesNotMatch(plain,/—/,`${id}: no em dash`);
    for(const sentence of plain.trim().split(/(?<=[.!?])\s+/).filter(Boolean))assert.ok(words(sentence)<=25,`${id}: ${words(sentence)} words in "${sentence}"`);
    const kept=new Set(numbers(plain)),source=new Set(numbers(original));
    for(const number of numbers(original))assert.ok(kept.has(number),`${id}: keeps the number ${number}`);
    for(const number of numbers(plain))assert.ok(source.has(number),`${id}: adds no number; ${number} is not in the original`);
    assert.doesNotMatch(plain,banned,`${id}: owner voice word list`);
    assert.doesNotMatch(plain,/\b[a-z]+_[a-z]+(?:_[a-z]+)*\b/,`${id}: no code token`);
  }
});

// The owner's voice rule: a term that must stay gets a short plain explanation in parentheses,
// 12 words at most.
test('each explanation in parentheses is 12 words or fewer',()=>{
  for(const [id,{plain}] of Object.entries(plainLanguage))for(const [,gloss] of plain.matchAll(/\(([^()]*)\)/g))assert.ok(words(gloss)<=12,`${id}: ${words(gloss)} words in "(${gloss})"`);
});

// A limit can turn into a claim by losing one word ("It is not a profitable trading rule"
// becomes "It is a profitable trading rule"), or by losing a sentence. Each plain text's count
// of negation words is pinned, so an edit that drops one fails here and must be reviewed on
// purpose. Pins are keyed by the first id that carries each distinct plain text. Words that
// state a limit without a negation (uncertain, insufficient, severe, unreliable) count too, so
// deleting "The timing of disruption ... is uncertain." from the 2025 limits fails here.
const negation=/\b(?:not|no|never|none|nor|neither|nothing|nobody|without|cannot|withheld|unverified|unproven|unvalidated|unavailable|unknown|uncertain|insufficient|severe|unreliabl[ey])\b|n['’]t\b/gi;
const negations=value=>(String(value).match(negation)||[]).length;
const negationPins={
  'library:nobel-2011:mechanism':1,'library:nobel-2011:takeaway':0,'library:nobel-2011:limits':3,'library:nobel-2011:verificationScope':2,
  'library:nobel-2012:mechanism':1,'library:nobel-2012:takeaway':0,'library:nobel-2012:limits':1,
  'library:nobel-2013:mechanism':0,'library:nobel-2013:takeaway':0,'library:nobel-2013:limits':1,
  'library:nobel-2014:mechanism':3,'library:nobel-2014:takeaway':0,'library:nobel-2014:limits':1,
  'library:nobel-2015:mechanism':1,'library:nobel-2015:takeaway':0,'library:nobel-2015:limits':1,
  'library:nobel-2016:mechanism':2,'library:nobel-2016:takeaway':0,'library:nobel-2016:limits':2,
  'library:nobel-2017:mechanism':2,'library:nobel-2017:takeaway':0,'library:nobel-2017:limits':1,
  'library:nobel-2018:mechanism':2,'library:nobel-2018:takeaway':0,'library:nobel-2018:limits':1,
  'library:nobel-2019:mechanism':1,'library:nobel-2019:takeaway':0,'library:nobel-2019:limits':1,
  'library:nobel-2020:mechanism':1,'library:nobel-2020:takeaway':0,'library:nobel-2020:limits':2,
  'library:nobel-2021:mechanism':0,'library:nobel-2021:takeaway':0,'library:nobel-2021:limits':2,
  'library:nobel-2022:mechanism':0,'library:nobel-2022:takeaway':0,'library:nobel-2022:limits':4,
  'library:nobel-2023:mechanism':1,'library:nobel-2023:takeaway':0,'library:nobel-2023:limits':4,
  'library:nobel-2024:mechanism':2,'library:nobel-2024:takeaway':0,'library:nobel-2024:limits':1,
  'library:nobel-2025:mechanism':0,'library:nobel-2025:takeaway':0,'library:nobel-2025:limits':4,
  'library:nobel-2026:mechanism':0,'library:nobel-2026:takeaway':1,'library:nobel-2026:limits':4,'library:nobel-2026:verificationScope':2,
  'method:layer:macro:question':0,'method:layer:macro:result':1,'method:layer:fed_response:question':0,'method:layer:fed_response:result':0,
  'method:layer:industry:question':0,'method:layer:industry:result':2,'method:layer:forward_earnings:question':0,'method:layer:forward_earnings:result':2,
  'method:layer:catalyst:question':0,'method:layer:catalyst:result':1,'method:layer:execution:question':0,'method:layer:execution:result':1,
  'method:layer:per_share:question':0,'method:layer:per_share:result':0,
  'gate:calibration:detail':2,'gate:rights:detail':0,'gate:earnings:detail':2,'gate:study:detail':0,
  'registry:nobel-2013:rightsStatus':1,'registry:nobel-2013:verificationScope':1,'registry:nobel-2011-sims:verificationScope':1,'registry:nobel-2022-diamond:verificationScope':1,
  'registry:nobel-2021-angrist:verificationScope':0,'registry:nobel-2017-thaler:verificationScope':0,'registry:nobel-2016-holmstrom:verificationScope':0,'registry:nobel-2014-tirole:verificationScope':0,
  'registry:fred-alfred:rightsStatus':1,'registry:fred-alfred:verificationScope':1,'registry:sec-edgar:rightsStatus':1,'registry:sec-edgar:verificationScope':1,
  'registry:nobel-background-2011:status':1,'registry:nobel-background-2011:rightsStatus':2,'registry:nobel-background-2011:verificationScope':4,'registry:nobel-background-2012:verificationScope':2,
  'registry:nobel-background-2026:verificationScope':4
};
test('plain texts keep every negation word that states a limit',()=>{
  const first=new Map();
  for(const [id,{plain}] of Object.entries(plainLanguage))if(!first.has(plain))first.set(plain,id);
  assert.deepEqual([...first.values()],Object.keys(negationPins),'one pin for each distinct plain text, in data order');
  for(const [plain,id] of first){
    const original=originalFor(id);
    assert.equal(negations(plain),negationPins[id],`${id}: negation words changed. Check that every limit keeps its meaning, then update the pin.`);
    assert.ok(negations(plain)>=negations(original),`${id}: no fewer negation words than the original`);
    if(negations(original)>0)assert.ok(negations(plain)>0,`${id}: the original states a limit, so the plain text must too`);
  }
});
test('the limit-word count catches a deleted limit sentence that has no negation word',()=>{
  const id='library:nobel-2025:limits',plain=plainLanguage[id].plain;
  const cut=plain.replace(/ The timing of disruption [^.]*\. So is value capture [^.]*\./,'');
  assert.notEqual(cut,plain,'the two sentences are in the plain text');
  assert.equal(negations(plain),negationPins[id]);
  assert.notEqual(negations(cut),negationPins[id],'deleting "is uncertain" changes the pinned count');
});

// Each distinct plain text is pinned by the first 16 hex digits of its sha256 (UTF-8), keyed
// like the negation pins. A deleted sentence, a swap between passages or any other edit fails
// here until someone checks the new text against its original and updates the pin on purpose.
const reviewedPins={
  'library:nobel-2011:mechanism':'9bc33d41bda8294e','library:nobel-2011:takeaway':'783705f2dda6fb88','library:nobel-2011:limits':'ac7ea04653bd5f10','library:nobel-2011:verificationScope':'b88e13438637387a',
  'library:nobel-2012:mechanism':'39da65f9a4b34e7a','library:nobel-2012:takeaway':'4a94a0252cae0b5e','library:nobel-2012:limits':'87b7af6df66d46f2',
  'library:nobel-2013:mechanism':'639481f9eb22a4ef','library:nobel-2013:takeaway':'63f8b79397401d53','library:nobel-2013:limits':'ca68f699ed0a0840',
  'library:nobel-2014:mechanism':'7dd55494a0872d70','library:nobel-2014:takeaway':'35a96a0d274b7d0a','library:nobel-2014:limits':'a5409eea5c2a8722',
  'library:nobel-2015:mechanism':'4534f09e3445cdd6','library:nobel-2015:takeaway':'a81f440a22dffd24','library:nobel-2015:limits':'93692b54f6914ceb',
  'library:nobel-2016:mechanism':'e1b58e173f936ebd','library:nobel-2016:takeaway':'5ab3257f3e9a0501','library:nobel-2016:limits':'3c707e8a41dbe4f2',
  'library:nobel-2017:mechanism':'237abd57ad2e8499','library:nobel-2017:takeaway':'1b2a94ab6e434253','library:nobel-2017:limits':'6efb7546a28b6d09',
  'library:nobel-2018:mechanism':'cdefc877547c1f9e','library:nobel-2018:takeaway':'3766f2c25a366a90','library:nobel-2018:limits':'0c983de4c7275222',
  'library:nobel-2019:mechanism':'924be7c47e80f258','library:nobel-2019:takeaway':'6a072586ad65a9ea','library:nobel-2019:limits':'4116c1f022675321',
  'library:nobel-2020:mechanism':'370320277391bb2f','library:nobel-2020:takeaway':'6d2f3309b44ede8a','library:nobel-2020:limits':'57619475fe1a6275',
  'library:nobel-2021:mechanism':'0b149d34ac72db56','library:nobel-2021:takeaway':'e956321033f1417e','library:nobel-2021:limits':'7a509245c4d070c6',
  'library:nobel-2022:mechanism':'64a2f9be8d5e1e8f','library:nobel-2022:takeaway':'b9b2ed43883de4f3','library:nobel-2022:limits':'67699e00f46f3b04',
  'library:nobel-2023:mechanism':'80953bafe6f42030','library:nobel-2023:takeaway':'6d550541b723ef67','library:nobel-2023:limits':'8fad88526c8ab757',
  'library:nobel-2024:mechanism':'f8e3b6acb1728cbb','library:nobel-2024:takeaway':'ad6cbccbf52efb3d','library:nobel-2024:limits':'dd70bb10113b313a',
  'library:nobel-2025:mechanism':'9c6ef52d71805f66','library:nobel-2025:takeaway':'4feb7609ae65f32d','library:nobel-2025:limits':'5c7160fcd1542337',
  'library:nobel-2026:mechanism':'c5d8cea8f2fbcdd7','library:nobel-2026:takeaway':'8e8bd42871a7efd5','library:nobel-2026:limits':'9f77c315f514d10f','library:nobel-2026:verificationScope':'023f7dae34b89888',
  'method:layer:macro:question':'5e40423c9f0f638b','method:layer:macro:result':'e74f0b7abdec96ff','method:layer:fed_response:question':'314de32beebc126e','method:layer:fed_response:result':'efd3d134fcfc7682',
  'method:layer:industry:question':'de9f6bfda6ecfbd7','method:layer:industry:result':'b8b0e40d198b602c','method:layer:forward_earnings:question':'da53aaaaf9c089ae','method:layer:forward_earnings:result':'60b14841c1810296',
  'method:layer:catalyst:question':'2fc39deff5e3cd23','method:layer:catalyst:result':'fd43e80c160ea432','method:layer:execution:question':'d6f0583a2b658610','method:layer:execution:result':'499dab69b71d5cb8',
  'method:layer:per_share:question':'626d765475259957','method:layer:per_share:result':'6973971b681fcad8',
  'gate:calibration:detail':'5185b06d9fdf9a9f','gate:rights:detail':'ff37b896ebb70c48','gate:earnings:detail':'d1c7ce6aa074b01d','gate:study:detail':'eb41134af0cc9627',
  'registry:nobel-2013:rightsStatus':'11c5c6821d993c30','registry:nobel-2013:verificationScope':'fcab6f325df6752d','registry:nobel-2011-sims:verificationScope':'d3c4e50b7b06f933','registry:nobel-2022-diamond:verificationScope':'9ce42727099ea56a',
  'registry:nobel-2021-angrist:verificationScope':'b8cbb331c43e6e38','registry:nobel-2017-thaler:verificationScope':'e11a4f59345797d3','registry:nobel-2016-holmstrom:verificationScope':'5f4dea4c829266c9','registry:nobel-2014-tirole:verificationScope':'fc1ec4932cb0e466',
  'registry:fred-alfred:rightsStatus':'abd47ff2232b2404','registry:fred-alfred:verificationScope':'1c7b1f89c760e968','registry:sec-edgar:rightsStatus':'31766d28ebd58cb7','registry:sec-edgar:verificationScope':'7b845906e1f6a159',
  'registry:nobel-background-2011:status':'083e31f0a58ec575','registry:nobel-background-2011:rightsStatus':'c762519ec8fd06e1','registry:nobel-background-2011:verificationScope':'873fbbe226861d0c','registry:nobel-background-2012:verificationScope':'144707d201364ef7',
  'registry:nobel-background-2026:verificationScope':'492c0ce85f72b21f'
};
test('each plain text is the exact text that was checked against its original',()=>{
  const first=new Map();
  for(const [id,{plain}] of Object.entries(plainLanguage))if(!first.has(plain))first.set(plain,id);
  assert.deepEqual([...first.values()],Object.keys(reviewedPins),'one pin for each distinct plain text, in data order');
  for(const [plain,id] of first)assert.equal(sha256(plain).slice(0,16),reviewedPins[id],`${id}: the plain text changed. Check it against its original, then update the pin.`);
});

// The limits that carry the most weight keep these exact plain words. A rewrite that turns one
// into a claim fails here even when it keeps the same count of negation words.
const requiredPhrases={
  'gate:calibration:detail':['No forecasting skill has been established'],
  'gate:study:detail':['before any claim of validation'],
  'gate:earnings:detail':['does not erase'],
  'gate:rights:detail':['still blocked until permission is confirmed'],
  'library:nobel-2025:limits':['is a severe problem'],
  'library:nobel-2026:limits':['no unverified claim','claims no forecast or investment result'],
  'registry:nobel-background-2026:verificationScope':['is withheld']
};
test('the weightiest limits keep their exact plain words',()=>{
  for(const [id,phrases] of Object.entries(requiredPhrases)){
    assert.ok(Object.hasOwn(plainLanguage,id),`${id} has a plain text`);
    for(const phrase of phrases)assert.ok(plainLanguage[id].plain.includes(phrase),`${id}: keeps "${phrase}"`);
  }
});

// Claim words run one way, like the number check, and they are counted. A plain text may use a
// stem no more often than its original does, plus the harmless uses listed below. So a plain text
// whose original says "forecast" once cannot add a second "forecasts gains". Each listed use was
// checked by hand.
const claimPattern=/\b(?:buy|recommend\w*|top pick|upside|probabilit\w*|odds|expected returns?|validated|proven|proves?)\b|chance (?:of|for) (?:a )?gain/i;
const claimStems={
  buy:/\bbuy\w*/i,sell:/\bsell\w*|\bsold\b/i,recommend:/\brecommend\w*/i,'top pick':/\btop picks?\b/i,outperform:/\boutperform\w*/i,beat:/\bbeat(?:s|ing)?\b/i,
  underpriced:/\bunderpric\w*|\bundervalu\w*/i,overpriced:/\boverpric\w*|\bovervalu\w*/i,mispriced:/\bmispric\w*/i,cheap:/\bcheap\w*/i,
  predict:/\bpredict\w*/i,forecast:/\bforecast\w*/i,'expected return':/\bexpected returns?\b/i,probability:/\bprobab\w*/i,odds:/\bodds\b/i,'chance of gain':/\bchances? (?:of|for) (?:a )?gains?\b/i,
  edge:/\bedge\w*/i,alpha:/\balpha\b/i,profit:/\bprofit\w*/i,upside:/\bupside\b/i,validated:/\bvalidat\w*/i,proven:/\bprov(?:en|es?)\b/i,guarantee:/\bguarant\w*/i,
  rank:/\brank\w*/i,signal:/\bsignal\w*/i,winner:/\bwinners?\b/i,
  // Direction and advice words.
  rise:/\b(?:ris(?:e|es|ing|en)|rose|rall(?:y|ies|ied|ying))\b/i,'go up':/\b(?:go|goes|going|gone|went)\s+up\b/i,gain:/\bgain(?:s|ed|ing)?\b/i,
  'price target':/\bprice targets?\b|\btarget prices?\b/i,bullish:/\bbullish\b|\bbearish\b/i,attractive:/\battractive\w*/i,likely:/\b(?:un)?likel(?:y|ihood)\b/i,
  'should buy':/\bshould\s+(?:buy|own|hold)\b/i,opportunity:/\bopportunit\w*/i,'do well':/\b(?:do|does|did|doing|done)\s+well\b/i
};
const stemCount=(value,pattern)=>(String(value).match(new RegExp(pattern.source,'gi'))||[]).length;
const harmlessClaimWords={
  'library:nobel-2013:mechanism':{gain:1}, // returns: "the gain or loss from holding an investment"
  'library:nobel-2013:limits':{mispriced:1}, // the joint-hypothesis gloss: "any test of mispricing also tests the pricing model"
  'library:nobel-2014:mechanism':{edge:2,profit:1}, // "the share of sales kept as profit"; high margins "do not show an edge over rivals", nor "that such an edge would hold up"
  'library:nobel-2015:limits':{gain:1}, // returns: "the gain or loss from owning its shares"
  'library:nobel-2018:mechanism':{'do well':1}, // "Neither idea, on its own, picks out a stock that will do well in the near term."
  'library:nobel-2020:mechanism':{winner:1}, // the winner’s curse gloss: "the winner has often valued the item too highly"
  'library:nobel-2021:mechanism':{gain:1}, // "Predicting the gain or loss from holding an investment is one task."
  'library:nobel-2022:mechanism':{sell:1}, // liquidity: "assets that can be sold quickly"
  'library:nobel-2023:limits':{gain:1}, // demographic mix "is not a factor that makes an investment gain or lose value"
  'library:nobel-2024:limits':{signal:1}, // noisy indicators: "random error that blurs the signal"
  'library:nobel-2025:limits':{gain:1}, // shareholder returns: "the gains or losses that owners of the shares get"
  'method:layer:macro:question':{cheap:1,rise:1}, // financing: "how easily and cheaply money can be raised"; inflation: "prices rising across the economy"
  'method:layer:industry:question':{profit:1}, // "the industry’s sales and profits"
  'method:layer:forward_earnings:question':{profit:1}, // "future sales or profit"
  'method:layer:forward_earnings:result':{profit:1}, // cash conversion: "how much profit turns into cash"
  'method:layer:per_share:result':{sell:1} // operating companies: "businesses that sell goods or services"
};
// The stems a plain text uses more often than its original plus its listed harmless uses.
const addedClaims=(id,plain,original)=>Object.entries(claimStems).filter(([stem,pattern])=>stemCount(plain,pattern)>stemCount(original,pattern)+(harmlessClaimWords[id]?.[stem]||0)).map(([stem])=>stem);
test('plain texts add no claim word that their original lacks',()=>{
  const used=[];
  for(const [id,{plain}] of Object.entries(plainLanguage)){
    const original=originalFor(id);
    if(claimPattern.test(plain))assert.match(original,claimPattern,`${id}: "${plain.match(claimPattern)[0]}" is a claim word its original lacks`);
    assert.deepEqual(addedClaims(id,plain,original),[],`${id}: uses a claim word more often than its original. Rewrite it, or check it by hand and list it as harmless.`);
    for(const [stem,pattern] of Object.entries(claimStems)){const extra=stemCount(plain,pattern)-stemCount(original,pattern);if(extra>0)used.push(`${id}:${stem}:${extra}`);}
  }
  assert.deepEqual(used.sort(),Object.entries(harmlessClaimWords).flatMap(([id,stems])=>Object.entries(stems).map(([stem,n])=>`${id}:${stem}:${n}`)).sort(),'each listed harmless use is still there, so the list stays exact');
});
test('the claim count catches added direction and advice words that the old presence check let through',()=>{
  const id='gate:calibration:detail',plain=plainLanguage[id].plain,original=originalFor(id);
  assert.deepEqual(addedClaims(id,plain,original),[]);
  for(const [sentence,stems] of [['Shares of innovators will likely rise.',['likely','rise']],['Expect the stock to go up.',['go up']],['The desk forecasts gains for next week.',['forecast','gain']],['It is an attractive opportunity with a price target.',['attractive','opportunity','price target']],['Owners should hold, as the view is bullish and the stock may do well.',['bullish','do well','should buy']]])
    assert.deepEqual(addedClaims(id,`${plain} ${sentence}`,original).sort(),stems.sort(),sentence);
  // "forecast" is in the original, so a presence check passed "forecasts gains"; the count does not.
  assert.ok(claimStems.forecast.test(original),'the original already says forecast');
});

// The way to the original must stay visible and easy to hit. cssRules() and hidingDeclarations()
// are read from tests/ui-feedback-anchor-desk.test.mjs, so this guard and the outcome-line guard
// share one reading of the stylesheet (rules inside any at-rule, in file order) and one list of the
// ways a rule can hide an element.
const feedbackGuard=await readFile(new URL('./ui-feedback-anchor-desk.test.mjs',import.meta.url),'utf8');
const lift=name=>{const start=feedbackGuard.indexOf(`function ${name}(`),end=feedbackGuard.indexOf('\n}\n',start)+2;assert.ok(start>=0&&end>start,`ui-feedback-anchor-desk.test.mjs defines ${name}()`);return feedbackGuard.slice(start,end);};
const {cssRules,hidingDeclarations}=vm.runInNewContext(`${lift('cssRules')}\n${lift('hidingDeclarations')}\n({cssRules,hidingDeclarations})`,{});
// A rule counts when one of its selectors names original-wording, when its subject (the last
// compound) can match the disclosure itself (details, optionally with the original-wording class,
// the open attribute or its data attributes) or its summary (a bare summary), or when its subject
// can match the original's text (a bare p or *) under an ancestor that can be a details element or
// .original-wording. Other ancestors are ignored, so ".library-card summary" and
// ".library-card details p" count. :root matches only the page root. Pseudo-elements never hide the
// element. :is(), :where() and :matches() lists are expanded one level.
const compoundsOf=selector=>selector.split(/\s*[>+~]\s*(?![^()]*\))|\s+(?![^()]*\))/).filter(Boolean);
const lastCompound=selector=>compoundsOf(selector).pop()||'';
const expand=compound=>{const match=compound.match(/:(?:is|where|matches)\(([^()]*)\)/);return match?match[1].split(',').flatMap(item=>expand(compound.replace(match[0],lastCompound(item.trim())))):[compound];};
function reaches(compound){
  const none={details:false,summary:false,text:false,container:false};
  if(/:root\b/.test(compound))return none;
  const rest=compound.replace(/:not\([^()]*\)/g,'').replace(/:[\w-]+(?:\([^()]*\))?/g,'');
  const tag=(rest.match(/^[a-z*]+/i)||[''])[0].toLowerCase(), classes=[...rest.matchAll(/\.([\w-]+)/g)].map(m=>m[1]), attributes=[...rest.matchAll(/\[\s*([\w-]+)/g)].map(m=>m[1]);
  if(rest.replace(/^[a-z*]+/i,'').replace(/\.[\w-]+|\[[^\]]*\]/g,'').trim())return none;
  const details=['','*','details'].includes(tag)&&classes.every(name=>name==='original-wording')&&attributes.every(name=>['open','data-state-key','data-search-open'].includes(name));
  return {
    details,
    summary:['','*','summary'].includes(tag)&&!classes.length&&!attributes.length,
    text:['','*','p'].includes(tag)&&!classes.length&&!attributes.length,
    container:details||tag==='details'||classes.includes('original-wording')
  };
}
function reach(selector){
  const subject=expand(lastCompound(selector)).map(reaches),ancestors=compoundsOf(selector).slice(0,-1).flatMap(expand).map(reaches);
  return {named:selector.includes('original-wording'),details:subject.some(hit=>hit.details),summary:subject.some(hit=>hit.summary)||selector.includes('original-wording')&&/summary(?::[\w-]+(?:\([^)]*\))?)*$/.test(selector),text:subject.some(hit=>hit.text)&&ancestors.some(hit=>hit.container)};
}
// The properties that rules reaching the original wording set today. Anything else needs a check
// by hand first and a place on this list: pointer-events, height, overflow, position, opacity,
// transform and custom properties can each hide the original or make it hard to open. Motion is
// only ever switched off here, because a keyframe animation could fade the text out.
const originalWordingProperties=new Set(['animation','border-left','border-top','box-sizing','break-inside','color','cursor','display','font-size','font-weight','line-height','margin','margin-bottom','max-width','min-height','min-width','outline','outline-color','outline-offset','overflow-wrap','padding','padding-block','padding-bottom','padding-left','scroll-behavior','scroll-margin-top','transition','width']);
const motion=new Set(['animation','transition']);
function originalWordingProblems(css){
  const problems=[];let rules=0;
  for(const rule of cssRules(css)){
    const where=`${rule.at.join(' ')} ${rule.selectors.join(',')}`.trim();
    const hits=rule.selectors.filter(selector=>selector&&!selector.includes('::')).map(reach);
    if(!hits.some(hit=>hit.named||hit.details||hit.summary||hit.text))continue;
    rules++;
    for(const part of rule.body.split(';')){
      const colon=part.indexOf(':');if(colon<0)continue;
      const name=part.slice(0,colon).trim().toLowerCase(),value=part.slice(colon+1).replace(/!important/i,'').trim().toLowerCase();
      if(!originalWordingProperties.has(name))problems.push(`${where}: ${name} is not on the list of checked properties`);
      else if(motion.has(name)&&value!=='none')problems.push(`${where}: ${name}:${value} is more than switching motion off`);
      if(name==='font-size')for(const [,n,unit] of value.matchAll(/(\d*\.?\d+)(px|r?em)\b/g))if(unit==='px'?Number(n)<11:Number(n)<0.7)problems.push(`${where}: font-size ${n}${unit} is too small to read`);
      if(hits.some(hit=>hit.summary)&&/^(?:min-|max-)?height$/.test(name))for(const [,n,unit] of value.matchAll(/(\d*\.?\d+)(px|r?em)\b/g))if(unit==='px'?Number(n)<44:Number(n)<2.75)problems.push(`${where}: ${name} ${n}${unit} keeps the summary under 44 px`);
    }
    for(const found of hidingDeclarations(rule.body))problems.push(`${where}: ${found} hides it`);
  }
  return {rules,problems};
}
test('style.css keeps each original-wording disclosure, summary and text visible, and each summary at least 44 px tall',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.match(css.replace(/\/\*[\s\S]*?\*\//g,''),/\.original-wording>summary\{[^}]*min-height:44px/,'the summary is a 44 px target');
  const {rules,problems}=originalWordingProblems(css);
  assert.deepEqual(problems,[],'no rule that reaches the original wording hides it, shrinks it or uses an unchecked property');
  assert.ok(rules>=20,`the rules that reach the original wording were found (${rules})`);
});
test('the original-wording CSS check sees rules that reach the disclosure through any selector',()=>{
  const hit=selector=>reach(selector);
  for(const selector of ['.original-wording>summary','.library-card summary','details>summary','summary:hover','main :is(button,summary):focus-visible','*'])assert.equal(hit(selector).summary,true,`${selector} reaches the summary`);
  for(const selector of ['.original-wording','details.original-wording[open]','.registry-card details','.method-application.card>div:first-child>details'])assert.equal(hit(selector).details,true,`${selector} reaches the disclosure`);
  for(const selector of ['.original-wording>p','.library-card details p','details *','.registry-card details>p:first-child','details.registry-group p','.x :is(.original-wording) p'])assert.equal(hit(selector).text,true,`${selector} reaches the original text`);
  for(const selector of ['.event-details>summary.event-row','details.registry-group>summary.x','.original-wording>p','.sr-only','[hidden]',':root'])assert.equal(hit(selector).summary,false,`${selector} cannot match the summary`);
  for(const selector of ['details.registry-group','.desk-disclosure','.stock-desk summary',':root'])assert.equal(hit(selector).details,false,`${selector} cannot match the disclosure`);
  for(const selector of ['p','.detail-copy p','details p.reason','.registry-card details .registry-kind'])assert.equal(hit(selector).text,false,`${selector} is not counted as reaching the original text`);
});
test('the original-wording CSS check fails each way of hiding the original that a review tried',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const fails=rule=>originalWordingProblems(`${css}\n${rule}`).problems.length>0;
  for(const body of ['opacity:0','font-size:0','color:transparent','transform:scale(0)','clip-path:inset(50%)','position:absolute;left:-9999px','text-indent:-9999px','pointer-events:none','height:0','height:1rem','visibility:hidden','display:none','display: none !important','content-visibility:hidden','font-size:.2rem','animation:fade 1s forwards','--t-small:0'])
    for(const selector of ['.original-wording','.original-wording>summary','.original-wording>p'])assert.ok(fails(`${selector}{${body}}`),`${selector}{${body}}`);
  for(const rule of ['.original-wording{max-height:0;overflow:hidden}','.library-card details p{display:none}','.registry-card details{height:0;overflow:hidden}','@media (max-width:680px){.original-wording>summary{min-height:24px}}','.stock-desk summary{min-height:2rem}','@supports (display:grid){@media (min-width:1101px){details.registry-group p{visibility:hidden}}}','.provenance-list details *{color:rgba(0,0,0,0)}'])
    assert.ok(fails(rule),rule);
  // Ordinary styling, and rules that cannot reach the original, are not flagged.
  for(const rule of ['.registry-card .registry-kind{display:none}','.sr-only{position:absolute;clip:rect(0 0 0 0)}','[hidden]{display:none}',':root{--x:0}','.original-wording>summary::marker{color:transparent}','.original-wording>summary{color:var(--ink,#1d2926);min-height:48px}','.original-wording>p{font-size:var(--t-small,13px);margin:0}'])
    assert.ok(!fails(rule),rule);
});

// "Library" in the research data names the outside place an earlier review used. On this site
// Library is also a menu item, so the plain text keeps the bare name and never says "the Library".
// Every registry gets the same neutral explanation, and a retained record is described as an
// earlier record (the data marks carried-over records "Retained"; no source PDF is served).
// "Retained review depth" is part of that record too. The original calls retained labels
// "reported provenance, not current verification", so the plain text says the depth record is
// no current check either, and it never states what the review did in its own voice. Each
// sentence after it names the record ("That record says", "The record also says", "The record
// adds") or states a limit.
test('plain texts name Library and the registry the way the data does',()=>{
  const explanations=new Set();
  for(const [id,{plain}] of Object.entries(plainLanguage)){
    const original=originalFor(id);
    assert.doesNotMatch(plain,/\bthe Library\b/i,`${id}: never "the Library"`);
    if(/\bthrough Library\b/.test(original))assert.match(plain,/\bthrough Library\b/,`${id}: keeps "through Library"`);
    for(const [,explanation] of plain.matchAll(/\bregistry \(([^)]*)\)/g))explanations.add(explanation);
    const retained=original.match(/^Retained bibliography (pages? [\d]+(?: and \d+)?) reviewed through Library\./);
    if(retained){
      assert.ok(plain.startsWith(`An earlier record says the bibliography (the list of works the source cites) on ${retained[1]} was reviewed through Library.`),`${id}: an earlier record, on ${retained[1]}`);
      assert.doesNotMatch(plain,/\bof the bibliography\b|\bretained\b|kept on file/i,`${id}: no page count of the bibliography and no claim that pages are kept`);
    }
    if(/Retained download\/review labels are reported provenance, not current verification\./.test(original))
      assert.ok(plain.includes('Labels about downloads and reviews were kept from earlier work. They record reported provenance (where a source came from and how it was saved). They do not count as a current check.'),`${id}: retained labels stay reported provenance, not a current check`);
    if(/Retained review depth:/.test(original)){
      const sentences=plain.split(/(?<=[.!?])\s+/),start=sentences.indexOf('The same holds for the earlier work’s record of how deep its review went.');
      assert.ok(start>0&&sentences[start-1]==='They do not count as a current check.',`${id}: the review depth is part of the earlier record, which is no current check`);
      const after=sentences.slice(start+1);
      assert.ok(after.length>0&&/^That record says\b/.test(after[0]),`${id}: the first claim names the record`);
      for(const sentence of after)assert.ok(/^(?:That|The) record (?:also says|says|adds)\b/.test(sentence)||negations(sentence)>0||/\brequired\b/.test(sentence),`${id}: "${sentence}" names the record or states a limit`);
      assert.doesNotMatch(plain,/\b(?:It|The review|The earlier work) (?:verified|reviewed|read|ran|checked|confirmed)\b/,`${id}: no claim of review work in the site’s own voice`);
    }
  }
  assert.deepEqual([...explanations],['a list of research sources and their details'],'one neutral explanation of "registry" everywhere');
});

test('the in-page fingerprint matches node:crypto and needs only JavaScript built-ins',async()=>{
  const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const start=app.indexOf('function sha256Hex(value) {'),end=app.indexOf('\n}\n',start)+2;
  assert.ok(start>0&&end>start,'app.js defines sha256Hex');
  const sha256Hex=vm.runInNewContext(`(${app.slice(start,end)})`,{});
  const samples=['','abc','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(1000),'winner’s curse · é € 😀',...inventory().map(item=>item.original)];
  for(const sample of samples)assert.equal(sha256Hex(sample),sha256(sample),JSON.stringify(sample).slice(0,60));
});

test('the plain module stays a light, optional, path-free data file',async()=>{
  const url=new URL('../dist/data/plain-language.js',import.meta.url);
  assert.ok((await stat(url)).size<64*1024,'under 64 KB');
  const source=await readFile(url,'utf8');
  assert.doesNotMatch(source,/\bimport\b|\bfetch\(|\/home\/|\/Users\/|\/tmp\//,'no imports, requests or local paths');
  const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.match(app,/import\('\.\/data\/plain-language\.js'\)[^;\n]*\.then\(usablePlain\)\.catch\(\(\)=>new Map\(\)\)/,'a failed or throwing plain module falls back to the originals');
});

const scenarios=['library-cards-and-notes-lead-with-plain-wording','search-matches-plain-and-original-wording','method-steps-and-open-checks-lead-with-plain-wording','sources-rows-and-dialogs-lead-with-plain-wording','a-missing-plain-module-leaves-every-original-as-before','a-missing-or-outdated-entry-shows-only-that-original','a-gate-without-an-id-shows-its-original','a-stalled-plain-module-leaves-every-original-within-2-seconds','a-slow-plain-module-counts-only-within-2-seconds','each-original-wording-disclosure-names-its-passage','plain-and-original-text-is-escaped-everywhere','a-search-that-matches-only-the-original-opens-it','originals-at-29-seconds-still-load-when-the-plain-module-stalls','a-plain-module-that-throws-leaves-every-original','each-term-is-explained-once-per-page'];
for(const scenario of scenarios)test(`plain wording on the pages: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/plain-language-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
