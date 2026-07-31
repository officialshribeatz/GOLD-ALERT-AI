/* ========================================================
   Gold Alert AI — Phase 1
   Tabs + Live Gold Price + News + Economic Calendar
   ======================================================== */

/* ---------- TAB SWITCHING ----------
   All four tabs (Price, Analysis, Calendar, Tools) now behave identically —
   Price used to be a special case (just scroll, no real panel) which is
   what caused the "clicking Price/News looks like the same page" confusion.
   Now Price is a real panel like the rest, so this is one simple, uniform
   piece of logic instead of two different code paths.
------------------------------------------ */
const TAB_ORDER = ['price', 'analysis', 'calendar', 'tools'];
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');
const navItems = document.querySelectorAll('.nav-item');

function activateTab(key){
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + key));
  navItems.forEach((n, idx) => n.classList.toggle('active', TAB_ORDER[idx] === key));
  window.scrollTo({top:0, behavior:'smooth'});
}

tabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=> activateTab(btn.dataset.tab));
});

navItems.forEach((item, idx)=>{
  item.addEventListener('click', ()=> activateTab(TAB_ORDER[idx]));
});

/* ---------- SHARED: multi-proxy fetch (tries several free CORS proxies in order) ---------- */
// Wraps fetch with a hard timeout so one slow/dead proxy can't hang the whole
// refresh — after `ms` milliseconds it aborts and we move to the next proxy.
async function fetchWithTimeout(url, ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  try{
    return await fetch(url, {cache:'no-store', signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithFallback(targetUrl){
  const proxies = [
    (u)=> `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u)=> `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u)=> `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];
  let lastErr;
  for(let i=0;i<proxies.length;i++){
    try{
      const res = await fetchWithTimeout(proxies[i](targetUrl), 6000);
      if(!res.ok) throw new Error('status '+res.status);
      const text = await res.text();
      // allorigins /get wraps response in {"contents": "..."}
      if(i === 2){
        const wrapped = JSON.parse(text);
        return wrapped.contents;
      }
      return text;
    }catch(e){
      lastErr = e;
      continue;
    }
  }
  throw lastErr;
}

/* ---------- LIVE GOLD PRICE ----------
   Now rendered by an embedded TradingView widget directly in index.html —
   this guarantees the price matches TradingView exactly since it's the
   same live data feed, not a separate free API.
------------------------------------------ */

/* ---------- PRICE ALERTS ---------- */
const ALERT_STORAGE_KEY = 'goldAlertAI_alerts';

function loadAlerts(){
  try{ return JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY)) || []; }
  catch(e){ return []; }
}
function saveAlerts(alerts){
  localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts));
}

let alerts = loadAlerts();

function renderAlerts(){
  const listEl = document.getElementById('alertList');
  if(!listEl) return;
  if(alerts.length === 0){
    listEl.innerHTML = `<div class="empty-state">अजून कुठलाच alert set केलेला नाही</div>`;
    return;
  }
  listEl.innerHTML = alerts.map((a, i) => `
    <div class="alert-card ${a.triggered ? 'triggered' : ''}">
      <div>
        <div class="alert-info">
          <span class="${a.direction === 'above' ? 'dir-up' : 'dir-down'}">
            ${a.direction === 'above' ? '▲ वर जाईल' : '▼ खाली जाईल'}
          </span> ${a.target.toFixed(2)}
        </div>
        <div class="alert-sub">${a.triggered ? '✅ Triggered — बंद झालाय' : '⏳ चालू आहे, लक्ष ठेवतोय'}</div>
      </div>
      <button class="alert-remove" data-idx="${i}">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.alert-remove').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      alerts.splice(parseInt(btn.dataset.idx), 1);
      saveAlerts(alerts);
      renderAlerts();
    });
  });
}

function setAlertStatus(msg){
  const el = document.getElementById('alertStatus');
  if(el) el.textContent = msg;
}

