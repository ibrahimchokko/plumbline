import { isApiError, type ApiErrorKind } from '@plumbline/core';

export { api, errorMessage } from './api.ts';
export const isApiErrorKind = (err: unknown, kind: ApiErrorKind) => isApiError(err, kind);
