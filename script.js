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

/* ---------- LIVE GOLD PRICE ---------- */
let lastPrice = null;
let sessionHigh = null;
let sessionLow = null;

async function fetchGoldPrice(){
  try{
    let price, prevClose, high, low;

    // Fire both requests in parallel instead of one-after-another — much faster
    const [hlResult, fastResult] = await Promise.allSettled([
      fetchWithFallback('https://data-asg.goldprice.org/dbXRates/USD'),
      fetch('https://api.gold-api.com/price/XAU', {cache:'no-store'}).then(r => r.ok ? r.json() : Promise.reject('bad status'))
    ]);

    let hlData = null;
    if(hlResult.status === 'fulfilled'){
      try{ hlData = JSON.parse(hlResult.value).items[0]; }catch(e){ /* ignore */ }
    }

    let fastPrice = null;
    if(fastResult.status === 'fulfilled' && typeof fastResult.value.price === 'number'){
      fastPrice = fastResult.value.price;
    }

    if(hlData){
      price = fastPrice !== null ? fastPrice : hlData.xauPrice;
      prevClose = hlData.xauClose;
      high = Math.max(hlData.xauHigh || price, price);
      low = Math.min(hlData.xauLow || price, price);
    } else if(fastPrice !== null){
      price = fastPrice;
      prevClose = price;
      high = price;
      low = price;
    } else {
      throw new Error('both sources failed');
    }

    const change = price - prevClose;
    const pct = (change/prevClose*100);

    // Track real session high/low ourselves since the API doesn't return reliable daily values
    if(sessionHigh === null || price > sessionHigh) sessionHigh = price;
    if(sessionLow === null || price < sessionLow) sessionLow = price;

    document.getElementById('goldPrice').textContent = price.toFixed(2);
    document.getElementById('goldHigh').textContent = sessionHigh.toFixed(2);
    document.getElementById('goldLow').textContent = sessionLow.toFixed(2);
    document.getElementById('goldGram').textContent = (price/31.1035).toFixed(2);

    const changeEl = document.getElementById('goldChange');
    const sign = change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');

    const aiBadge = document.getElementById('aiBadge');
    if(change >= 0){
      aiBadge.textContent = 'BULLISH BIAS';
      aiBadge.className = 'ai-badge up';
    } else {
      aiBadge.textContent = 'BEARISH BIAS';
      aiBadge.className = 'ai-badge down';
    }
    document.getElementById('aiText').innerHTML =
      `Day change च्या आधारे साधा bias दाखवत आहोत. <b>Full AI (ICT/SMC) analysis Phase 2</b> मध्ये येईल.`;

    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-IN', {hour12:false});
    document.getElementById('statusDot').style.background = '#3ECF8E';
    document.getElementById('statusText').textContent = 'Live';
    lastPrice = price;
  }catch(err){
    console.error('Price fetch failed', err);
    document.getElementById('statusDot').style.background = '#FF5C5C';
    document.getElementById('statusText').textContent = 'Offline';
    if(!lastPrice){
      document.getElementById('goldPrice').textContent = 'N/A';
    }
  }
}

fetchGoldPrice();
setInterval(fetchGoldPrice, 3000); // refresh every 3s

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
  listEl.innerHTML = allItems.slice(0, 15).map(n => `
    <div class="news-card">
      <div class="news-source">${n.source}</div>
      <div class="news-title">${escapeHtml(n.title)}</div>
      <div class="news-time">${timeAgo(n.pubDate)}</div>
    </div>
  `).join('');
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
