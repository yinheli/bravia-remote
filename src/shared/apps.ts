/** Extra app-launch buttons configured via BRAVIA_APPS, shared across layers. */
export type CustomApp = { name: string; uri: string };

/**
 * App URI grammar shared by `BRAVIA_APPS` entries and `/api/app` launch
 * requests. Exported so config errors can quote the same pattern.
 */
export const APP_URI_PATTERN = /^[\w.:/-]+$/;

export const isAppUri = (uri: string): boolean => APP_URI_PATTERN.test(uri);
