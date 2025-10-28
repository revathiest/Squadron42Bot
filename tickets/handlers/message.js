const core = require('../core');

async function handleMessageCreate(message) {
  await core.handleMessageCreate(message);
}

module.exports = {
  handleMessageCreate
};
