
---

# 🕷️ Review Scraper for G2 & Capterra

This Node.js project scrapes reviews from **G2** and **Capterra**, filters them by date, and exports the results to a structured JSON file. It uses [Crawlbase](https://crawlbase.com/dashboard/api) (formerly ScraperAPI) to avoid IP blocks and handle dynamic content.

---

## 📦 Features

- Scrape product reviews from **G2** or **Capterra**.
- Filter reviews based on a given **date range**.
- Saves results to timestamped `.json` files in the `output` folder.
- Retry logic to handle transient failures.
- Minimal setup – run from the command line.

---

## 🛠️ Installation

1. **Clone this repository**  
   ```bash
   git clone https://github.com/officialasishkumar/review-scrapper.git
   cd review-scraper
   ```

2. **Install dependencies**  
   ```bash
   npm install
   ```

3. **Create environment variables**  
   Create a `.env` file in the root directory:
   ```
   TOKEN=your_crawlbase_api_token
   ```

   Get your token from [Crawlbase Dashboard](https://crawlbase.com/dashboard/api).

4. **Create an `input.json` file**

   Example `input.json`:
   ```json
   {
     "url": "https://www.g2.com/products/example-product/reviews",
     "start_date": "2023-01-01",
     "end_date": "2023-12-31"
   }
   ```

   🔹 Supported sites:
   - `g2.com`
   - `capterra.com`

---
## 🚀 Running the Scraper

Once you've set everything up:

```bash
node scrapper.js
```

📂 Your scraped review file will be saved in the `output/` directory, named after the product and timestamped.

---

## 📌 Notes

- Make sure the input URL is correct and publicly accessible.
- The scraper respects a delay between requests to avoid bans.
- G2 reviews are paginated and collected across multiple pages.
- Capterra pulls all visible reviews from the main page only.

---
