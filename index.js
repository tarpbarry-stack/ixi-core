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
        caption TEXT,
        platform_post_id TEXT,
        platform_post_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        posted_at TIMESTAMP,
        UNIQUE (sharetribe_listing_id, platform)
      );
    `);

    await pool.query(`
      ALTER TABLE social_post_jobs
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS price NUMERIC,
      ADD COLUMN IF NOT EXISTS listing_url TEXT;
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
    const result = await integrationSdk.listings.query({
      states: ["published"],
      sort: "-createdAt",
      perPage: 25,
    });

    const listings = result.data.data;

    let imported = 0;
    let skipped = 0;

    for (const listing of listings) {
      const listingId = listing.id.uuid;

      const existing = await pool.query(
        `
        SELECT id
        FROM social_post_jobs
        WHERE sharetribe_listing_id = $1
        AND platform = 'facebook'
        `,
        [listingId]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const title = listing.attributes.title || null;

      const price =
        listing.attributes.price?.amount
          ? listing.attributes.price.amount / 100
          : null;

      const listingUrl = `https://staging.ironxchange.com/l/${listingId}`;

      await pool.query(
        `
        INSERT INTO social_post_jobs (
          sharetribe_listing_id,
          platform,
          status,
          title,
          price,
          listing_url
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          listingId,
          "facebook",
          "pending",
          title,
          price,
          listingUrl,
        ]
      );

      imported++;
    }

    res.json({
      status: "import complete",
      imported,
      skipped,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "import failed",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 IXI Core running on port ${PORT}`);
});
