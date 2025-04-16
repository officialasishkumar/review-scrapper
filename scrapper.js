/**
 * scraper.js
 * 
 * This unified script reads input from "input.json" (which must include fields "url", "start_date", and "end_date"),
 * then determines whether the URL belongs to G2 or Capterra and calls the appropriate scrapper.
 * 
 * Usage: node scraper.js
 */

const cheerio = require("cheerio");
const { CrawlingAPI } = require("crawlbase");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const api = new CrawlingAPI({ token: process.env.TOKEN });

/**
 * Saves the final scraped data as JSON in the output folder.
 */
function saveToJsonFile(data) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // For Capterra pages, the product name might include a " Reviews" suffix.
    let cleanProductName = data.productName.replace(/ Reviews$/i, '');
    const sanitizedProductName = cleanProductName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedProductName}_${timestamp}.json`;
    const filePath = path.join(outputDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { filePath, filename };
}

/* ======================= G2 SCRAPER FUNCTIONS ======================= */

/**
 * Parses G2 HTML to extract product and review data.
 */
function parsedDataFromHTML_G2(html) {
    try {
        const $ = cheerio.load(html);
        const productData = {
            productName: "",
            stars: "",
            totalReviews: "",
            allReviews: [],
        };

        productData.productName = $("div.product-head__title a.c-midnight-100").text();
        productData.stars = $("#products-dropdown .fw-semibold").first().text();
        productData.totalReviews = $(".filters-product h3").text();

        const paginationText = $(".pagination").text();
        const hasNextPage = paginationText.includes("Next");

        $(".nested-ajax-loading > div.paper").each((_, element) => {
            const reviewerName = $(element).find("[itemprop=author]").text();
            const stars = $(element).find("[itemprop='ratingValue']").attr("content");
            const reviewText = $(element).find(".pjax").text().replace(/[^a-zA-Z ]/g, "");
            const reviewLink = $(element).find(".pjax").attr("href");
            const profileTitle = $(element)
                .find(".mt-4th")
                .map((_, label) => $(label).text())
                .get();
            const reviewDate = $(element).find(".x-current-review-date").text();

            productData.allReviews.push({
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
 * Iteratively scrapes all G2 pages.
 */
async function scrapeAllPages_G2(baseUrl) {
    let currentPage = 1;
    let hasNextPage = true;
    let allReviews = [];
    let productInfo = {};

    console.log(`Starting to scrape ${baseUrl} (G2)`);

    while (hasNextPage) {
        const currentUrl = generatePageUrl(baseUrl, currentPage);
        console.log(`Scraping page ${currentPage}: ${currentUrl}`);

        try {
            const response = await api.get(currentUrl);
            const parsedResult = parsedDataFromHTML_G2(response.body);

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
            await new Promise(resolve => setTimeout(resolve, 25000));
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
 * Filters reviews by start and end date (inclusive).
 * Assumes that G2 review dates are in a format parseable by new Date().
 */
function filterReviewsByDate(reviews, startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    return reviews.filter(review => {
        const reviewDateObj = new Date(review.reviewDate);
        if (isNaN(reviewDateObj)) return false;
        return reviewDateObj >= startDate && reviewDateObj <= endDate;
    });
}

/* ======================= CAPTERRA SCRAPER FUNCTIONS ======================= */

/**
 * Parses Capterra HTML to extract product and review data.
 */
function parsedDataFromHTML_Capterra(html) {
    try {
        const $ = cheerio.load(html);
        const productData = {
            productName: "",
            stars: "",
            totalReviews: "",
            allReviews: [],
        };

        productData.productName = $("div#productHeader > div.container > div#productHeaderInfo > div.col > h1.mb-1").text();
        productData.stars = $("div#productHeader > div.container > div#productHeaderInfo > div.col > div.align-items-center.d-flex > span.star-rating-component > span.d-flex > span.ms-1").text();

        $("#reviews > div.review-card, div.i18n-translation_container.review-card").each((_, element) => {
            const reviewerName = $(element).find("div.ps-0 > div.fw-bold, div.col > div.h5.fw-bold").text().trim();
            const profileTitle = $(element).find("div.ps-0 > div.text-ash, div.col > div.text-ash").first().text().trim();
            const starsText = $(element).find("div.text-ash > span.ms-1, span.star-rating-component span.ms-1").text().trim();
            const reviewDate = $(element).find("div.text-ash > span.ms-2, span.ms-2").text().trim();
            const commentSection = $(element).find("p span:contains('Comments:')").parent();
            const reviewText = commentSection.find("span:not(:contains('Comments:'))").text().trim();
            const prosSection = $(element).find("p:contains('Pros:')").next();
            const pros = prosSection.text().trim();
            const consSection = $(element).find("p:contains('Cons:')").next();
            const cons = consSection.text().trim();

            productData.allReviews.push({
                reviewerName,
                profileTitle,
                stars: starsText,
                reviewDate,
                reviewText,
                pros,
                cons,
            });
        });

        productData.totalReviews = productData.allReviews.length.toString();
        return { productData };
    } catch (error) {
        console.error("Error parsing HTML:", error);
        return { error };
    }
}

/**
 * Converts a relative time string (like "2 months ago") to a Date object.
 */
function calculateDateFromRelative(relativeTimeStr) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();

    if (relativeTimeStr.includes('years ago') || relativeTimeStr.includes('year ago')) {
        const years = parseInt(relativeTimeStr);
        return new Date(currentYear - years, 0, 1);
    } else if (relativeTimeStr.includes('months ago') || relativeTimeStr.includes('month ago')) {
        const months = parseInt(relativeTimeStr);
        let targetYear = currentYear;
        let targetMonth = currentMonth - months;
        while (targetMonth < 0) {
            targetYear--;
            targetMonth += 12;
        }
        return new Date(targetYear, targetMonth, 1);
    } else if (relativeTimeStr.includes('days ago') || relativeTimeStr.includes('day ago')) {
        return new Date(currentYear, currentMonth, 1);
    } else {
        return currentDate;
    }
}

/**
 * Checks if the review's date (given as a relative time string) falls within the specified range.
 */
function isReviewInDateRange(reviewDateStr, startDate, endDate) {
    const reviewDate = calculateDateFromRelative(reviewDateStr);
    const start = new Date(startDate);
    const end = new Date(endDate);
    return reviewDate >= start && reviewDate <= end;
}

/**
 * Scrapes and filters Capterra reviews.
 */
async function scrapeAndFilterReviews_Capterra(baseUrl, startDate, endDate) {
    let allReviews = [];
    let filteredReviews = [];
    let productInfo = {};

    console.log(`Starting to scrape ${baseUrl} (Capterra)`);
    console.log(`Filtering reviews between ${startDate} and ${endDate}`);

    try {
        const response = await api.get(baseUrl);
        console.log(response.body);
        const parsedResult = parsedDataFromHTML_Capterra(response.body);

        if (parsedResult.error) {
            console.error("Error parsing page:", parsedResult.error);
            return null;
        }

        let cleanProductName = parsedResult.productData.productName.replace(/ Reviews$/i, '');
        productInfo = {
            productName: cleanProductName,
            stars: parsedResult.productData.stars,
            totalReviews: parsedResult.productData.totalReviews
        };

        allReviews = parsedResult.productData.allReviews;
        console.log(`Found ${allReviews.length} total reviews`);

        filteredReviews = allReviews.filter(review =>
            isReviewInDateRange(review.reviewDate, startDate, endDate)
        );
        console.log(`${filteredReviews.length} reviews match the date range criteria`);
    } catch (error) {
        console.error("Failed to scrape", error);
        return null;
    }

    return {
        ...productInfo,
        allReviews: filteredReviews,
        totalScrapedReviews: filteredReviews.length
    };
}

/* ======================= MAIN FUNCTION ======================= */

async function main() {
    try {
        const inputFilePath = path.join(__dirname, 'input.json');
        if (!fs.existsSync(inputFilePath)) {
            console.error("Input file not found: input.json");
            process.exit(1);
        }

        const inputData = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));
        const { url, start_date, end_date } = inputData;
        if (!url || !start_date || !end_date) {
            console.error("Input JSON file must include 'url', 'start_date', and 'end_date'");
            process.exit(1);
        }

        let result;
        // Choose the scraper based on the URL
        if (url.toLowerCase().includes('capterra')) {
            result = await scrapeAndFilterReviews_Capterra(url, start_date, end_date);
        } else if (url.toLowerCase().includes('g2')) {
            result = await scrapeAllPages_G2(url);
            // For G2 the review dates are expected to be in a parseable date format,
            // so we filter the results further based on the provided date range.
            result.allReviews = filterReviewsByDate(result.allReviews, start_date, end_date);
            result.totalScrapedReviews = result.allReviews.length;
        } else {
            console.error("Unsupported URL. Please provide a URL from either G2 or Capterra.");
            process.exit(1);
        }

        if (!result) {
            console.error("Failed to scrape data");
            process.exit(1);
        }

        

        const fileInfo = saveToJsonFile(result);
        console.log("Scraping complete.");
        console.log("Product Name:", result.productName);
        console.log("Total Reviews (from the website):", result.totalReviews);
        console.log("Scraped Reviews Count (after filtering):", result.totalScrapedReviews);
        console.log("Output file saved to:", fileInfo.filePath);
    } catch (error) {
        console.error("Error during scraping:", error);
        process.exit(1);
    }
}

main();
