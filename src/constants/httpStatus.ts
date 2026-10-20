export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

export const STATUS_MESSAGE: Record<HttpStatusCode, string> = {
  [HTTP_STATUS.OK]: 'Success',
  [HTTP_STATUS.ACCEPTED]: 'Accepted',
  [HTTP_STATUS.BAD_REQUEST]: 'Invalid JSON body',
  [HTTP_STATUS.FORBIDDEN]: 'Forbidden',
  [HTTP_STATUS.NOT_FOUND]: 'Resource not found',
  [HTTP_STATUS.CONFLICT]: 'Conflict',
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: 'Payload too large',
  [HTTP_STATUS.TOO_MANY_REQUESTS]: 'Too many requests',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [HTTP_STATUS.NOT_IMPLEMENTED]: 'Not implemented',
  [HTTP_STATUS.BAD_GATEWAY]: 'Bad gateway',
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'Database unavailable',
};
