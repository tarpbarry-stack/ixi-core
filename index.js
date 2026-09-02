const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { acquire } = require("./acquisition");

const {
  ensurePassportForSource,
  findPassportById,
  readPassportRecords,
  deletePassportById,
  deletePassportBySource
} = require("./passport/passportRegistry");

const {
  buildLaunchPayload
} = require("./acquisition/presentation/buildLaunchPayload");

const {
  normalizeAuctionContract
} = require("./acquisition/normalizers/normalizeAuctionContract");

const {
  createMediaJob
} = require("./media/jobs/createMediaJob");

const {
  getMediaJob
} = require("./media/storage/mediaJobStore");

const {
  getMachineMediaManifest,
  setMachineMediaHero,
  reorderMachineMedia,
  removeMachineMedia
} = require("./media/storage/machineMediaManifest");

const {
  createDirectUpload
} = require("./media/uploads/createDirectUpload");

const {
  completeDirectUpload
} = require("./media/uploads/completeDirectUpload");

const {
  retireMachineMedia
} = require("./media/admin/retireMachineMedia");

const {
  restoreMachineMedia
} = require("./media/admin/restoreMachineMedia");

const {
  permanentlyDeleteRetiredMedia
} = require("./media/admin/permanentlyDeleteRetiredMedia");

const {
  listRetiredMediaRecords
} = require("./media/storage/retiredMediaStore");

const {
  listAdminAudit
} = require("./media/admin/adminAuditLog");

const {
  mosRouter
} = require("./mos/routes/mosRouter");

const financialRoutes = require("./financial/IXIFinancialRoutes");
const { freightRouter } = require("./freight/routes/freightRouter");
const {
  freightAuthenticatedRequest
} = require(
  "./freight/routes/freightAuthenticatedRequest"
);

const {
  ticketRouter
} = require(
  "./tickets/routes/ticketRouter"
);

const {
  ticketAuthenticatedRequest
} = require(
  "./tickets/routes/ticketAuthenticatedRequest"
);


const authorityRoutes = require("./authority/IXIAuthorityRoutes");

const {
  ixiAuthenticatedFinancialRequest
} = require(
  "./identity/IXIAuthenticatedFinancialRequest"
);

const {
  ixiOptionalMosAuthorityRequest
} = require(
  "./authority/IXIAuthorityMosRequest"
);

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  "/financial",
  ixiAuthenticatedFinancialRequest,
  financialRoutes
);

app.use(
  "/freight/v1",
  ixiAuthenticatedFinancialRequest,
  freightAuthenticatedRequest,
  freightRouter
);


app.use(
  "/tickets/v1",
  ixiAuthenticatedFinancialRequest,
  ticketAuthenticatedRequest,
  ticketRouter
);

app.use(
  "/authority",
  authorityRoutes
);

app.use(
  "/mos/v1",
  ixiOptionalMosAuthorityRequest,
  mosRouter
);

const STATE_FILE = "./ixi-machine-state.json";

function loadState() {
  try {
    return JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8")
    );
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2)
  );
}

app.get("/", (req, res) => {
  res.json({
    service: "IX Core",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ix-core"
  });
});

app.post("/passport/ensure", (req, res) => {
  try {
    const {
      sourceType,
      sourceId,
      visibility,
      status
    } = req.body || {};

    if (!sourceType || !sourceId) {
      return res.status(400).json({
        ok: false,
        error: "Missing sourceType or sourceId"
      });
    }

    const result = ensurePassportForSource({
      sourceType,
      sourceId,
      visibility: visibility || "private",
      status: status || "active"
    });

    return res.json(result);
} catch (error) {
  console.error("ACQUISITION FAILED:", error);

  res.status(500).json({
    ok: false,
    error: error.message
  });
}
});