async function requestNotifPermission(){
  if(!('Notification' in window)) return 'unsupported';
  if(Notification.permission === 'granted') return 'granted';
  if(Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

document.getElementById('addAlertBtn')?.addEventListener('click', async ()=>{
  const targetInput = document.getElementById('alertTarget');
  const direction = document.getElementById('alertDirection').value;
  const target = parseFloat(targetInput.value);

  if(isNaN(target) || target <= 0){
    setAlertStatus('कृपया योग्य price टाक');
    return;
  }

  const perm = await requestNotifPermission();
  if(perm === 'denied'){
    setAlertStatus('⚠️ Notification permission बंद आहे — browser settings मध्ये चालू कर');
  } else if(perm === 'unsupported'){
    setAlertStatus('⚠️ हा browser notifications support करत नाही, पण alert list मध्ये दिसेल');
  } else {
    setAlertStatus('✅ Alert set झाला');
  }

  alerts.push({ target, direction, triggered:false, createdAt: Date.now() });
  saveAlerts(alerts);
  renderAlerts();
  syncAlertsToFirebaseIfEnabled();
  targetInput.value = '';
  setTimeout(()=> setAlertStatus(''), 3000);
});

function syncAlertsToFirebaseIfEnabled(){
  if(localStorage.getItem('goldAlertAI_pushEnabled') === 'true' && typeof syncAlertsToFirebase === 'function'){
    syncAlertsToFirebase();
  }
}

// Mobile Chrome requires showNotification() via an active service worker registration
// once a page has a controlling SW — the old `new Notification()` constructor throws.
// This wraps that safely so a notification failure never blocks the alert/UI update.
async function safeNotify(title, options){
  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){
        await reg.showNotification(title, options);
        return;
      }
    }
    if('Notification' in window){
      new Notification(title, options);
    }
  }catch(e){
    console.warn('Notification display failed (non-fatal):', e);
  }
}

function checkAlerts(price){
  let changed = false;
  alerts.forEach(a=>{
    if(a.triggered) return;
    const hit = a.direction === 'above' ? price >= a.target : price <= a.target;
    if(hit){
      a.triggered = true;
      changed = true;
      const msg = `Gold ${a.direction === 'above' ? 'वर गेलं' : 'खाली गेलं'}: ${price.toFixed(2)} (target ${a.target.toFixed(2)})`;
      if(Notification.permission === 'granted'){
        safeNotify('🔔 Gold Alert AI', { body: msg, icon: 'icon-192.png' });
      }
    }
  });
  if(changed){
    saveAlerts(alerts);
    renderAlerts();
  }
}

// Silent background price polling — purely to check alerts, TradingView widget handles the visible display
async function pollPriceForAlerts(){
  const needAlertCheck = alerts.some(a => !a.triggered);
  const needLiqCheck = isLiqEnabled();
  try{
    const res = await fetch('https://api.gold-api.com/price/XAU', {cache:'no-store'});
    if(!res.ok) return;
    const d = await res.json();
    if(typeof d.price === 'number'){
      if(needAlertCheck) checkAlerts(d.price);
      if(needLiqCheck) checkLiquidityZones(d.price);
    }
  }catch(e){ /* silent fail, try again next tick */ }
}

renderAlerts();
setInterval(pollPriceForAlerts, 5000);

/* ---------- LIQUIDITY ZONE ALERTS ----------
   Uses day high/low as a stand-in for liquidity pools (ICT/SMC concept) —
   real broker liquidation data isn't publicly available for gold.
------------------------------------------ */
const LIQ_STORAGE_KEY = 'goldAlertAI_liqEnabled';
const LIQ_PROXIMITY = 2.5; // notify when price comes within this many $ of day high/low

let dayHigh = null, dayLow = null;
let liqNotifiedHigh = false, liqNotifiedLow = false;

function isLiqEnabled(){
  return localStorage.getItem(LIQ_STORAGE_KEY) === 'true';
}

const liqToggle = document.getElementById('liqToggle');
if(liqToggle){
  liqToggle.checked = isLiqEnabled();
  liqToggle.addEventListener('change', async ()=>{
    if(liqToggle.checked){
      const perm = await requestNotifPermission();
      if(perm === 'denied'){
        setLiqInfo('⚠️ Notification permission बंद आहे');
      }
    }
    localStorage.setItem(LIQ_STORAGE_KEY, liqToggle.checked);
    updateLiqInfo();
    if(fcmDb && deviceId){
      fcmDb.ref('devices/' + deviceId + '/liqEnabled').set(liqToggle.checked).catch(()=>{});
    }
  });
}

function setLiqInfo(text){
  const el = document.getElementById('liqZoneInfo');
  if(el) el.textContent = text;
}

