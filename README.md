# SignalStack Dashboard

SignalStack is a live briefing prototype for tracking real news links, market shifts, AI updates, and startup opportunities.

## Run locally

From this folder:

```bash
set OPENROUTER_API_KEY=your_key_here
node server.mjs
```

Open:

```text
http://127.0.0.1:4174/
```

## Current features

- Priority world news cards
- Market and business trend radar
- AI update board
- Startup opportunity board
- Google News-inspired briefing layout
- Search, topic tabs, and severity filtering
- Real article links from RSS feeds
- AI summaries capped at 100 words through OpenRouter/DeepSeek when `OPENROUTER_API_KEY` is set
- Market tracking through Yahoo Finance chart data
- Node backend endpoints at `/api/news`, `/api/markets`, and `/api/briefing`
- Source/ranking audit endpoint at `/api/sources`
- Transparent `signalstack-rank-v2` scoring for top stories
- Summary counters and breaking-signal ticker
- WhatsApp/email alert preference modal saved to `localStorage`

## AI summarization

The backend reads `OPENROUTER_API_KEY` or `DEEPSEEK_API_KEY` from the environment. It summarizes the top-ranked articles, caches results in memory, and falls back to RSS text when a publisher blocks full-article scraping.

Optional environment variables:

```bash
set OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324
set MAX_AI_SUMMARIES=12
```

## Next real-app upgrades

- Add optional API-key integrations such as NewsAPI, GDELT, Alpha Vantage, Twelve Data, Finnhub, or a broker API
- Pull AI updates from official model/provider blogs and selected RSS feeds
- Add a backend job that ranks signals by urgency and business impact
- Send alerts through WhatsApp Cloud API/Twilio and SendGrid/Resend

## Current ranking model

Top stories are not manually selected. The backend scores each article with:

- recency
- source tier
- category priority for markets, business, AI, and startups
- impact keywords such as rates, oil, funding, crisis, regulation, IPO, and AI
- cross-source corroboration when similar headlines appear across feeds