app.get("/passport/:passportId", (req, res) => {
  try {
    const passport = findPassportById(req.params.passportId);

    if (!passport) {
      return res.status(404).json({
        ok: false,
        error: "Passport not found"
      });
    }

    return res.json({
      ok: true,
      passport
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/passport", (req, res) => {
  try {
    const records = readPassportRecords();

    return res.json({
      ok: true,
      count: records.length,
      passports: records
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.delete("/passport/:passportId", (req, res) => {
  try {
    const confirmation =
      String(
        req.body?.confirmation ||
        req.headers[
          "x-ixi-delete-confirmation"
        ] ||
        ""
      ).trim();

    if (
      confirmation !==
      "PERMANENT_DELETE"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing PERMANENT_DELETE confirmation"
      });
    }

    const result =
      deletePassportById(
        req.params.passportId
      );

    return res.json(result);
  } catch (error) {
    console.error(
      "PASSPORT DELETE FAILED:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Passport delete failed"
    });
  }
});

app.delete(
  "/passport/by-source/:sourceType/:sourceId",
  (req, res) => {
    try {
      const confirmation =
        String(
          req.body?.confirmation ||
          req.headers[
            "x-ixi-delete-confirmation"
          ] ||
          ""
        ).trim();

      if (
        confirmation !==
        "PERMANENT_DELETE"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Missing PERMANENT_DELETE confirmation"
        });
      }

      const result =
        deletePassportBySource(
          req.params.sourceType,
          req.params.sourceId
        );

      return res.json(result);
    } catch (error) {
      console.error(
        "PASSPORT SOURCE DELETE FAILED:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "Passport source delete failed"
      });
    }
  }
);

app.post("/acquisition", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "Missing url"
      });
    }

    const result = await acquire(url);

    const normalizedResult =
      await normalizeAuctionContract(result);

    const launchPayload =
      buildLaunchPayload(normalizedResult);

    res.json({
      ok: true,
      result,
      launchPayload
    });

  } catch (error) {
    console.error("IX-CORE ACQUISITION FAILED:");
    console.error(error);
    console.error(error?.stack || "NO STACK AVAILABLE");

    res.status(500).json({
      ok: false,
      error: error?.message || "Acquisition failed",
      stack: error?.stack || null
    });
  }
});

app.post("/media/uploads/init", async (req, res) => {
  try {
    const {
      machineId,
      passportId,
      fileName,
      contentType,
      sizeBytes,
      position
    } = req.body || {};

    const upload =
      await createDirectUpload({
        machineId,
        passportId:
          passportId || "",
        fileName,
        contentType,
        sizeBytes,
        position:
          Number(position) || 0
      });

    return res.status(201).json({
      ok: true,
      upload
    });
  } catch (error) {
    console.error(
      "DIRECT UPLOAD INIT FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,
      error:
        error?.message ||
        "Unable to initialize upload"
    });
  }
});

app.post("/media/uploads/complete", async (req, res) => {
  try {
    const {
      machineId,
      passportId,
      sourceType,
      sourceUrl,
      uploads,
      manifestMode,
      selectionMode
    } = req.body || {};

    const result =
      await completeDirectUpload({
        machineId,
        passportId:
          passportId || "",
        sourceType:
          sourceType ||
          "direct-upload",
        sourceUrl:
          sourceUrl || "",

        uploads,

        manifestMode:
          manifestMode ||
          "replace",

        selectionMode:
          selectionMode ||
          "manual"
      });

    return res.status(202).json(result);
  } catch (error) {
    console.error(
      "DIRECT UPLOAD COMPLETE FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,
      error:
        error?.message ||
        "Unable to complete upload"
    });
  }
});

app.post("/media/jobs", async (req, res) => {
  try {
    const {
      machineId,
      passportId,
      sourceType,
      sourceUrl,
      imageUrls,
      mediaInputs,
      manifestMode,
      selectionMode
    } = req.body || {};

    if (!machineId) {
      return res.status(400).json({
        ok: false,
        error: "Missing machineId"
      });
    }

    if (!sourceType) {
      return res.status(400).json({
        ok: false,
        error: "Missing sourceType"
      });
    }

    const hasImageUrls =
      Array.isArray(imageUrls) &&
      imageUrls.length > 0;

    const hasMediaInputs =
      Array.isArray(mediaInputs) &&
      mediaInputs.length > 0;

    if (
      !hasImageUrls &&
      !hasMediaInputs
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing imageUrls or mediaInputs"
      });
    }

    const job = await createMediaJob({
      machineId,
      passportId:
        passportId || "",
      sourceType:
        sourceType ||
        "direct-upload",
      sourceUrl:
        sourceUrl || "",
      imageUrls:
        hasImageUrls
          ? imageUrls
          : [],
      mediaInputs:
        hasMediaInputs
          ? mediaInputs
          : [],

      manifestMode:
        manifestMode ||
        "replace",

      selectionMode:
        selectionMode || ""
    });

    return res.status(202).json({
      ok: true,
      job
    });
  } catch (error) {
    console.error(
      "MEDIA JOB CREATE FAILED:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Unable to create media job"
    });
  }
});

