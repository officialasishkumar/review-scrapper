const express = require("express");
const cheerio = require("cheerio");
const { CrawlingAPI } = require("crawlbase");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const api = new CrawlingAPI({ token: process.env.TOKEN });
const app = express();
const PORT = process.env.PORT || 3000;

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
      const reviewerName = $(element).find("[itemprop=author]").text(),
        stars = $(element).find("[itemprop='ratingValue']").attr("content"),
        reviewText = $(element)
          .find(".pjax")
          .text()
          .replace(/[^a-zA-Z ]/g, ""),
        reviewLink = $(element).find(".pjax").attr("href"),
        profileTitle = $(element)
          .find(".mt-4th")
          .map((_, label) => $(label).text())
          .get(),
        reviewDate = $(element).find(".x-current-review-date").text();

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
          totalReviews: parsedResult.productData.totalReviews
        };
      }

      allReviews = [...allReviews, ...parsedResult.productData.allReviews];
      console.log(`Found ${parsedResult.productData.allReviews.length} reviews on page ${currentPage}`);

      hasNextPage = parsedResult.hasNextPage;
      currentPage++;

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

app.get("/scrape", async (req, res) => {
  try {
    if (!req.query.url) {
      return res.status(400).send({ status: "Failed", msg: "URL parameter is required" });
    }

    const baseUrl = req.query.url;
    const allData = await scrapeAllPages(baseUrl);

    if (allData.productName) {
      const fileInfo = saveToJsonFile(allData);

      return res.status(200).json({
        status: "Success",
        productName: allData.productName,
        totalReviews: allData.totalReviews,
        scrapedReviews: allData.totalScrapedReviews,
        outputFile: fileInfo.filename,
        outputPath: fileInfo.filePath,
        data: allData
      });
    } else {
      return res.status(404).send({ status: "Failed", msg: "No product data found" });
    }
  } catch (error) {
    console.error("Error in scrape endpoint:", error);
    return res.status(500).send({ status: "Failed", msg: "An error occurred during scraping" });
  }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));