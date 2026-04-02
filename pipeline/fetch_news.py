import feedparser
import asyncio
import google.generativeai as genai
from typing import List, Dict
import logging
from db import upsert_news, get_existing_news_urls
from config import config

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

RSS_FEEDS = [
    "https://www.moneycontrol.com/rss/marketreports.xml",
    "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "https://www.business-standard.com/rss/markets-106.rss",
]

SENTIMENT_PROMPT = """
Analyze the following news article and provide:
1. Sentiment: positive, negative, or neutral
2. Sentiment score: a float between -1 (very negative) and 1 (very positive)
3. Related symbols: list of stock symbols mentioned (e.g., RELIANCE.NS, TCS.NS), empty list if none

Article Title: {title}
Article Summary: {summary}

Respond in JSON format:
{{
  "sentiment": "positive|negative|neutral",
  "sentiment_score": 0.5,
  "related_symbols": ["SYMBOL1.NS", "SYMBOL2.NS"]
}}
"""

genai.configure(api_key=config.gemini_api_key)
model = genai.GenerativeModel('gemini-1.5-flash')

async def analyze_sentiment_batch(articles: List[Dict]) -> List[Dict]:
    """Analyze sentiment for a batch of articles using Gemini."""
    results = []
    for article in articles:
        prompt = SENTIMENT_PROMPT.format(title=article['title'], summary=article.get('summary', ''))
        try:
            response = model.generate_content(prompt)
            # Parse JSON response
            import json
            data = json.loads(response.text.strip())
            results.append({
                **article,
                'sentiment': data.get('sentiment', 'neutral'),
                'sentiment_score': data.get('sentiment_score', 0.0),
                'related_symbols': data.get('related_symbols', [])
            })
        except Exception as e:
            logger.error(f"Failed to analyze article {article['title']}: {e}")
            results.append({
                **article,
                'sentiment': 'neutral',
                'sentiment_score': 0.0,
                'related_symbols': []
            })
    return results

async def fetch_news() -> None:
    """Fetch and process news from RSS feeds."""
    existing_urls = get_existing_news_urls()
    logger.info(f"Found {len(existing_urls)} existing news URLs")

    all_articles = []
    for feed_url in RSS_FEEDS:
        logger.info(f"Parsing feed: {feed_url}")
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries:
                url = entry.link
                if url in existing_urls:
                    continue
                article = {
                    'headline': entry.title,
                    'summary': getattr(entry, 'summary', ''),
                    'url': url,
                    'published_at': getattr(entry, 'published', None)
                }
                all_articles.append(article)
        except Exception as e:
            logger.error(f"Failed to parse feed {feed_url}: {e}")

    logger.info(f"Found {len(all_articles)} new articles")

    # Process in batches of 25
    batch_size = 25
    for i in range(0, len(all_articles), batch_size):
        batch = all_articles[i:i+batch_size]
        logger.info(f"Processing batch {i//batch_size + 1}")

        analyzed_batch = await analyze_sentiment_batch(batch)

        # Upsert
        upsert_news(analyzed_batch)
        logger.info(f"Upserted {len(analyzed_batch)} articles")

        # Rate limit
        if i + batch_size < len(all_articles):
            await asyncio.sleep(4)

if __name__ == "__main__":
    asyncio.run(fetch_news())