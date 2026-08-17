import api from './api';

import type {
  LeaveRequest,
  LeaveType,
} from '../types';

/* =========================================================
   BACKEND TYPES
========================================================= */

type BackendId =
  | string
  | {
      _id?: string;
      fullName?: string;
    }
  | null
  | undefined;

interface BackendLeaveRequest {
  _id: string;

  employeeId:
    BackendId;

  employeeName?: string;

  department?: string;

  leaveType:
    LeaveRequest['leaveType'];

  startDate: string;

  endDate: string;

  totalDaysRequested?:
    number;

  totalWorkingDays?:
    number;

  excludedWeekendDates?:
    string[];

  reason?: string;

  status:
    LeaveRequest['status'];

  requiredApproverIds?:
    BackendId[];

  approvedByIds?:
    BackendId[];

  rejectedByIds?:
    BackendId[];

  approvalHistory?:
    LeaveRequest['approvalHistory'];

  isAdminOnlyDecision?:
    boolean;

  isExtension?:
    boolean;

  originalRequestId?:
    string | null;

  isPaidOverride?:
    boolean | null;

  isStopRequest?:
    boolean;

  cancelledBy?:
    string | null;

  attachmentName?:
    string;

  hasAttachment?:
    boolean;

  createdAt: string;
}

/* =========================================================
   HELPERS
========================================================= */

function getId(
  value: BackendId
): string {
  if (!value) {
    return '';
  }

  if (
    typeof value ===
    'string'
  ) {
    return value;
  }

  return value._id || '';
}

function dateOnly(
  value?: string
): string {
  if (!value) {
    return '';
  }

  return value.split(
    'T'
  )[0];
}

/* =========================================================
   MAPPER
========================================================= */

export function mapBackendLeaveRequest(
  leave: BackendLeaveRequest
): LeaveRequest {
  const employee =
    typeof leave.employeeId ===
    'object'
      ? leave.employeeId
      : null;

  return {
    id:
      leave._id,

    employeeId:
      getId(
        leave.employeeId
      ),

    employeeName:
      leave.employeeName ||
      employee?.fullName ||
      '',

    department:
      leave.department ||
      '',

    leaveType:
      leave.leaveType,

    startDate:
      dateOnly(
        leave.startDate
      ),

    endDate:
      dateOnly(
        leave.endDate
      ),

    totalDaysRequested:
      leave.totalDaysRequested ??
      0,

    totalWorkingDays:
      leave.totalWorkingDays ??
      0,

    excludedWeekendDates:
      leave.excludedWeekendDates ||
      [],

    reason:
      leave.reason ||
      '',

    status:
      leave.status,

    requiredApproverIds:
      (
        leave.requiredApproverIds ||
        []
      ).map(
        getId
      ),

    approvedByIds:
      (
        leave.approvedByIds ||
        []
      ).map(
        getId
      ),

    rejectedByIds:
      (
        leave.rejectedByIds ||
        []
      ).map(
        getId
      ),

    approvalHistory:
      leave.approvalHistory ||
      [],

    isAdminOnlyDecision:
      leave.isAdminOnlyDecision ??
      false,

    isExtension:
      leave.isExtension ??
      false,

    originalRequestId:
      leave.originalRequestId ||
      undefined,

    isPaidOverride:
      leave.isPaidOverride ??
      undefined,

    isStopRequest:
      leave.isStopRequest ??
      false,

    cancelledBy:
      leave.cancelledBy ||
      undefined,

    attachmentName:
      leave.attachmentName,

    createdAt:
      leave.createdAt,

    hasAttachment:
      leave.hasAttachment,
  } as LeaveRequest & {
    hasAttachment?:
      boolean;
  };
}

/* =========================================================
   GET LEAVE REQUESTS
========================================================= */

export async function getLeaveRequests(): Promise<
  LeaveRequest[]
> {
  const response =
    await api.get(
      '/leave-requests',
      {
        params: {
          page: 1,
          limit: 500,
        },
      }
    );

  const rows =
    response.data?.data ||
    [];

  return rows.map(
    mapBackendLeaveRequest
  );
}

/* =========================================================
   CREATE LEAVE REQUEST PAYLOAD
========================================================= */

export interface CreateLeaveRequestPayload {
  leaveType:
    LeaveType;

  startDate:
    string;

  endDate:
    string;

  reason:
    string;

  attachment?:
    File | null;
}

/* =========================================================
   CREATE LEAVE REQUEST
   multipart/form-data
========================================================= */

export async function createLeaveRequest(
  payload:
    CreateLeaveRequestPayload
): Promise<LeaveRequest> {
  const formData =
    new FormData();

  formData.append(
    'leaveType',
    payload.leaveType
  );

  formData.append(
    'startDate',
    payload.startDate
  );

  formData.append(
    'endDate',
    payload.endDate
  );

  formData.append(
    'reason',
    payload.reason
  );

  if (
    payload.attachment
  ) {
    formData.append(
      'attachment',
      payload.attachment
    );
  }

  const response =
    await api.post(
      '/leave-requests',
      formData,
      {
        headers: {
          'Content-Type':
            'multipart/form-data',
        },
      }
    );

  return mapBackendLeaveRequest(
    response.data.data
  );
}

/* =========================================================
   PRIVATE ATTACHMENT URL

   Backend first checks authorization.
   Then temporary signed Cloudinary URL is returned.

   Permanent public URL frontend mein save nahi hoti.
========================================================= */

export interface LeaveAttachmentUrlResponse {
  url: string;

  expiresAt:
    number;

  expiresInSeconds:
    number;

  name:
    string;
}

export async function getLeaveAttachmentUrl(
  leaveRequestId:
    string
): Promise<LeaveAttachmentUrlResponse> {
  const response =
    await api.get(
      `/leave-requests/${leaveRequestId}/attachment-url`
    );

  return response.data.data;
}

/* =========================================================
   OPEN PRIVATE ATTACHMENT

   Is helper ko Approvals / Leave History mein
   "View Document" button se use kar sakte ho.
========================================================= */

export async function openLeaveAttachment(
  leaveRequestId:
    string
): Promise<void> {
  const attachment =
    await getLeaveAttachmentUrl(
      leaveRequestId
    );

  if (
    !attachment.url
  ) {
    throw new Error(
      'Attachment URL was not returned by the server.'
    );
  }

  window.open(
    attachment.url,
    '_blank',
    'noopener,noreferrer'
  );
}