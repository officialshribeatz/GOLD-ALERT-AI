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
const TAB_ORDER = ['price', 'analysis', 'bbtrap', 'calendar', 'tools'];
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

let lastKnownPrice = null;

async function pollPriceForAlerts(){
  const needAlertCheck = alerts.some(a => !a.triggered);
  const needLiqCheck = isLiqEnabled();
  try{
    const res = await fetch('https://api.gold-api.com/price/XAU', {cache:'no-store'});
    if(!res.ok) return;
    const d = await res.json();
    if(typeof d.price === 'number'){
      lastKnownPrice = d.price;
      if(needAlertCheck) checkAlerts(d.price);
      if(needLiqCheck) checkLiquidityZones(d.price);
      updateLiveSwingCandle(d.price);
    }
  }catch(e){ /* silent fail, try again next tick */ }
}

renderAlerts();
setInterval(pollPriceForAlerts, 5000);

/* ---------- LIQUIDITY ZONE ALERTS ---------- */
const LIQ_STORAGE_KEY = 'goldAlertAI_liqEnabled';
const LIQ_PROXIMITY = 2.5;

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
    liqNotifiedHigh = false;
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
setInterval(fetchDayHighLowForLiq, 30000);

/* ---------- SWING LEVELS (server-side, GitHub Actions computed) ---------- */
const SWING_DEDUPE_GAP = 15;
const SWING_MAX_STORED = 12;

let swingLevels = [];

