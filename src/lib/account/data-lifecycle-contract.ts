export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY ACCOUNT";
export const ACCOUNT_DELETION_COOKIE = "alpha-dog-account-deletion";
export const ACCOUNT_DELETION_REAUTH_MINUTES = 10;
export const ACCOUNT_DELETION_RETRY_HOURS = 24;
export const ACCOUNT_EXPORT_FORMAT = "alpha-dog-account-export";
export const ACCOUNT_EXPORT_SCHEMA_VERSION = 1;

export const ACCOUNT_DATA_RETENTION_POLICY = {
  analysisRequestsDays: 90,
  completedImportMetadataDays: 365,
  deletionAuditDays: 90,
  incompleteImportsDays: 30,
  rawImportRowsDays: 90,
  retentionRunHistoryDays: 90,
} as const;
