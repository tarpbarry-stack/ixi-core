require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const app = express();

app.use(express.json());
app.use("/generated", express.static(path.join(__dirname, "generated")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const S3_BUCKET = process.env.AWS_S3_BUCKET;

const SHARETRIBE_CLIENT_ID = process.env.SHARETRIBE_CLIENT_ID;
const SHARETRIBE_CLIENT_SECRET = process.env.SHARETRIBE_CLIENT_SECRET;

function getId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value.uuid) return value.uuid;
  return String(value);
}

async function safeJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON but got ${response.status} ${response.statusText}: ${text.slice(0, 120)}`
    );
  }
}

async function getAccessToken() {
  const response = await fetch("https://flex-api.sharetribe.com/v1/auth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SHARETRIBE_CLIENT_ID,
      client_secret: SHARETRIBE_CLIENT_SECRET,
      scope: "integ",
    }),
  });

  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function getBestImageUrl(imageAsset) {
  const variants = imageAsset?.attributes?.variants || {};

  return (
    variants["listing-card-2x"]?.url ||
    variants["listing-card"]?.url ||
    variants["landscape-crop2x"]?.url ||
    variants["landscape-crop"]?.url ||
    variants["scaled-large"]?.url ||
    variants["scaled-medium"]?.url ||
    variants["scaled-small"]?.url ||
    variants["square-small"]?.url ||
    variants.default?.url ||
    Object.values(variants).find((variant) => variant?.url)?.url ||
    imageAsset?.attributes?.url ||
    ""
  );
}

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

function getListingState(publicData = {}) {
  return (
    publicData.state ||
    publicData.location?.state ||
    publicData.addressState ||
    publicData.loc ||
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

async function fetchPublishedListingsWithImages() {
  const token = await getAccessToken();

  const response = await fetch(
    "https://flex-integ-api.sharetribe.com/v1/integration_api/listings/query?per_page=100&include=images",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(`Listings failed: ${JSON.stringify(data)}`);
  }

  const imageById = new Map();

  for (const asset of data.included || []) {
    if (asset.type !== "image") continue;

    const id = getId(asset.id);
    const url = getBestImageUrl(asset);

    if (id && url) {
      imageById.set(id, url);
    }
  }

  return (data.data || [])
    .filter((item) => item.attributes?.state === "published")
    .map((item) => {
      const attrs = item.attributes || {};
      const publicData = attrs.publicData || {};
      const listingId = getId(item.id);

      const imageRefs = item.relationships?.images?.data || [];
      const imageUrls = imageRefs
        .map((ref) => imageById.get(getId(ref.id)))
        .filter(Boolean);

      const slug = slugify(attrs.slug || attrs.title || "equipment");
      const price = attrs.price?.amount ? attrs.price.amount / 100 : null;

      return {
        listingId,
        title: attrs.title || "Equipment",
        price,
        listingUrl: `https://staging.ironxchange.com/l/${slug}/${listingId}`,
        state: getListingState(publicData),
        primaryImageUrl: imageUrls[0] || null,
        imageUrls,
      };
    });
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
    const listings = await fetchPublishedListingsWithImages();

    let imported = 0;
    let updated = 0;
    let missingPrice = 0;
    let missingImage = 0;

    for (const item of listings) {
      if (!item.price) {
        missingPrice++;
        continue;
      }

      if (!item.primaryImageUrl) {
        missingImage++;
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

      if (result.rows[0]?.inserted) imported++;
      else updated++;
    }

    res.json({
      status: "import complete",
      imported,
      updated,
      missingPrice,
      missingImage,
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

app.get("/watermark-pending-images", async (req, res) => {
  try {
    const outputDir = path.join(__dirname, "generated", "watermarked");
    fs.mkdirSync(outputDir, { recursive: true });

    const watermarkPath = path.join(
      __dirname,
      "assets",
      "ironxchange-watermark-x-white-2048.png"
    );

    if (!fs.existsSync(watermarkPath)) {
      return res.status(500).json({
        status: "watermark failed",
        error: "Watermark asset not found",
        expected_path: watermarkPath,
      });
    }

    const jobsResult = await pool.query(`
  SELECT id, sharetribe_listing_id, primary_image_url
  FROM social_post_jobs
  WHERE status = 'pending'
    AND primary_image_url IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 25
`);

    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const job of jobsResult.rows) {
      try {
        const imageResponse = await fetch(job.primary_image_url);

        if (!imageResponse.ok) {
          throw new Error(`Image download failed: ${imageResponse.status}`);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const imageMeta = await sharp(imageBuffer).metadata();

        const imageWidth = imageMeta.width || 1200;
        const watermarkWidth = Math.round(imageWidth * 0.11);
        const padding = Math.round(imageWidth * 0.035);

        const watermarkBuffer = await sharp(watermarkPath)
          .resize({ width: watermarkWidth })
          .ensureAlpha()
          .composite([
            {
              input: Buffer.from([255, 255, 255, 185]),
              raw: {
                width: 1,
                height: 1,
                channels: 4,
              },
              tile: true,
              blend: "dest-in",
            },
          ])
          .png()
          .toBuffer();

       const outputFilename = `${job.sharetribe_listing_id}-watermarked.jpg`;
const s3Key = `watermarked/${outputFilename}`;

const finalImageBuffer = await sharp(imageBuffer)
  .composite([
    {
      input: watermarkBuffer,
      top: padding,
      left: imageWidth - watermarkWidth - padding,
    },
  ])
  .jpeg({
    quality: 92,
    mozjpeg: true,
  })
  .toBuffer();

await s3.send(
  new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: finalImageBuffer,
    ContentType: "image/jpeg",
  })
);

const publicUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

        await pool.query(
          `
          UPDATE social_post_jobs
          SET watermarked_image_url = $1,
              updated_at = NOW()
          WHERE id = $2
          `,
          [publicUrl, job.id]
        );

        processed++;
      } catch (error) {
        failed++;
        errors.push({
          job_id: job.id,
          error: error.message,
        });
      }
    }

    res.json({
      status: "watermark complete",
      found: jobsResult.rows.length,
      processed,
      failed,
      errors,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "watermark failed",
      error: error.message,
    });
  }
});

app.get("/post-one-facebook", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM social_post_jobs
      WHERE status = 'pending'
        AND watermarked_image_url IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        status: "no pending jobs",
      });
    }

    const job = result.rows[0];

    const facebookImageUrl = job.watermarked_image_url;

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${process.env.FACEBOOK_PAGE_ID}/photos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: facebookImageUrl,
          caption: job.caption,
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
        }),
      }
    );

    const data = await safeJson(response);

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    await pool.query(
      `
      UPDATE social_post_jobs
      SET
        status = 'posted',
        platform_post_id = $1,
        platform_post_url = $2,
        posted_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        data.post_id || data.id,
        `https://facebook.com/${data.post_id || data.id}`,
        job.id,
      ]
    );

    res.json({
      status: "facebook post successful",
      job_id: job.id,
      facebook_response: data,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "facebook post failed",
      error: error.message,
    });
  }
});

