// src/app/api/route.ts
// This path used to hold a second copy of the upload endpoint. The upload logic (including the process tree
// rules: root-only uploads, automatic run start, branch choice) now lives only in documents/route.ts, so this
// path simply hands over to it and cannot be used to bypass those rules.
export const runtime = "nodejs";
export { POST } from "./documents/route";
