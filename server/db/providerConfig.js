const mongoose = require('mongoose');

let ProviderConfig;

function getModel() {
  if (!ProviderConfig) {
    try {
      ProviderConfig = mongoose.model('ProviderConfig');
    } catch (_) {
      const providerConfigSchema = new mongoose.Schema({
        userId: { type: String, required: true },
        provider: { type: String, required: true },
        config: { type: mongoose.Schema.Types.Mixed, default: {} },
        updatedAt: { type: String, required: true },
      }, { versionKey: false });
      providerConfigSchema.index({ userId: 1, provider: 1 }, { unique: true });
      ProviderConfig = mongoose.model('ProviderConfig', providerConfigSchema);
    }
  }
  return ProviderConfig;
}

async function saveConfig(userId, provider, config) {
  const Model = getModel();
  const updatedAt = new Date().toISOString();
  await Model.findOneAndUpdate(
    { userId, provider },
    { userId, provider, config, updatedAt },
    { upsert: true }
  );
  return config;
}

async function getConfig(userId, provider) {
  const Model = getModel();
  const doc = await Model.findOne({ userId, provider }).lean();
  return doc ? doc.config || {} : {};
}

async function getAllConfigs(userId) {
  const Model = getModel();
  return Model.find({ userId }).select('provider config').lean();
}

async function deleteConfigs(userId) {
  const Model = getModel();
  await Model.deleteMany({ userId });
}

module.exports = { saveConfig, getConfig, getAllConfigs, deleteConfigs };
