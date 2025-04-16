const cheerio = require("cheerio");
const { CrawlingAPI } = require("crawlbase");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const api = new CrawlingAPI({ token: process.env.TOKEN });

// Function to parse HTML
function parsedDataFromHTML(html) {
    try {
        const $ = cheerio.load(html);
        const productData = {
            productName: "",
            stars: "",
            totalReviews: "",
            allReviews: [],
        };

        productData["productName"] = $("div#productHeader > div.container > div#productHeaderInfo > div.col > h1.mb-1").text();
        productData["stars"] = $("div#productHeader > div.container > div#productHeaderInfo > div.col > div.align-items-center.d-flex > span.star-rating-component > span.d-flex > span.ms-1").text();

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

            productData["allReviews"].push({
                reviewerName,
                profileTitle,
                stars: starsText,
                reviewDate,
                reviewText,
                pros,
                cons,
            });
        });

        productData["totalReviews"] = productData["allReviews"].length.toString();

        return { productData };
    } catch (error) {
        console.error("Error parsing HTML:", error);
        return { error };
    }
}

// Function to calculate date from relative time string
function calculateDateFromRelative(relativeTimeStr) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-11

    // Parse the relative time string
    if (relativeTimeStr.includes('years ago') || relativeTimeStr.includes('year ago')) {
        const years = parseInt(relativeTimeStr);
        return new Date(currentYear - years, 0, 1); // January 1st of the year
    }
    else if (relativeTimeStr.includes('months ago') || relativeTimeStr.includes('month ago')) {
        const months = parseInt(relativeTimeStr);
        // Calculate the year and month
        let targetYear = currentYear;
        let targetMonth = currentMonth - months;

        // Adjust for negative months
        while (targetMonth < 0) {
            targetYear--;
            targetMonth += 12;
        }

        return new Date(targetYear, targetMonth, 1); // 1st day of the month
    }
    else if (relativeTimeStr.includes('days ago') || relativeTimeStr.includes('day ago')) {
        // For days, we'll use the current month's first day
        return new Date(currentYear, currentMonth, 1);
    }
    else {
        // Default to current date if format is unrecognized
        return currentDate;
    }
}

// Function to check if a review is within the specified date range
function isReviewInDateRange(reviewDateStr, startDate, endDate) {
    // Parse the review date
    const reviewDate = calculateDateFromRelative(reviewDateStr);

    // Convert string dates to Date objects
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Check if the review date is within range
    return reviewDate >= start && reviewDate <= end;
}

async function scrapeAndFilterReviews(baseUrl, startDate, endDate) {
    let allReviews = [];
    let filteredReviews = [];
    let productInfo = {};

    console.log(`Starting to scrape ${baseUrl}`);
    console.log(`Filtering reviews between ${startDate} and ${endDate}`);

    try {
        console.log(baseUrl)
        const response = await api.get(baseUrl);
        console.log(response.body);
        const parsedResult = parsedDataFromHTML(response.body);

        if (parsedResult.error) {
            console.error(`Error parsing page: `, parsedResult.error);
            return null;
        }

        // Extract product info
        productInfo = {
            productName: parsedResult.productData.productName,
            stars: parsedResult.productData.stars,
            totalReviews: parsedResult.productData.totalReviews
        };

        allReviews = parsedResult.productData.allReviews;
        console.log(`Found ${allReviews.length} total reviews`);

        // Filter reviews by date range
        filteredReviews = allReviews.filter(review =>
            isReviewInDateRange(review.reviewDate, startDate, endDate)
        );

        console.log(`${filteredReviews.length} reviews match the date range criteria`);

    } catch (error) {
        console.error(`Failed to scrape`, error);
        return null;
    }

    return {
        ...productInfo,
        allReviews: filteredReviews,
        totalScrapedReviews: filteredReviews.length
    };
}

function saveToJsonFile(data) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Remove "Reviews" suffix from product name
    let cleanProductName = data.productName.replace(/ Reviews$/i, '');

    const sanitizedProductName = cleanProductName
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

// Main function to run the script
async function main() {
    try {
        // Read input JSON file
        const inputFilePath = path.join(__dirname, 'input.json');
        if (!fs.existsSync(inputFilePath)) {
            console.error('Input file not found: input.json');
            process.exit(1);
        }

        const inputData = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));

        // Validate input data
        if (!inputData.url || !inputData.start_date || !inputData.end_date) {
            console.error('Input file must contain url, start_date, and end_date fields');
            process.exit(1);
        }

        // Validate date format (YYYY-MM-DD)
        const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateFormatRegex.test(inputData.start_date) || !dateFormatRegex.test(inputData.end_date)) {
            console.error('Dates must be in YYYY-MM-DD format');
            process.exit(1);
        }

        // Scrape and filter reviews
        const result = await scrapeAndFilterReviews(
            inputData.url,
            inputData.start_date,
            inputData.end_date
        );

        if (!result) {
            console.error('Failed to scrape data');
            process.exit(1);
        }

        // Save to JSON file
        const fileInfo = saveToJsonFile(result);
        console.log(`Scraped data saved to: ${fileInfo.filePath}`);

        // Output summary
        console.log({
            status: "Success",
            productName: result.productName,
            totalReviews: result.totalReviews,
            scrapedReviews: result.totalScrapedReviews,
            outputFile: fileInfo.filename
        });

    } catch (error) {
        console.error('Script execution failed:', error);
        process.exit(1);
    }
}

// Run the script
main();