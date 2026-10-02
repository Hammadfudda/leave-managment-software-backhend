import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.4
const designationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // null = legacy shared master data; owned records carry the client organization.
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  },
  { timestamps: true }
);

export default mongoose.model('Designation', designationSchema);
