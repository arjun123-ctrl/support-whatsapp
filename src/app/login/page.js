import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName, localWorkspaceUser, session } from "@/lib/security.mjs";
import { PublicLayout } from "../_components/public";
import { PublicForm } from "../_components/public-form";
export const metadata = { title:"Team sign in", robots:{index:false} };
export default async function Login() {
  if (localWorkspaceUser(await headers())) redirect("/dashboard/conversations");
  if (session((await cookies()).get(cookieName)?.value)) redirect("/dashboard");
  return <PublicLayout><article className="legal narrow"><p className="eyebrow">Team workspace</p><h1>Sign in</h1><PublicForm login/></article></PublicLayout>;
}
