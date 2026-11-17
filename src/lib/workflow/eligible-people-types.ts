// Plain data shared by the server (which works out who can act) and the screens that show it.
// No server-only imports here: client components may import this file.
export type EligiblePerson = {
  id: string;
  name: string;
  email: string;
  userTypeName: string;
  // Why this person qualifies, e.g. "Named in the flow" or "Role \"Site Clerk\" (Upload documents)".
  reasons: string[];
};
