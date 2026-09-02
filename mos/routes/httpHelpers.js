function sendMosError(res, error) {
  const statusCode =
    Number(error?.statusCode) || 500;

  if (statusCode >= 500) {
    console.error("MOS ROUTE FAILED:", {
      code: error?.code || null,
      message:
        error?.message || String(error),
      stack: error?.stack || null,
      details: error?.details || null
    });
  }

  return res.status(statusCode).json({
    ok: false,
    error: {
      code:
        error?.code ||
        "MOS_INTERNAL_ERROR",

      message:
        error?.message ||
        "IXI MOS request failed.",

      details:
        error?.details || null
    }
  });
}

module.exports = {
  sendMosError
};
