import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cookieName, workspaceUser } from "@/lib/security.mjs";
import { pendingRequests, users, sharedStorageConfigured, withWorkspaceStore } from "@/lib/store.mjs";
import { list } from "@/lib/inbox.mjs";
import { Workspace } from "../workspace";

export default async function DashboardPage({params,searchParams}) {
  const token = (await cookies()).get(cookieName)?.value;
  const requestHeaders = await headers();
  const sectionPath = (await params).section?.join("/");
  const selected = Number((await searchParams).id) || 0;
  const render = () => dashboard(token,requestHeaders,sectionPath,selected);
  if (sharedStorageConfigured() && (token || sectionPath === "overview")) {
    return withWorkspaceStore(render,{readOnly:true});
  }
  return render();
}

function dashboard(token,requestHeaders,sectionPath,selected) {
  const user = workspaceUser(token,requestHeaders);
  const publicAccess = user.role === "PUBLIC";
  const section = sectionPath || (publicAccess ? "conversations" : "overview");
  const admin = user.role === "ADMIN";
  const basic = publicAccess ? ["overview","conversations","templates"] : ["overview","conversations","contacts","templates"];
  const restricted = ["team","settings/whatsapp","deletion-requests","logs"];
  if (!basic.includes(section) && !(admin && restricted.includes(section))) notFound();
  const team = admin && ["conversations","contacts"].includes(section) ? users().filter((row)=>row.active).map(({id,name})=>({id,name})) : [];
  const overview = section === "overview" ? list(user) : [];
  const requestCount = admin && section === "overview" ? pendingRequests() : 0;
  return <Workspace key={section+":"+selected} section={section} admin={admin} team={team} overview={overview} requestCount={requestCount} initialId={selected}/>;
}
