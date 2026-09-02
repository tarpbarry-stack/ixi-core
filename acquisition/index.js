require("dotenv").config();

const {
  acquireMachine
} = require("./orchestrator/acquireMachine");

async function acquire(url = "") {
  return acquireMachine(url);
}

module.exports = {
  acquire
};
