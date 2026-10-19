import {build} from 'esbuild';
import fs from 'node:fs/promises';

const bundled=await build({entryPoints:['main.tsx'],bundle:true,write:false,outdir:'offline-build',minify:true,format:'iife',platform:'browser',target:['es2022'],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','__TWSTOCKRS_OFFLINE__':'true'},legalComments:'inline'});
const js=bundled.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundled.outputFiles.find(file=>file.path.endsWith('.css')).text;
const reset='button,input,select{font-family:inherit}button,input,select{margin:0}button{line-height:inherit}svg{display:block;vertical-align:middle;flex-shrink:0}h1,h2,h3{line-height:1.5}body{line-height:1.5}select{max-width:100%}';
let html=await fs.readFile('index.html','utf8');
const favicon=await fs.readFile('public/favicon.svg','utf8');
const appleIcon=(await fs.readFile('public/assets/twstockrs/icons/apple-touch-icon.png')).toString('base64');
html=html.replace('<html lang="zh-Hant">','<html lang="zh-Hant" data-theme="dark">')
 .replace('href="/favicon.svg"',`href="data:image/svg+xml,${encodeURIComponent(favicon)}"`)
 .replace('href="/assets/twstockrs/icons/apple-touch-icon.png"',`href="data:image/png;base64,${appleIcon}"`)
 .replace(/<link rel="manifest"[^>]*>/,'')
 .replace('</head>',`<style>${reset}${css}</style></head>`)
 .replace('<script type="module" src="/main.tsx"></script>',()=>`<script>${js.replace(/<\/script/gi,'<\\/script')}</script>`);
await fs.writeFile('TWStockRS-Foundation-0.html',html);
console.log(`Updated self-contained prototype: ${Buffer.byteLength(html)} bytes`);
