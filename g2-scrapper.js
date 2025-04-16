const cheerio = require("cheerio");
const { CrawlingAPI } = require("crawlbase");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const api = new CrawlingAPI({ token: process.env.TOKEN });

/**
 * Parses HTML to extract product and review data.
 */
function parsedDataFromHTML(html) {
  try {
    const $ = cheerio.load(html);
    const productData = {
      productName: "",
      stars: "",
      totalReviews: "",
      allReviews: [],
    };

    productData["productName"] = $("div.product-head__title a.c-midnight-100").text();
    productData["stars"] = $("#products-dropdown .fw-semibold").first().text();
    productData["totalReviews"] = $(".filters-product h3").text();

    const paginationText = $(".pagination").text();
    const hasNextPage = paginationText.includes("Next");

    $(".nested-ajax-loading > div.paper").each((_, element) => {
      const reviewerName = $(element).find("[itemprop=author]").text();
      const stars = $(element).find("[itemprop='ratingValue']").attr("content");
      const reviewText = $(element)
        .find(".pjax")
        .text()
        .replace(/[^a-zA-Z ]/g, "");
      const reviewLink = $(element).find(".pjax").attr("href");
      const profileTitle = $(element)
        .find(".mt-4th")
        .map((_, label) => $(label).text())
        .get();
      const reviewDate = $(element).find(".x-current-review-date").text();

      productData["allReviews"].push({
        reviewerName,
        reviewText,
        stars,
        profileTitle: profileTitle.length ? profileTitle.join(" ") : "",
        reviewDate,
        reviewLink,
      });
    });

    return { productData, hasNextPage };
  } catch (error) {
    return { error };
  }
}

/**
 * Generates the proper URL for the given page number.
 */
function generatePageUrl(baseUrl, pageNum) {
  if (pageNum === 1) {
    return baseUrl;
  }

  if (baseUrl.includes('?')) {
    return `${baseUrl}&page=${pageNum}`;
  } else {
    return `${baseUrl}?page=${pageNum}`;
  }
}

/**
 * Iteratively scrapes pages while a "Next" page exists.
 */
async function scrapeAllPages(baseUrl) {
  let currentPage = 1;
  let hasNextPage = true;
  let allReviews = [];
  let productInfo = {};

  console.log(`Starting to scrape ${baseUrl}`);

  while (hasNextPage) {
    const currentUrl = generatePageUrl(baseUrl, currentPage);
    console.log(`Scraping page ${currentPage}: ${currentUrl}`);

    try {
      const response = await api.get(currentUrl);
      const parsedResult = parsedDataFromHTML(response.body);

      if (parsedResult.error) {
        console.error(`Error parsing page ${currentPage}:`, parsedResult.error);
        break;
      }

      if (currentPage === 1) {
        productInfo = {
          productName: parsedResult.productData.productName,
          stars: parsedResult.productData.stars,
          totalReviews: parsedResult.productData.totalReviews,
        };
      }

      allReviews = [...allReviews, ...parsedResult.productData.allReviews];
      console.log(`Found ${parsedResult.productData.allReviews.length} reviews on page ${currentPage}`);

      hasNextPage = parsedResult.hasNextPage;
      currentPage++;

      // Wait 30 seconds to mimic the delay between page requests.
      await new Promise(resolve => setTimeout(resolve, 30000));
    } catch (error) {
      console.error(`Failed to scrape page ${currentPage}:`, error);
      break;
    }
  }

  return {
    ...productInfo,
    allReviews,
    totalScrapedReviews: allReviews.length
  };
}

/**
 * Saves data to a JSON file in the "output" folder.
 */
function saveToJsonFile(data) {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const sanitizedProductName = data.productName
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${sanitizedProductName}_${timestamp}.json`;

  const filePath = path.join(outputDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

  return {
    filePath,
    filename
  };
}

/**
 * Filters reviews between the given start and end dates (inclusive).
 * The review dates are parsed from strings like "Jan 30, 2024".
 */
function filterReviewsByDate(reviews, startDateStr, endDateStr) {
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  return reviews.filter(review => {
    const reviewDateObj = new Date(review.reviewDate);
    // If reviewDateObj is not a valid date, you may choose to exclude it
    if (isNaN(reviewDateObj)) return false;
    return reviewDateObj >= startDate && reviewDateObj <= endDate;
  });
}

/**
 * Main function: Reads input from a JSON file, scrapes all pages,
 * filters the scraped reviews by date, saves the output JSON file,
 * and prints a summary to the console.
 */
(async () => {
  try {
    // Expect the input JSON file path as the first command line argument.
    if (process.argv.length < 3) {
      console.log("Usage: node script.js <input-json-file>");
      process.exit(1);
    }

    const inputFilePath = path.join(__dirname, 'input.json');
    const inputData = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));
    const { url, start_date, end_date } = inputData;

    if (!url || !start_date || !end_date) {
      console.error("Input JSON file must include 'url', 'start_date', and 'end_date'");
      process.exit(1);
    }

    console.log(`Starting scraping for URL: ${url}`);
    let allData = await scrapeAllPages(url);

    // Filter reviews based on the provided start and end dates.
    const filteredReviews = filterReviewsByDate(allData.allReviews, start_date, end_date);
    allData.allReviews = filteredReviews;
    allData.totalScrapedReviews = filteredReviews.length;

    // Save the final data to a JSON file.
    const fileInfo = saveToJsonFile(allData);

    console.log("Scraping complete.");
    console.log("Product Name:", allData.productName);
    console.log("Total Reviews (from the website):", allData.totalReviews);
    console.log("Scraped Reviews Count (after filtering):", allData.totalScrapedReviews);
    console.log("Output file saved to:", fileInfo.filePath);
  } catch (error) {
    console.error("Error during scraping:", error);
    process.exit(1);
  }
})();
