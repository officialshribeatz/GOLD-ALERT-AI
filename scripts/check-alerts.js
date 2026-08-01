/* Runs on a GitHub Actions schedule (every 5 min).
   Reads all devices + their alerts from Firebase Realtime Database,
   checks against the live gold price, and sends push notifications
   via Firebase Cloud Messaging for any alert that has been hit. */

const admin = require('firebase-admin');
const fetch = require('node-fetch');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

async function getGoldPrice(){
  const res = await fetch('https://api.gold-api.com/price/XAU', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if(!res.ok){
    throw new Error(`Gold price API returned status ${res.status}`);
  }
  const data = await res.json();
  return data.price;
}

async function main(){
  const price = await getGoldPrice();
  console.log('Current gold price:', price);

  // ---- 1. Price alerts (existing) ----
  const [devicesSnap, alertsSnap] = await Promise.all([
    db.ref('devices').once('value'),
    db.ref('alerts').once('value')
  ]);

  const devices = devicesSnap.val() || {};
  const allAlerts = alertsSnap.val() || {};

  for(const deviceId of Object.keys(allAlerts)){
    const deviceAlerts = allAlerts[deviceId] || [];
    const token = devices[deviceId]?.token;
    if(!token) continue;

    for(let i = 0; i < deviceAlerts.length; i++){
      const a = deviceAlerts[i];
      if(a.triggered) continue;

      const hit = a.direction === 'above' ? price >= a.target : price <= a.target;
      if(hit){
        console.log(`Alert hit for ${deviceId}:`, a);
        try{
          await admin.messaging().send({
            token,
            notification: {
              title: '🔔 Gold Alert AI',
              body: `Gold ${a.direction === 'above' ? 'वर गेलं' : 'खाली गेलं'}: ${price.toFixed(2)} (target ${a.target.toFixed(2)})`
            }
          });
          await db.ref(`alerts/${deviceId}/${i}/triggered`).set(true);
        }catch(e){
          console.warn('Push send failed for', deviceId, e.message);
        }
      }
    }
  }

  // ---- 2. Server-side swing (H4/Daily-style) detection ----
  // Runs every 5 min regardless of any phone being open — builds real swing
  // history in shared Firebase data so the app just displays it.
  //
  // NOTE: MIN_AMPLITUDE was previously $8, which requires a single 5-min
  // tick to beat ALL 8 neighboring ticks by $8 — gold usually only moves
  // $1-5 per 5-min tick in normal conditions, so that threshold was rarely
  // (if ever) met, which is why swingLevels stayed empty. Lowered to $4,
  // and N (confirmation window) lowered slightly so levels form faster too.
  const N = 3;                // neighbors each side to confirm a swing point
  const MIN_AMPLITUDE = 4;    // $ — must beat every neighbor by this much
  const DEDUPE_GAP = 12;      // $ — treat close levels as the same zone
  const MAX_HISTORY = 500;    // cap stored price ticks (~ a few days at 5 min/tick)
  const MAX_SWINGS = 20;

  const histSnap = await db.ref('priceHistory').once('value');
  let history = histSnap.val() || [];
  history.push({ price, t: Date.now() });
  if(history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
  await db.ref('priceHistory').set(history);

  console.log(`priceHistory length: ${history.length} (need >= ${2 * N + 1} to start checking for swings)`);

  const idx = history.length - 1 - N;
  if(idx >= N){
    const point = history[idx];
    const neighbors = [...history.slice(idx - N, idx), ...history.slice(idx + 1, idx + 1 + N)];
    const isHigh = neighbors.every(p => point.price > p.price + MIN_AMPLITUDE);
    const isLow = neighbors.every(p => point.price < p.price - MIN_AMPLITUDE);

    console.log(`Checking candidate point (idx ${idx}, price ${point.price}): isHigh=${isHigh}, isLow=${isLow}`);

    if(isHigh || isLow){
      const type = isHigh ? 'high' : 'low';
      const swingSnap = await db.ref('swingLevels').once('value');
      let swings = swingSnap.val() || [];
      const duplicate = swings.find(s => s.type === type && Math.abs(s.value - point.price) <= DEDUPE_GAP);
      if(!duplicate){
        swings.push({ type, value: point.price, time: point.t });
        swings.sort((a,b) => b.time - a.time);
        if(swings.length > MAX_SWINGS) swings = swings.slice(0, MAX_SWINGS);
        await db.ref('swingLevels').set(swings);
        console.log('New server-side swing detected:', type, point.price);

        // Notify every device that has swing alerts enabled
        const tokens = Object.values(devices)
          .filter(d => d.swingEnabled && d.token)
          .map(d => d.token);
        if(tokens.length){
          const body = `Naya swing ${type === 'high' ? 'high' : 'low'} tayar zala: ${point.price.toFixed(2)}`;
          try{
            await admin.messaging().sendEachForMulticast({
              tokens,
              notification: { title: '📍 Gold Alert AI — Swing Level', body }
            });
          }catch(e){ console.warn('Swing push failed:', e.message); }
        }
      } else {
        console.log('Swing candidate found but treated as duplicate of an existing zone, skipping.');
      }
    }
  } else {
    console.log('Not enough price history yet to check for a swing point this run.');
  }

  // ---- 3. Server-side Liquidity Zone (day high/low proximity) detection ----
  const LIQ_PROXIMITY = 2.5;
  try{
    const glRes = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const glData = await glRes.json();
    const item = glData.items[0];
    const dayHigh = item.xauHigh || item.xauPrice;
    const dayLow = item.xauLow || item.xauPrice;

    const nearHigh = Math.abs(dayHigh - price) <= LIQ_PROXIMITY;
    const nearLow = Math.abs(price - dayLow) <= LIQ_PROXIMITY;

    if(nearHigh || nearLow){
      const stateSnap = await db.ref('liqNotifyState').once('value');
      const state = stateSnap.val() || {};
      const zoneKey = nearHigh ? `high_${dayHigh.toFixed(0)}` : `low_${dayLow.toFixed(0)}`;

      if(state.lastZoneKey !== zoneKey){
        const tokens = Object.values(devices)
          .filter(d => d.liqEnabled && d.token)
          .map(d => d.token);
        if(tokens.length){
          const body = nearHigh
            ? `Price (${price.toFixed(2)}) day high (${dayHigh.toFixed(2)}) jawal ala — reversal/sweep sambhav.`
            : `Price (${price.toFixed(2)}) day low (${dayLow.toFixed(2)}) jawal ala — reversal/sweep sambhav.`;
          try{
            await admin.messaging().sendEachForMulticast({
              tokens,
              notification: { title: '🎯 Gold Alert AI — Liquidity Zone', body }
            });
          }catch(e){ console.warn('Liquidity push failed:', e.message); }
        }
        await db.ref('liqNotifyState').set({ lastZoneKey: zoneKey, updatedAt: Date.now() });
      }
    }
  }catch(e){
    console.warn('Liquidity zone check failed (non-fatal):', e.message);
  }
}

main().then(()=> process.exit(0)).catch(e => { console.error(e); process.exit(1); });
