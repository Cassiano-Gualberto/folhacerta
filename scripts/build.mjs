import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
await rm('dist',{recursive:true,force:true});await mkdir('dist/vendor',{recursive:true});
for (const item of ['index.html','styles.css','icon.svg','icons','manifest.webmanifest','src']) await cp(item,`dist/${item}`,{recursive:true});
await cp('node_modules/pdfjs-dist/legacy/build/pdf.min.mjs','dist/vendor/pdf.mjs');
await cp('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','dist/vendor/pdf.worker.mjs');
for (const item of ['cmaps','standard_fonts']) await cp(`node_modules/pdfjs-dist/${item}`,`dist/vendor/${item}`,{recursive:true});
await cp('node_modules/pdfjs-dist/LICENSE','dist/vendor/PDFJS-LICENSE.txt');
await writeFile('dist/.nojekyll','');
async function walk(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await walk(file));else out.push(file);}return out;}
const files=(await walk('dist')).sort();
const hash=createHash('sha256');for(const file of files)hash.update(await readFile(file));
const version=hash.digest('hex').slice(0,12);
const template=await readFile('sw.js','utf8');
await writeFile('dist/sw.js',template.replace('__VERSION__',version).replace('__ASSETS__',JSON.stringify(['./',...files.map(f=>'./'+path.relative('dist',f).split(path.sep).join('/'))])));
console.log(`FolhaCerta pronto: ${files.length} arquivos, cache ${version}. Nenhum PDF ou dado de usuário incluído.`);
