import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cookieName, workspaceUser } from "@/lib/security.mjs";
import { pendingRequests, users } from "@/lib/store.mjs";
import { list } from "@/lib/inbox.mjs";
import { Workspace } from "../workspace";

export default async function DashboardPage({params,searchParams}) {
  const user = workspaceUser((await cookies()).get(cookieName)?.value, await headers());
  if (!user) redirect("/login");
  const section = (await params).section?.join("/") || "overview";
  const admin = user.role === "ADMIN";
  const basic = ["overview","conversations","contacts","templates"];
  const restricted = ["team","settings/whatsapp","deletion-requests","logs"];
  if (!basic.includes(section) && !(admin && restricted.includes(section))) notFound();
  const team = admin && ["conversations","contacts"].includes(section) ? users().filter((row)=>row.active).map(({id,name})=>({id,name})) : [];
  const overview = section === "overview" ? list(user) : [];
  const requestCount = admin && section === "overview" ? pendingRequests() : 0;
  const selected = Number((await searchParams).id) || 0;
  return <Workspace key={section+":"+selected} section={section} admin={admin} team={team} overview={overview} requestCount={requestCount} initialId={selected}/>;
}