function renderSwingLevels(){
  const listEl = document.getElementById('swingList');
  const quickEl = document.getElementById('priceSwingQuickList');
  const countEl = document.getElementById('priceSwingCount');

  if(countEl) countEl.textContent = swingLevels.length || '--';

  if(listEl){
    if(swingLevels.length === 0){
      listEl.innerHTML = '';
    } else {
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
  }

  if(quickEl){
    if(swingLevels.length === 0){
      quickEl.innerHTML = `<div class="empty-state" style="padding:14px 4px;">अजून स्विंग data जमा होत आहे — Tools tab मध्ये सविस्तर दिसेल.</div>`;
    } else {
      quickEl.innerHTML = swingLevels.slice(0, 4).map(s => `
        <div class="swing-card">
          <div>
            <div class="swing-type ${s.type}">${s.type === 'high' ? '🔺 Swing High' : '🔻 Swing Low'}</div>
            <div class="swing-time">${new Date(s.time).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</div>
          </div>
          <div class="swing-val">${s.value.toFixed(2)}</div>
        </div>
      `).join('');
    }
  }
}

renderSwingLevels();

document.getElementById('clearSwingBtn')?.addEventListener('click', ()=>{
  swingLevels = [];
  renderSwingLevels();
});

let lastCandlePattern = null;
let lastBBTrapSignal = null;
let lastBBTrapSignal15m = null;
let lastBBTrapPending = null;
let lastBBTrapPending15m = null;

/* ---------- BB TRAP: PENDING Alert Candle (not yet confirmed/invalidated) ----------
   Shown separately from the confirmed signal — this is "an Alert Candle has
   formed and we're watching whether its Low/High gets broken", live, before
   any entry actually exists yet.
------------------------------------------ */
function renderBBTrapPendingInto(elId, pending){
  const el = document.getElementById(elId);
  if(!el) return;
  if(!pending){
    el.innerHTML = '';
    return;
  }
  const isBullish = pending.type === 'bullish';
  el.innerHTML = `
    <div class="bb-trap-card pending">
      <div class="bb-trap-badge pending">👀 WATCHING — Alert Candle तयार झालाय</div>
      <div class="risk-result-row"><span>दिशा</span><span>${isBullish ? 'Bullish (Buy) संभाव्य' : 'Bearish (Sell) संभाव्य'}</span></div>
      <div class="risk-result-row"><span>Alert Candle High</span><span>${pending.alertHigh.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Alert Candle Low</span><span>${pending.alertLow.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Watch Entry (${isBullish ? 'High तुटला की' : 'Low तुटला की'})</span><span>${pending.watchEntryPrice.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Alert Candle वेळ</span><span>${new Date(pending.alertCandleTime).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span></div>
    </div>
    <div class="empty-state" style="padding:6px 4px 4px; text-align:left; font-size:10.5px;">
      ⚠️ अजून entry झालेली नाही — फक्त watch करतोय. ${isBullish ? 'High' : 'Low'} तुटला की खरा signal येईल; उलट दिशेने तुटलं तर हा trap रद्द होईल.
    </div>
  `;
}

/* ---------- BB TRAP SIGNAL (server-side, Bollinger Band trap) ----------
   Renders whatever check-alerts.js last stored in Firebase — both a 1H
   node (`bbTrapSignal`) and a 15m node (`bbTrapSignal15m`), each an Alert
   Candle that formed fully outside a 20-period Bollinger Band, plus the
   later candle that broke its Low/High (entry), target = 20 SMA at that
   moment. VWAP is intentionally not part of this — 20 SMA is used
   throughout instead, so this is an approximation, not a guarantee.
------------------------------------------ */
function renderBBTrapInto(elId, signal){
  const el = document.getElementById(elId);
  if(!el) return;
  if(!signal){
    el.innerHTML = `<div class="empty-state" style="padding:14px 4px;">सध्या कुठलाही active BB Trap signal नाही.</div>`;
    return;
  }
  const isBullish = signal.type === 'bullish';
  el.innerHTML = `
    <div class="bb-trap-card ${isBullish ? 'bullish' : 'bearish'}">
      <div class="bb-trap-badge ${isBullish ? 'bullish' : 'bearish'}">${isBullish ? '📈 BULLISH TRAP — BUY' : '📉 BEARISH TRAP — SELL'}</div>
      <div class="risk-result-row"><span>Alert Candle High</span><span>${signal.alertHigh.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Alert Candle Low</span><span>${signal.alertLow.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Entry Price</span><span>${signal.entryPrice.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Target (20 SMA)</span><span>${signal.target.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Alert Candle वेळ</span><span>${new Date(signal.alertCandleTime).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span></div>
      <div class="risk-result-row"><span>Trigger वेळ</span><span>${new Date(signal.triggerCandleTime).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span></div>
    </div>
    <div class="empty-state" style="padding:8px 4px 4px; text-align:left; font-size:10.5px;">
      ⚠️ VWAP नाही, फक्त 20 SMA वापरलंय — मूळ strategy चा approximate आहे. Stoploss स्वतः ठरवा (उदा. day high/low वर).
    </div>
  `;
}

function renderBBTrap(){
  renderBBTrapPendingInto('bbTrapPendingCard', lastBBTrapPending);
  renderBBTrapPendingInto('bbTrap15mPendingCard', lastBBTrapPending15m);
  renderBBTrapInto('bbTrapCard', lastBBTrapSignal);
  renderBBTrapInto('bbTrap15mCard', lastBBTrapSignal15m);
}

// "Clear" here means clearing what's currently shown on screen — the next
// automatic refresh (every 5 min) will pull whatever the server currently
// considers the latest 1H/15m signal and pending Alert Candle, so this is
// just a way to wipe a stale-looking card without waiting for that refresh.
document.getElementById('clearBBTrapBtn')?.addEventListener('click', ()=>{
  lastBBTrapSignal = null;
  lastBBTrapPending = null;
  renderBBTrap();
});
document.getElementById('clearBBTrap15mBtn')?.addEventListener('click', ()=>{
  lastBBTrapSignal15m = null;
  lastBBTrapPending15m = null;
  renderBBTrap();
});

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
  try{
    const res2 = await fetch(firebaseConfig.databaseURL + '/lastCandlePattern.json');
    const pattern = await res2.json();
    if(pattern && pattern.type){
      const isFresh = (Date.now() - (pattern.detectedAt || 0)) < 2 * 60 * 60 * 1000;
      lastCandlePattern = isFresh ? pattern : null;
    }
  }catch(e){
    console.warn('Server candle pattern fetch failed (non-fatal):', e);
  }
  try{
    const res3 = await fetch(firebaseConfig.databaseURL + '/bbTrapSignal.json');
    const trap = await res3.json();
    if(trap && trap.type){
      const isFresh = (Date.now() - (trap.detectedAt || 0)) < 12 * 60 * 60 * 1000;
      lastBBTrapSignal = isFresh ? trap : null;
    } else {
      lastBBTrapSignal = null;
    }
  }catch(e){
    console.warn('Server BB Trap (1H) fetch failed (non-fatal):', e);
  }
  try{
    const res4 = await fetch(firebaseConfig.databaseURL + '/bbTrapSignal15m.json');
    const trap15 = await res4.json();
    if(trap15 && trap15.type){
      // 15m signals go stale faster — shorter freshness window than 1H
      const isFresh = (Date.now() - (trap15.detectedAt || 0)) < 3 * 60 * 60 * 1000;
      lastBBTrapSignal15m = isFresh ? trap15 : null;
    } else {
      lastBBTrapSignal15m = null;
    }
  }catch(e){
    console.warn('Server BB Trap (15m) fetch failed (non-fatal):', e);
  }
  try{
    const res5 = await fetch(firebaseConfig.databaseURL + '/bbTrapSignalPending.json');
    const p1 = await res5.json();
    lastBBTrapPending = (p1 && p1.type) ? p1 : null;
  }catch(e){
    console.warn('Server BB Trap pending (1H) fetch failed (non-fatal):', e);
  }
  try{
    const res6 = await fetch(firebaseConfig.databaseURL + '/bbTrapSignal15mPending.json');
    const p2 = await res6.json();
    lastBBTrapPending15m = (p2 && p2.type) ? p2 : null;
  }catch(e){
    console.warn('Server BB Trap pending (15m) fetch failed (non-fatal):', e);
  }
  renderBBTrap();
  updateAIAnalysis();
}
fetchServerSwings();
setInterval(fetchServerSwings, 5 * 60 * 1000);

