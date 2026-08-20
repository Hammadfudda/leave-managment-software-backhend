import mongoose from 'mongoose';

const { Schema } = mongoose;

const gradeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    /*
     * Leave quotas do NOT live in Grade anymore.
     * Grade only identifies the employee's grade.
     * Per-grade yearly quotas are stored inside LeavePolicy.gradeQuotas.
     */
    carryForwardAllowed: {
      type: Boolean,
      default: false,
    },

    maxCarryForwardDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  'Grade',
  gradeSchema
);
