"use strict";
const crypto = require("crypto");
const { postingForMachine } = require("../storage/postFreePostingStore");
function findPosting(machineKey) {
  if (!machineKey) return null;
  // Authorization must resolve the exact key used by the legacy storage layer.
  const { sanitizeMachineKey } = require("../../media/storage/machineMediaManifest");
  return postingForMachine(sanitizeMachineKey(machineKey));
}
function validReadTicket(ticket, machineKey, now = Date.now()) {
  const secret = process.env.IXI_MOS_INTERNAL_SECRET;
  const [expires, signature] = String(ticket || "").split(".");
  if (!secret || !/^\d+$/.test(expires || "") || Number(expires) < now || Number(expires) > now + 60000 || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  const expected = crypto.createHmac("sha256", secret).update(`ixi-media-read-v1\n${machineKey}\n${expires}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
async function protectPostingMedia(req, res, next) {
  try {
    const matched = req.path.match(/^\/machines\/([^/]+)/i);
    const keys = [matched && decodeURIComponent(matched[1]), req.body?.machineId, req.body?.passportId, req.query?.machineKey].filter(Boolean);
    if (/^\/jobs\//i.test(req.path)) {
      const job = await require("../../media/storage/mediaJobStore").getMediaJob(decodeURIComponent(req.path.slice(6)).trim());
      if (job) keys.push(job.machineId, job.passportId);
    }
    const row = keys.map(findPosting).find(Boolean);
    if (!row) return next();
    const machineKey = matched && decodeURIComponent(matched[1]);
    if (req.method === "GET" && /^\/machines\/[^/]+$/.test(req.path) && validReadTicket(req.headers["x-ixi-media-read-ticket"], machineKey)) return next();
    return res.status(403).json({ ok: false, error: { code: "POST_FREE_GOVERNED_MEDIA_REQUIRED", message: "This machine requires authorized media access." }, listingId: row.listingId });
  } catch (error) { return res.status(503).json({ ok: false, error: "Media access could not be verified." }); }
}
module.exports = { findPosting, validReadTicket, protectPostingMedia };
