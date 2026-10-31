import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function walk(dir){let all=[];for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','dist','.openai','build'].includes(e.name))continue;const p=`${dir}/${e.name}`;if(e.isDirectory())all.push(...await walk(p));else all.push(p);}return all;}
for(const file of await walk('.')){
 if(/\.(pdf|apk|jks|keystore|aab)$/i.test(file))throw Error(`Arquivo privado/gerado no código: ${file}`);
 if(/\.(js|mjs)$/.test(file))execFileSync(process.execPath,['--check',file]);
}
const html=await readFile('index.html','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw Error('IDs duplicados no HTML.');
const app=await readFile('src/app.js','utf8');
for(const m of app.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(m[1]))throw Error(`Elemento ausente: ${m[1]}`);
const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));
for(const size of ['192x192','512x512'])if(!manifest.icons.some(i=>i.sizes===size&&i.type==='image/png'))throw Error(`Ícone PWA ausente ${size}`);
console.log('Sintaxe, referências DOM, manifesto e arquivos de distribuição conferidos.');
