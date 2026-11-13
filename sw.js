/* 늘메모 서비스워커: 네트워크 우선, 오프라인이면 저장해 둔 앱 파일로 + 윈도우 11 위젯 */
const CACHE = 'neulmemo-v19';
const DATA = 'neulmemo-data';               /* 위젯에 보여줄 메모 목록(앱이 보내 줌) */
const SHELL = ['./', './memo.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const dkey = () => new URL('./__widget-data.json', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k))))
      .then(() => self.clients.claim()).then(renderWidgets).catch(() => {})
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 구글 로그인·드라이브는 건드리지 않음
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./memo.html')))
  );
});

/* ---------- 위젯 (Windows 11 위젯 보드) ---------- */
async function loadData() {
  try { const c = await caches.open(DATA); const r = await c.match(dkey()); if (r) return await r.text(); } catch (e) {}
  return JSON.stringify({ count: 0, items: [], notes: [] });
}
const PLACE = { id: '', title: '메모를 지정하세요', body: '늘메모 앱에서 메모를 열고 ⋮ 메뉴 → 「위젯으로 설정」을 누르세요' };
const akey = () => new URL('./__widget-assign.json', self.registration.scope).href;
async function loadAssign() {
  try { const c = await caches.open(DATA); const r = await c.match(akey()); if (r) return await r.json(); } catch (e) {}
  return {};
}
async function saveAssign(m) {
  const c = await caches.open(DATA);
  await c.put(akey(), new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }));
}
async function renderWidgets() {
  if (!self.widgets) return;
  const raw = await loadData();
  let data = {}; try { data = JSON.parse(raw); } catch (e) {}
  /* 1) 목록 위젯: 같은 내용을 모두에게 */
  const wl = await self.widgets.getByTag('memo-list');
  if (wl && wl.instances && wl.instances.length) {
    const template = await (await fetch(wl.definition.msAcTemplate)).text();
    await self.widgets.updateByTag('memo-list', { template, data: raw });
  }
  /* 2) 포스트잇 위젯: 위젯 하나에 「위젯으로 설정」한 메모 하나씩 */
  const wn = await self.widgets.getByTag('memo-note');
  if (!wn || !wn.instances || !wn.instances.length) { await saveAssign({}); return; }
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const byId = new Map(notes.map(n => [n.id, n]));
  const old = await loadAssign(), next = {}, used = new Set();
  for (const inst of wn.instances) {                       /* 이미 붙어 있던 메모는 유지 */
    const id = old[inst.id];
    if (id && byId.has(id) && !used.has(id)) { next[inst.id] = id; used.add(id); }
  }
  const free = notes.filter(n => !used.has(n.id));
  for (const inst of wn.instances) {                       /* 빈 위젯에는 아직 안 붙은 메모를 차례로 */
    if (next[inst.id]) continue;
    const n = free.shift();
    if (n) { next[inst.id] = n.id; used.add(n.id); }
  }
  await saveAssign(next);
  const template = await (await fetch(wn.definition.msAcTemplate)).text();
  for (const inst of wn.instances) {
    const note = byId.get(next[inst.id]) || PLACE;
    await self.widgets.updateByInstanceId(inst.id, { template, data: JSON.stringify({ note }) });
  }
}
self.addEventListener('widgetinstall', e => e.waitUntil(renderWidgets().catch(() => {})));
self.addEventListener('widgetuninstall', e => e.waitUntil(renderWidgets().catch(() => {})));
self.addEventListener('widgetresume', e => e.waitUntil(renderWidgets().catch(() => {})));
self.addEventListener('message', e => {
  const m = e.data;
  if (!m || m.type !== 'snap' || typeof m.data !== 'string') return;
  e.waitUntil((async () => {
    const c = await caches.open(DATA);
    await c.put(dkey(), new Response(m.data, { headers: { 'content-type': 'application/json' } }));
    await renderWidgets();
  })().catch(() => {}));
});
self.addEventListener('widgetclick', e => {
  const a = String(e.action || '');
  let kind = '', val = '';
  if (a.startsWith('new-')) { kind = 'new'; val = a.slice(4); }
  else if (a.startsWith('open-') && a.length > 5) { kind = 'open'; val = a.slice(5); }
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).pathname.endsWith('memo.html')) {
        try { await c.focus(); } catch (_) {}
        c.postMessage({ type: 'intent', kind, val });
        return;
      }
    }
    const q = kind ? '?' + kind + '=' + encodeURIComponent(val) : '';
    await self.clients.openWindow('./memo.html' + q);
  })().catch(() => {}));
});
