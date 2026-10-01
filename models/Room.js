const mongoose = require('mongoose');

// A group chat room. Anyone logged in can see and join public rooms.
const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 30 },
    description: { type: String, default: '', maxlength: 120 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Room', roomSchema);
