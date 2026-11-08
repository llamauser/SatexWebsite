/** Map a Supabase auth error to an i18n key under `auth.errors.*`. */
export function authErrorKey(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!error) return "generic";
  switch (error.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "weak_password":
      return "weakPassword";
    case "same_password":
      return "samePassword";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rateLimit";
    case "user_already_exists":
    case "email_exists":
      return "generic"; // do not reveal whether an account exists
    default:
      break;
  }
  if (error.status === 429) return "rateLimit";
  if (/failed to fetch|network/i.test(error.message ?? "")) return "network";
  return "generic";
}
