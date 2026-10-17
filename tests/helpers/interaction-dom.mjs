// Offline DOM subset for the app's native controls. Replacing innerHTML detaches
// old nodes and resets focus, unlike the old string-only runtime mocks.
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const camel=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
const dash=s=>s.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`);
const voids=new Set(['AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT','LINK','META','PARAM','SOURCE','TRACK','WBR']);
function matches(node,selector){
  if(node.tagName==='#TEXT')return false;
  const parts=selector.trim().split(/\s+(?![^[]*\])/);
  if(parts.length>1){const last=parts.pop();if(!matches(node,last))return false;let parent=node.parentElement;while(parent){if(matches(parent,parts.join(' ')))return true;parent=parent.parentElement;}return false;}
  let s=selector.trim(), ok=true;
  s=s.replace(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g,(_,key,value)=>{ok&&=value===undefined?node.attributes.has(key):node.getAttribute(key)===value;return '';});
  s=s.replace(/#([\w-]+)/g,(_,id)=>{ok&&=node.id===id;return '';});
  s=s.replace(/\.([\w-]+)/g,(_,name)=>{ok&&=node.className.split(/\s+/).includes(name);return '';});
  return ok&&(!s||s==='*'||node.tagName===s.toUpperCase());
}
export class Element {
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes=new Map();this.listeners=new Map();this.parentElement=null;this.writes=0;this.value='';this._text='';this._html='';
    this.dataset=new Proxy({},{get:(_,key)=>this.getAttribute(`data-${dash(key)}`)??undefined,set:(_,key,value)=>{this.setAttribute(`data-${dash(key)}`,String(value));return true;}});
    this.classList={toggle:(name,force)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));(force??!set.has(name))?set.add(name):set.delete(name);this.className=[...set].join(' ');}};
  }
  get id(){return this.getAttribute('id')||'';} get className(){return this.getAttribute('class')||'';}set className(v){this.setAttribute('class',v);}
  get open(){return this.attributes.has('open');}set open(value){value?this.setAttribute('open',''):this.removeAttribute('open');}
  get isConnected(){return this===this.ownerDocument?.body||!!this.parentElement?.isConnected;}
  get isContentEditable(){return this.getAttribute('contenteditable')==='true'||this.getAttribute('contenteditable')===''||!!this.parentElement?.isContentEditable;}
  setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)??null;}removeAttribute(k){this.attributes.delete(k);}
  get textContent(){return this.tagName==='#TEXT'?this._text:this.children.map(n=>n.textContent).join('');}
  set textContent(value){this.replaceChildren();const node=new Element('#text',this.ownerDocument);node._text=String(value);this.append(node);this._html=String(value);}
  get innerHTML(){return this._html;}
  set innerHTML(html){this.replaceChildren();this._html=html;this.writes++;parse(html,this,this.ownerDocument);}
  append(node){node.parentElement=this;this.children.push(node);}
  replaceChildren(){if(this.contains(this.ownerDocument?.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;for(const n of this.children)n.parentElement=null;this.children=[];}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(selector){const out=[];for(const child of this.children){if(selector.split(',').some(s=>matches(child,s)))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  closest(s){let node=this;while(node){if(s.split(',').some(part=>matches(node,part)))return node;node=node.parentElement;}return null;}
  focus(){if(this.isConnected)this.ownerDocument.activeElement=this;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  dispatch(event){event.target??=this;for(const fn of this.listeners.get(event.type)||[])fn(event);if(this.parentElement)this.parentElement.dispatch(event);else if(this!==this.ownerDocument.body)this.ownerDocument.dispatch(event);else this.ownerDocument.dispatch(event);}
  close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn({type:'close',target:this});}
  showModal(){this.open=true;this.querySelector('button')?.focus();}
  getBoundingClientRect(){return {left:0,top:0,right:500,bottom:500};}
}
function parse(html,root,document){const stack=[root];for(const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g)||[]){if(token.startsWith('<!'))continue;if(token.startsWith('</')){const tag=token.slice(2,-1).trim().toUpperCase();for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}if(token.startsWith('<')){const match=token.match(/^<([\w-]+)/);if(!match)continue;const node=new Element(match[1],document);const attrs=token.slice(match[0].length,token.length-1);for(const a of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(a[1],decode(a[2]??a[3]??a[4]??''));stack.at(-1).append(node);if(!voids.has(node.tagName)&&!token.endsWith('/>'))stack.push(node);}else{const node=new Element('#text',document);node._text=decode(token);stack.at(-1).append(node);}}}
export function createDocument(html){const document={hidden:false,title:'',listeners:new Map(),addEventListener:Element.prototype.addEventListener,dispatch(event){for(const fn of this.listeners.get(event.type)||[])fn(event);}};document.body=new Element('body',document);document.activeElement=document.body;document.querySelector=s=>document.body.querySelector(s);document.querySelectorAll=s=>document.body.querySelectorAll(s);document.body.innerHTML=html.replace(/^[\s\S]*?<body[^>]*>/,'').replace(/<\/body>[\s\S]*$/,'');return document;}
