import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.4
const designationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.model('Designation', designationSchema);
