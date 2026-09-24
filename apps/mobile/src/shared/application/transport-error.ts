export type TransportError = Readonly<{
  code:
    | "UNAUTHENTICATED"
    | "COMPANY_REQUIRED"
    | "INVALID_COMPANY"
    | "NETWORK_ERROR"
    | "RATE_LIMITED"
    | "SERVER_ERROR"
    | "INVALID_RESPONSE"
    | "OPERATION_CANCELLED"
    | "SECURE_STORAGE_ERROR";
  message: string;
}>;
