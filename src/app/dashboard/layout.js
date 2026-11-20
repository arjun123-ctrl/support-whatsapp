import { cookies, headers } from "next/headers";
import { cookieName, workspaceUser } from "@/lib/security.mjs";
import { Sidebar } from "./workspace";
import { Brand } from "../_components/brand";
export const metadata = { title:"Dashboard", robots:{index:false} };
export default async function DashboardLayout({children}) {
  const user = workspaceUser((await cookies()).get(cookieName)?.value,await headers());
  return <div className="workspace"><aside className="sidebar"><Brand href="/dashboard"/>
    <p className="sidebar-label">WORKSPACE</p><Sidebar admin={user.role === "ADMIN"} publicAccess={user.role === "PUBLIC"}/>
    <div className="viewer"><strong>{user.name}</strong><small>{{ADMIN:"Administrator",AGENT:"Agent",PUBLIC:"Public access"}[user.role]}</small></div>
  </aside><main className="work-main">{children}</main></div>;
}