/* ---------- FIREBASE PUSH NOTIFICATIONS ---------- */
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
  { name:'FXStreet', url:'https://www.fxstreet.com/rss/news' },
  { name:'DailyFX', url:'https://www.dailyfx.com/feeds/all' }
];

let lastFetchedNewsItems = [];

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

const GOLD_BULLISH_KEYWORDS = [
  'gold hits record', 'gold record high', 'gold surges', 'gold soars',
  'gold rallies', 'gold climbs', 'gold jumps', 'gold gains', 'gold rises',
  'gold at all-time high', 'gold all-time high', 'gold near record',
  'safe-haven demand', 'safe haven demand', 'flight to safety', 'flight to safe-haven',
  'central bank buying', 'central banks buy', 'central bank gold purchases',
  'gold outlook bullish', 'bullish on gold', 'gold price forecast raised',
  'gold breaks', 'gold hits new high', 'gold hits fresh high'
];

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

const NOTIFIED_IMPORTANT_KEY = 'goldAlertAI_notifiedImportantNews';
function getNotifiedImportantSet(){
  try{ return new Set(JSON.parse(localStorage.getItem(NOTIFIED_IMPORTANT_KEY)) || []); }
  catch(e){ return new Set(); }
}
function saveNotifiedImportantSet(set){
  const arr = Array.from(set).slice(-200);
  localStorage.setItem(NOTIFIED_IMPORTANT_KEY, JSON.stringify(arr));
}

let hasLoadedNewsOnce = false;

