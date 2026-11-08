/** next-intl's typed `t` rejects keys built at runtime (e.g. zod error codes). This view of it takes any string key. */
export type LooseT = (key: string, values?: Record<string, string | number>) => string;
export const loose = (t: unknown): LooseT => t as LooseT;
