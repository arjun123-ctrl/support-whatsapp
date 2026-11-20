"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../_components/public-form";
import { messageReactions, reactionLifetime } from "@/lib/message-reactions.mjs";
import { TemplateLibrary } from "./template-editor";

const navigation = [
  ["Overview","", "◫"],["Conversations","conversations","▤"],["Contacts","contacts","◎"],["Templates","templates","▧"],
  ["Team","team","◉",true],["WhatsApp Settings","settings/whatsapp","⚙",true],
  ["Data Deletion Requests","deletion-requests","▱",true],["Logs","logs","≡",true],
];
const date = (stamp) => stamp ? new Date(stamp).toLocaleString("en-IN", { dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata" }) : "—";
const name = (item) => item.name || "+"+item.wa_id;
function formOf(values) {
  const form = new FormData();
  for (const [key,value] of Object.entries(values)) form.set(key,value ?? "");
  return form;
}
export function Sidebar({admin}) {
  const current = usePathname();
  const [requests,setRequests] = useState(0);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    const refresh = () => api("request-count").then(({total}) => { if (active) setRequests(total); }).catch(() => {});
    void refresh();
    const timer = setInterval(refresh,15000);
    return () => { active = false; clearInterval(timer); };
  },[admin]);
  return <nav aria-label="Workspace">{navigation.filter((item) => !item[3] || admin).map(([label,path,icon]) => {
    const href = "/dashboard"+(path ? "/"+path : "");
    return <Link key={href} href={href} aria-current={current === href ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}{path === "deletion-requests" && requests > 0 && <b className="badge" aria-label={requests+" open requests"}>{requests}</b>}</Link>;
  })}</nav>;
}
export function Logout() {
  const router = useRouter();
  const [error,setError] = useState("");
  return <><button className="secondary" onClick={async () => {
    try { await api("logout",new FormData()); router.replace("/login"); router.refresh(); }
    catch (error) { setError(error.message); }
  }}>Sign out</button>{error && <small role="alert">{error}</small>}</>;
}
function Header({label,detail}) {
  return <header className="work-header"><div><h1>{label}</h1><p>{detail}</p></div><span className="channel">WhatsApp Cloud API</span></header>;
}
function Status({error,message}) {
  return <>{error && <p className="alert" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}</>;
}
export function Workspace(props) {
  const {section,overview,requestCount,admin} = props;
  if (section === "conversations" || section === "contacts") return <Inbox {...props} contacts={section === "contacts"}/>;
  if (section === "overview") return <><Header label="Overview" detail="WhatsApp conversations and workspace activity."/><div className="work-content">
    <div className="metrics"><article><span>Unread in recent conversations</span><strong>{overview.reduce((n,item) => n+item.unread,0)}</strong></article>
      <article><span>Recent conversations</span><strong>{Math.min(overview.length,30)}</strong></article>
      {admin && <article><span>Open customer requests</span><strong>{requestCount}</strong></article>}</div>
    <section className="panel"><div className="panel-title"><h2>Recent conversations</h2><Link href="/dashboard/conversations">Open inbox</Link></div>
      {overview.length ? <div className="rows">{overview.slice(0,8).map((item) => <Link key={item.id} href={"/dashboard/conversations?id="+item.id}><Avatar item={item}/><strong>{name(item)}</strong><span>{item.preview || item.status}</span><small>{date(item.last_message)}</small></Link>)}</div>
      : <p className="empty">Conversations appear here after a customer messages a connected WhatsApp number.</p>}
    </section></div></>;
  return <Management section={section} admin={admin}/>;
}
function Avatar({item}) { return <span aria-hidden="true" className="avatar">{(item.name || "WA").slice(0,2).toUpperCase()}</span>; }

