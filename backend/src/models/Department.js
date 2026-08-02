import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.3
const departmentSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    // false = this department works a 6-day week (Saturday is a normal working day).
    // Default true = standard 5-day week (Saturday off, same as Sunday).
    saturdayOff: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Department', departmentSchema);