async function fetchNews(){
  const listEl = document.getElementById('newsList');
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
        pubDate: item.pubDate || '',
        link: item.link || '',
        description: item.description || ''
      }));
    }catch(e){
      console.warn('rss2json failed for', feed.name, '— trying raw proxy fallback', e);
      const text = await fetchWithFallback(feed.url);
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      const items = Array.from(xml.querySelectorAll('item')).slice(0, 6);
      return items.map(item => ({
        source: feed.name,
        title: item.querySelector('title')?.textContent || '',
        pubDate: item.querySelector('pubDate')?.textContent || '',
        link: item.querySelector('link')?.textContent || '',
        description: item.querySelector('description')?.textContent || ''
      }));
    }
  }));

  feedResults.forEach(result => {
    if(result.status === 'fulfilled'){
      allItems.push(...result.value);
    }
  });

  allItems = allItems.filter(n => n.title && n.title.length > 5);

  allItems.forEach(n => {
    n.goldBullish = isGoldBullishNews(n.title);
    n.goldBearish = !n.goldBullish && isGoldBearishNews(n.title);
    n.important = !n.goldBullish && !n.goldBearish && isHighImpactNews(n.title);
  });

  const PRIORITY_FRESHNESS_HOURS = 6;
  allItems.sort((a,b)=>{
    const ageHours = (n)=> (Date.now() - parseFeedDate(n.pubDate)) / 3600000;
    const rank = (n)=>{
      const fresh = ageHours(n) <= PRIORITY_FRESHNESS_HOURS;
      if(!fresh) return 3;
      return n.goldBullish ? 0 : (n.goldBearish ? 1 : (n.important ? 2 : 3));
    };
    const ra = rank(a), rb = rank(b);
    if(ra !== rb) return ra - rb;
    return parseFeedDate(b.pubDate) - parseFeedDate(a.pubDate);
  });

  if(allItems.length === 0){
    if(!hasLoadedNewsOnce){
      listEl.innerHTML = `<div class="empty-state">News सध्या load होत नाहीये.<br>Network / proxy issue असू शकते.</div>`;
      document.getElementById('newsCount').textContent = '0';
    }
    return;
  }

  hasLoadedNewsOnce = true;
  lastFetchedNewsItems = allItems;
  document.getElementById('newsCount').textContent = allItems.length;
  const topItems = allItems.slice(0, 15);

  listEl.innerHTML = topItems.map((n, i) => `
    <div class="news-card" style="cursor:pointer; ${n.goldBullish ? 'border:2px solid #3ecf8e; background:rgba(62,207,142,0.10); box-shadow:0 0 12px rgba(62,207,142,0.3);' : n.goldBearish ? 'border:2px solid #ff8c42; background:rgba(255,140,66,0.10); box-shadow:0 0 12px rgba(255,140,66,0.3);' : n.important ? 'border:2px solid #ff4d4d; background:rgba(255,77,77,0.08); box-shadow:0 0 12px rgba(255,77,77,0.25);' : ''}">
      ${n.goldBullish ? `<div style="display:inline-block; background:#3ecf8e; color:#062b1a; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:6px; letter-spacing:.3px;">📈 GOLD बुलिश — फायद्याची बातमी</div>` : n.goldBearish ? `<div style="display:inline-block; background:#ff8c42; color:#2b1300; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:6px; letter-spacing:.3px;">🔻 GOLD बेअरिश — सावध रहा</div>` : n.important ? `<div style="display:inline-block; background:#ff4d4d; color:#1a0000; font-weight:800; font-size:11px; padding:3px 8px; border-radius:6px; margin-bottom:4px; letter-spacing:.3px;">🚨 HIGH IMPACT — लगेच लक्ष द्या</div><div style="font-size:10.5px; color:var(--sub); margin-bottom:6px;">⚠️ दिशा (वर/खाली) आपोआप ठरवता येत नाही — पूर्ण बातमी वाचून स्वतः ठरव</div>` : ''}
      <div class="news-source">${n.source}</div>
      <div class="news-title-mr" id="mr-${i}" style="color:var(--text); font-size:14.5px; font-weight:600; line-height:1.5;">मराठी भाषांतर होत आहे...</div>
      <div class="news-title" style="color:var(--sub); font-size:11.5px; font-weight:400; margin-top:6px; line-height:1.4;">${escapeHtml(n.title)}</div>
      <div class="news-time">${timeAgo(n.pubDate)}</div>
      <div style="margin-top:8px; font-size:11px; color:var(--gold-soft); font-weight:600;" class="news-toggle-hint" id="hint-${i}">🔽 महत्त्वाचे मुद्दे बघण्यासाठी टॅप कर</div>
      <div class="news-points" id="pts-${i}"></div>
    </div>
  `).join('');

  listEl.querySelectorAll('.news-card').forEach((card, i) => {
    card.addEventListener('click', ()=> toggleKeyPoints(i, topItems[i].description));
  });

  topItems.forEach((n, i) => setTimeout(()=> translateToMarathi(n.title, i), i * 400));

  const notified = getNotifiedImportantSet();
  const newsworthy = allItems.filter(n =>
    (n.important || n.goldBullish || n.goldBearish) &&
    !notified.has(n.title) &&
    (Date.now() - parseFeedDate(n.pubDate)) / 3600000 <= PRIORITY_FRESHNESS_HOURS
  );
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

  updateAIAnalysis();
}

function isValidTranslation(text){
  if(!text) return false;
  return !/mymemory warning|usagelimit|query length limit/i.test(text);
}

const TRANSLATE_QUOTA_KEY = 'goldAlertAI_translateQuotaHitAt';
function isTranslateQuotaLikelyExceeded(){
  const t = localStorage.getItem(TRANSLATE_QUOTA_KEY);
  if(!t) return false;
  return (Date.now() - parseInt(t, 10)) < 12 * 60 * 60 * 1000;
}
function markTranslateQuotaExceeded(){
  localStorage.setItem(TRANSLATE_QUOTA_KEY, Date.now().toString());
}

