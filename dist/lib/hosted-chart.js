const SYMBOLS = Object.freeze({IBM:'NYSE:IBM',JNJ:'NYSE:JNJ',NFLX:'NASDAQ:NFLX',PG:'NYSE:PG',TSLA:'NASDAQ:TSLA',TXN:'NASDAQ:TXN',SPY:'AMEX:SPY'});
export function hostedSymbol(symbol) { return typeof symbol==='string'&&Object.hasOwn(SYMBOLS,symbol)?SYMBOLS[symbol]:null; }
export function hostedChartURL(symbol) { const mapped=hostedSymbol(symbol);return mapped?`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(mapped)}`:null; }

// The endpoint and fragment format are used by TradingView's own Advanced Chart
// documentation. Never put its loader script in the private app or a same-origin
// srcdoc. Only the allowlisted public ticker enters this fixed configuration.
export function hostedChartEmbedURL(symbol) {
  const mapped=hostedSymbol(symbol);if(!mapped)return null;
  const config={autosize:true,symbol:mapped,interval:'D',timezone:'Etc/UTC',theme:'light',style:'1',locale:'en',allow_symbol_change:false,calendar:false,save_image:false,support_host:'https://www.tradingview.com',width:'100%',height:'100%'};
  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}

export function createHostedChartFrame(symbol,{document:doc=globalThis.document}={}) {
  const src=hostedChartEmbedURL(symbol);if(!src)throw new Error('unsupported_hosted_symbol');
  const frame=doc.createElement('iframe');
  frame.title=`${symbol} hosted market chart from TradingView`;
  // allow-same-origin preserves the vendor's own origin for its cookie/storage
  // APIs. The fixed HTTPS vendor document remains cross-origin to the private
  // app, so it cannot read the parent DOM, storage or journal responses.
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy','no-referrer');
  // Supporting browsers use an ephemeral third-party context, not a signed-in
  // TradingView session. Unsupported browsers still enforce the origin boundary.
  frame.setAttribute('credentialless','');
  frame.setAttribute('loading','lazy');
  frame.setAttribute('width','100%');frame.setAttribute('height','460');
  frame.style.cssText='display:block;width:100%;height:460px;border:0';
  frame.src=src;
  return frame;
}
