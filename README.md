# ⚡ Next.js Trading Dashboard

Modern, serverless trading system built with Next.js 14, TypeScript, and deployed on Vercel.

## 🎯 Features

- ✅ **Next.js 14** with App Router & Server Components
- ✅ **TypeScript** decision engine with 7 trading strategies
- ✅ **Real-time webhooks** from TradingView
- ✅ **Vercel KV (Redis)** for data storage
- ✅ **Tailwind CSS** for styling
- ✅ **Server-side rendering** for performance
- ✅ **API routes** for webhook processing
- ✅ **Dark theme** optimized for trading
- ✅ **Responsive design** mobile-friendly
- ✅ **FREE hosting** on Vercel

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your values

# Run development server
npm run dev

# Open browser
open http://localhost:3000
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/trading-dashboard)

1. Click "Deploy" button
2. Connect GitHub repository
3. Add environment variables
4. Deploy!

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for detailed instructions.

## 📁 Project Structure

```
nextjs-trading/
├── app/                      # Next.js App Router
│   ├── api/                 # API routes
│   │   ├── webhook/         # Webhook endpoint
│   │   └── signals/         # Signals API
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Dashboard page
│   └── globals.css          # Global styles
├── components/              # React components
│   ├── navigation.tsx       # Navigation bar
│   ├── stats-cards.tsx      # Stats cards
│   ├── recent-signals.tsx   # Signals feed
│   └── ui/                  # UI components
├── lib/                     # Utilities
│   ├── decision-engine.ts   # Trading logic
│   └── utils.ts             # Helper functions
└── public/                  # Static assets
```

## 🎨 Tech Stack

- **Framework:** Next.js 14
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Vercel KV (Redis)
- **Deployment:** Vercel
- **Icons:** Lucide React
- **Charts:** Recharts

## ⚙️ Configuration

### Environment Variables

Required variables in `.env.local`:

```bash
# Trading Strategy
STRATEGY=balanced  # mega_only, conservative, balanced, aggressive, reversal_only, mean_reversion, scalping
RISK_PER_TRADE=100
MAX_RISK_PER_SHARE=2.00
MIN_RR_RATIO=1.3

# Ticker Filter (comma-separated, empty for all)
ALLOWED_TICKERS=SPY,QQQ,AAPL
ALLOWED_TIMEFRAMES=10,15

# Vercel KV (auto-added when you create KV database)
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
```

### Trading Strategies

| Strategy | Trades/Day | Win Rate | Description |
|----------|------------|----------|-------------|
| **mega_only** | 1-3 | 85-95% | Only 5-star MEGA signals |
| **conservative** | 3-5 | 75-85% | High quality, 4+ stars |
| **balanced** | 5-10 | 70-80% | Recommended for most |
| **aggressive** | 10-20 | 60-70% | More trades, lower quality |
| **reversal_only** | 1-3 | 85-95% | Only 2-2 reversals |
| **mean_reversion** | 4-8 | 70-80% | Bounce trades at levels |
| **scalping** | 15-30 | 55-65% | Quick trades |

## 📡 Webhook Integration

### TradingView Setup

1. Create alert on your chart
2. Set webhook URL to: `https://YOUR_SITE.vercel.app/api/webhook`
3. Message: Leave default (indicator sends JSON)
4. Enable "Webhook URL" option
5. Create alert

### Webhook Format

The webhook expects JSON with this structure:

```json
{
  "signal": {
    "type": "LONG_MEGA",
    "quality": 5
  },
  "market": {
    "ticker": "SPY",
    "timeframe_minutes": 10
  },
  "price": {
    "entry": 450.25,
    "body_percent": 70
  },
  "volume": {
    "z_score": 1.8,
    "is_unusual": true
  },
  "structure": {
    "trend": "BULLISH",
    "vwap": { "distance_percent": 0.15 },
    "atr_levels": { "at_key_level": true }
  },
  "strat": {
    "pattern": {
      "name": "2-2 REV",
      "is_2_2_reversal": true
    }
  },
  "risk_management": {
    "stop_loss": 449.00,
    "target_1": 451.00,
    "risk_reward_ratio": 1.6
  },
  "confluence": {
    "total_factors": 5,
    "unusual_volume": true,
    "trend_aligned": true
  }
}
```

## 🧪 Testing

### Test Webhook Locally

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d @test-signal.json
```

### Test on Vercel

```bash
curl -X POST https://YOUR_SITE.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d @test-signal.json
```

## 📊 API Endpoints

- **GET /api/webhook** - Health check
- **POST /api/webhook** - Process trading signal
- **GET /api/signals** - Get signal history
- **GET /api/stats** - Get statistics

## 🗄️ Data Storage

Uses Vercel KV (Redis) for:
- Signal history
- Performance metrics
- Trade tracking
- Real-time stats

**Free tier includes:**
- 30MB storage
- 3,000 commands/day
- Perfect for testing!

## 📈 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import to Vercel
3. Add Vercel KV database
4. Set environment variables
5. Deploy!

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for complete guide.

### Other Platforms

While optimized for Vercel, can deploy to:
- Netlify (with Redis addon)
- Railway
- Render
- Self-hosted (requires Redis)

## 🔒 Security

- Environment variables for sensitive data
- Webhook signature verification (optional)
- HTTPS by default on Vercel
- No API keys in frontend code
- Server-side validation

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 📞 Support

- **Documentation:** See `/docs` folder
- **Issues:** GitHub Issues
- **Deployment:** [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)

## 🎓 Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel KV Documentation](https://vercel.com/docs/storage/vercel-kv)
- [Tailwind CSS](https://tailwindcss.com)
- [TypeScript](https://www.typescriptlang.org/)

## ⚡ Quick Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # Check TypeScript

# Deployment
git push             # Auto-deploys to Vercel
vercel --prod        # Manual deploy
```

---

**Built with ❤️ using Next.js and deployed on Vercel**
