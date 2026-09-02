class MosError extends Error {
  constructor(code, message, details = null, statusCode = 400) {
    super(message);

    this.name = "MosError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

module.exports = {
  MosError
};