async function translateToMarathi(text, idx){
  const el = document.getElementById('mr-'+idx);
  if(!el) return;
  if(isTranslateQuotaLikelyExceeded()){
    el.textContent = text;
    return;
  }
  try{
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|mr`;
    const res = await fetch(url, {cache:'no-store'});
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if(isValidTranslation(translated)){
      el.textContent = translated;
    } else {
      markTranslateQuotaExceeded();
      el.textContent = text;
    }
  }catch(e){
    el.textContent = text;
  }
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function parseFeedDate(dateStr){
  if(!dateStr) return NaN;
  let s = String(dateStr).trim();
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$|GMT|UTC$/i.test(s);
  if(!hasTimezone && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)){
    s = s.replace(' ', 'T');
    if(!s.endsWith('Z')) s += 'Z';
  }
  return new Date(s).getTime();
}

function timeAgo(dateStr){
  if(!dateStr) return '';
  const diffMs = Date.now() - parseFeedDate(dateStr);
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
setInterval(fetchNews, 5*60*1000);

/* ---------- SERVICE WORKER REGISTER (PWA) ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js')
      .then(reg=>{
        reg.update();
        setInterval(()=> reg.update(), 5 * 60 * 1000);
      })
      .catch(e=>console.warn('SW register failed', e));
  });

  const RELOAD_FLAG_KEY = 'goldAlertAI_swAutoReloadedAt';
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    const last = sessionStorage.getItem(RELOAD_FLAG_KEY);
    const now = Date.now();
    if(last && (now - parseInt(last, 10)) < 60000) return;
    sessionStorage.setItem(RELOAD_FLAG_KEY, now.toString());
    window.location.reload();
  });
}

/* ---------- FORCE UPDATE ---------- */
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
  localStorage.setItem('goldAlertAI_justUpdated', '1');
  window.location.href = window.location.pathname + '?v=' + Date.now();
});

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

/* ---------- INLINE KEY POINTS ---------- */
function stripHtml(html){
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || div.innerText || '';
}

function extractKeyPoints(description){
  const clean = stripHtml(description).replace(/\s+/g,' ').trim();
  if(!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length > 12);
  return sentences.slice(0, 4);
}

const openPointsIndex = new Set();

function toggleKeyPoints(i, description){
  const box = document.getElementById('pts-'+i);
  const hint = document.getElementById('hint-'+i);
  if(!box) return;

  const isOpen = box.classList.contains('open');
  if(isOpen){
    box.classList.remove('open');
    openPointsIndex.delete(i);
    if(hint) hint.textContent = '🔽 महत्त्वाचे मुद्दे बघण्यासाठी टॅप कर';
    return;
  }

  const points = extractKeyPoints(description);
  if(points.length === 0){
    box.innerHTML = `<div class="pts-empty">या बातमीसाठी अजून जास्त तपशील उपलब्ध नाही.</div>`;
  } else {
    box.innerHTML = `<ul>${points.map((p, j) => `<li id="pt-${i}-${j}">${escapeHtml(p)} <span style="color:var(--sub); font-size:10.5px;">(मराठी भाषांतर होत आहे...)</span></li>`).join('')}</ul>`;
    points.forEach((p, j) => setTimeout(()=> translatePoint(p, i, j), j * 300));
  }
  box.classList.add('open');
  openPointsIndex.add(i);
  if(hint) hint.textContent = '🔼 बंद करण्यासाठी परत टॅप कर';
}

async function translatePoint(text, i, j){
  const el = document.getElementById(`pt-${i}-${j}`);
  if(!el) return;
  if(isTranslateQuotaLikelyExceeded()){
    el.textContent = text;
    return;
  }
  try{
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|mr`;
    const res = await fetch(url, {cache:'no-store'});
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if(isValidTranslation(translated)){
      el.textContent = translated;
    } else {
      markTranslateQuotaExceeded();
      el.textContent = text;
    }
  }catch(e){
    el.textContent = text;
  }
}