app.get("/post-one-instagram", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM social_post_jobs
      WHERE status = 'pending'
        AND watermarked_image_url IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        status: "no pending jobs",
      });
    }

    const job = result.rows[0];

    // STEP 1: Create IG media container
    const containerResponse = await fetch(
      `https://graph.facebook.com/v22.0/${process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: job.watermarked_image_url,
          caption: job.caption,
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
        }),
      }
    );

    const containerData = await safeJson(containerResponse);

    if (!containerResponse.ok) {
      throw new Error(JSON.stringify(containerData));
    }

    const creationId = containerData.id;

    // STEP 2: Publish IG media container
    const publishResponse = await fetch(
      `https://graph.facebook.com/v22.0/${process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
        }),
      }
    );

    const publishData = await safeJson(publishResponse);

    if (!publishResponse.ok) {
      throw new Error(JSON.stringify(publishData));
    }

    await pool.query(
      `
      UPDATE social_post_jobs
      SET
        status = 'posted',
        platform_post_id = $1,
        platform_post_url = $2,
        posted_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        publishData.id,
        `https://www.instagram.com/p/${publishData.id}/`,
        job.id,
      ]
    );

    res.json({
      status: "instagram post successful",
      job_id: job.id,
      instagram_response: publishData,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "instagram post failed",
      error: error.message,
    });
  }
});

app.get("/post-one-linkedin", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM social_post_jobs
      WHERE status = 'pending'
        AND watermarked_image_url IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        status: "no pending jobs",
      });
    }

    const job = result.rows[0];

    const organizationUrn = `urn:li:organization:${process.env.LINKEDIN_ORGANIZATION_ID}`;

    const postBody = {
      author: organizationUrn,
      commentary: job.caption,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      content: {
        article: {
          source: job.listing_url,
          title: job.title,
          description: `${job.title} listed on IronXchange`,
          thumbnail: job.watermarked_image_url,
        },
      },
    };

    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": "202506",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(postBody),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(text);
    }

    const linkedinPostId =
      response.headers.get("x-restli-id") ||
      response.headers.get("X-RestLi-Id") ||
      null;

    await pool.query(
      `
      UPDATE social_post_jobs
      SET
        status = 'posted',
        platform_post_id = $1,
        platform_post_url = $2,
        posted_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        linkedinPostId,
        linkedinPostId
          ? `https://www.linkedin.com/feed/update/${linkedinPostId}`
          : null,
        job.id,
      ]
    );

    res.json({
      status: "linkedin post successful",
      job_id: job.id,
      linkedin_post_id: linkedinPostId,
      linkedin_response: text || null,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "linkedin post failed",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 IXI Core running on port ${PORT}`);
});
