// db.js - MongoDB Atlas with Mongoose
const mongoose = require('mongoose');

let dbInstance = null;

async function connectDB() {
  if (dbInstance) return dbInstance;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI is not set');
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ MongoDB Atlas connected');
    dbInstance = mongoose.connection;

    return dbInstance;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// Emulate your current .collection(name) interface
function collection(collectionName) {
  const Schema = new mongoose.Schema({}, { timestamps: true });
  const Model = mongoose.models[collectionName] || mongoose.model(collectionName, Schema, collectionName);

  return {
    find: (query = {}) => Model.find(query).lean().exec(),
    findOne: (query) => Model.findOne(query).lean().exec(),
    findById: (id) => Model.findById(id).lean().exec(),
    insert: async (doc) => {
      const instance = new Model(doc);
      await instance.save();
      return instance.toObject();
    },
    update: async (query, changes) => {
      const result = await Model.updateMany(query, changes);
      return result.modifiedCount;
    },
    updateById: async (id, update) => {
      const res = await Model.findByIdAndUpdate(id, update, { new: true }).lean();
      return res;
    },
    remove: async (query) => {
      const result = await Model.deleteMany(query);
      return result.deletedCount;
    },
    removeById: async (id) => {
      const result = await Model.findByIdAndDelete(id);
      return result ? 1 : 0;
    },
    count: (query = {}) => Model.countDocuments(query).exec(),
    findAll: () => Model.find({}).lean().exec(),
  };
}

module.exports = { connectDB, collection };
