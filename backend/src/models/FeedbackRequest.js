import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const feedbackRequestSchema = new Schema(
  {
    submittedById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    submittedByName: {
      type: String,
      required: true,
      trim: true,
    },

    submittedByEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    organizationName: {
      type: String,
      default: '',
      trim: true,
    },

    type: {
      type: String,
      enum: [
        'feedback',
        'change_request',
        'issue',
      ],
      required: true,
      default: 'feedback',
    },

    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    status: {
      type: String,
      enum: [
        'new',
        'reviewing',
        'resolved',
      ],
      default: 'new',
    },

    superAdminNote: {
      type: String,
      default: '',
      trim: true,
      maxlength: 3000,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

feedbackRequestSchema.plugin(
  tenantPlugin
);

feedbackRequestSchema.index({
  organizationId: 1,
  createdAt: -1,
});

export default mongoose.model(
  'FeedbackRequest',
  feedbackRequestSchema
);