/* ---------- AI ANALYSIS BADGE (news + swing + candle + BB Trap) ----------
   Not a guaranteed trading signal — a transparent, explained heuristic.
------------------------------------------ */
function updateAIAnalysis(){
  const bullishCount = lastFetchedNewsItems.filter(n => n.goldBullish).length;
  const bearishCount = lastFetchedNewsItems.filter(n => n.goldBearish).length;
  const newsSignal = bullishCount > bearishCount ? 1 : (bearishCount > bullishCount ? -1 : 0);

  let swingSignal = 0;
  let swingNote = 'अजून पुरेसा swing data नाही';
  if(swingLevels && swingLevels.length >= 2){
    const latest = swingLevels[0];
    const prevSame = swingLevels.slice(1).find(s => s.type === latest.type);
    if(prevSame){
      if(latest.type === 'high' && latest.value > prevSame.value){ swingSignal = 1; swingNote = 'Higher High — नवीन उच्चांक जुन्यापेक्षा वर'; }
      else if(latest.type === 'high' && latest.value < prevSame.value){ swingSignal = -1; swingNote = 'Lower High — नवीन उच्चांक जुन्यापेक्षा खाली'; }
      else if(latest.type === 'low' && latest.value > prevSame.value){ swingSignal = 1; swingNote = 'Higher Low — नवीन नीचांक जुन्यापेक्षा वर'; }
      else if(latest.type === 'low' && latest.value < prevSame.value){ swingSignal = -1; swingNote = 'Lower Low — नवीन नीचांक जुन्यापेक्षा खाली'; }
      else { swingNote = 'Swing सपाट — स्पष्ट trend नाही'; }
    }
  }

  let candleSignal = 0;
  let candleNote = 'अजून candle pattern data नाही';
  if(lastCandlePattern){
    if(lastCandlePattern.type === 'bullish_engulfing'){ candleSignal = 1; candleNote = 'Bullish Engulfing (शेवटच्या तासाचा candle)'; }
    else if(lastCandlePattern.type === 'bearish_engulfing'){ candleSignal = -1; candleNote = 'Bearish Engulfing (शेवटच्या तासाचा candle)'; }
    else if(lastCandlePattern.type === 'doji'){ candleSignal = 0; candleNote = 'Doji — indecision, स्पष्ट दिशा नाही'; }
  }

  let bbTrapSignalVal = 0;
  let bbTrapNote = 'सध्या active BB Trap नाही';
  if(lastBBTrapSignal){
    bbTrapSignalVal = lastBBTrapSignal.type === 'bullish' ? 1 : -1;
    bbTrapNote = `1H: ${lastBBTrapSignal.type === 'bullish' ? 'Bullish' : 'Bearish'} Trap — Entry ${lastBBTrapSignal.entryPrice.toFixed(2)}, Target ${lastBBTrapSignal.target.toFixed(2)}`;
  }
  if(lastBBTrapSignal15m){
    bbTrapNote += lastBBTrapSignal ? ' · ' : '';
    bbTrapNote += `15m: ${lastBBTrapSignal15m.type === 'bullish' ? 'Bullish' : 'Bearish'} Trap — Entry ${lastBBTrapSignal15m.entryPrice.toFixed(2)}, Target ${lastBBTrapSignal15m.target.toFixed(2)}`;
  }

  const totalScore = newsSignal + swingSignal + candleSignal + bbTrapSignalVal;
  let label, cls;
  if(totalScore >= 1){ label = '📈 BULLISH'; cls = 'up'; }
  else if(totalScore <= -1){ label = '📉 BEARISH'; cls = 'down'; }
  else { label = '➖ NEUTRAL'; cls = 'neutral'; }

  const detail = `News: ${bullishCount} बुलिश / ${bearishCount} बेअरिश  ·  Swing: ${swingNote}  ·  Candle: ${candleNote}  ·  BB Trap: ${bbTrapNote}`;

  const badge = document.getElementById('aiBadge');
  const text = document.getElementById('aiText');
  if(badge){ badge.textContent = label; badge.className = 'ai-badge ' + cls; }
  if(text){ text.innerHTML = `<b>अंदाजे संकेत</b> (गॅरंटी नाही) — ${detail}`; }

  const bigBadge = document.getElementById('analysisBadgeBig');
  const detailText = document.getElementById('analysisDetailText');
  if(bigBadge){ bigBadge.textContent = label; bigBadge.className = 'ai-badge ' + cls; bigBadge.style.fontSize = '14px'; bigBadge.style.padding = '8px 14px'; }
  if(detailText){
    detailText.innerHTML = `
      <div style="margin-bottom:6px;"><b style="color:var(--text);">News sentiment:</b> ${bullishCount} बुलिश headline, ${bearishCount} बेअरिश headline</div>
      <div style="margin-bottom:6px;"><b style="color:var(--text);">Swing structure:</b> ${swingNote}</div>
      <div style="margin-bottom:6px;"><b style="color:var(--text);">Candle pattern (1H, approximate):</b> ${candleNote}</div>
      <div><b style="color:var(--text);">BB Trap (1H, 20 SMA target):</b> ${bbTrapNote}</div>
    `;
  }
}

/* ---------- RISK & LOT SIZE CALCULATOR ---------- */
const GOLD_OZ_PER_STANDARD_LOT = 100;

