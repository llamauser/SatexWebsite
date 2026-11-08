import { notFound } from "next/navigation";

// Catch-all so unknown URLs under a locale render the localized not-found page.
export default function CatchAll() {
  notFound();
}
