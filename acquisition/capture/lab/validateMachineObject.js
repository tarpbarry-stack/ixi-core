function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

function validateMachineObject(result = {}) {
  const machine = result.machine || {};

  const checks = {
    title: hasValue(machine.title),
    category: hasValue(machine.category),
    year: hasValue(machine.year),
    make: hasValue(machine.make),
    model: hasValue(machine.model),
    price: hasValue(machine.price),
    hours: hasValue(machine.hours),
    serialNumber: hasValue(machine.serialNumber),
    stockNumber: hasValue(machine.stockNumber),
    location: hasValue(machine.location),
    photos:
      Array.isArray(result.media) &&
      result.media.length > 0,

    identity:
      !!machine.identity &&
      machine.identity.ok === true
  };

  const passed =
    checks.title &&
    checks.make &&
    checks.model &&
    checks.photos;

  return {
    passed,
    checks,
    machine
  };
}

module.exports = {
  validateMachineObject
};