document.getElementById('calcRiskBtn')?.addEventListener('click', ()=>{
  const statusEl = document.getElementById('riskCalcStatus');
  const resultEl = document.getElementById('riskCalcResult');

  const balance = parseFloat(document.getElementById('riskBalance').value);
  const riskPct = parseFloat(document.getElementById('riskPercent').value);
  const entry = parseFloat(document.getElementById('riskEntry').value);
  const stop = parseFloat(document.getElementById('riskStop').value);

  if(isNaN(balance) || balance <= 0){
    statusEl.textContent = 'कृपया योग्य Account Balance टाक';
    resultEl.innerHTML = '';
    return;
  }
  if(isNaN(riskPct) || riskPct <= 0 || riskPct > 100){
    statusEl.textContent = 'कृपया योग्य Risk % टाक (0-100 च्या दरम्यान)';
    resultEl.innerHTML = '';
    return;
  }
  if(isNaN(entry) || entry <= 0 || isNaN(stop) || stop <= 0){
    statusEl.textContent = 'कृपया योग्य Entry आणि Stop Loss price टाक';
    resultEl.innerHTML = '';
    return;
  }
  if(entry === stop){
    statusEl.textContent = 'Entry आणि Stop Loss same असू शकत नाही';
    resultEl.innerHTML = '';
    return;
  }

  statusEl.textContent = '';

  const stopDistance = Math.abs(entry - stop);
  const riskAmount = balance * (riskPct / 100);
  const lotSize = riskAmount / (stopDistance * GOLD_OZ_PER_STANDARD_LOT);
  const positionValue = lotSize * GOLD_OZ_PER_STANDARD_LOT * entry;
  const direction = stop < entry ? 'BUY (वर जाईल असं गृहीत धरून)' : 'SELL (खाली जाईल असं गृहीत धरून)';

  const roundedLot = Math.floor(lotSize * 100) / 100;

  let lotWarning = '';
  if(roundedLot < 0.01){
    lotWarning = `<div class="empty-state" style="padding:10px 4px; color:var(--bear);">⚠️ या risk % आणि stop distance नुसार lot size 0.01 पेक्षाही कमी येतोय — एकतर risk % वाढव, किंवा stop loss जवळ घे.</div>`;
  }

  resultEl.innerHTML = `
    <div class="risk-result-card">
      <div class="risk-result-highlight">
        <div class="big">${roundedLot.toFixed(2)} lot</div>
        <div class="lbl">शिफारस केलेला Lot Size (${direction})</div>
      </div>
      ${lotWarning}
      <div class="risk-result-row"><span>Stop Distance</span><span>$${stopDistance.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>Risk Amount</span><span>$${riskAmount.toFixed(2)} (${riskPct}%)</span></div>
      <div class="risk-result-row"><span>Position Value</span><span>$${positionValue.toFixed(2)}</span></div>
      <div class="risk-result-row"><span>$ per $1 move (या lot वर)</span><span>$${(roundedLot * GOLD_OZ_PER_STANDARD_LOT).toFixed(2)}</span></div>
    </div>
    <div class="empty-state" style="padding:8px 4px 20px; text-align:left; font-size:10.5px;">
      ⚠️ हा फक्त गणिती calculator आहे (100 oz/lot या standard gold convention नुसार) — तुमच्या broker चा exact contract size/margin वेगळा असू शकतो, ट्रेड घेण्याआधी broker platform वर एकदा खात्री करा.
    </div>
  `;
});

/* ---------- FULLSCREEN CHART MODAL / TRADINGVIEW APP LINK ---------- */
let fullChartLoaded = false;

function loadFullChartWidgetIfNeeded(){
  if(fullChartLoaded) return;
  fullChartLoaded = true;
  const container = document.getElementById('fullChartWidget');
  if(!container) return;
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.async = true;
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol: 'OANDA:XAUUSD',
    interval: '60',
    timezone: 'Asia/Kolkata',
    theme: 'dark',
    style: '1',
    locale: 'en',
    toolbar_bg: '#14171B',
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_side_toolbar: false,
    hide_legend: false,
    save_image: true,
    allow_symbol_change: false,
    withdateranges: true,
    calendar: false,
    support_host: 'https://www.tradingview.com'
  });
  container.appendChild(script);
}

document.getElementById('openChartBtn')?.addEventListener('click', ()=>{
  window.location.href = 'https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD';
});

/* ---------- H4 SWING CHART (candles + swing lines, live-updating) ----------
   Uses TradingView's free open-source "Lightweight Charts" library (not the
   embedded widget — that one can't take custom price lines). We build H4
   candles client-side from the same raw `priceHistory` ticks the server
   uses, so the candles line up exactly with the server-computed swing
   levels. The last (currently forming) H4 candle is kept live-updating off
   the same 5-second price poll already used for alerts elsewhere in this
   file — everything before that is fixed/closed candles from the server.
   LIMITATION: Firebase only keeps ~7 days of raw ticks, so swings older
   than that have no candle data left to draw a line against — they still
   show in the list (Tools tab), just not on this chart.
------------------------------------------ */
let swingChart = null;
let swingCandleSeries = null;
let currentLiveCandle = null; // the in-progress H4 candle being live-updated
const H4_SECONDS = 4 * 60 * 60;

