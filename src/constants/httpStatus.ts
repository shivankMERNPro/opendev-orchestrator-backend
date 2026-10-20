export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

export const STATUS_MESSAGE: Record<HttpStatusCode, string> = {
  [HTTP_STATUS.OK]: 'Success',
  [HTTP_STATUS.BAD_REQUEST]: 'Invalid JSON body',
  [HTTP_STATUS.FORBIDDEN]: 'Forbidden',
  [HTTP_STATUS.NOT_FOUND]: 'Resource not found',
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: 'Payload too large',
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'Database unavailable',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'Internal server error',
};
