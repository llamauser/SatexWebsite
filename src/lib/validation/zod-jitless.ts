import { z } from "zod";

// zod 4 tests whether it may compile schemas with `new Function(...)`. Our Content-Security-Policy forbids eval, so that test
// would be reported as a violation on every page that validates a form. Schemas are small: the interpreted mode is plenty fast.
z.config({ jitless: true });