function buildH4CandlesFromTicks(ticks){
  if(!Array.isArray(ticks) || ticks.length === 0) return [];
  const buckets = {};
  for(const tick of ticks){
    const key = Math.floor(tick.t / (H4_SECONDS * 1000));
    if(!buckets[key]) buckets[key] = [];
    buckets[key].push(tick);
  }
  const sortedKeys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
  return sortedKeys.map(k=>{
    const bucketTicks = buckets[k].sort((a,b)=>a.t-b.t);
    const prices = bucketTicks.map(t=>t.price);
    return {
      time: k * H4_SECONDS, // lightweight-charts wants seconds, not ms
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length-1]
    };
  });
}

async function initSwingChart(){
  const container = document.getElementById('swingChartContainer');
  const note = document.getElementById('swingChartNote');
  if(!container || typeof LightweightCharts === 'undefined') return;
  if(typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey === 'YOUR_API_KEY') return;

  try{
    const res = await fetch(firebaseConfig.databaseURL + '/priceHistory.json');
    const ticks = await res.json();
    const candles = buildH4CandlesFromTicks(ticks || []);

    if(candles.length === 0){
      if(note) note.textContent = 'अजून पुरेसा price data नाही — थोडा वेळ थांबा.';
      return;
    }

    if(!swingChart){
      swingChart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 300,
        layout: { background: { color: 'transparent' }, textColor: '#8A919C' },
        grid: { vertLines: { color: '#262B31' }, horzLines: { color: '#262B31' } },
        timeScale: { timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#262B31' },
      });
      swingCandleSeries = swingChart.addCandlestickSeries({
        upColor: '#3ECF8E', downColor: '#FF5C5C',
        borderUpColor: '#3ECF8E', borderDownColor: '#FF5C5C',
        wickUpColor: '#3ECF8E', wickDownColor: '#FF5C5C',
      });
      window.addEventListener('resize', ()=>{
        if(swingChart) swingChart.applyOptions({ width: container.clientWidth });
      });
    }

    swingCandleSeries.setData(candles);
    currentLiveCandle = { ...candles[candles.length - 1] };

    // Draw a horizontal line for each swing level that falls within the
    // candles we actually have data for (older ones are skipped — see note above).
    swingCandleSeries.priceLines?.forEach?.(pl => swingCandleSeries.removePriceLine(pl));
    const earliestCandleTime = candles[0].time * 1000;
    const drawnSwings = swingLevels.filter(s => s.time >= earliestCandleTime);
    drawnSwings.forEach(s => {
      swingCandleSeries.createPriceLine({
        price: s.value,
        color: s.type === 'high' ? '#3ECF8E' : '#FF5C5C',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: s.type === 'high' ? 'Swing High' : 'Swing Low'
      });
    });

    if(note){
      const skipped = swingLevels.length - drawnSwings.length;
      note.textContent = skipped > 0
        ? `${drawnSwings.length} स्विंग रेषा दाखवल्या (${skipped} जुने स्विंग्स — त्यांचा candle data आता उपलब्ध नाही, फक्त list मध्ये दिसतील).`
        : `${drawnSwings.length} स्विंग रेषा दाखवल्या — शेवटचा candle live अपडेट होतोय.`;
    }
  }catch(e){
    console.warn('Swing chart init failed (non-fatal):', e);
    if(note) note.textContent = 'Chart लोड करता आलं नाही.';
  }
}

function updateLiveSwingCandle(price){
  if(!swingCandleSeries || !currentLiveCandle) return;
  const nowBucket = Math.floor(Date.now() / (H4_SECONDS * 1000)) * H4_SECONDS;

  if(nowBucket !== currentLiveCandle.time){
    // a new H4 bucket has started — begin a fresh live candle
    currentLiveCandle = { time: nowBucket, open: price, high: price, low: price, close: price };
  } else {
    currentLiveCandle.high = Math.max(currentLiveCandle.high, price);
    currentLiveCandle.low = Math.min(currentLiveCandle.low, price);
    currentLiveCandle.close = price;
  }
  swingCandleSeries.update(currentLiveCandle);
}

// Re-draw the chart (fresh candles + swing lines) every time server swings
// refresh, so it stays in sync with the same 5-min cycle as the rest of the app.
initSwingChart();
setInterval(initSwingChart, 5 * 60 * 1000);
