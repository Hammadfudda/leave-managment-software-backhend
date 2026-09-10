import mongoose from 'mongoose';

import {
  getTenantOrganizationId,
} from './tenantContext.js';

const { Schema } = mongoose;

function normalizeTenantId(value) {
  if (value === null) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
}

function getTenantId() {
  const tenantId = getTenantOrganizationId();

  if (tenantId === undefined) {
    return undefined;
  }

  return normalizeTenantId(tenantId);
}

function scopeQuery(query) {
  const tenantId = getTenantId();

  if (tenantId === undefined) {
    return;
  }

  const original = query.getFilter?.() || {};

  query.setQuery({
    $and: [
      original,
      {
        organizationId: tenantId,
      },
    ],
  });
}

function protectUpdate(query) {
  const tenantId = getTenantId();

  if (tenantId === undefined) {
    return;
  }

  scopeQuery(query);

  const update = query.getUpdate?.();

  if (!update || typeof update !== 'object') {
    return;
  }

  // Prevent a normal tenant request from moving a document to another tenant.
  delete update.organizationId;

  if (update.$unset) {
    delete update.$unset.organizationId;
  }

  if (update.$set) {
    update.$set.organizationId = tenantId;
  } else if (
    Object.keys(update).some((key) => key.startsWith('$'))
  ) {
    update.$set = {
      organizationId: tenantId,
    };
  } else {
    update.organizationId = tenantId;
  }

  query.setUpdate(update);
}

export function tenantPlugin(schema) {
  if (!schema.path('organizationId')) {
    schema.add({
      organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        default: null,
        index: true,
      },
    });
  }

  // New AND existing documents cannot escape the current tenant via save().
  schema.pre('validate', function tenantDocumentGuard(next) {
    const tenantId = getTenantId();

    if (tenantId !== undefined) {
      this.organizationId = tenantId;
    }

    next();
  });

  schema.pre('insertMany', function tenantInsertMany(next, docs) {
    const tenantId = getTenantId();

    if (tenantId !== undefined && Array.isArray(docs)) {
      for (const doc of docs) {
        doc.organizationId = tenantId;
      }
    }

    next();
  });

  for (const op of [
    'find',
    'findOne',
    'countDocuments',
    'deleteOne',
    'deleteMany',
  ]) {
    schema.pre(op, function tenantQueryGuard(next) {
      scopeQuery(this);
      next();
    });
  }

  for (const op of [
    'findOneAndUpdate',
    'updateOne',
    'updateMany',
  ]) {
    schema.pre(op, function tenantUpdateGuard(next) {
      protectUpdate(this);
      next();
    });
  }

  schema.pre('findOneAndDelete', function tenantDeleteGuard(next) {
    scopeQuery(this);
    next();
  });

  schema.pre('aggregate', function tenantAggregateGuard(next) {
    const tenantId = getTenantId();

    if (tenantId === undefined) {
      return next();
    }

    const tenantMatch = {
      $match: {
        organizationId: tenantId,
      },
    };

    const pipeline = this.pipeline();

    // These stages must remain first if present.
    if (
      pipeline[0]?.$geoNear ||
      pipeline[0]?.$search ||
      pipeline[0]?.$vectorSearch
    ) {
      pipeline.splice(1, 0, tenantMatch);
    } else {
      pipeline.unshift(tenantMatch);
    }

    next();
  });
}
