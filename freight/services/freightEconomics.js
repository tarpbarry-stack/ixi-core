"use strict";

const {
  number,
  money
} = require("../util");

const ENGINE_VERSION =
  "ixi-freight-economics-v1";

function hasExpectedAmount(source = {}) {
  if (source.expectedProvided === true) return true;

  return [
    source.expectedTotal,
    source.agreedAmount,
    source.permitEstimate,
    source.escortEstimate,
    source.fuelSurchargeEstimate,
    source.otherEstimate
  ].some(value => Math.abs(number(value)) >= 0.005);
}

function expectedEconomics(
  source = {},
  routeMiles = 0
) {
  const result = {
    quotedAmount:
      money(source.quotedAmount),

    agreedAmount:
      money(source.agreedAmount),

    permitEstimate:
      money(source.permitEstimate),

    escortEstimate:
      money(source.escortEstimate),

    fuelSurchargeEstimate:
      money(source.fuelSurchargeEstimate),

    otherEstimate:
      money(source.otherEstimate)
  };

  result.expectedTotal = money(
    result.agreedAmount +
    result.permitEstimate +
    result.escortEstimate +
    result.fuelSurchargeEstimate +
    result.otherEstimate
  );

  result.expectedProvided =
    hasExpectedAmount(source);

  const miles =
    Math.max(0, number(routeMiles));

  result.expectedPerMile =
    miles > 0
      ? money(result.expectedTotal / miles)
      : 0;

  result.economicsEngineVersion =
    ENGINE_VERSION;

  return result;
}

function actualEconomics(
  expected = {},
  source = {},
  miles = 0
) {
  const result = {
    actualFreight:
      money(source.actualFreight),

    actualPermits:
      money(source.actualPermits),

    actualEscort:
      money(source.actualEscort),

    actualDetention:
      money(source.actualDetention),

    actualFuelSurcharge:
      money(source.actualFuelSurcharge),

    actualOther:
      money(source.actualOther)
  };

  result.actualTotal = money(
    result.actualFreight +
    result.actualPermits +
    result.actualEscort +
    result.actualDetention +
    result.actualFuelSurcharge +
    result.actualOther
  );

  const mileage =
    Math.max(0, number(miles));

  result.actualPerMile =
    mileage > 0
      ? money(result.actualTotal / mileage)
      : 0;

  result.variance = money(
    hasExpectedAmount(expected)
      ? result.actualTotal -
        number(expected.expectedTotal)
      : 0
  );

  result.varianceBasis =
    hasExpectedAmount(expected)
      ? "expected"
      : "none";

  result.economicsEngineVersion =
    ENGINE_VERSION;

  return result;
}

module.exports = {
  ENGINE_VERSION,
  hasExpectedAmount,
  expectedEconomics,
  actualEconomics
};
