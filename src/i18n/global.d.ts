import type { AppLocale } from "./routing";
import type fr from "../../messages/fr.json";

// Typed message keys and locales for next-intl (French is the source of truth).
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof fr;
  }
}
