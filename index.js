require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
        caption TEXT,
        platform_post_id TEXT,
        platform_post_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        posted_at TIMESTAMP,
        UNIQUE (sharetribe_listing_id, platform)
      );
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 IXI Core running on port ${PORT}`);
});
