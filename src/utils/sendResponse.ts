import type { Response } from 'express';
import type { ApiResponse } from '../types/apiResponse.type.js';

export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  message: string,
): void {
  const body: ApiResponse<T> = {
    success: true,
    code: statusCode,
    message,
    data,
  };
  res.status(statusCode).json(body);
}

export function sendFailure<T>(
  res: Response,
  statusCode: number,
  data: T,
  message: string,
): void {
  const body: ApiResponse<T> = {
    success: false,
    code: statusCode,
    message,
    data,
  };
  res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
): void {
  const body: ApiResponse<never> = {
    success: false,
    code: statusCode,
    message,
  };
  res.status(statusCode).json(body);
}
