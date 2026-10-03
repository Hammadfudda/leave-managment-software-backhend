import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.10
const loginHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ipAddress: String,
    userAgent: String,
    successful: { type: Boolean, required: true },
    userName: { type: String, default: '' },
    userDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('LoginHistory', loginHistorySchema);
