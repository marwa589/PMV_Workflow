// The browser reads the attached files to suggest values for the custom fields (document scan). It is switched off
// for now. To turn it back on, set NEXT_PUBLIC_DOCUMENT_SCAN_ENABLED=true in the environment and rebuild the app
// (NEXT_PUBLIC_ values are fixed at build time).
export const DOCUMENT_SCAN_ENABLED = process.env.NEXT_PUBLIC_DOCUMENT_SCAN_ENABLED === "true";
