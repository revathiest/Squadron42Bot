const { respondEphemeral } = require('../utils');
const { handleOrgPromoCommand } = require('./promoChannels');

function memberHasRole(member, roleId) {
  if (!member || !roleId) {
    return false;
  }

  const cache = member.roles?.cache;
  if (!cache) {
    return false;
  }

  if (typeof cache.has === 'function') {
    return cache.has(roleId);
  }

  if (typeof cache.some === 'function') {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  if (Array.isArray(cache)) {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  return false;
}

async function handleModCommand(interaction) {
  const group = interaction.options.getSubcommandGroup(false);

  if (group === 'auto-ban') {
    const { handleTrapConfigCommand } = require('../autoBanTrap');
    return handleTrapConfigCommand(interaction);
  }

  if (group === 'org-promos') {
    return handleOrgPromoCommand(interaction);
  }

  return respondEphemeral(interaction, 'Unsupported moderation command.');
}

module.exports = {
  memberHasRole,
  handleModCommand
};
