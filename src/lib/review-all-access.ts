// remove this variable to disable the "bulk review" feature for this test user as well
const REVIEW_ALL_TESTER_EMAIL = "marc.baddour@ahmadiah.com";

export function canUseReviewAll(email: string): boolean {
  if (process.env.REVIEW_ALL_USERS === "true") return true;
  return email.trim().toLowerCase() === REVIEW_ALL_TESTER_EMAIL;
}

// replace teh function with this to disable the "bulk review" for teh test user
// to disable the feature for all users, set process.env.REVIEW_ALL_USERS to "false" in the .env file or 
// to true to enable it for all users
// export function canUseReviewAll(_email: string): boolean {
//   return process.env.REVIEW_ALL_USERS === "true";
// }