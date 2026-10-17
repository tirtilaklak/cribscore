import http from 'node:http';
import {stat} from 'node:fs/promises';
const bundleURL=new URL('../dist/server/index.js',import.meta.url);
import {SQLiteD1} from '../tests/helpers/sqlite-d1.mjs';

// Development only: loopback HTTP and temporary SQLite memory. The real Worker
// trusts only the platform identity and its deployed DB binding.
const db=new SQLiteD1();
const port=Number(process.env.CRIBSCORE_PORT||4180);
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`),headers=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!key.toLowerCase().startsWith('oai-'))headers.set(key,Array.isArray(value)?value.join(','):value);
    headers.set('oai-authenticated-user-id','local-development-preview');
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;if(length>8_000_000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const body=['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks);
    const request=new Request(url,{method:req.method,headers,...(body?{body}: {})});
    const revision=(await stat(bundleURL)).mtimeMs;
    const {default:worker}=await import(`${bundleURL.href}?revision=${revision}`);
    const response=await worker.fetch(request,{DB:db});
    const responseHeaders=Object.fromEntries(response.headers);let bytes=Buffer.from(await response.arrayBuffer());
    if(req.method!=='HEAD'&&responseHeaders['content-type']?.startsWith('text/html'))bytes=Buffer.from(bytes.toString('utf8').replace('<head>','<head><meta name="cribscore-local-preview" content="true">'));
    responseHeaders['cache-control']='no-store';res.writeHead(response.status,responseHeaders);res.end(bytes);
  }catch{res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Local Worker preview unavailable');}
});
server.on('error',error=>{console.error(`Local Worker preview unavailable: ${error.code}`);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Cribscore Worker preview: http://127.0.0.1:${port}/ (temporary local journal)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
