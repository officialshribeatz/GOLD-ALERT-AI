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

// Shared helper: build OHLC candles of any bucket size out of the raw 5-min
// price ticks. Used for the hourly engulfing/doji detector, and for BOTH
// the 1H and 15m BB Trap detectors below — same function, different bucket size.
function buildCandles(history, bucketMs){
  const buckets = {};
  for(const tick of history){
    const bucketKey = Math.floor(tick.t / bucketMs);
    if(!buckets[bucketKey]) buckets[bucketKey] = [];
    buckets[bucketKey].push(tick);
  }
  const sortedKeys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
  return sortedKeys.map(k=>{
    const ticks = buckets[k].sort((a,b)=>a.t-b.t);
    const prices = ticks.map(t=>t.price);
    return {
      t: k * bucketMs,
      open: ticks[0].price,
      close: ticks[ticks.length-1].price,
      high: Math.max(...prices),
      low: Math.min(...prices)
    };
  });
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

  // ---- 2. Server-side swing (genuinely H4-style) detection ----
  // Runs every 5 min regardless of any phone being open — builds real swing
  // history in shared Firebase data so the app just displays it.
  //
  // PREVIOUS VERSION OF THIS CODE was checking raw 5-min ticks directly for
  // local highs/lows — that's an M5-style swing, not H4, even though the
  // app's tagline says "H4/Daily style". Fixed here: ticks are first grouped
  // into 4-hour candles (Open/High/Low/Close per 4h bucket), and swings are
  // now detected on the candle-level High/Low sequence — that's what makes
  // this a real H4 swing instead of 5-min noise. This needs more history to
  // build up before the first swing appears (at least a few days), which is
  // expected and correct for a genuinely H4-scale signal.
  const H4_BUCKET_MS = 4 * 60 * 60 * 1000; // 4 hours
  const H4_N = 2;              // candles each side to confirm a swing point (= 8h each side)
  const H4_MIN_AMPLITUDE = 6;  // $ — must beat every neighboring candle's high/low by this much
  const DEDUPE_GAP = 12;       // $ — treat close levels as the same zone
  const MAX_HISTORY = 2016;    // ~7 days of 5-min ticks — enough for several days of H4 candles
  const MAX_SWINGS = 20;

  const histSnap = await db.ref('priceHistory').once('value');
  let history = histSnap.val() || [];
  history.push({ price, t: Date.now() });
  if(history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
  await db.ref('priceHistory').set(history);

  const h4Buckets = {};
  for(const tick of history){
    const key = Math.floor(tick.t / H4_BUCKET_MS);
    if(!h4Buckets[key]) h4Buckets[key] = [];
    h4Buckets[key].push(tick);
  }
  const h4Keys = Object.keys(h4Buckets).map(Number).sort((a,b)=>a-b);
  const h4Candles = h4Keys.map(k=>{
    const ticks = h4Buckets[k].sort((a,b)=>a.t-b.t);
    const prices = ticks.map(t=>t.price);
    return { t: k * H4_BUCKET_MS, high: Math.max(...prices), low: Math.min(...prices) };
  });

  console.log(`priceHistory ticks: ${history.length}  |  H4 candles built: ${h4Candles.length} (need >= ${2 * H4_N + 1} to start checking for swings)`);

  const idx = h4Candles.length - 1 - H4_N;
  if(idx >= H4_N){
    const candle = h4Candles[idx];
    const neighbors = [...h4Candles.slice(idx - H4_N, idx), ...h4Candles.slice(idx + 1, idx + 1 + H4_N)];
    const isHigh = neighbors.every(c => candle.high > c.high + H4_MIN_AMPLITUDE);
    const isLow = neighbors.every(c => candle.low < c.low - H4_MIN_AMPLITUDE);

    console.log(`Checking H4 candle (idx ${idx}, high ${candle.high}, low ${candle.low}): isHigh=${isHigh}, isLow=${isLow}`);

    if(isHigh || isLow){
      const type = isHigh ? 'high' : 'low';
      const value = isHigh ? candle.high : candle.low;
      const swingSnap = await db.ref('swingLevels').once('value');
      let swings = swingSnap.val() || [];
      const duplicate = swings.find(s => s.type === type && Math.abs(s.value - value) <= DEDUPE_GAP);
      if(!duplicate){
        swings.push({ type, value, time: candle.t });
        swings.sort((a,b) => b.time - a.time);
        if(swings.length > MAX_SWINGS) swings = swings.slice(0, MAX_SWINGS);
        await db.ref('swingLevels').set(swings);
        console.log('New H4 swing detected:', type, value);

        // Notify every device that has swing alerts enabled
        const tokens = Object.values(devices)
          .filter(d => d.swingEnabled && d.token)
          .map(d => d.token);
        if(tokens.length){
          const body = `Naya H4 swing ${type === 'high' ? 'high' : 'low'} tayar zala: ${value.toFixed(2)}`;
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

  // Build the shared hourly candle series once — used by both Section 4
  // (engulfing/doji) and Section 5 (BB Trap, 1H) below.
  const hourlyCandles = buildCandles(history, 60 * 60 * 1000);

  // ---- 4. Basic candle pattern detection (engulfing / doji) ----
  // Approximate hourly candles built from the raw 5-min ticks — not a real
  // broker OHLC feed, the app says so wherever this is shown.
  try{
    if(hourlyCandles.length >= 2){
      const prev = hourlyCandles[hourlyCandles.length - 2];
      const curr = hourlyCandles[hourlyCandles.length - 1];
      let pattern = null;

      const currBody = Math.abs(curr.close - curr.open);
      const currRange = curr.high - curr.low;

      // Bullish engulfing: prev candle red, curr candle green and its body
      // fully covers (engulfs) the previous candle's body.
      if(prev.close < prev.open && curr.close > curr.open &&
         curr.open <= prev.close && curr.close >= prev.open){
        pattern = { type: 'bullish_engulfing', label: 'Bullish Engulfing' };
      }
      // Bearish engulfing: mirror of the above.
      else if(prev.close > prev.open && curr.close < curr.open &&
              curr.open >= prev.close && curr.close <= prev.open){
        pattern = { type: 'bearish_engulfing', label: 'Bearish Engulfing' };
      }
      // Doji: open and close almost equal (body is a tiny fraction of the
      // candle's total range) — signals indecision, not direction.
      else if(currRange > 0 && currBody / currRange < 0.1){
        pattern = { type: 'doji', label: 'Doji (indecision)' };
      }

      if(pattern){
        await db.ref('lastCandlePattern').set({
          ...pattern,
          candleTime: curr.t,
          detectedAt: Date.now()
        });
        console.log('Candle pattern detected:', pattern.label);
      } else {
        console.log('No notable candle pattern on the latest hourly candle.');
      }
    } else {
      console.log(`Not enough hourly candles yet for pattern detection (have ${hourlyCandles.length}, need 2).`);
    }
  }catch(e){
    console.warn('Candle pattern detection failed (non-fatal):', e.message);
  }

  // ---- 5. BB Trap strategy detection (20-period Bollinger Bands) ----
  // Now runs on TWO timeframes — 1H (as before) and 15m (new) — each stored
  // under its own Firebase node so the app can show both separately.
  // Rules (VWAP intentionally left out — no volume data available for gold
  // from our free price source, so 20 SMA is used as the reference line
  // throughout, same as the strategy's own target rule already does):
  //   BEARISH: an "Alert Candle" forms fully above the upper band (its Low
  //   is still above the band) → the first later candle whose Low breaks
  //   below the Alert Candle's Low triggers a SHORT entry at that Low,
  //   target = the 20 SMA value at the moment of the break.
  //   BULLISH: mirror — Alert Candle fully below the lower band → first
  //   later candle whose High breaks above the Alert Candle's High triggers
  //   a LONG entry, target = 20 SMA at that moment.
  // This is a simple, mechanical, approximate read on candles built from
  // 5-min ticks — not the real broker OHLC feed the original PDF strategy
  // was designed against, and it does not implement the strategy's
  // stoploss/partial-entry/consolidation rules — only the core alert →
  // break → target signal, clearly labeled as such wherever it's shown.
  async function runBBTrapDetection(candles, firebaseNode, timeframeLabel){
    try{
      const BB_PERIOD = 20;
      if(candles.length < BB_PERIOD + 2){
        console.log(`Not enough ${timeframeLabel} candles yet for BB Trap detection (have ${candles.length}, need ${BB_PERIOD + 2}).`);
        return;
      }

      const bands = new Array(candles.length).fill(null);
      for(let i = BB_PERIOD; i < candles.length; i++){
        const window = candles.slice(i - BB_PERIOD, i).map(c => c.close);
        const mean = window.reduce((a,b)=>a+b, 0) / BB_PERIOD;
        const variance = window.reduce((a,b)=> a + Math.pow(b - mean, 2), 0) / BB_PERIOD;
        const stdDev = Math.sqrt(variance);
        bands[i] = { sma: mean, upper: mean + 2*stdDev, lower: mean - 2*stdDev };
      }

      function findLatestSignal(direction){
        for(let i = candles.length - 2; i >= BB_PERIOD; i--){
          const b = bands[i];
          if(!b) continue;
          const c = candles[i];
          const isAlert = direction === 'bearish'
            ? c.low > b.upper
            : c.high < b.lower;
          if(!isAlert) continue;

          // Walk forward candle-by-candle from right after the Alert Candle.
          // Bearish: first candle whose LOW breaks the Alert Candle's Low
          // confirms the trap (valid). But if a candle's HIGH breaks the
          // Alert Candle's High BEFORE that happens, the trap is invalidated
          // — price kept going up instead of trapping bulls, so this alert
          // candle is discarded and we keep searching further back in time
          // for an earlier, still-valid Alert Candle instead of stopping here.
          let invalidated = false;
          let confirmedSignal = null;
          for(let j = i + 1; j < candles.length; j++){
            const trigC = candles[j];
            const confirmsIt = direction === 'bearish'
              ? trigC.low < c.low
              : trigC.high > c.high;
            const invalidatesIt = direction === 'bearish'
              ? trigC.high > c.high
              : trigC.low < c.low;

            if(confirmsIt){
              const targetBand = bands[j] || b;
              confirmedSignal = {
                type: direction,
                timeframe: timeframeLabel,
                alertCandleTime: c.t,
                alertHigh: c.high,
                alertLow: c.low,
                entryPrice: direction === 'bearish' ? c.low : c.high,
                target: targetBand.sma,
                triggerCandleTime: trigC.t
              };
              break;
            }
            if(invalidatesIt){
              invalidated = true;
              break;
            }
          }

          if(confirmedSignal) return { confirmed: confirmedSignal, pending: null };
          if(invalidated) continue; // this Alert Candle is dead — look further back for an earlier one
          // Still pending: this Alert Candle exists but hasn't been confirmed
          // or invalidated yet — the app can show this as "waiting" live.
          return {
            confirmed: null,
            pending: {
              type: direction,
              timeframe: timeframeLabel,
              alertCandleTime: c.t,
              alertHigh: c.high,
              alertLow: c.low,
              watchEntryPrice: direction === 'bearish' ? c.low : c.high
            }
          };
        }
        return { confirmed: null, pending: null };
      }

      const bearishResult = findLatestSignal('bearish');
      const bullishResult = findLatestSignal('bullish');

      const signal = [bearishResult.confirmed, bullishResult.confirmed]
        .filter(Boolean)
        .sort((a,b) => b.triggerCandleTime - a.triggerCandleTime)[0] || null;

      // Of any pending (unconfirmed) Alert Candles, show the more recent one.
      const pending = [bearishResult.pending, bullishResult.pending]
        .filter(Boolean)
        .sort((a,b) => b.alertCandleTime - a.alertCandleTime)[0] || null;

      const pendingNode = firebaseNode + 'Pending';
      if(pending){
        await db.ref(pendingNode).set({ ...pending, detectedAt: Date.now() });
        console.log(`${timeframeLabel} pending BB Trap Alert Candle:`, pending.type, 'watch entry', pending.watchEntryPrice);
      } else {
        await db.ref(pendingNode).remove();
      }

      if(signal){
        const prevSnap = await db.ref(firebaseNode).once('value');
        const prev = prevSnap.val();
        const isNew = !prev || prev.triggerCandleTime !== signal.triggerCandleTime || prev.type !== signal.type;

        await db.ref(firebaseNode).set({ ...signal, detectedAt: Date.now() });

        if(isNew){
          console.log(`New ${timeframeLabel} BB Trap signal:`, signal.type, 'entry', signal.entryPrice, 'target', signal.target);

          // Reuses the existing "swingEnabled" opt-in (same toggle as Swing
          // Level alerts) rather than adding a brand-new one — the app's
          // Tools tab already lets people turn this category of alert on/off.
          const tokens = Object.values(devices)
            .filter(d => d.swingEnabled && d.token)
            .map(d => d.token);
          if(tokens.length){
            const dirLabel = signal.type === 'bullish' ? 'BULLISH (BUY)' : 'BEARISH (SELL)';
            const body = `${timeframeLabel} BB Trap ${dirLabel} — Entry ${signal.entryPrice.toFixed(2)}, Target ${signal.target.toFixed(2)}`;
            try{
              await admin.messaging().sendEachForMulticast({
                tokens,
                notification: { title: `🎯 Gold Alert AI — ${timeframeLabel} BB Trap`, body }
              });
            }catch(e){ console.warn(`${timeframeLabel} BB Trap push failed:`, e.message); }
          }
        } else {
          console.log(`${timeframeLabel} BB Trap signal unchanged from last run.`);
        }
      } else {
        console.log(`No active ${timeframeLabel} BB Trap signal right now (no unbroken/triggered Alert Candle found).`);
      }
    }catch(e){
      console.warn(`${timeframeLabel} BB Trap detection failed (non-fatal):`, e.message);
    }
  }

  const fifteenMinCandles = buildCandles(history, 15 * 60 * 1000);
  await runBBTrapDetection(hourlyCandles, 'bbTrapSignal', '1H');
  await runBBTrapDetection(fifteenMinCandles, 'bbTrapSignal15m', '15m');
}

main().then(()=> process.exit(0)).catch(e => { console.error(e); process.exit(1); });
