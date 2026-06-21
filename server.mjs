import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4174);
const root = process.cwd();
const cache = new Map();
const summaryCache = new Map();
const cacheTtlMs = 5 * 60 * 1000;
const maxAiSummaries = Number(process.env.MAX_AI_SUMMARIES || 18);
const openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat-v3-0324";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const newsFeeds = [
  { provider: "BBC", category: "world", label: "World", tier: 9, url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { provider: "BBC", category: "business", label: "Business", tier: 9, url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { provider: "BBC", category: "technology", label: "Technology", tier: 9, url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { provider: "The Guardian", category: "world", label: "World", tier: 8, url: "https://www.theguardian.com/world/rss" },
  { provider: "The Guardian", category: "business", label: "Business", tier: 8, url: "https://www.theguardian.com/business/rss" },
  { provider: "The Guardian", category: "technology", label: "Technology", tier: 8, url: "https://www.theguardian.com/technology/rss" },
  { provider: "The New York Times", category: "world", label: "World", tier: 9, url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { provider: "The New York Times", category: "business", label: "Business", tier: 9, url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { provider: "The New York Times", category: "technology", label: "Technology", tier: 9, url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml" },
  { provider: "Al Jazeera", category: "world", label: "World", tier: 8, url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { provider: "NPR", category: "world", label: "World", tier: 7, url: "https://feeds.npr.org/1001/rss.xml" },
  { provider: "NPR", category: "business", label: "Business", tier: 7, url: "https://feeds.npr.org/1006/rss.xml" },
  { provider: "CNBC", category: "business", label: "Business", tier: 8, url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { provider: "CNBC", category: "markets", label: "Markets", tier: 8, url: "https://www.cnbc.com/id/19854910/device/rss/rss.html" },
  { provider: "MarketWatch", category: "markets", label: "Markets", tier: 7, url: "https://www.marketwatch.com/rss/topstories" },
  { provider: "TechCrunch", category: "startup", label: "Startups", tier: 7, url: "https://techcrunch.com/feed/" },
  { provider: "VentureBeat", category: "ai", label: "AI", tier: 7, url: "https://venturebeat.com/feed/" },
  { provider: "The Verge", category: "technology", label: "Technology", tier: 7, url: "https://www.theverge.com/rss/index.xml" },
  { provider: "Google News", category: "markets", label: "Markets", tier: 6, url: "https://news.google.com/rss/search?q=stock%20market%20OR%20economy%20OR%20business&hl=en-IN&gl=IN&ceid=IN:en" },
  { provider: "Google News", category: "ai", label: "AI", tier: 6, url: "https://news.google.com/rss/search?q=artificial%20intelligence%20OR%20OpenAI%20OR%20AI%20startup&hl=en-IN&gl=IN&ceid=IN:en" },
  { provider: "Google News", category: "startup", label: "Startups", tier: 6, url: "https://news.google.com/rss/search?q=startup%20funding%20India%20OR%20venture%20capital%20startup&hl=en-IN&gl=IN&ceid=IN:en" }
];

const rankingModel = {
  version: "signalstack-rank-v2",
  factors: [
    "recency: newer stories score higher, decaying across 48 hours",
    "sourceTier: established publishers and specialist market/tech sources get more weight",
    "categoryPriority: markets, business, AI, and startups are boosted for SignalStack's opportunity lens",
    "impactKeywords: war, rates, inflation, funding, regulation, IPO, oil, and market-shock terms add urgency",
    "crossSourceCluster: similar headlines across multiple sources get a corroboration boost"
  ]
};

const marketSymbols = [
  { symbol: "^NSEI", label: "Nifty 50", type: "Index" },
  { symbol: "^BSESN", label: "Sensex", type: "Index" },
  { symbol: "^GSPC", label: "S&P 500", type: "Index" },
  { symbol: "^IXIC", label: "Nasdaq", type: "Index" },
  { symbol: "BTC-USD", label: "Bitcoin", type: "Crypto" },
  { symbol: "ETH-USD", label: "Ethereum", type: "Crypto" },
  { symbol: "CL=F", label: "Crude Oil", type: "Commodity" },
  { symbol: "GC=F", label: "Gold", type: "Commodity" },
  { symbol: "USDINR=X", label: "USD/INR", type: "FX" }
];

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.createdAt < cacheTtlMs) {
    return Promise.resolve({ ...hit.value, cached: true });
  }

  return loader().then((value) => {
    cache.set(key, { createdAt: Date.now(), value });
    return { ...value, cached: false };
  });
}

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities(match?.[1] || "");
}

function readAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}\\s[^>]*${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return decodeEntities(match?.[1] || "");
}

function parseRss(xml, feed) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];

  return items.slice(0, 14).map((match, index) => {
    const item = match[0];
    const rawTitle = readTag(item, "title");
    const link = readTag(item, "link");
    const pubDate = readTag(item, "pubDate");
    const description = readTag(item, "description");
    const source = readTag(item, "source") || readAttr(item, "source", "url") || feed.label;
    const title = cleanArticleTitle(rawTitle, source);
    const imageUrl = readImageUrl(item);
    const timestamp = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

    return {
      id: `${feed.category}-${index}-${Buffer.from(link || title).toString("base64url").slice(0, 10)}`,
      category: feed.category,
      categoryLabel: feed.label,
      title,
      url: link,
      source: normalizeSource(source, feed.provider),
      feedProvider: feed.provider,
      sourceTier: feed.tier,
      summary: summarizeText(cleanArticleSummary(description), 260),
      imageUrl,
      publishedAt: timestamp,
      severity: "low"
    };
  }).filter((item) => item.title && item.url && !isBlockedArticle(item));
}

function readImageUrl(item) {
  const candidates = [
    readAttr(item, "media:thumbnail", "url"),
    readAttr(item, "media:content", "url"),
    readAttr(item, "enclosure", "url"),
    readAttr(item, "image", "url"),
    readDescriptionImage(item)
  ].filter(Boolean);

  return candidates.find((url) => /^https?:\/\//i.test(url)) || "";
}

function readDescriptionImage(item) {
  const description = item.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1] || "";
  const decoded = description
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const match = decoded.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || "";
}

function normalizeSource(source, provider) {
  const clean = source.replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
  return clean || provider;
}

function cleanArticleTitle(title, source) {
  let clean = title.trim();
  const endings = [source, "instagram.com", "YouTube", "Facebook", "X", "LinkedIn"].filter(Boolean);

  for (const ending of endings) {
    clean = clean.replace(new RegExp(`\\s+-\\s+${escapeRegExp(ending)}$`, "i"), "");
  }

  return clean.replace(/\s+/g, " ").trim();
}

function cleanArticleSummary(summary) {
  return summary
    .replace(/\s+-\s+[^-]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(text, maxLength) {
  const clean = text
    .replace(/\b(CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxLength) return clean;

  const slice = clean.slice(0, maxLength);
  const lastSentence = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("?"), slice.lastIndexOf("!"));
  const lastSpace = slice.lastIndexOf(" ");
  const cutAt = lastSentence > 90 ? lastSentence + 1 : lastSpace;

  return `${slice.slice(0, cutAt).trim()}...`;
}

function truncateWords(text, maxWords = 100) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function isBlockedArticle(article) {
  const text = `${article.title} ${article.url} ${article.source}`.toLowerCase();
  const blocked = [
    "instagram.com",
    "facebook.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "reddit.com"
  ];

  return blocked.some((site) => text.includes(site));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deDupeArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const key = article.url || article.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleFingerprint(title) {
  const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "over", "after", "about", "your", "are", "has", "have", "will"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word))
    .slice(0, 7)
    .sort()
    .join("-");
}

function clusterArticles(articles) {
  const clusters = new Map();

  for (const article of articles) {
    const key = titleFingerprint(article.title);
    if (!key) continue;
    clusters.set(key, (clusters.get(key) || 0) + 1);
  }

  return articles.map((article) => ({
    ...article,
    clusterSize: clusters.get(titleFingerprint(article.title)) || 1
  }));
}

function scoreArticle(article) {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  const ageHours = Math.max(0, (Date.now() - new Date(article.publishedAt).getTime()) / 36e5);
  const recencyScore = Math.max(0, 30 - ageHours * 0.9);
  const sourceScore = (article.sourceTier || 5) * 2.4;
  const categoryScore = {
    markets: 16,
    business: 14,
    ai: 14,
    startup: 14,
    technology: 10,
    world: 9
  }[article.category] || 6;
  const impactScore = keywordScore(text, [
    "war", "attack", "crisis", "ceasefire", "sanction", "tariff", "rate cut", "rate hike",
    "inflation", "recession", "oil", "crude", "fed", "central bank", "market", "stocks",
    "shares", "ipo", "funding", "acquisition", "merger", "regulation", "ban", "lawsuit",
    "breakthrough", "openai", "artificial intelligence", "semiconductor", "supply chain"
  ], 3.5, 28);
  const opportunityScore = keywordScore(text, [
    "startup", "funding", "venture", "ai", "automation", "india", "smb", "fintech",
    "manufacturing", "logistics", "payments", "saas", "electric vehicle", "ev"
  ], 2.2, 18);
  const clusterScore = Math.min(14, Math.max(0, (article.clusterSize || 1) - 1) * 5);
  const noisePenalty = relevancePenalty(text, impactScore + opportunityScore, article.category);
  const score = Math.max(0, Math.round(recencyScore + sourceScore + categoryScore + impactScore + opportunityScore + clusterScore - noisePenalty));

  return {
    ...article,
    score,
    severity: score >= 78 ? "high" : score >= 55 ? "medium" : "low",
    scoreBreakdown: {
      recency: Math.round(recencyScore),
      source: Math.round(sourceScore),
      category: Math.round(categoryScore),
      impact: Math.round(impactScore),
      opportunity: Math.round(opportunityScore),
      corroboration: Math.round(clusterScore),
      noisePenalty: Math.round(noisePenalty)
    }
  };
}

function keywordScore(text, keywords, points, cap) {
  const hits = keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  return Math.min(cap, hits * points);
}

function relevancePenalty(text, signalScore, category) {
  const lowSignalWords = [
    "celebrity", "recipe", "cooking", "restaurant", "fashion", "dating", "parenting",
    "movie", "film", "music", "sports", "football", "podcast", "television", "tv",
    "horoscope", "wedding", "travel", "holiday", "garden"
  ];
  const lowSignalHits = lowSignalWords.filter((word) => text.includes(word)).length;
  const lowSignalPenalty = Math.min(28, lowSignalHits * 9);
  const weakBusinessPenalty = signalScore < 6 && ["business", "technology"].includes(category) ? 14 : 0;

  return lowSignalPenalty + weakBusinessPenalty;
}

async function fetchNews() {
  const settled = await Promise.allSettled(newsFeeds.map(async (feed) => {
    const response = await fetch(feed.url, {
      headers: { "User-Agent": "SignalStackDashboard/1.0" }
    });

    if (!response.ok) throw new Error(`${feed.label} feed failed with ${response.status}`);
    const xml = await response.text();
    return parseRss(xml, feed);
  }));

  const rawArticles = deDupeArticles(settled.flatMap((result) => (
    result.status === "fulfilled" ? result.value : []
  )));

  const articles = clusterArticles(rawArticles)
    .map(scoreArticle)
    .sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));

  const summarizedArticles = await enrichArticleSummaries(articles);

  const errors = settled
    .map((result, index) => result.status === "rejected" ? `${newsFeeds[index].label}: ${result.reason.message}` : null)
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    articles: summarizedArticles,
    errors,
    rankingModel,
    summaryModel: {
      enabled: Boolean(openRouterApiKey),
      provider: "OpenRouter",
      model: openRouterModel,
      maxWords: 100,
      summarizedTopArticles: openRouterApiKey ? Math.min(maxAiSummaries, articles.length) : 0
    },
    sources: newsFeeds.map((feed) => ({
      provider: feed.provider,
      category: feed.category,
      label: feed.label,
      tier: feed.tier
    }))
  };
}

