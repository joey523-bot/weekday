import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=process.cwd();const {onRequestGet}=await import('file://'+root+'/functions/api/botanical/today.js');
createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1:8792');if(u.pathname==='/api/botanical/today'){const r=await onRequestGet({request:new Request(u)});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());return;}
// Isolated preview identity; no production API or account traffic.
if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname.endsWith('/session')?{user:{id:'local-preview',nickname:'本地预览'}}:u.pathname.endsWith('/sync')?{snapshot:null,revision:0}:{}));return;}
const path=resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}try{const b=await readFile(path);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(b);}catch{res.writeHead(404).end();}}).listen(8792,'127.0.0.1',()=>console.log('Local preview http://127.0.0.1:8792'));
