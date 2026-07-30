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
}

main().then(()=> process.exit(0)).catch(e => { console.error(e); process.exit(1); });