async function enrichArticleSummaries(articles) {
  if (!openRouterApiKey) {
    return articles.map((article) => ({
      ...article,
      aiSummary: truncateWords(article.summary, 100),
      summaryProvider: "local"
    }));
  }

  const enriched = [...articles];
  const targetIndexes = enriched
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => article.url && article.title)
    .slice(0, maxAiSummaries);

  const concurrency = 3;
  let cursor = 0;

  async function worker() {
    while (cursor < targetIndexes.length) {
      const current = targetIndexes[cursor];
      cursor += 1;
      enriched[current.index] = await summarizeArticle(current.article);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  return enriched.map((article) => ({
    ...article,
    aiSummary: article.aiSummary || truncateWords(article.summary, 100),
    summaryProvider: article.summaryProvider || "local"
  }));
}

async function summarizeArticle(article) {
  const cacheKey = `${article.url}|${article.title}`;
  const cached = summaryCache.get(cacheKey);
  if (cached) return { ...article, ...cached };

  try {
    let content = "";
    let usedFallbackContent = false;
    try {
      content = await fetchArticleText(article.url);
    } catch {
      content = article.summary || article.title;
      usedFallbackContent = true;
    }
    const sourceText = content || article.summary || article.title;
    const aiSummary = await callAiSummary({
      title: article.title,
      source: article.source,
      url: article.url,
      content: sourceText
    });
    const result = {
      aiSummary: truncateWords(aiSummary, 100),
      summaryProvider: usedFallbackContent ? "deepseek-rss" : "deepseek"
    };
    summaryCache.set(cacheKey, result);
    return { ...article, ...result };
  } catch (error) {
    const result = {
      aiSummary: truncateWords(article.summary, 100),
      summaryProvider: "local-fallback",
      summaryError: error.message
    };
    summaryCache.set(cacheKey, result);
    return { ...article, ...result };
  }
}

async function fetchArticleText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 SignalStackDashboard/1.0",
      "Accept": "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(9000)
  });

  if (!response.ok) throw new Error(`article fetch failed ${response.status}`);
  const html = await response.text();
  return extractReadableText(html);
}

