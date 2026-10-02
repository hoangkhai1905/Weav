import { SetMetadata } from '@nestjs/common';

export const AUTH_POLICY = Symbol('gateway.auth-policy');
export const OCR_DEVELOPMENT_AUTH = Symbol('gateway.ocr-development-auth');
export type RouteAuthPolicy = 'public' | 'optional' | 'required';
export const AuthPolicy = (policy: RouteAuthPolicy) =>
  SetMetadata(AUTH_POLICY, policy);
// Applied only to the existing OCR extraction handler.
export const OcrDevelopmentAuth = () => SetMetadata(OCR_DEVELOPMENT_AUTH, true);