app.get("/admin/audit", async (req, res) => {
  try {
    const machineKey =
      String(
        req.query.machineKey || ""
      ).trim();

    const limit =
      Number(
        req.query.limit || 100
      );

    const records =
      await listAdminAudit({
        machineKey,
        limit
      });

    return res.json({
      ok: true,

      machineKey,

      count:
        records.length,

      records
    });
  } catch (error) {
    console.error(
      "ADMIN AUDIT LIST FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,

      error:
        error?.message ||
        "Unable to list admin audit records"
    });
  }
});

app.get("/admin/media/machines/:machineKey/retired", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey ||
        ""
      ).trim();

    if (!machineKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing machine key"
      });
    }

    const retired =
      await listRetiredMediaRecords({
        machineKey
      });

    return res.json({
      ok: true,

      machineKey,

      count:
        retired.length,

      retired
    });
  } catch (error) {
    console.error(
      "LIST RETIRED MEDIA FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,

      error:
        error?.message ||
        "Unable to list retired media"
    });
  }
});

app.post("/admin/media/machines/:machineKey/retired/:mediaId/permanent-delete", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey ||
        ""
      ).trim();

    const mediaId =
      String(
        req.params.mediaId ||
        ""
      ).trim();

    const result =
      await permanentlyDeleteRetiredMedia({
        machineKey,
        mediaId,

        confirmation:
          String(
            req.body?.confirmation ||
            ""
          ),

        reason:
          String(
            req.body?.reason ||
            ""
          ),

        deletedBy:
          req.body?.deletedBy ||
          "admin-daddy",

        requestContext: {
          ipAddress:
            req.ip ||
            req.socket?.remoteAddress ||
            "",

          userAgent:
            req.get("user-agent") ||
            "",

          requestId:
            req.get("x-request-id") ||
            ""
        }
      });

    return res.json({
      ok: true,

      retired:
        result.retired,

      audit:
        result.audit,

      deletedObjectKeys:
        result.deletedObjectKeys
    });
  } catch (error) {
    console.error(
      "PERMANENT MEDIA DELETE FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,

      error:
        error?.message ||
        "Unable to permanently delete media"
    });
  }
});

app.post("/admin/media/machines/:machineKey/retired/:mediaId/restore", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey ||
        ""
      ).trim();

    const mediaId =
      String(
        req.params.mediaId ||
        ""
      ).trim();

    if (!machineKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing machine key"
      });
    }

    if (!mediaId) {
      return res.status(400).json({
        ok: false,
        error: "Missing mediaId"
      });
    }

    const result =
      await restoreMachineMedia({
        machineId:
          machineKey,

        passportId:
          machineKey,

        mediaId,

        position:
          req.body?.position,

        setAsHero:
          Boolean(
            req.body?.setAsHero
          ),

        restoredBy:
          req.body?.restoredBy ||
          "admin-daddy",

        requestContext: {
          ipAddress:
            req.ip ||
            req.socket?.remoteAddress ||
            "",

          userAgent:
            req.get("user-agent") ||
            "",

          requestId:
            req.get("x-request-id") ||
            ""
        }
      });

    return res.json({
      ok: true,

      retired:
        result.retired,

      manifest:
        result.manifest,

      audit:
        result.audit
    });
  } catch (error) {
    console.error(
      "RESTORE RETIRED MEDIA FAILED:",
      error
    );

    return res.status(400).json({
      ok: false,

      error:
        error?.message ||
        "Unable to restore retired media"
    });
  }
});

app.post("/media/machines/:machineKey/hero", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey || ""
      ).trim();

    const mediaId =
      String(
        req.body?.mediaId || ""
      ).trim();

    if (!mediaId) {
      return res.status(400).json({
        ok: false,
        error: "Missing mediaId"
      });
    }

    const manifest =
      await setMachineMediaHero({
        machineId:
          machineKey,

        passportId:
          machineKey,

        mediaId
      });

    return res.json({
      ok: true,
      manifest
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error:
        error?.message ||
        "Unable to set hero"
    });
  }
});

