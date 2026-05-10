require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const sharetribe = require("sharetribe-flex-integration-sdk");

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const integrationSdk = sharetribe.createInstance({
  clientId: process.env.SHARETRIBE_CLIENT_ID,
  clientSecret: process.env.SHARETRIBE_CLIENT_SECRET,
});

function formatPrice(price) {
  return Number(price).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function slugify(text = "") {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getListingUrl(listing) {
  const title = listing.attributes?.title || "listing";
  const id = listing.id?.uuid;
  return `https://staging.ironxchange.com/l/${slugify(title)}/${id}`;
}

function getListingImages(listing) {
  const images = listing.images || [];

  const imageUrls = images
    .map(image =>
      image.attributes?.variants?.scaledLarge?.url ||
      image.attributes?.variants?.scaledMedium?.url ||
      image.attributes?.variants?.default?.url
    )
    .filter(Boolean);

  return {
    imageUrls,
    primaryImageUrl: imageUrls[0] || null,
  };
}

function getListingState(listing) {
  return (
    listing.attributes?.publicData?.state ||
    listing.attributes?.publicData?.location?.state ||
    listing.attributes?.publicData?.addressState ||
    "USA"
  );
}

function buildCaption(job) {
  return `${job.title}

Price: ${formatPrice(job.price)}
Location: ${job.state || "USA"}

View full listing:
${job.listing_url}

#IronXchange #HeavyEquipment #ConstructionEquipment`;
}

async function fetchPublishedListings() {
  const result = await integrationSdk.listings.query({
    states: ["published"],
    sort: "-createdAt",
    perPage: 25,
    include: ["images"],
    "fields.image": ["variants.scaledLarge", "variants.scaledMedium", "variants.default"],
  });

  return result.data.data || [];
}

function normalizeListing(listing) {
  const listingId = listing.id.uuid;
  const title = listing.attributes?.title || null;

  const price = listing.attributes?.price?.amount
    ? listing.attributes.price.amount / 100
    : null;

  const listingUrl = getListingUrl(listing);
  const state = getListingState(listing);
  const { imageUrls, primaryImageUrl } = getListingImages(listing);

  return {
    listingId,
    title,
    price,
    listingUrl,
    state,
    imageUrls,
    primaryImageUrl,
  };
}

app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      status: "IXI Core Running",
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({
      status: "IXI Core Error",
      error: error.message,
    });
  }
});

app.get("/setup", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_post_jobs (
        id SERIAL PRIMARY KEY,
        sharetribe_listing_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        title TEXT,
        price NUMERIC,
        listing_url TEXT,
        state TEXT,
        primary_image_url TEXT,
        image_urls JSONB,
        watermarked_image_url TEXT,
        caption TEXT,
        platform_post_id TEXT,
        platform_post_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        posted_at TIMESTAMP,
        UNIQUE (sharetribe_listing_id, platform)
      );
    `);

    await pool.query(`
      ALTER TABLE social_post_jobs
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS price NUMERIC,
      ADD COLUMN IF NOT EXISTS listing_url TEXT,
      ADD COLUMN IF NOT EXISTS state TEXT,
      ADD COLUMN IF NOT EXISTS primary_image_url TEXT,
      ADD COLUMN IF NOT EXISTS image_urls JSONB,
      ADD COLUMN IF NOT EXISTS watermarked_image_url TEXT,
      ADD COLUMN IF NOT EXISTS caption TEXT,
      ADD COLUMN IF NOT EXISTS platform_post_id TEXT,
      ADD COLUMN IF NOT EXISTS platform_post_url TEXT,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP;
    `);

    res.json({
      status: "setup complete",
      table: "social_post_jobs",
    });
  } catch (error) {
    res.status(500).json({
      status: "setup failed",
      error: error.message,
    });
  }
});

app.get("/jobs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM social_post_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `);

    res.json({
      count: result.rows.length,
      jobs: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      status: "jobs query failed",
      error: error.message,
    });
  }
});

app.get("/import-listings", async (req, res) => {
  try {
    const listings = await fetchPublishedListings();

    let imported = 0;
    let updated = 0;
    let missingPrice = 0;

    for (const listing of listings) {
      const item = normalizeListing(listing);

      if (!item.price) {
        missingPrice++;
        continue;
      }

      const caption = buildCaption({
        title: item.title,
        price: item.price,
        state: item.state,
        listing_url: item.listingUrl,
      });

      const result = await pool.query(
        `
        INSERT INTO social_post_jobs (
          sharetribe_listing_id,
          platform,
          status,
          title,
          price,
          listing_url,
          state,
          primary_image_url,
          image_urls,
          caption,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())
        ON CONFLICT (sharetribe_listing_id, platform)
        DO UPDATE SET
          title = EXCLUDED.title,
          price = EXCLUDED.price,
          listing_url = EXCLUDED.listing_url,
          state = EXCLUDED.state,
          primary_image_url = EXCLUDED.primary_image_url,
          image_urls = EXCLUDED.image_urls,
          caption = EXCLUDED.caption,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
        `,
        [
          item.listingId,
          "facebook",
          "pending",
          item.title,
          item.price,
          item.listingUrl,
          item.state,
          item.primaryImageUrl,
          JSON.stringify(item.imageUrls),
          caption,
        ]
      );

      if (result.rows[0]?.inserted) {
        imported++;
      } else {
        updated++;
      }
    }

    res.json({
      status: "import complete",
      imported,
      updated,
      missingPrice,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "import failed",
      error: error.message,
    });
  }
});

app.get("/generate-captions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM social_post_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 50
    `);

    let updated = 0;

    for (const job of result.rows) {
      if (!job.price) continue;

      const caption = buildCaption(job);

      await pool.query(
        `
        UPDATE social_post_jobs
        SET caption = $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [caption, job.id]
      );

      updated++;
    }

    res.json({
      status: "captions generated",
      updated,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "caption generation failed",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 IXI Core running on port ${PORT}`);
});
