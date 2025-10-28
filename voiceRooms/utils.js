const core = require('./core');

module.exports = {
  templateCache: core.templateCache,
  tempChannelCache: core.tempChannelCache,
  addTemplateToCache: core.addTemplateToCache,
  removeTemplateFromCache: core.removeTemplateFromCache,
  addTemporaryChannelToCache: core.addTemporaryChannelToCache,
  removeTemporaryChannelFromCache: core.removeTemporaryChannelFromCache,
  isTemplateChannel: core.isTemplateChannel
};
