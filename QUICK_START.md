# 🚀 QUICK START - 5 MINUTES TO DEPLOYMENT

## Get your trading dashboard live in 5 minutes!

---

## ✅ **WHAT YOU'LL HAVE:**

- Modern Next.js trading dashboard
- Real-time webhook processing
- 7 trading strategies
- FREE hosting on Vercel
- Automatic deployments

---

## 📦 **STEP 1: DOWNLOAD FILES** (1 min)

Download all files from the `nextjs-trading/` folder

---

## 🚀 **STEP 2: PUSH TO GITHUB** (2 mins)

```bash
cd nextjs-trading
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/trading-dashboard.git
git push -u origin main
```

---

## ☁️ **STEP 3: DEPLOY TO VERCEL** (2 mins)

1. Go to https://vercel.com
2. Sign up (free)
3. Click "Add New Project"
4. Import your GitHub repo
5. Click "Deploy"

**LIVE IN 30 SECONDS! 🎉**

---

## 🗄️ **STEP 4: ADD VERCEL KV** (1 min)

1. In Vercel dashboard → Your project
2. Click "Storage" tab
3. Click "Create Database" → "KV"
4. Name it `trading-kv`
5. Click "Connect to Project"
6. Click "Redeploy"

**DATABASE CONNECTED! ✅**

---

## ⚙️ **STEP 5: SET ENVIRONMENT VARIABLES** (1 min)

In Vercel:
1. Project → Settings → Environment Variables
2. Add these:

```
STRATEGY=balanced
RISK_PER_TRADE=100
MAX_RISK_PER_SHARE=2.00
MIN_RR_RATIO=1.3
ALLOWED_TICKERS=SPY,QQQ
ALLOWED_TIMEFRAMES=10,15
```

3. Redeploy

---

## 📡 **STEP 6: CONNECT TRADINGVIEW** (1 min)

1. In TradingView → Create Alert
2. Webhook URL: `https://YOUR-PROJECT.vercel.app/api/webhook`
3. Leave message default
4. Create alert

**DONE! SIGNALS WILL NOW FLOW IN! 🎯**

---

## ✅ **VERIFY IT'S WORKING:**

### Test Webhook:
```bash
curl https://YOUR-PROJECT.vercel.app/api/webhook
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "strategy": "balanced"
}
```

### View Dashboard:
```
https://YOUR-PROJECT.vercel.app
```

You should see:
- ✅ Stats cards
- ✅ Recent signals
- ✅ Dark theme
- ✅ Navigation

---

## 🎉 **YOU'RE LIVE!**

```
Your URLs:
├─ Dashboard:  https://YOUR-PROJECT.vercel.app
├─ Webhook:    https://YOUR-PROJECT.vercel.app/api/webhook
└─ Vercel:     https://vercel.com/dashboard
```

---

## 📚 **NEXT STEPS:**

```
☐ Let signals flow for 1-2 days
☐ Monitor dashboard
☐ Check Vercel logs
☐ View KV data browser
☐ Optimize strategy settings
☐ Add custom domain (optional)
```

---

## 🆘 **NEED HELP?**

- **Full Guide:** See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)
- **README:** See [README.md](./README.md)
- **Issues:** GitHub Issues

---

## ⚡ **TOTAL TIME: ~5 MINUTES**

```
Step 1: Download        (1 min)
Step 2: Push to GitHub  (2 mins)
Step 3: Deploy Vercel   (2 mins)
Step 4: Add KV         (1 min)
Step 5: Set Env Vars   (1 min)
Step 6: Connect TV     (1 min)

TOTAL: ~8 minutes including reading 😄
```

---

**Welcome to modern serverless trading! 🚀**
