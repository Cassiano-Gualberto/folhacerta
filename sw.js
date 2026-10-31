// O build injeta a lista explícita de recursos públicos e o hash do conteúdo.
const CACHE = 'folhacerta-__VERSION__';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message', event => { if(event.data?.type==='ACTIVATE')self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('folhacerta-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url), scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const relative='./'+url.pathname.slice(scope.pathname.length);
 if(!ASSETS.includes(relative)&&event.request.mode!=='navigate')return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
  const key=event.request.mode==='navigate'?'./index.html':relative;
  const cached=await cache.match(key);if(cached)return cached;
  return fetch(event.request);
 }));
});
