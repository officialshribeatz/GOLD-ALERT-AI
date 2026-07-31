/* ========================================================
   Gold Alert AI — Phase 1
   Tabs + Live Gold Price + News + Economic Calendar
   ======================================================== */

/* ---------- TAB SWITCHING ---------- */
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');
const navItems = document.querySelectorAll('.nav-item');

tabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach(p=>p.classList.remove('active'));
    document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
    navItems.forEach(n=>n.classList.remove('active'));
    const idx = btn.dataset.tab === 'news' ? 1 : btn.dataset.tab === 'calendar' ? 2 : 3;
    navItems[idx].classList.add('active');
  });
});

navItems.forEach((item, idx)=>{
  item.addEventListener('click', ()=>{
    const map = ['price','news','calendar','tools'];
    const key = map[idx];
    navItems.forEach(n=>n.classList.remove('active'));
    item.classList.add('active');
    if(key === 'price'){
      // just scroll up, price board always visible
      window.scrollTo({top:0, behavior:'smooth'});
      return;
    }
    tabBtns.forEach(b=>b.classList.remove('active'));
    panels.forEach(p=>p.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${key}"]`).classList.add('active');
    document.getElementById('panel-'+key).classList.add('active');
  });
});

/* ---------- SHARED: multi-proxy fetch (tries several free CORS proxies in order) ---------- */
async function fetchWithFallback(targetUrl){
  const proxies = [
    (u)=> `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u)=> `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u)=> `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];
  let lastErr;
  for(let i=0;i<proxies.length;i++){
    try{
      const res = await fetch(proxies[i](targetUrl), {cache:'no-store'});
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
      logPriceForSwings(d.price);
      checkSwingProximity(d.price);
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

/* ---------- SWING LEVELS (self-learning liquidity pools) ----------
   Since free multi-day historical OHLC data isn't available, we build our own
   history locally: every price tick gets logged, and simple fractal swing
   detection (a point higher/lower than its neighbors) finds real swing
   highs/lows over time. These accumulate in localStorage and persist across
   visits, so the longer the app stays in use, the more levels it learns.
------------------------------------------ */
const SWING_HISTORY_KEY = 'goldAlertAI_priceHistory';
const SWING_LEVELS_KEY = 'goldAlertAI_swingLevels';
const SWING_FRACTAL_N = 3; // neighbors on each side to confirm a swing point
const SWING_DEDUPE_GAP = 3; // $ gap to treat two levels as "the same" zone
const SWING_MAX_STORED = 12;

function loadPriceHistory(){
  try{ return JSON.parse(localStorage.getItem(SWING_HISTORY_KEY)) || []; }
  catch(e){ return []; }
}
function savePriceHistory(hist){
  // cap history length so localStorage doesn't grow unbounded
  if(hist.length > 300) hist = hist.slice(hist.length - 300);
  localStorage.setItem(SWING_HISTORY_KEY, JSON.stringify(hist));
  return hist;
}
function loadSwingLevels(){
  try{ return JSON.parse(localStorage.getItem(SWING_LEVELS_KEY)) || []; }
  catch(e){ return []; }
}
function saveSwingLevels(levels){
  localStorage.setItem(SWING_LEVELS_KEY, JSON.stringify(levels));
}

let priceHistory = loadPriceHistory();
let swingLevels = loadSwingLevels();
let swingNotified = {}; // key: level value, value: bool (prevents notification spam)

function detectNewSwings(){
  const n = SWING_FRACTAL_N;
  if(priceHistory.length < n*2 + 1) return;

  // only check the point that now has enough neighbors on both sides (the most recently confirmable one)
  const idx = priceHistory.length - 1 - n;
  if(idx < n) return;
  const point = priceHistory[idx];
  const left = priceHistory.slice(idx-n, idx);
  const right = priceHistory.slice(idx+1, idx+1+n);

  const isHigh = left.every(p => p.price <= point.price) && right.every(p => p.price <= point.price);
  const isLow = left.every(p => p.price >= point.price) && right.every(p => p.price >= point.price);

  if(isHigh || isLow){
    const type = isHigh ? 'high' : 'low';
    const duplicate = swingLevels.find(s => s.type === type && Math.abs(s.value - point.price) <= SWING_DEDUPE_GAP);
    if(!duplicate){
      swingLevels.push({ type, value: point.price, time: point.t });
      swingLevels.sort((a,b)=> b.time - a.time);
      if(swingLevels.length > SWING_MAX_STORED) swingLevels = swingLevels.slice(0, SWING_MAX_STORED);
      saveSwingLevels(swingLevels);
      renderSwingLevels();
    }
  }
}

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

function checkSwingProximity(price){
  swingLevels.forEach(s=>{
    const near = Math.abs(price - s.value) <= LIQ_PROXIMITY;
    const key = s.type + '_' + s.value;
    if(near && !swingNotified[key]){
      swingNotified[key] = true;
      const msg = `Price (${price.toFixed(2)}) जुन्या swing ${s.type === 'high' ? 'high' : 'low'} (${s.value.toFixed(2)}) जवळ आलं.`;
      if(Notification.permission === 'granted'){
        safeNotify('📍 Gold Alert AI — Swing Level', { body: msg, icon: 'icon-192.png' });
      }
    } else if(!near){
      swingNotified[key] = false;
    }
  });
}

function logPriceForSwings(price){
  priceHistory.push({ price, t: Date.now() });
  priceHistory = savePriceHistory(priceHistory);
  detectNewSwings();
}

renderSwingLevels();

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
      await fcmDb.ref('devices/' + deviceId).set({ token, updatedAt: Date.now() });
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

async function fetchNews(){
  const listEl = document.getElementById('newsList');
  let allItems = [];

  const feedResults = await Promise.allSettled(NEWS_FEEDS.map(async (feed) => {
    try{
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
      const res = await fetch(apiUrl, {cache:'no-store'});
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

  // sort newest first
  allItems.sort((a,b)=> new Date(b.pubDate) - new Date(a.pubDate));

  if(allItems.length === 0){
    listEl.innerHTML = `<div class="empty-state">News सध्या load होत नाहीये.<br>Network / proxy issue असू शकते.</div>`;
    document.getElementById('newsCount').textContent = '0';
    return;
  }

  document.getElementById('newsCount').textContent = allItems.length;
  const topItems = allItems.slice(0, 15);

  listEl.innerHTML = topItems.map((n, i) => `
    <div class="news-card">
      <div class="news-source">${n.source}</div>
      <div class="news-title">${escapeHtml(n.title)}</div>
      <div class="news-title-mr" id="mr-${i}" style="color:var(--gold-soft); font-size:12.5px; margin-top:6px; line-height:1.5;">Marathi मध्ये भाषांतर होत आहे...</div>
      <div class="news-time">${timeAgo(n.pubDate)}</div>
    </div>
  `).join('');

  // Translate each headline to Marathi in the background (free MyMemory API, no key needed)
  // staggered slightly so we don't fire 15 requests at once and trip rate limits
  topItems.forEach((n, i) => setTimeout(()=> translateToMarathi(n.title, i), i * 400));
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
