const REVIEW_ALL_TESTER_EMAIL = "marc.baddour@ahmadiah.com";

export function canUseReviewAll(email: string): boolean {
  if (process.env.REVIEW_ALL_USERS === "true") return true;
  return email.trim().toLowerCase() === REVIEW_ALL_TESTER_EMAIL;
}