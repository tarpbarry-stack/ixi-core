const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MOS_OBJECT_TYPES
} = require("../constants");

const {
  getObjectTemplate
} = require("../objects/objectTemplates");


test("customer container is a neutral first-class MOS object type", () => {
  assert.equal(
    MOS_OBJECT_TYPES.CONTAINER,
    "container"
  );

  const template =
    getObjectTemplate(
      MOS_OBJECT_TYPES.CONTAINER
    );

  assert.equal(
    template.objectType,
    MOS_OBJECT_TYPES.CONTAINER
  );
  assert.equal(
    template.capabilities.canContain,
    true
  );
  assert.equal(
    template.capabilities.canMove,
    true
  );
});
