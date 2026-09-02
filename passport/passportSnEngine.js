// /passport/passportSnEngine.js

const PASSPORT_PREFIX = "IXI";

// Removed confusing characters:
// O, I, L, 0, 1
const PASSPORT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const PASSPORT_SERIAL_LENGTH = 7;

function randomChar() {
  const index = Math.floor(Math.random() * PASSPORT_ALPHABET.length);
  return PASSPORT_ALPHABET[index];
}

function generatePassportSerial() {
  let serial = "";

  for (let i = 0; i < PASSPORT_SERIAL_LENGTH; i += 1) {
    serial += randomChar();
  }

  return serial;
}

function generatePassportId() {
  return `${PASSPORT_PREFIX}${generatePassportSerial()}`;
}

function normalizePassportId(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isValidPassportId(value = "") {
  const normalized = normalizePassportId(value);

  if (!normalized.startsWith(PASSPORT_PREFIX)) return false;
  if (normalized.length !== PASSPORT_PREFIX.length + PASSPORT_SERIAL_LENGTH) {
    return false;
  }

  const serial = normalized.slice(PASSPORT_PREFIX.length);

  return serial.split("").every(char => PASSPORT_ALPHABET.includes(char));
}

function getPassportUrl(passportId = "") {
  const normalized = normalizePassportId(passportId);

  if (!isValidPassportId(normalized)) return "";

  return `/p/${normalized}`;
}

module.exports = {
  PASSPORT_PREFIX,
  PASSPORT_ALPHABET,
  PASSPORT_SERIAL_LENGTH,
  generatePassportSerial,
  generatePassportId,
  normalizePassportId,
  isValidPassportId,
  getPassportUrl
};
