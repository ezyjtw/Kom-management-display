/** Audit action names for security events (spec §17.7). Dependency-free so evaluators can import it. */
export const SECURITY_ACTIONS = {
  permissionDenied: "permission_denied",
  roleChanged: "role_changed",
  credentialUsed: "integration_credential_used",
  credentialFailure: "integration_auth_failure",
  nonSsoLogin: "non_sso_login",
  exportCapExceeded: "export_cap_exceeded",
} as const;
