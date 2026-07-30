# Gold Alert AI — Phase 1

## काय आहे यात
- Live XAUUSD price (30 सेकंदाला auto-refresh)
- Breaking gold news (Kitco + FXStreet RSS)
- Economic calendar (सध्या curated static list — Phase 2 मध्ये live होईल)
- PWA — mobile वर "Add to Home Screen" करता येईल, app सारखं उघडेल

## GitHub Pages वर FREE hosting कशी करायची

1. GitHub वर नवीन repository बनवा — नाव द्या `gold-alert-ai`
2. या folder मधल्या सगळ्या files (index.html, script.js, manifest.json, sw.js, icons/) त्या repo मध्ये upload करा
3. Repo च्या **Settings → Pages** मध्ये जा
4. Source मध्ये `main` branch आणि `/ (root)` निवडा → Save
5. २-३ मिनिटांत तुमची लिंक तयार होईल:
   `https://<तुमचं-username>.github.io/gold-alert-ai/`

## Mobile वर App सारखं Install कसं करायचं
1. वरची लिंक Chrome मध्ये उघडा
2. वरच्या उजव्या ⋮ मेनूमध्ये **"Add to Home Screen"** निवडा
3. आता ते icon बाकी app सारखं दिसेल आणि उघडेल — कोणताही Play Store install लागत नाही

## सध्याच्या मर्यादा (माहितीसाठी)
- Gold price चा data source `goldprice.org` चा public/no-key endpoint आहे — तो कधी कधी CORS मुळे block होऊ शकतो. झाल्यास "Offline" दिसेल, थोड्या वेळाने परत ट्राय होतं.
- News साठी `allorigins.win` हा free CORS proxy वापरलाय — तो कधी कधी rate-limit होतो.
- Calendar सध्या फक्त recurring events दाखवतो (exact तारीख नाही) — Phase 2 मध्ये आपण एखादं free calendar API जोडू.

## पुढचा टप्पा (Phase 2)
- Push Notifications (Firebase free tier)
- Price Alerts (user-set target)
- AI Analysis (OpenAI किंवा free LLM वापरून Bullish/Bearish + Marathi summary)
