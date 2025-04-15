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


async function scrapeAllPages(baseUrl) {
    let allReviews = [];
    let productInfo = {};

    console.log(`Starting to scrape ${baseUrl}`);

    console.log(`Scraping page: ${baseUrl}`);

    try {
        const response = await api.get(baseUrl);
        const parsedResult = parsedDataFromHTML(response.body);

        if (parsedResult.error) {
            console.error(`Error parsing page: `, parsedResult.error);
        }

        productInfo = {
            productName: parsedResult.productData.productName,
            stars: parsedResult.productData.stars,
            totalReviews: parsedResult.productData.totalReviews
        };

        allReviews = [...allReviews, ...parsedResult.productData.allReviews];
        console.log(`Found ${parsedResult.productData.allReviews.length} reviews`);


    } catch (error) {
        console.error(`Failed to scrape`, error);
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

        console.log(allData["productName"])

        if (allData.productName) {
            const fileInfo = saveToJsonFile(allData);

            return res.status(200).json({
                status: "Success",
                productName: allData.productName,
                totalReviews: allData.totalScrapedReviews,
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