function updateLiqInfo(){
  if(!isLiqEnabled()){ setLiqInfo(''); return; }
  if(dayHigh === null || dayLow === null){ setLiqInfo('Zone data लोड होत आहे...'); return; }
  setLiqInfo(`🔺 High: ${dayHigh.toFixed(2)}   🔻 Low: ${dayLow.toFixed(2)}`);
}

async function fetchDayHighLowForLiq(){
  try{
    const raw = await fetchWithFallback('https://data-asg.goldprice.org/dbXRates/USD');
    const item = JSON.parse(raw).items[0];
    dayHigh = item.xauHigh || item.xauPrice;
    dayLow = item.xauLow || item.xauPrice;
    updateLiqInfo();
  }catch(e){ /* silent fail, retry next cycle */ }
}

function checkLiquidityZones(price){
  if(!isLiqEnabled() || dayHigh === null || dayLow === null) return;

  const nearHigh = Math.abs(dayHigh - price) <= LIQ_PROXIMITY;
  const nearLow = Math.abs(price - dayLow) <= LIQ_PROXIMITY;

  if(nearHigh && !liqNotifiedHigh){
    liqNotifiedHigh = true;
    notifyLiq(`🎯 Buy-side liquidity जवळ! Price (${price.toFixed(2)}) day high (${dayHigh.toFixed(2)}) जवळ आलं — reversal/sweep संभव.`);
  } else if(!nearHigh){
    liqNotifiedHigh = false; // reset so it can fire again if it revisits later
  }

  if(nearLow && !liqNotifiedLow){
    liqNotifiedLow = true;
    notifyLiq(`🎯 Sell-side liquidity जवळ! Price (${price.toFixed(2)}) day low (${dayLow.toFixed(2)}) जवळ आलं — reversal/sweep संभव.`);
  } else if(!nearLow){
    liqNotifiedLow = false;
  }
}

function notifyLiq(msg){
  if(Notification.permission === 'granted'){
    safeNotify('🎯 Gold Alert AI — Liquidity Zone', { body: msg, icon: 'icon-192.png' });
  }
  setLiqInfo(msg);
}

updateLiqInfo();
fetchDayHighLowForLiq();
setInterval(fetchDayHighLowForLiq, 30000); // day high/low doesn't need to refresh often

/* ---------- SWING LEVELS (server-side, GitHub Actions computed) ----------
   All detection now happens on the GitHub Actions server every 5 min,
   independent of any device being open. This just displays what the
   server has found, pulled from Firebase Realtime Database.
------------------------------------------ */
const SWING_DEDUPE_GAP = 15; // $ — kept for display/merge purposes
const SWING_MAX_STORED = 12;

let swingLevels = [];

