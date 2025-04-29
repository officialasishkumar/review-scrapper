const cheerio = require("cheerio");
const { CrawlingAPI } = require("crawlbase");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const api = new CrawlingAPI({ token: process.env.TOKEN });

function saveToJsonFile(data) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    let cleanProductName = data.productName.replace(/ Reviews$/i, '');
    const sanitizedProductName = cleanProductName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedProductName}_${timestamp}.json`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { filePath, filename };
}

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
            const reviewDate = $(element).find("time").text();
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

function parseDate(dateStr) {
    dateStr = dateStr.trim();
    let m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) {
        const [, year, month, day] = m;
        return new Date(+year, +month - 1, +day);
    }
    m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, month, day, year] = m;
        return new Date(+year, +month - 1, +day);
    }
    return new Date(dateStr);
}

function filterReviewsByDate(reviews, startDateStr, endDateStr) {
    const start = parseDate(startDateStr);
    const end = parseDate(endDateStr);
    return reviews.filter(review => {
        const rd = parseDate(review.reviewDate);
        return !isNaN(rd) && rd >= start && rd <= end;
    });
}

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
            let parsedResult, response;
            for (let attempt = 1; attempt <= 5; attempt++) {
                response = await api.get(currentUrl);
                parsedResult = parsedDataFromHTML_G2(response.body);
                if (parsedResult.error) {
                    console.error(`Error parsing page ${currentPage}:`, parsedResult.error);
                    break;
                }
                if (parsedResult.productData.allReviews.length > 0) break;
                console.warn(`Attempt ${attempt} for page ${currentPage} returned 0 reviews—retrying...`);
                await new Promise(r => setTimeout(r, 5000));
            }
            if (parsedResult.error) {
                console.error(`Failed parsing after retries on page ${currentPage}.`);
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
        return { error };
    }
}

function calculateDateFromRelative(relativeTimeStr) {
    const currentDate = new Date();
    const lowerStr = relativeTimeStr.toLowerCase();
    if (lowerStr.includes('year')) {
        const years = parseInt(relativeTimeStr);
        return new Date(currentDate.getFullYear() - years, currentDate.getMonth(), currentDate.getDate());
    } else if (lowerStr.includes('month')) {
        const months = parseInt(relativeTimeStr);
        let newMonth = currentDate.getMonth() - months;
        let newYear = currentDate.getFullYear();
        while (newMonth < 0) {
            newMonth += 12;
            newYear--;
        }
        return new Date(newYear, newMonth, currentDate.getDate());
    } else if (lowerStr.includes('day')) {
        const days = parseInt(relativeTimeStr);
        const resultDate = new Date(currentDate);
        resultDate.setDate(resultDate.getDate() - days);
        return resultDate;
    } else {
        return new Date(relativeTimeStr);
    }
}

function isReviewInDateRange(reviewDateStr, startDate, endDate) {
    const reviewDate = calculateDateFromRelative(reviewDateStr);
    const start = new Date(startDate);
    const end = new Date(endDate);
    return reviewDate >= start && reviewDate <= end;
}

async function scrapeAndFilterReviews_Capterra(baseUrl, startDate, endDate) {
    let allReviews = [];
    let filteredReviews = [];
    let productInfo = {};
    try {
        let parsedResult, response;
        for (let attempt = 1; attempt <= 5; attempt++) {
            response = await api.get(baseUrl);
            parsedResult = parsedDataFromHTML_Capterra(response.body);
            if (parsedResult.error) {
                return null;
            }
            if (parsedResult.productData.allReviews.length > 0) break;
            await new Promise(r => setTimeout(r, 5000));
        }
        let cleanProductName = parsedResult.productData.productName.replace(/ Reviews$/i, '');
        productInfo = {
            productName: cleanProductName,
            stars: parsedResult.productData.stars,
            totalReviews: parsedResult.productData.totalReviews
        };
        allReviews = parsedResult.productData.allReviews;
        filteredReviews = allReviews.filter(review =>
            isReviewInDateRange(review.reviewDate, startDate, endDate)
        );
    } catch {
        return null;
    }
    return {
        ...productInfo,
        allReviews: filteredReviews,
        totalScrapedReviews: filteredReviews.length
    };
}

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
        if (url.toLowerCase().includes('capterra')) {
            result = await scrapeAndFilterReviews_Capterra(url, start_date, end_date);
        } else if (url.toLowerCase().includes('g2')) {
            result = await scrapeAllPages_G2(url);
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
