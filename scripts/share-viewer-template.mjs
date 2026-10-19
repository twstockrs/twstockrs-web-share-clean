import {build} from 'esbuild';
export async function shareViewerTemplate(){
 const result=await build({entryPoints:['share-viewer.tsx'],bundle:true,write:false,outdir:'share-build',minify:true,format:'iife',platform:'browser',target:['es2022'],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script'),css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
 return '<!doctype html><html lang="zh-Hant" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>TWStockRS 凍結分享 · 唯讀副本</title><style>'+css+'</style></head><body><div id="root"></div><!--FROZEN_DATA--><script>'+js+'</script></body></html>';
}
