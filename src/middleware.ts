import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Locale detection order: NEXT_LOCALE cookie -> Accept-Language -> default (fr). See docs/09-i18n.md.
export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
