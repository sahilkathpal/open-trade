import feedparser
import httpx

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

FEEDS = {
    "markets":   "https://www.livemint.com/rss/markets",
    "economy":   "https://www.livemint.com/rss/economy",
    "companies": "https://www.livemint.com/rss/companies",
    "finance":   "https://www.livemint.com/rss/money",
}


def fetch_news(category: str = "markets", limit: int = 15) -> list[dict]:
    """
    Fetch latest news from Business Standard RSS feeds.
    category: 'markets', 'economy', 'companies', or 'finance'
    limit: max number of articles to return
    """
    url = FEEDS.get(category, FEEDS["markets"])
    with httpx.Client(headers=_HEADERS, timeout=15, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
    feed = feedparser.parse(r.text)
    return [
        {
            "title":     entry.title,
            "summary":   entry.get("summary", ""),
            "published": entry.get("published", ""),
            "link":      entry.link,
        }
        for entry in feed.entries[:limit]
    ]
