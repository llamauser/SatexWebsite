import Image from "next/image";
import { storageUrl } from "@/lib/data/public";

/** Fabric photo from Supabase Storage. Loopback hosts (local development) cannot go through the image optimizer. */
export function FabricImage({ path, alt, sizes, priority = false }: { path: string | null; alt: string; sizes: string; priority?: boolean }) {
  const src = path ? storageUrl(path) : null;
  if (!src) return <div className="h-full w-full bg-surface-muted" aria-hidden />;
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(src);
  return <Image src={src} alt={alt} fill sizes={sizes} unoptimized={local} priority={priority} className="object-cover" />;
}
