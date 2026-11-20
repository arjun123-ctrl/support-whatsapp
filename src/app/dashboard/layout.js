import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName, localWorkspaceUser, session } from "@/lib/security.mjs";
import { Logout, Sidebar } from "./workspace";
import { Brand } from "../_components/brand";
export const metadata = { title:"Dashboard", robots:{index:false} };
export default async function DashboardLayout({children}) {
  const localUser = localWorkspaceUser(await headers());
  const user = localUser || session((await cookies()).get(cookieName)?.value);
  if (!user) redirect("/login");
  return <div className="workspace"><aside className="sidebar"><Brand href="/dashboard"/>
    <p className="sidebar-label">WORKSPACE</p><Sidebar admin={user.role === "ADMIN"}/>
    <div className="viewer"><strong>{user.name}</strong><small>{user.role === "ADMIN" ? "Administrator" : "Agent"}</small>{!localUser && <Logout/>}</div>
  </aside><main className="work-main">{children}</main></div>;
}