function extractReadableText(html) {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const articleMatch = noScripts.match(/<article[\s\S]*?<\/article>/i)?.[0] || noScripts;
  const paragraphs = [...articleMatch.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((match) => decodeEntities(match[1]))
    .filter((text) => text.length > 50);
  const text = (paragraphs.length ? paragraphs.join(" ") : decodeEntities(articleMatch))
    .replace(/\s+/g, " ")
    .trim();

  if (!text) throw new Error("no readable article text");
  return text.slice(0, 9000);
}

async function callAiSummary({ title, source, url, content }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:4174",
      "X-Title": "SignalStack Dashboard"
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: 0.2,
      max_tokens: 170,
      messages: [
        {
          role: "system",
          content: "You summarize news articles for a serious financial/news terminal. Write one factual paragraph under 100 words. Do not invent facts. Do not add bullets. Do not mention that you are an AI."
        },
        {
          role: "user",
          content: `Title: ${title}\nSource: ${source}\nURL: ${url}\n\nArticle text:\n${content}`
        }
      ]
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`summary API failed ${response.status}: ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("summary API returned no content");
  return summary;
}

async function fetchMarketSymbol(item) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?interval=1d&range=5d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "SignalStackDashboard/1.0" }
  });

  if (!response.ok) throw new Error(`${item.symbol} failed with ${response.status}`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error(`${item.symbol} returned no chart metadata`);

  const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
  const previous = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = price !== null && previous !== null ? price - previous : null;
  const changePercent = change !== null && previous ? (change / previous) * 100 : null;

  return {
    symbol: item.symbol,
    label: item.label,
    type: item.type,
    exchange: meta.exchangeName || "",
    currency: meta.currency || "",
    price,
    previous,
    change,
    changePercent,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

async function fetchMarkets() {
  const settled = await Promise.allSettled(marketSymbols.map(fetchMarketSymbol));
  const markets = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const errors = settled
    .map((result, index) => result.status === "rejected" ? `${marketSymbols[index].symbol}: ${result.reason.message}` : null)
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    markets,
    errors,
    provider: "Yahoo Finance chart endpoint"
  };
}

async function handleApi(pathname, response) {
  try {
    if (pathname === "/api/sources") {
      return json(response, 200, {
        generatedAt: new Date().toISOString(),
        rankingModel,
        feeds: newsFeeds.map((feed) => ({
          provider: feed.provider,
          category: feed.category,
          label: feed.label,
          tier: feed.tier,
          url: feed.url
        })),
        markets: marketSymbols
      });
    }

    if (pathname === "/api/news") {
      return json(response, 200, await cached("news", fetchNews));
    }

    if (pathname === "/api/markets") {
      return json(response, 200, await cached("markets", fetchMarkets));
    }

    if (pathname === "/api/briefing") {
      const [news, markets] = await Promise.all([
        cached("news", fetchNews),
        cached("markets", fetchMarkets)
      ]);

      return json(response, 200, {
        generatedAt: new Date().toISOString(),
        news,
        markets
      });
    }

    return json(response, 404, { error: "Unknown API route" });
  } catch (error) {
    return json(response, 500, {
      error: "SignalStack backend error",
      detail: error.message
    });
  }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(url.pathname, response);
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(root, pathname));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`SignalStack running at http://127.0.0.1:${port}/`);
});