app.post("/media/machines/:machineKey/reorder", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey || ""
      ).trim();

    const orderedMediaIds =
      req.body?.orderedMediaIds;

    const manifest =
      await reorderMachineMedia({
        machineId:
          machineKey,

        passportId:
          machineKey,

        orderedMediaIds
      });

    return res.json({
      ok: true,
      manifest
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error:
        error?.message ||
        "Unable to reorder media"
    });
  }
});

app.delete("/media/machines/:machineKey/media/:mediaId", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey || ""
      ).trim();

    const mediaId =
      String(
        req.params.mediaId || ""
      ).trim();

    const result =
      await retireMachineMedia({
        machineId:
          machineKey,

        passportId:
          machineKey,

        mediaId,

        reason:
          req.body?.reason ||
          "user-remove",

        removedBy:
          req.body?.removedBy ||
          "system",

        requestContext: {
          ipAddress:
            req.ip ||
            req.socket?.remoteAddress ||
            "",

          userAgent:
            req.get("user-agent") ||
            "",

          requestId:
            req.get("x-request-id") ||
            ""
        }
      });

    return res.json({
      ok: true,

      retired:
        result.retired,

      manifest:
        result.manifest,

      audit:
        result.audit
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error:
        error?.message ||
        "Unable to remove media"
    });
  }
});

app.get("/media/machines/:machineKey", async (req, res) => {
  try {
    const machineKey =
      String(
        req.params.machineKey || ""
      ).trim();

    if (!machineKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing machine key"
      });
    }

    /*
     * The canonical manifest key prefers passportId.
     * Passing the same value for both fields lets the manifest
     * resolver find either a Passport-based or machine-based record.
     */
    const manifest =
      await getMachineMediaManifest({
        machineId:
          machineKey,

        passportId:
          machineKey
      });

    if (!manifest) {
      return res.status(404).json({
        ok: false,
        error: "Machine media manifest not found"
      });
    }

    const hero =
      manifest.media?.find(
        item =>
          item.mediaId ===
          manifest.heroMediaId
      ) ||
      manifest.media?.[0] ||
      null;

    return res.json({
      ok: true,

      manifest: {
        schemaVersion:
          manifest.schemaVersion,

        machineId:
          manifest.machineId,

        passportId:
          manifest.passportId,

        canonicalMachineKey:
          manifest.canonicalMachineKey,

        mediaVersion:
          manifest.mediaVersion,

        status:
          manifest.status,

        heroMediaId:
          manifest.heroMediaId,

        orderedMediaIds:
          manifest.orderedMediaIds,

        hero,

        media:
          manifest.media,

        mediaCount:
          manifest.mediaCount,

        sourceType:
          manifest.sourceType,

        sourceUrl:
          manifest.sourceUrl,

        sourcePhotoCount:
          manifest.sourcePhotoCount,

        importedPhotoCount:
          manifest.importedPhotoCount,

        selectionMode:
          manifest.selectionMode,

        manifestMode:
          manifest.manifestMode,

        latestJobId:
          manifest.latestJobId,

        createdAt:
          manifest.createdAt,

        updatedAt:
          manifest.updatedAt
      }
    });
  } catch (error) {
    console.error(
      "MACHINE MEDIA MANIFEST READ FAILED:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Unable to read machine media manifest"
    });
  }
});

app.get("/media/jobs/:jobId", async (req, res) => {
  try {
    const job = await getMediaJob(
      req.params.jobId
    );

    if (!job) {
      return res.status(404).json({
        ok: false,
        error: "Media job not found"
      });
    }

    return res.json({
      ok: true,
      job
    });
  } catch (error) {
    console.error(
      "MEDIA JOB READ FAILED:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Unable to read media job"
    });
  }
});

app.get("/ixi-machine-state/:userId", (req, res) => {
  const state = loadState();


  res.json(
    state[req.params.userId] || {}
  );
});

app.post("/ixi-machine-state", (req, res) => {
  const {
    userId,
    listingId,
    patch
  } = req.body;

  if (!userId || !listingId) {
    return res.status(400).json({
      error: "Missing userId or listingId"
    });
  }

  const state = loadState();

  state[userId] = state[userId] || {};

  state[userId][listingId] = {
    ...(state[userId][listingId] || {}),
    ...patch,
    updatedAt: Date.now()
  };

  saveState(state);

  res.json({
    ok: true
  });
});

const PORT = 4100;

app.listen(PORT, () => {
  console.log(
    `IX Core running on port ${PORT}`
  );
});