function Inbox({admin,team,contacts,initialId}) {
  const [id,setId] = useState(initialId);
  const [search,setSearch] = useState("");
  const [filter,setFilter] = useState("");
  const [page,setPage] = useState(0);
  const [before,setBefore] = useState(null);
  const [data,setData] = useState(null);
  const [error,setError] = useState("");
  const [live,setLive] = useState(false);
  const [revision,refresh] = useState(0);
  const q = "?" + new URLSearchParams({id:String(id),q:search,filter,page:String(page),before:String(before || "")});
  useEffect(() => {
    let active = true;
    let ticking = false;
    async function poll() {
      if (ticking) return;
      ticking = true;
      try { const value = await api("inbox",null,q); if (active) { setData({q,value}); setError(""); } }
      catch (error) { if (active) { setError(error.message); setData(null); } }
      finally { ticking = false; }
    }
    const stream = new EventSource("/api/workspace/events"+q);
    stream.onopen = () => setLive(true);
    stream.onmessage = (event) => { setData({q,value:JSON.parse(event.data)}); setError(""); };
    stream.onerror = () => { setLive(false); void poll(); };
    stream.addEventListener("unavailable", () => {
      setData(null); setError("Conversation access is no longer available."); stream.close(); setLive(false);
    });
    const fallback = setInterval(() => { if (stream.readyState !== EventSource.OPEN) void poll(); },6500);
    void poll();
    return () => { active = false; clearInterval(fallback); stream.close(); };
  },[q,revision]);
  const current = data?.q === q ? data.value : null;
  const selected = current?.selected;
  function open(item) {
    setId(item.id); setBefore(null);
    if (item.unread && !contacts) api("conversation",formOf({id:item.id,action:"read"})).catch((failure) => setError(failure.message));
  }
  return <><Header label={contacts ? "Contacts" : "Conversations"} detail={contacts ? "Customer information, consent and conversation history." : "Manage customer messages from one workspace."}/>
    {error && <div className="inbox-alert"><Status error={error}/>{id > 0 && <button className="secondary" onClick={() => {setId(0);setBefore(null);}}>Return to inbox</button>}</div>}
    <div className={"inbox "+(contacts ? "contact-mode" : "")+(selected ? " selected" : "")}>
    <section className="queue" aria-label="Conversation list">
      <div className="queue-top"><div className="panel-title"><h2>{contacts ? "Customers" : "Inbox"}</h2>{live && <small className="live">Live</small>}</div>
      <input aria-label="Search contacts" placeholder="Search by name or number" value={search} onChange={(event) => {setSearch(event.target.value);setPage(0);}}/>
      {!contacts && <div className="filters">{[["","All"],["unread","Unread"],["mine","Assigned to me"]].map(([value,label]) => <button key={value} className="secondary" aria-pressed={filter===value} onClick={() => {setFilter(value);setPage(0);}}>{label}</button>)}</div>}</div>
      {!current && !error && <p className="empty" role="status">Loading conversations…</p>}
      {current && !current.items.length && <p className="empty">No matching {contacts ? "contacts" : "conversations"}.</p>}
      {current?.items.slice(0,30).map((item) => <button className="queue-row" key={item.id} aria-current={id === item.id ? "true" : undefined} onClick={() => open(item)}>
        <Avatar item={item}/><span className="queue-copy"><strong>{name(item)}</strong><small>+{item.wa_id} · {item.status}</small><span>{item.preview || "No messages"}</span><small>{item.agent || "Unassigned"} · {date(item.last_message)}</small></span>{item.unread > 0 && <span className="badge">{item.unread}</span>}
      </button>)}
      {(page > 0 || current?.items.length > 30) && <div className="pager"><button className="secondary" disabled={!page} onClick={() => setPage(page-1)}>Previous</button><button className="secondary" disabled={current?.items.length <= 30} onClick={() => setPage(page+1)}>Next</button></div>}
    </section>
    {!selected ? <section className="conversation empty-state"><span aria-hidden="true">▤</span><h2>{contacts ? "Select a customer" : "Select a conversation"}</h2><p>{contacts ? "View contact details and consent records." : "Open a conversation to view messages and reply."}</p></section>
      : <><Chat key={"chat:"+selected.id} thread={selected} messages={current.messages} before={before} setBefore={setBefore} contacts={contacts} refresh={() => refresh(revision+1)} back={() => {setId(0);setBefore(null);}}/>
      {contacts && <Details key={"details:"+selected.id} thread={selected} admin={admin} team={team} refresh={() => refresh(revision+1)}/>}</>}
    </div></>;
}
function Attachment({message}) {
  if (!message.media) return null;
  const url = "/api/workspace/media?id="+message.id;
  // Authenticated, short-lived proxy responses cannot use the image optimization cache.
  /* eslint-disable @next/next/no-img-element */
  if (message.kind === "image") return <a href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={message.body || "WhatsApp image"}/></a>;
  /* eslint-enable @next/next/no-img-element */
  if (message.kind === "audio") return <audio aria-label="Voice message" controls preload="none" src={url}/>;
  if (message.kind === "video") return <video controls preload="none" src={url}/>;
  return <a href={url}>Download document</a>;
}
const templateText = (item) => item?.components?.find((component) => component.type === "BODY")?.text || "";
const slots = (item) => [...new Set([...templateText(item).matchAll(/{{(\d+)}}/g)].map((match) => Number(match[1])))].sort((a,b)=>a-b);
const chatTime = new Intl.DateTimeFormat("en-IN",{timeStyle:"short",timeZone:"Asia/Kolkata"});
const deliveryMark = {pending:"…",unknown:"?",accepted:"✓",sent:"✓",delivered:"✓✓",read:"✓✓",failed:"!"};
const quotedMediaLabels = {image:"Photo",audio:"Audio message",video:"Video",document:"Document",sticker:"Sticker"};
function QuotedMessage({message}) {
  return <blockquote className="quoted-message"><strong>Quoted message</strong>
    {message ? <>
      {message.kind === "image" && message.media && <Attachment message={message}/>}
      <span>{message.body || quotedMediaLabels[message.kind] || message.kind || "Message"}</span>
    </> : <span>Original message unavailable</span>}
  </blockquote>;
}
function MessageActions({message,canReply,canReact,onReply,onAction}) {
  const menu = useRef(null);
  const trigger = useRef(null);
  const [busy,setBusy] = useState(false);
  async function perform(action,value) {
    setBusy(true);
    try {
      if (await onAction(message,action,value) && menu.current) {
        menu.current.open = false;
        trigger.current.focus();
      }
    } finally { setBusy(false); }
  }
  return <details className="message-actions" ref={menu} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === "Escape") {
      event.preventDefault();
      menu.current.open = false;
      trigger.current.focus();
    }
  }}>
    <summary ref={trigger} aria-label="Message actions" title="Message actions" onClick={event => {
      const anchor = event.currentTarget.getBoundingClientRect();
      const timeline = event.currentTarget.closest(".timeline").getBoundingClientRect();
      menu.current.dataset.side = timeline.bottom-anchor.bottom < 180 && anchor.top-timeline.top > timeline.bottom-anchor.bottom ? "above" : "below";
    }}>⋯</summary>
    <div className="message-action-panel">
      {canReply && <button type="button" className="secondary" onClick={() => {menu.current.open=false;onReply(message);}}>Reply</button>}
      {message.body && <button type="button" className="secondary" disabled={busy} onClick={() => perform("copy")}>Copy text</button>}
      {message.media && <a href={"/api/workspace/media?id="+message.id} download>Download attachment</a>}
      <button type="button" className="secondary" disabled={busy} onClick={() => perform(message.starred ? "unstar" : "star")}>{message.starred ? "Remove star" : "Star message"}</button>
      {canReact && <div className="message-reaction-options" aria-label="React to message">
        {messageReactions.map(emoji => <button key={emoji} type="button" aria-label={"React "+emoji} aria-pressed={message.reaction===emoji}
          className="secondary" disabled={busy} onClick={() => perform("react",message.reaction===emoji ? "" : emoji)}>{emoji}</button>)}
      </div>}
    </div>
  </details>;
}
function Chat({thread,messages,before,setBefore,contacts,refresh,back}) {
  const [available,setAvailable] = useState([]);
  const [template,setTemplate] = useState("");
  const [values,setValues] = useState({});
  const [reply,setReply] = useState(null);
  const [working,setWorking] = useState(false);
  const [error,setError] = useState("");
  const [delivery,setDelivery] = useState("");
  const [now,setNow] = useState(() => Date.now());
  const [file,setFile] = useState("");
  const [templatesOpen,setTemplatesOpen] = useState(false);
  const [templatesLoading,setTemplatesLoading] = useState(false);
  const attachment = useRef(null);
  const composerInput = useRef(null);
  const lock = useRef(false);
  const end = useRef(null);
  const latest = messages.at(-1)?.id;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick,1000);
    return () => clearInterval(timer);
  },[]);
  useEffect(() => { if (!before) end.current?.scrollIntoView({block:"nearest"}); },[latest,before]);
  const expiry = thread.last_inbound ? thread.last_inbound+86400000 : 0;
  const windowOpen = expiry > now;
  const chosen = available.find((item) => item.id === template);
  async function messageAction(message,action,emoji) {
    setError("");
    setDelivery("");
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(message.body);
        setDelivery("Message copied.");
      } else {
        await api("message-action",formOf({id:thread.id,message:message.id,action,emoji}));
        refresh();
      }
      return true;
    } catch (error) {
      setError(action === "copy" ? "Could not copy the message." : error.message);
      return false;
    }
  }
  async function loadTemplates() {
    setTemplatesOpen(!templatesOpen);
    if (templatesOpen || templatesLoading) return;
    setTemplatesLoading(true);
    setError("");
    try { setAvailable((await api("templates")).filter((item) => item.status==="APPROVED" && (item.category!=="MARKETING" || thread.opt_in==="yes"))); }
    catch (error) { setError(error.message); }
    finally { setTemplatesLoading(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setWorking(true);setError("");setDelivery("");
    const element = event.currentTarget;
    const form = new FormData(element);
    form.set("id",thread.id);
    form.set("requestId",crypto.randomUUID());
    form.set("reply",reply?.meta_id || "");
    try {
      const result = await api("send",form);
      element.reset();setFile("");setTemplate("");setValues({});setReply(null);setTemplatesOpen(false);
      setDelivery(result.delivery === "accepted" ? "" : "Message status: "+result.delivery);
    } catch (error) { setError(error.message); }
    finally { lock.current = false;setWorking(false);refresh(); }
  }
  return <section className="conversation" aria-label="Messages"><header className="chat-title"><button type="button" className="secondary mobile-back" onClick={back}>Inbox</button><Avatar item={thread}/><div><h2>{name(thread)}</h2><small>+{thread.wa_id}</small></div>{contacts && <Link href={"/dashboard/conversations?id="+thread.id}>Open conversation</Link>}</header>
    <div className="timeline">
      {messages.length > 50 && <button className="secondary" onClick={() => setBefore(messages[1].id)}>Older messages</button>}
      {before && <button className="secondary" onClick={() => setBefore(null)}>Latest messages</button>}
      {!messages.length && <p className="empty">No messages on this page.</p>}
      {messages.slice(-50).map((message) => <article key={message.id} className={"bubble "+message.direction}>
        {message.reply_to && <QuotedMessage message={message.quoted}/>}
        <Attachment message={message}/>
        <div className="bubble-line">
          {message.body ? <p>{message.body}</p> : !message.media && <p>{message.kind}</p>}
          <small className="bubble-meta" title={date(message.stamp)}>
            <time dateTime={new Date(message.stamp).toISOString()}>{chatTime.format(message.stamp)}</time>
            {message.direction === "out" && <span className="delivery-mark" data-status={message.status} role="img"
              aria-label={message.status + (message.error_code ? " · " + message.error_code : "")}
              title={message.status + (message.error_code ? " · " + message.error_code : "")}>{deliveryMark[message.status] || message.status}</span>}
          </small>
        </div>
        {(message.status === "unknown" || message.status === "pending") && message.direction === "out" && <small>Check delivery before sending again.</small>}
        {message.direction === "out" && message.status === "failed" && message.error_code === "131042" &&
          <small>Delivery failed · Meta billing issue (131042). <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noreferrer">Check WhatsApp billing</a></small>}
        {(message.starred || message.reaction) && <div className="message-markers">
          {message.starred && <span title="Starred" aria-label="Starred">★</span>}
          {message.reaction && <span title="Your reaction">{message.reaction}</span>}
        </div>}
        {!contacts && <MessageActions message={message} canReply={windowOpen && message.direction === "in" && Boolean(message.meta_id)}
          canReact={windowOpen && Boolean(message.meta_id) && message.kind !== "reaction" && !["pending","unknown","failed"].includes(message.status) && now-message.stamp < reactionLifetime}
          onReply={message => {setReply(message);setTemplate("");setValues({});requestAnimationFrame(() => composerInput.current?.focus());}} onAction={messageAction}/>}
      </article>)}<div ref={end}/>
    </div>
    {!contacts && <form className="composer" onSubmit={submit}>
      {!windowOpen && <p className="notice">Customer service window expired. Send an approved WhatsApp template to continue.</p>}
      {reply && !template && windowOpen && <p className="notice">Replying to {reply.body || reply.kind} <button className="text-button" type="button" onClick={() => setReply(null)}>Clear reply</button></p>}
      <Status error={error} message={delivery}/>
      <div id="composer-template-picker" className="composer-template-picker" hidden={!templatesOpen}>
        <label htmlFor="composer-template">Approved template</label>
        <select id="composer-template" name="template" disabled={templatesLoading} value={template} onChange={(event)=>{setTemplate(event.target.value);setValues({});}}>
          <option value="">{templatesLoading ? "Loading templates…" : available.length ? "Select template" : "No approved templates available"}</option>
          {available.map((item)=><option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}
        </select>
      </div>
      {chosen ? <div className="form"><p className="notice">{templateText(chosen).replace(/{{(\d+)}}/g,(match,index)=>values[index]||match)}</p>{slots(chosen).map((index)=><label key={index}>Variable {index}<input name="variable" required maxLength={1024} value={values[index] || ""} onChange={(event)=>setValues({...values,[index]:event.target.value})}/></label>)}</div>
        : null}
      {file && windowOpen && !chosen && <div className="composer-file"><span>{file}</span><button className="text-button" type="button" onClick={() => {attachment.current.value="";setFile("");}}>Remove attachment</button></div>}
      <div className="composer-bar">
        <button className="secondary composer-icon" type="button" aria-label="Choose approved template" title="Choose approved template"
          aria-expanded={templatesOpen} aria-controls="composer-template-picker" onClick={loadTemplates}><span className="composer-template-icon" aria-hidden="true"/></button>
        <input hidden ref={attachment} type="file" name="attachment" disabled={!windowOpen || Boolean(chosen)}
          accept="image/png,image/jpeg,application/pdf,audio/mpeg,audio/ogg,video/mp4"
          onChange={(event)=>setFile(event.target.files[0]?.name || "")}/>
        {windowOpen && !chosen && <>
          <button className="secondary composer-icon" type="button" aria-label="Attach image or file" title="Attach image or file"
            onClick={() => attachment.current?.click()}><span className="composer-image-icon" aria-hidden="true"/></button>
          <textarea ref={composerInput} name="body" maxLength={4096} rows={1} placeholder="Type a message…" aria-label="Message" onKeyDown={(event) => {
            if (event.key==="Enter" && (event.ctrlKey||event.metaKey) && !event.nativeEvent.isComposing) {event.preventDefault();event.currentTarget.form.requestSubmit();}
          }}/>
        </>}
        <button className="composer-send" disabled={working || (Boolean(chosen) && templatesLoading) || (!chosen && !windowOpen)}>{working ? "Sending…" : "Send"}</button>
      </div>
    </form>}
  </section>;
}
function Details({thread,admin,team,refresh}) {
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [pending,setPending] = useState(false);
  return <aside className="details"><h2>Customer details</h2><dl className="facts">
    <dt>Customer</dt><dd>{name(thread)}</dd><dt>WhatsApp</dt><dd>+{thread.wa_id}</dd>
    <dt>First contact</dt><dd>{date(thread.created)}</dd><dt>Last inbound</dt><dd>{date(thread.last_inbound)}</dd>
    <dt>Service window expires</dt><dd>{date(thread.last_inbound ? thread.last_inbound+86400000 : null)}</dd>
    <dt>Last message</dt><dd>{date(thread.last_message)}</dd><dt>Marketing opt-in</dt><dd>{thread.opt_in === "yes" ? "Opted in" : thread.opt_in === "no" ? "Opted out" : "Unrecorded"}{thread.opt_source && <small>{thread.opt_source} · {date(thread.opt_at)}</small>}</dd>
    <dt>Assigned to</dt><dd>{thread.agent || "Unassigned"}</dd></dl>
    <form className="form" onSubmit={async (event)=>{
      event.preventDefault();setPending(true);setError("");setMessage("");
      const form = new FormData(event.currentTarget);form.set("id",thread.id);
      try { await api("conversation",form);refresh();setMessage("Saved."); }
      catch (error) { setError(error.message); }
      finally { setPending(false); }
    }}>
    <label>Status<select name="status" defaultValue={thread.status}><option>Open</option><option>Pending</option><option>Closed</option></select></label>
    {admin && <label>Assign agent<select name="agent" defaultValue={thread.agent_id || ""}><option value="">Unassigned</option>{team.map((member)=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
    <label>Internal notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={thread.notes}/></label><label>Tags<input name="tags" maxLength={400} defaultValue={thread.tags}/></label>
    {admin && <><label>Update marketing consent<select name="consent"><option value="">Keep current record</option><option value="yes">Record opt-in</option><option value="no">Record opt-out</option><option value="clear">Clear record</option></select></label><label>Consent source<input name="source" maxLength={200}/></label></>}
    <button disabled={pending}>Save details</button><Status error={error} message={message}/>
    </form>
  </aside>;
}
const definitions = {
  templates:["Templates","Meta template status, languages and message previews.","templates"],
  team:["Team","Manage access to the WhatsApp workspace.","team"],
  "settings/whatsapp":["WhatsApp Settings","Connection diagnostics and webhook activity.","settings"],
  "deletion-requests":["Data Deletion Requests","Review privacy and support requests.","requests"],
  logs:["Logs","Administrative actions and Meta API diagnostics.","logs"],
};
function Management({section,admin}) {
  const [label,detail,resource] = definitions[section];
  const [data,setData] = useState(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [pending,setPending] = useState(false);
  const [result,setResult] = useState(null);
  useEffect(() => {
    let active = true;
    api(resource).then((value) => {if(active)setData(value);}).catch((error) => {if(active)setError(error.message);});
    return () => {active=false;};
  },[resource]);
  async function refreshTemplates() {
    setError("");
    try { setData(await api("templates")); }
    catch (error) { setError(error.message); }
  }
  async function submitTemplate(form) {
    setPending(true);setError("");setMessage("");
    try {
      const {id,status} = await api("templates",form);
      setMessage("Submitted to Meta. Status: " + (status || "Check Meta templates") + (id ? " ? ID " + id : ""));
      await refreshTemplates();
      return true;
    } catch (error) {setError(error.message);return false;}
    finally {setPending(false);}
  }
  async function mutate(form) {
    setPending(true);setError("");setMessage("");
    try {const value=await api(resource,form);setResult(value);setMessage(value.accepted ? "Meta accepted the authorized test message." : "Action completed.");setData(await api(resource));return true;}
    catch (error) {setError(error.message);return false;}
    finally {setPending(false);}
  }
  return <><Header label={label} detail={detail}/><div className="work-content"><Status error={error} message={message}/>
    {!data && !error && <div className="panel skeleton" role="status">Loading {label.toLowerCase()}…</div>}
    {data && resource === "team" && <><section className="panel"><h2>Add team member</h2><form className="form team-form" onSubmit={async (event)=>{
      event.preventDefault();const el=event.currentTarget;if(await mutate(new FormData(el)))el.reset();
    }}><label>Name<input name="name" required maxLength={120}/></label><label>Email<input name="email" type="email" required/></label>
    <label>Role<select name="role"><option>AGENT</option><option>ADMIN</option></select></label><label>Initial password<input name="password" type="password" autoComplete="new-password" minLength={14} maxLength={256} required/></label>
    <button disabled={pending}>Add member</button></form></section><section className="panel"><h2>Team members</h2><div className="rows">
      {data.map((member)=><article key={member.id}><strong>{member.name}</strong><span>{member.email}</span><small>{member.role}</small>{member.active ? <button className="secondary" disabled={pending} onClick={()=>mutate(formOf({action:"disable",id:member.id}))}>Disable</button> : <small>Disabled</small>}</article>)}</div></section></>}
    {data && resource === "settings" && <section className="panel"><h2>Integration configuration</h2><dl className="facts">
      {Object.entries({"Meta App ID":data.appId,"WABA ID":data.waba,"Phone Number ID":data.phoneId,"Graph API":data.version,"Callback URL":data.webhook,"Verification challenge served":date(data.activity.verification),"Last signed webhook":date(data.activity.delivery),"Last accepted outbound message":date(data.activity.outbound),"Delivered templates in retained history":data.deliveredTemplates,"Repeated webhook failures":data.repeatedWebhookFailures}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value === "" ? "Unconfigured" : value}</dd></div>)}</dl>
      <div className="actions"><button disabled={pending} onClick={()=>mutate(formOf({action:"connection"}))}>Test connection and permissions</button><button className="secondary" disabled={pending} onClick={()=>mutate(formOf({action:"test"}))}>Send authorized test message</button><button className="secondary" onClick={async()=>{
        try {await navigator.clipboard.writeText(data.webhook);setMessage("Callback URL copied.");} catch {setError("Select the callback URL to copy it.");}
      }}>Copy callback URL</button></div>
      {result?.number && <p className="notice">Connected to {result.number.display_phone_number || data.phoneId}{result.number.verified_name ? " · "+result.number.verified_name : ""}{result.number.quality_rating ? " · Quality "+result.number.quality_rating : ""}. Template access {result.templateAccess ? "confirmed" : "unconfirmed"}. WABA subscription {result.appSubscription === true ? "confirmed" : "unconfirmed"}.</p>}
      <p>Check billed usage and applicable pricing in <a href="https://business.facebook.com/wa/manage/">WhatsApp Manager</a>.</p>
      <details><summary>Webhook setup</summary><p>In your Meta app, configure the callback URL and matching verification token. Subscribe to the WhatsApp Business Account messages field, then subscribe the app to your WABA and send a test message.</p></details>
      <h2>Recent API errors</h2><LogRows rows={data.errors}/></section>}
    {data && resource === "logs" && <section className="panel"><h2>Recent events</h2><LogRows rows={data}/></section>}
    {resource === "templates" && <TemplateLibrary data={data} admin={admin} busy={pending} refresh={refreshTemplates} submit={submitTemplate}/>}
    {data && resource === "requests" && <section className="panel"><h2>Request queue</h2>{!data.length && <p className="empty">No customer requests.</p>}
      {data.map((item)=><details key={item.ref} className="request-row"><summary>{item.kind} · {item.status} · {date(item.created)}</summary><p>Reference {item.ref}</p>
        {item.resolved ? <p>Resolved {date(item.resolved)}</p> : <><p>{item.name} · +{item.phone} {item.email && " · "+item.email}</p><p className="pre">{item.details}</p>
        <form className="form" onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget,event.nativeEvent.submitter);form.set("ref",item.ref);void mutate(form);}}>
          {item.kind !== "Support" && <label className="checkbox"><input type="checkbox" name="acknowledged" value="yes" required/> {item.status === "Verified" ? "I authorize erasure of the verified customer’s local records." : "I verified this customer’s identity through an approved channel."}</label>}
          <div className="actions">{item.kind !== "Support" && (item.status === "Verified" ? <button disabled={pending} name="action" value="complete">Erase customer data</button> : <button disabled={pending} name="action" value="verify">Record identity verification</button>)}
          <button formNoValidate className="secondary" disabled={pending} name="action" value="close">Close request</button></div>
        </form></>}
      </details>)}</section>}
  </div></>;
}
function LogRows({rows}) {
  return rows.length ? <div className="rows">{rows.map((row,index)=><article key={row.id || index}><strong>{row.event.replaceAll("_"," ")}</strong><span>{row.detail || "—"}</span><small>{date(row.stamp)}{row.actor ? " · User "+row.actor : ""}</small></article>)}</div>
    : <p className="empty">No events recorded.</p>;
}
