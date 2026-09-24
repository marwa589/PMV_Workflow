import { redirect } from "next/navigation";

export default function ClerkRejectedDocumentsPage() {
  redirect("/clerk/my-documents?status=REJECTED");
}