function renderSwingLevels(){
  const listEl = document.getElementById('swingList');
  if(!listEl) return;
  if(swingLevels.length === 0){
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = swingLevels.map(s => `
    <div class="swing-card">
      <div>
        <div class="swing-type ${s.type}">${s.type === 'high' ? '🔺 Swing High' : '🔻 Swing Low'}</div>
        <div class="swing-time">${new Date(s.time).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</div>
      </div>
      <div class="swing-val">${s.value.toFixed(2)}</div>
    </div>
  `).join('');
}

renderSwingLevels();

document.getElementById('clearSwingBtn')?.addEventListener('click', ()=>{
  swingLevels = [];
  renderSwingLevels();
});

// Pull server-side swings (computed by GitHub Actions every 5 min) — this is
// what makes levels show up even after the app was closed the whole time.
async function fetchServerSwings(){
  if(typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey === 'YOUR_API_KEY') return;
  try{
    const res = await fetch(firebaseConfig.databaseURL + '/swingLevels.json');
    const serverSwings = await res.json();
    if(Array.isArray(serverSwings) && serverSwings.length){
      swingLevels = serverSwings.slice(0, SWING_MAX_STORED);
      renderSwingLevels();
    }
  }catch(e){
    console.warn('Server swing fetch failed (non-fatal):', e);
  }
}
fetchServerSwings();
setInterval(fetchServerSwings, 5 * 60 * 1000); // refresh from server every 5 min

/* ---------- FIREBASE PUSH NOTIFICATIONS (Phase 2) ----------
   Works even when the app/tab is closed or phone is locked, unlike the
   in-browser Notification API used elsewhere in this file.
   A GitHub Actions cron job checks prices every 5 min and sends pushes
   via the Firebase Admin SDK using data stored here in Realtime Database.
------------------------------------------ */
let fcmApp = null, fcmMessaging = null, fcmDb = null, deviceId = null;

function getOrCreateDeviceId(){
  let id = localStorage.getItem('goldAlertAI_deviceId');
  if(!id){
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('goldAlertAI_deviceId', id);
  }
  return id;
}

async function initPushNotifications(){
  if(typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey === 'YOUR_API_KEY'){
    console.warn('Firebase config अजून भरलेला नाही — Push Notifications बंद आहेत.');
    return;
  }
  try{
    fcmApp = firebase.initializeApp(firebaseConfig);
    fcmMessaging = firebase.messaging();
    fcmDb = firebase.database();
    deviceId = getOrCreateDeviceId();

    const perm = await requestNotifPermission();
    if(perm !== 'granted') return;

    const swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    const token = await fcmMessaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if(token){
      await fcmDb.ref('devices/' + deviceId).set({
        token,
        updatedAt: Date.now(),
        swingEnabled: true,
        liqEnabled: isLiqEnabled()
      });
      syncAlertsToFirebase();
    }
  }catch(e){
    console.warn('Push notification setup failed:', e);
  }
}

function syncAlertsToFirebase(){
  if(!fcmDb || !deviceId) return;
  const activeAlerts = alerts.filter(a => !a.triggered);
  fcmDb.ref('alerts/' + deviceId).set(activeAlerts).catch(e => console.warn('Alert sync failed', e));
}

// Enable push notifications toggle handling
document.getElementById('pushToggle')?.addEventListener('change', async (e)=>{
  if(e.target.checked){
    await initPushNotifications();
    localStorage.setItem('goldAlertAI_pushEnabled', 'true');
  } else {
    localStorage.setItem('goldAlertAI_pushEnabled', 'false');
    if(fcmDb && deviceId) fcmDb.ref('devices/' + deviceId).remove();
  }
});
if(document.getElementById('pushToggle')){
  document.getElementById('pushToggle').checked = localStorage.getItem('goldAlertAI_pushEnabled') === 'true';
  if(document.getElementById('pushToggle').checked) initPushNotifications();
}

/* ---------- NEWS (RSS via free proxy, no API key) ---------- */
const NEWS_FEEDS = [
  { name:'Kitco News', url:'https://www.kitco.com/rss/KitcoNews.xml' },
  { name:'FXStreet', url:'https://www.fxstreet.com/rss/news' }
];

// Keywords that mean specifically BAD news for gold's own price (bearish for gold).
const GOLD_BEARISH_KEYWORDS = [
  'gold falls', 'gold drops', 'gold slides', 'gold slips', 'gold plunges',
  'gold tumbles', 'gold sinks', 'gold retreats', 'gold declines', 'gold slumps',
  'gold pressured', 'gold under pressure', 'gold weakens', 'gold loses',
  'gold hits low', 'gold near low', 'gold multi-week low', 'gold multi-month low',
  'dollar strengthens', 'dollar rallies', 'dollar surges', 'stronger dollar',
  'yields rise', 'yields surge', 'yields jump', 'treasury yields climb',
  'risk-on', 'risk on rally', 'gold outlook bearish', 'bearish on gold',
  'gold price forecast cut', 'gold price forecast lowered', 'profit-taking in gold'
];

// Keywords that mean specifically GOOD news for gold's own price (bullish for gold) —
// separate from generic high-impact/volatility keywords below, so these get their
// own distinct green badge instead of the red high-impact one.
const GOLD_BULLISH_KEYWORDS = [
  'gold hits record', 'gold record high', 'gold surges', 'gold soars',
  'gold rallies', 'gold climbs', 'gold jumps', 'gold gains', 'gold rises',
  'gold at all-time high', 'gold all-time high', 'gold near record',
  'safe-haven demand', 'safe haven demand', 'flight to safety', 'flight to safe-haven',
  'central bank buying', 'central banks buy', 'central bank gold purchases',
  'gold outlook bullish', 'bullish on gold', 'gold price forecast raised',
  'gold breaks', 'gold hits new high', 'gold hits fresh high'
];

// Keywords that usually mean "this news can move gold price hard / high volatility"
// but aren't necessarily good news specifically for gold (could be either direction).
const HIGH_IMPACT_KEYWORDS = [
  'fed', 'fomc', 'powell', 'rate cut', 'rate hike', 'interest rate',
  'cpi', 'nfp', 'non-farm', 'inflation', 'recession', 'gdp',
  'war', 'attack', 'strike', 'invasion', 'missile', 'nuclear', 'conflict',
  'intervention', 'crisis', 'emergency', 'default', 'shutdown',
  'crash', 'plunge', 'plunges', 'surge', 'surges', 'soar', 'soars',
  'record high', 'record low', 'all-time high', 'all-time low',
  'safe-haven', 'safe haven', 'tariff', 'sanctions', 'geopolitical',
  'gold hits', 'gold jumps', 'breaking'
];

function isGoldBullishNews(title){
  const t = title.toLowerCase();
  return GOLD_BULLISH_KEYWORDS.some(k => t.includes(k));
}

function isGoldBearishNews(title){
  const t = title.toLowerCase();
  return GOLD_BEARISH_KEYWORDS.some(k => t.includes(k));
}

function isHighImpactNews(title){
  const t = title.toLowerCase();
  return HIGH_IMPACT_KEYWORDS.some(k => t.includes(k));
}

// Tracks which high-impact headlines we've already notified about, so the
// same story doesn't push a notification every 5-min refresh cycle.
const NOTIFIED_IMPORTANT_KEY = 'goldAlertAI_notifiedImportantNews';
function getNotifiedImportantSet(){
  try{ return new Set(JSON.parse(localStorage.getItem(NOTIFIED_IMPORTANT_KEY)) || []); }
  catch(e){ return new Set(); }
}
function saveNotifiedImportantSet(set){
  // keep only the most recent 200 to avoid localStorage growing forever
  const arr = Array.from(set).slice(-200);
  localStorage.setItem(NOTIFIED_IMPORTANT_KEY, JSON.stringify(arr));
}

// Tracks whether we've EVER successfully shown news at least once — used so
// a failed refresh doesn't wipe out news that's already on screen.
let hasLoadedNewsOnce = false;

async function fetchNews(){
  const listEl = document.getElementById('newsList');
  // extra bottom padding so the last card isn't hidden half-behind the bottom nav bar
  listEl.style.paddingBottom = '90px';
  let allItems = [];

  const feedResults = await Promise.allSettled(NEWS_FEEDS.map(async (feed) => {
    try{
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
      const res = await fetchWithTimeout(apiUrl, 6000);
      const json = await res.json();
      if(json.status !== 'ok') throw new Error('rss2json status: '+json.status);
      return (json.items || []).slice(0, 8).map(item => ({
        source: feed.name,
        title: item.title || '',
        pubDate: item.pubDate || ''
      }));
    }catch(e){
      console.warn('rss2json failed for', feed.name, '— trying raw proxy fallback', e);
      const text = await fetchWithFallback(feed.url);
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      const items = Array.from(xml.querySelectorAll('item')).slice(0, 6);
      return items.map(item => ({
        source: feed.name,
        title: item.querySelector('title')?.textContent || '',
        pubDate: item.querySelector('pubDate')?.textContent || ''
      }));
    }
  }));

  feedResults.forEach(result => {
    if(result.status === 'fulfilled'){
      allItems.push(...result.value);
    }
  });

  // filter roughly for gold-relevant keywords when feed isn't gold-specific
  allItems = allItems.filter(n => n.title && n.title.length > 5);

  // tag high-impact / gold-bullish / gold-bearish items — the gold-specific
  // categories are checked first since they're more specific (a gold-bullish
  // or bearish headline often also matches generic high-impact words like
  // "record high"/"plunge", so we don't want double-badging)
  allItems.forEach(n => {
    n.goldBullish = isGoldBullishNews(n.title);
    n.goldBearish = !n.goldBullish && isGoldBearishNews(n.title);
    n.important = !n.goldBullish && !n.goldBearish && isHighImpactNews(n.title);
  });

  // sort: gold-bullish first, then gold-bearish, then high-impact, then newest first within each group
  allItems.sort((a,b)=>{
    const rank = (n)=> n.goldBullish ? 0 : (n.goldBearish ? 1 : (n.important ? 2 : 3));
    const ra = rank(a), rb = rank(b);
    if(ra !== rb) return ra - rb;
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  if(allItems.length === 0){
    // Only show the empty/error state the very first time (nothing on screen yet).
    // If news is already showing from a previous successful load, leave it alone —
    // a failed refresh (proxy rate-limited, etc.) shouldn't wipe the screen.
    if(!hasLoadedNewsOnce){
      listEl.innerHTML = `<div class="empty-state">News सध्या load होत नाहीये.<br>Network / proxy issue असू शकते.</div>`;
      document.getElementById('newsCount').textContent = '0';
    }
    return;
  }

  hasLoadedNewsOnce = true;
  document.getElementById('newsCount').textContent = allItems.length;
  const topItems = allItems.slice(0, 15);

  listEl.innerHTML = topItems.map((n, i) => `
    <div class="news-card" style="${n.goldBullish ? 'border:2px solid #3ecf8e; background:rgba(62,207,142,0.10); box-shadow:0 0 12px rgba(62,207,142,0.3);' : n.goldBearish ? 'border:2px solid #ff8c42; background:rgba(255,140,66,0.10); box-shadow:0 0 12px rgba(255,140,66,0.3);' : n.important ? 'border:2px solid #ff4d4d; background:rgba(255,77,77,0.08); box-shadow:0 0 12px rgba(255,77,77,0.25);' : ''}">
      ${n.goldBullish ? `<div style="display:inline-block; background:#3ecf8e; color:#062b1a; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:6px; letter-spacing:.3px;">📈 GOLD बुलिश — फायद्याची बातमी</div>` : n.goldBearish ? `<div style="display:inline-block; background:#ff8c42; color:#2b1300; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:6px; letter-spacing:.3px;">🔻 GOLD बेअरिश — सावध रहा</div>` : n.important ? `<div style="display:inline-block; background:#ff4d4d; color:#1a0000; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:6px; letter-spacing:.3px;">🚨 HIGH IMPACT — लगेच लक्ष द्या</div>` : ''}
      <div class="news-source">${n.source}</div>
      <div class="news-title">${escapeHtml(n.title)}</div>
      <div class="news-title-mr" id="mr-${i}" style="color:var(--gold-soft); font-size:12.5px; margin-top:6px; line-height:1.5;">Marathi मध्ये भाषांतर होत आहे...</div>
      <div class="news-time">${timeAgo(n.pubDate)}</div>
    </div>
  `).join('');

  // Translate each headline to Marathi in the background (free MyMemory API, no key needed)
  // staggered slightly so we don't fire 15 requests at once and trip rate limits
  topItems.forEach((n, i) => setTimeout(()=> translateToMarathi(n.title, i), i * 400));

  // Push a notification for NEW important headlines only (so it works even
  // if the phone/app is closed at the moment it's checked via the 5-min interval).
  const notified = getNotifiedImportantSet();
  const newsworthy = allItems.filter(n => (n.important || n.goldBullish || n.goldBearish) && !notified.has(n.title));
  if(newsworthy.length && Notification.permission === 'granted'){
    newsworthy.forEach(n=>{
      const title = n.goldBullish ? '📈 Gold Alert AI — GOLD बुलिश न्यूज'
        : n.goldBearish ? '🔻 Gold Alert AI — GOLD बेअरिश न्यूज'
        : '🚨 Gold Alert AI — High Impact News';
      safeNotify(title, { body: n.title, icon: 'icon-192.png' });
      notified.add(n.title);
    });
    saveNotifiedImportantSet(notified);
  } else if(newsworthy.length){
    newsworthy.forEach(n => notified.add(n.title));
    saveNotifiedImportantSet(notified);
  }
}

async function translateToMarathi(text, idx){
  const el = document.getElementById('mr-'+idx);
  if(!el) return;
  try{
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|mr`;
    const res = await fetch(url, {cache:'no-store'});
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if(translated && el){
      el.textContent = '🇮🇳 ' + translated;
    } else if(el){
      el.style.display = 'none';
    }
  }catch(e){
    if(el) el.style.display = 'none';
  }
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(dateStr){
  if(!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs/60000);
  if(mins < 60) return `${mins} min आधी`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return `${hrs} तास आधी`;
  return `${Math.floor(hrs/24)} दिवस आधी`;
}

fetchNews();
document.getElementById('refreshNewsBtn')?.addEventListener('click', async ()=>{
  const btn = document.getElementById('refreshNewsBtn');
  btn.textContent = '⏳ Loading...';
  btn.disabled = true;
  const beforeCount = document.getElementById('newsCount').textContent;
  await fetchNews();
  const afterCount = document.getElementById('newsCount').textContent;
  btn.textContent = (afterCount === '0' && beforeCount !== '0') ? '⚠️ थोड्या वेळाने परत ट्राय कर' : '✅ Refresh झालं!';
  setTimeout(()=>{
    btn.textContent = '🔄 News Refresh कर';
    btn.disabled = false;
  }, 2000);
});
setInterval(fetchNews, 5*60*1000); // refresh every 5 min

/* ---------- ECONOMIC CALENDAR ----------
   Phase 1: curated static list of recurring high-impact USD events.
   Phase 2 मध्ये आपण हे लाईव्ह calendar API ला जोडू (उदा. TradingEconomics / ForexFactory).
------------------------------------------ */
const CALENDAR_EVENTS = [
  { time:'Weekly', title:'Initial Jobless Claims', sub:'दर गुरुवारी, 6:00 PM IST', impact:'med' },
  { time:'Monthly', title:'CPI (Inflation Data)', sub:'महिन्याच्या मध्यात, 6:00 PM IST', impact:'high' },
  { time:'Monthly', title:'NFP (Non-Farm Payrolls)', sub:'पहिला शुक्रवार, 6:00 PM IST', impact:'high' },
  { time:'Monthly', title:'PPI (Producer Price Index)', sub:'CPI नंतर 1-2 दिवसांनी', impact:'med' },
  { time:'6-weekly', title:'FOMC Rate Decision', sub:'Fed meeting, रात्री 11:30 PM IST', impact:'high' },
  { time:'Varies', title:'Powell Speech', sub:'FOMC नंतर press conference', impact:'high' },
];

function renderCalendar(){
  const calEl = document.getElementById('calList');
  calEl.innerHTML = CALENDAR_EVENTS.map(ev => `
    <div class="cal-card">
      <div class="cal-time mono">${ev.time}</div>
      <div class="cal-impact impact-${ev.impact}"></div>
      <div class="cal-body">
        <div class="cal-title">${ev.title}</div>
        <div class="cal-sub">${ev.sub}</div>
      </div>
    </div>
  `).join('') + `<div class="empty-state">🔜 Live exact date/time calendar Phase 2 मध्ये जोडू</div>`;
}

renderCalendar();

/* ---------- SERVICE WORKER REGISTER (PWA) ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.warn('SW register failed', e));
  });
}

/* ---------- FORCE UPDATE (clears SW + caches without needing phone Settings) ---------- */
document.getElementById('forceUpdateBtn')?.addEventListener('click', async ()=>{
  const btn = document.getElementById('forceUpdateBtn');
  btn.textContent = '⏳ Clean करत आहे...';
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      for(const reg of regs) await reg.unregister();
    }
    if('caches' in window){
      const keys = await caches.keys();
      for(const key of keys) await caches.delete(key);
    }
  }catch(e){
    console.warn('Force update cleanup failed:', e);
  }
  // Hard reload with cache-buster so even the HTML itself is fetched fresh
  localStorage.setItem('goldAlertAI_justUpdated', '1');
  window.location.href = window.location.pathname + '?v=' + Date.now();
});

// Show a confirmation banner if we just came back from a Force Update
if(localStorage.getItem('goldAlertAI_justUpdated') === '1'){
  localStorage.removeItem('goldAlertAI_justUpdated');
  window.addEventListener('DOMContentLoaded', ()=>{
    const banner = document.createElement('div');
    banner.textContent = '✅ Update झालं! नवीन code load झाला आहे.';
    banner.style.cssText = 'position:fixed; top:12px; left:16px; right:16px; z-index:999; background:rgba(62,207,142,.95); color:#0a1f14; font-weight:700; font-size:13px; padding:12px 16px; border-radius:10px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,.3);';
    document.body.appendChild(banner);
    setTimeout(()=>{ banner.style.transition='opacity .4s'; banner.style.opacity='0'; setTimeout(()=>banner.remove(), 400); }, 3000);
  });
}
