const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  type: {
    type: String,
    enum: ['public', 'company', 'optional'],
    default: 'public',
  },
  applicableDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  isRecurring: { type: Boolean, default: false },
}, { timestamps: true });

holidaySchema.index({ date: 1 });

module.exports = mongoose.model('Holiday', holidaySchema);
