const state = {
  articles: [],
  markets: [],
  category: "all",
  query: ""
};

const categoryMap = {
  world: "World",
  business: "Business",
  technology: "Technology",
  markets: "Markets",
  ai: "AI",
  startup: "Startups"
};

const severityRank = {
  high: 3,
  medium: 2,
  low: 1
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function timeAgo(dateString) {
  const timestamp = new Date(dateString).getTime();
  if (Number.isNaN(timestamp)) return "recently";

  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day ago`;
}

function formatDate() {
  $("#dateLine").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatPrice(value, currency = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const number = Number(value);
  const digits = Math.abs(number) >= 1000 ? 2 : 4;
  return `${currency ? `${currency} ` : ""}${number.toLocaleString(undefined, {
    maximumFractionDigits: digits
  })}`;
}

function getFilteredArticles() {
  const query = state.query.trim().toLowerCase();

  return state.articles
    .filter((article) => {
      if (state.category === "all") return true;
      if (state.category === "markets") return ["markets", "business"].includes(article.category);
      return article.category === state.category;
    })
    .filter((article) => {
      const searchable = `${article.title} ${article.aiSummary || article.summary} ${article.source} ${article.categoryLabel}`.toLowerCase();
      return !query || searchable.includes(query);
    })
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff) return scoreDiff;
      const severityDiff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
      if (severityDiff) return severityDiff;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
}

function articleMeta(article) {
  return `
    <div class="story-meta">
      <span class="source">${escapeHtml(article.source || article.categoryLabel)}</span>
      <span>${escapeHtml(timeAgo(article.publishedAt))}</span>
      <span class="tag ${escapeHtml(article.severity)}">${escapeHtml(article.severity || "signal")}</span>
      <span class="tag">score ${escapeHtml(article.score ?? "--")}</span>
      <span class="tag">${escapeHtml(article.summaryProvider || "summary")}</span>
    </div>
  `;
}

function summaryBlock(article, fallbackText) {
  const provider = article.summaryProvider || "summary";
  const label = provider.startsWith("deepseek") ? "AI summary" : "Summary";
  return `
    <div class="summary-block ${provider.startsWith("deepseek") ? "is-ai" : ""}">
      <span class="summary-label">${escapeHtml(label)} · ${escapeHtml(provider)}</span>
      <p>${escapeHtml(article.aiSummary || article.summary || fallbackText)}</p>
    </div>
  `;
}

function renderFeatured(articles) {
  if (!articles.length) {
    $("#featuredStory").innerHTML = `<p class="empty">No real news links matched this filter. Try another topic or refresh.</p>`;
    $("#storyList").innerHTML = "";
    return;
  }

  const featured = articles.find((article) => article.imageUrl) || articles[0];
  const rest = articles.filter((article) => article.id !== featured.id);
  $("#featuredStory").classList.remove("skeleton");
  const featuredImage = featured.imageUrl
    ? `<img src="${escapeHtml(featured.imageUrl)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  const visualCategory = featured.category || "world";
  const visualLabel = categoryMap[visualCategory] || featured.categoryLabel || "Signal";

  $("#featuredStory").innerHTML = `
    <article class="hero-card">
      <a class="story-visual ${featured.imageUrl ? "has-image" : "has-placeholder"} visual-${escapeHtml(visualCategory)}" href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(featured.title)}">
        ${featuredImage}
        <span class="visual-label">${escapeHtml(visualLabel)}</span>
      </a>
      <div>
        <span class="source">${escapeHtml(categoryMap[featured.category] || featured.categoryLabel)}</span>
        <a class="story-title" href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(featured.title)}</a>
        ${summaryBlock(featured, "Open the source link for the full story.").replace("summary-block", "summary-block story-summary-block")}
        ${articleMeta(featured)}
      </div>
    </article>
  `;

  $("#storyList").innerHTML = rest.slice(0, 5).map((article) => `
    <article class="story-row">
      ${articleMeta(article)}
      <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
      ${summaryBlock(article, "Read the full source story.")}
    </article>
  `).join("");
}

function renderPicks(articles) {
  const picks = articles
    .filter((article) => ["ai", "startup", "markets", "business"].includes(article.category))
    .slice(0, 3);

  $("#picksList").innerHTML = picks.length ? picks.map((article) => `
    <article class="pick-row">
      ${articleMeta(article)}
      <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
      ${summaryBlock(article, "Open source for full context.")}
    </article>
  `).join("") : `<p class="empty">No opportunity picks available yet.</p>`;
}

function renderMarkets() {
  const validMarkets = state.markets.filter((market) => market.price !== null);
  const upCount = validMarkets.filter((market) => (market.changePercent || 0) >= 0).length;
  const moodPercent = validMarkets.length ? Math.round((upCount / validMarkets.length) * 100) : 0;

  $("#marketMood").textContent = moodPercent >= 60 ? `Bullish ${moodPercent}%` : moodPercent >= 40 ? `Mixed ${moodPercent}%` : `Risk-off ${moodPercent}%`;
  $("#marketSubtext").textContent = validMarkets.length ? `${validMarkets.length} live instruments tracked` : "Market data unavailable";
  $("#pulseScore").textContent = `${moodPercent || "--"}${moodPercent ? "%" : ""}`;
  $("#marketCount").textContent = validMarkets.length;

  $("#marketList").innerHTML = validMarkets.length ? validMarkets.map((market) => {
    const change = Number(market.changePercent || 0);
    const direction = change >= 0 ? "up" : "down";
    const sign = change >= 0 ? "+" : "";

    return `
      <article class="market-row">
        <div>
          <span class="market-symbol">${escapeHtml(market.label)}</span>
          <p class="market-label">${escapeHtml(market.type)} · ${escapeHtml(market.symbol)}</p>
        </div>
        <div class="market-price">
          ${escapeHtml(formatPrice(market.price, market.currency))}
          <span class="market-change ${direction}">${sign}${change.toFixed(2)}%</span>
        </div>
      </article>
    `;
  }).join("") : `<p class="empty">Market feed did not return data. Try refreshing.</p>`;
}

function renderMetrics(articles) {
  $("#articleCount").textContent = state.articles.length;
  $("#highCount").textContent = articles.filter((article) => article.severity === "high").length;
}

function renderAll() {
  const filtered = getFilteredArticles();
  renderFeatured(filtered);
  renderPicks(filtered);
  renderMarkets();
  renderMetrics(filtered);
}

function setStatus(text, isLive = false) {
  const status = $("#backendStatus");
  status.textContent = text;
  status.classList.toggle("is-live", isLive);
}

async function loadBriefing() {
  setStatus("Fetching feeds");
  $("#featuredStory").innerHTML = `<p class="loading">Loading real news links and market data...</p>`;

  try {
    const briefing = await fetchBriefingData();

    state.articles = briefing.news?.articles || [];
    state.markets = briefing.markets?.markets || [];

    const newsErrors = briefing.news?.errors || [];
    const marketErrors = briefing.markets?.errors || [];
    const hasErrors = newsErrors.length || marketErrors.length;

    setStatus(hasErrors ? "Partial live" : "Live", !hasErrors);
    const sourceCount = new Set(state.articles.map((article) => article.source)).size;
    $("#sourceBadge").textContent = `${sourceCount} sources · rank-v2`;
    $("#marketProvider").textContent = briefing.markets?.provider || "Yahoo Finance";
    $("#lastUpdated").textContent = new Date(briefing.generatedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    renderAll();
  } catch (error) {
    setStatus("Offline");
    $("#featuredStory").innerHTML = `
      <p class="empty">Could not reach the SignalStack backend: ${escapeHtml(error.message)}.</p>
    `;
    $("#storyList").innerHTML = "";
    $("#picksList").innerHTML = `<p class="empty">No live picks until feeds recover.</p>`;
    $("#marketList").innerHTML = `<p class="empty">No market data until feeds recover.</p>`;
  }
}

async function fetchBriefingData() {
  const apiPath = `${location.origin}/api/briefing?ts=${Date.now()}`;
  const staticPath = `${new URL("api/briefing.json", location.href).href}?ts=${Date.now()}`;

  try {
    const response = await fetch(apiPath);
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    return await response.json();
  } catch (error) {
    const fallback = await fetch(staticPath);
    if (!fallback.ok) throw error;
    const data = await fallback.json();
    data.generatedAt = data.generatedAt || new Date().toISOString();
    return data;
  }
}

function loadAlertPrefs() {
  const prefs = JSON.parse(localStorage.getItem("signalStackAlerts") || "null");
  if (!prefs) return;

  $("#emailInput").value = prefs.email || "";
  $("#whatsappInput").value = prefs.whatsapp || "";
  $("#enableAlertsInput").checked = Boolean(prefs.enableAlerts);
  $("#alertStatus").textContent = prefs.enableAlerts ? "On" : "Off";
}

function bindEvents() {
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderAll();
  });

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((item) => item.classList.remove("is-active"));
      tab.classList.add("is-active");
      state.category = tab.dataset.category;
      renderAll();
    });
  });

  $("#refreshBtn").addEventListener("click", async () => {
    $("#refreshBtn").classList.add("is-spinning");
    await loadBriefing();
    $("#refreshBtn").classList.remove("is-spinning");
  });

  $("#alertsBtn").addEventListener("click", () => {
    $("#alertsModal").hidden = false;
    $("#emailInput").focus();
  });

  $("#closeModal").addEventListener("click", () => {
    $("#alertsModal").hidden = true;
  });

  $("#alertsModal").addEventListener("click", (event) => {
    if (event.target === $("#alertsModal")) $("#alertsModal").hidden = true;
  });

  $("#alertsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const prefs = {
      email: $("#emailInput").value,
      whatsapp: $("#whatsappInput").value,
      enableAlerts: $("#enableAlertsInput").checked
    };

    localStorage.setItem("signalStackAlerts", JSON.stringify(prefs));
    $("#alertStatus").textContent = prefs.enableAlerts ? "On" : "Off";
    $("#formStatus").textContent = "Preferences saved locally.";
    setTimeout(() => {
      $("#alertsModal").hidden = true;
      $("#formStatus").textContent = "";
    }, 650);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") $("#alertsModal").hidden = true;
  });
}

formatDate();
loadAlertPrefs();
bindEvents();
loadBriefing();
