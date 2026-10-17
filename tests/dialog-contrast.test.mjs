import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=(await readFile(new URL('../dist/style.css',import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selectors:selector.split(',').map(value=>value.trim()),declarations:Object.fromEntries(body.split(';').filter(part=>part.includes(':')).map(part=>{const colon=part.indexOf(':');return [part.slice(0,colon).trim(),part.slice(colon+1).trim()];}))}));
function property(selectors,name){let value;for(const rule of rules)if(rule.selectors.some(selector=>selectors.includes(selector))&&rule.declarations[name])value=rule.declarations[name];return value;}
function luminance(hex){const channels=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return channels.reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);}
function contrast(a,b){const [dark,light]=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (light+0.05)/(dark+0.05);}
for(const [name,selectors] of [['dialog surface',['dialog']],['record-code surface',['.record-code']]])test(`dialog body text meets normal-text contrast on ${name}`,()=>{
  // These exact selectors are the shipped modal paragraph foreground and its
  // two surfaces. record-code inherits the body color; it has no color rule.
  const foreground=property(['.detail-copy','dialog .detail-copy'],'color');
  const background=property(selectors,'background');
  assert.match(foreground,/^#[0-9a-f]{6}$/i);assert.match(background,/^#[0-9a-f]{6}$/i);
  if(name==='record-code surface')assert.equal(property(['.record-code'],'color'),undefined);
  const ratio=contrast(foreground,background);assert.ok(ratio>=4.5,`${foreground} on ${background}: ${ratio.toFixed(2)}:1 needs 4.5:1`);
});
