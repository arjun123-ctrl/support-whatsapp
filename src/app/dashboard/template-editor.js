"use client";

import { useEffect, useRef, useState } from "react";

const buttonNames = {URL:"Visit website",PHONE_NUMBER:"Call phone number",QUICK_REPLY:"Quick reply"};
const component = (item,type) => item?.components?.find(entry => entry.type === type);
const indices = (body) => [...new Set(Array.from(body.matchAll(/{{([1-9]\d*)}}/g),match => Number(match[1])))].sort((a,b) => a-b);
const supported = (item) => ["UTILITY","MARKETING"].includes(item.category) &&
  item.components?.every(entry => entry.type === "HEADER" ? entry.format === "IMAGE" :
    entry.type === "BUTTONS" ? entry.buttons?.every(button => Object.hasOwn(buttonNames,button.type)) :
    entry.type === "FOOTER" || (entry.type === "BODY" && !/{{[^\d]/.test(entry.text || "")));

export function TemplateLibrary({data,admin,busy,refresh,submit}) {
  const [editor,setEditor] = useState(null);
  const [view,setView] = useState(null);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("All");
  const filters = ["All","Approved","Pending","Rejected","Other"];
  const items = (data || []).filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === "All" || (filter === "Other" ? !filters.slice(1,4).some(status => status.toUpperCase() === item.status) : item.status === filter.toUpperCase())));
  return <>
    {editor && <TemplateEditor key={editor.id || "new"} item={editor.id ? editor : null} pending={busy}
      close={() => setEditor(null)} submit={async form => {if (await submit(form)) setEditor(null);}}/>}
    <section className="panel template-library">
      <div className="panel-title"><h2>WhatsApp templates</h2>{admin && <button onClick={() => {setView(null);setEditor({});}}>Create template</button>}</div>
      <div className="template-toolbar">
        <div className="filters" aria-label="Filter by status">{filters.map(status => <button className="secondary" key={status}
          aria-pressed={filter === status} onClick={() => setFilter(status)}>{status}</button>)}</div>
        <input type="search" aria-label="Search by template name" placeholder="Search templates" value={query} onChange={event => setQuery(event.target.value)}/>
        <button className="secondary" disabled={busy} onClick={refresh}>Refresh statuses</button>
      </div>
      {items.length > 0 && <div className="template-table"><table><thead><tr>
        <th>Name</th><th>Language</th><th>Category</th><th>Format</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>{items.map(item => <tr key={item.id}>
        <th scope="row">{item.name}</th><td>{item.language}</td><td>{item.category}</td>
        <td>{component(item,"HEADER")?.format || "TEXT"}</td><td><span className="template-status" data-status={item.status}>{item.status}</span></td>
        <td><div className="actions"><button className="secondary" onClick={() => setView(item)}>Preview</button>
          {admin && supported(item) && <button className="secondary" onClick={() => {setView(null);setEditor(item);}}>Edit</button>}</div></td>
      </tr>)}</tbody></table></div>}
      {data && !items.length && <p className="empty">No matching templates.</p>}
      {view && <div className="template-read"><div className="panel-title"><h3>{view.name}</h3><button className="secondary" onClick={() => setView(null)}>Close preview</button></div>
        <MessagePreview body={component(view,"BODY")?.text || ""} footer={component(view,"FOOTER")?.text}
          examples={component(view,"BODY")?.example?.body_text?.[0] || []} buttons={component(view,"BUTTONS")?.buttons?.map(b => ({label:b.text})) || []}
          imageHeader={component(view,"HEADER")?.format === "IMAGE"}/></div>}
    </section>
  </>;
}

function TemplateEditor({item,pending,close,submit}) {
  const existingBody = component(item,"BODY");
  const [body,setBody] = useState(existingBody?.text || "");
  const [footer,setFooter] = useState(component(item,"FOOTER")?.text || "");
  const [format,setFormat] = useState(component(item,"HEADER") ? "IMAGE" : "TEXT");
  const [examples,setExamples] = useState(() => Object.fromEntries((existingBody?.example?.body_text?.[0] || []).map((value,i) => [i+1,value])));
  const [image,setImage] = useState(null);
  const [imageError,setImageError] = useState("");
  const [buttons,setButtons] = useState(() => (component(item,"BUTTONS")?.buttons || []).map((button,i) => ({
    id:i,type:button.type,label:button.text,target:button.url || button.phone_number || "",sample:button.example?.[0] || "",
  })));
  const nextId = useRef(buttons.length);
  const imageRef = useRef(null);
  const bodyRef = useRef(null);
  const variables = indices(body);
  useEffect(() => () => {if (image) URL.revokeObjectURL(image);},[image]);

  function updateButton(id,field,value) {
    setButtons(previous => previous.map(button => button.id === id ? {...button,[field]:value} : button));
  }
  function moveButton(index,offset) {
    const reordered = [...buttons];
    [reordered[index],reordered[index+offset]] = [reordered[index+offset],reordered[index]];
    setButtons(reordered);
  }
  function addVariable() {
    const field = bodyRef.current;
    const index = (variables.at(-1) || 0)+1;
    const start = field.selectionStart;
    const token = "{{"+index+"}}";
    const next = body.slice(0,start)+token+body.slice(field.selectionEnd);
    if (next.length > 1024) return;
    setBody(next);
    requestAnimationFrame(() => {field.focus();field.setSelectionRange(start+token.length,start+token.length);});
  }
  return <section className="panel template-editor">
    <div className="panel-title"><h2>{item ? "Edit WhatsApp template" : "Create WhatsApp template"}</h2>
      <button className="secondary" disabled={pending} onClick={close}>Cancel</button></div>
    <div className="template-editor-grid">
      <form className="form" onSubmit={event => {
        event.preventDefault();
        if (imageError) return;
        const form = new FormData(event.currentTarget);
        form.set("examples",variables.map(index => examples[index] || "").join("\n"));
        void submit(form);
      }}>
        {item && <input type="hidden" name="templateId" value={item.id}/>}
        <fieldset><legend>Basic details</legend><div className="template-fields">
          <label>Template name<input name="name" defaultValue={item?.name} readOnly={Boolean(item)} required pattern="[a-z0-9_]+" maxLength={512} placeholder="order_update"/></label>
          <label>Language code<input name="language" defaultValue={item?.language || "en_US"} readOnly={Boolean(item)} required maxLength={10}/></label>
          <label>Category<select name="category" defaultValue={item?.category || "UTILITY"}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select></label>
          <label>Header format<select value={format} onChange={event => {setFormat(event.target.value);setImage(null);setImageError("");}}><option value="TEXT">Body only</option><option value="IMAGE">Image</option></select></label>
        </div>
        {format === "IMAGE" && <div className="form">
          <label>Sample image<input ref={imageRef} name="image" type="file" accept="image/jpeg,image/png" required onChange={event => {
            const file = event.target.files[0];
            const invalid = file && (file.size > 3500000 || !["image/jpeg","image/png"].includes(file.type));
            setImageError(invalid ? "Select a PNG or JPEG up to 3.5 MB." : "");
            setImage(file && !invalid ? URL.createObjectURL(file) : null);
          }}/></label>
          {imageError && <p className="alert" role="alert">{imageError}</p>}
          {image && <div><button type="button" className="secondary" onClick={() => {imageRef.current.value="";setImage(null);}}>Remove image</button></div>}
        </div>}</fieldset>
        <fieldset><legend>Message content</legend>
          <label>Body text<textarea ref={bodyRef} name="body" rows={7} maxLength={1024} required value={body} onChange={event => setBody(event.target.value)}/></label>
          <div className="panel-title"><small>{body.length}/1024 characters · {variables.length} variables</small><button type="button" className="secondary" onClick={addVariable}>Add variable</button></div>
          {variables.length > 0 && <div className="template-fields">{variables.map(index => <label key={index}>Sample text for {"{{"+index+"}}"}<input
            required maxLength={1024} value={examples[index] || ""} onChange={event => setExamples({...examples,[index]:event.target.value})}/></label>)}</div>}
          <label>Footer (optional)<input name="footer" maxLength={60} value={footer} onChange={event => setFooter(event.target.value)}/><small>{footer.length}/60 characters</small></label>
        </fieldset>
        <fieldset><legend>Action buttons</legend>
          {buttons.map((button,index) => <div className="template-button" key={button.id}>
            <div className="panel-title"><strong>{buttonNames[button.type]}</strong><div className="actions">
              <button type="button" className="secondary" disabled={index===0} onClick={() => moveButton(index,-1)}>Move up</button>
              <button type="button" className="secondary" disabled={index===buttons.length-1} onClick={() => moveButton(index,1)}>Move down</button>
              <button type="button" className="secondary" onClick={() => setButtons(buttons.filter(entry => entry.id!==button.id))}>Remove</button>
            </div></div>
            <input type="hidden" name="buttonType" value={button.type}/>
            <label>Button label<input name="buttonLabel" required maxLength={20} value={button.label} onChange={event => updateButton(button.id,"label",event.target.value)}/></label>
            {button.type === "QUICK_REPLY" ? <input type="hidden" name="buttonTarget" value=""/> :
              <label>{button.type === "URL" ? "Website URL" : "Phone with country code"}<input name="buttonTarget" required maxLength={300}
                placeholder={button.type === "URL" ? "https://example.com/{{1}}" : "+919876543210"} value={button.target} onChange={event => updateButton(button.id,"target",event.target.value)}/></label>}
            {button.type === "URL" && button.target.endsWith("{{1}}") ? <label>Sample URL<input name="buttonSample" type="url" required maxLength={300}
              value={button.sample} onChange={event => updateButton(button.id,"sample",event.target.value)}/></label> : <input type="hidden" name="buttonSample" value=""/>}
          </div>)}
          <div className="actions">{Object.entries(buttonNames).map(([type,label]) => <button key={type} type="button" className="secondary"
            disabled={buttons.length>=10 || buttons.filter(button => button.type===type).length >= (type==="URL" ? 2 : type==="PHONE_NUMBER" ? 1 : 8)}
            onClick={() => setButtons([...buttons,{id:nextId.current++,type,label:"",target:"",sample:""}])}>Add {label.toLowerCase()}</button>)}</div>
        </fieldset>
        <div><button disabled={pending || Boolean(imageError)}>{pending ? "Submitting…" : item ? "Submit update to Meta" : "Submit for Meta review"}</button></div>
      </form>
      <aside className="template-live"><h3>Live preview</h3><MessagePreview body={body} footer={footer} examples={variables.map(index => examples[index])}
        buttons={buttons} image={image} imageHeader={format==="IMAGE"}/></aside>
    </div>
  </section>;
}

function MessagePreview({body,footer,examples,buttons,image,imageHeader}) {
  return <div className="template-phone"><div className="template-phone-header"><span className="avatar">BT</span><strong>BharatTapp</strong></div>
    <div className="template-bubble">
      {/* A temporary browser object URL cannot be optimized by next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="Sample header"/> : imageHeader && <div className="template-image-placeholder">Image header</div>}
      <p className="pre">{body.replace(/{{(\d+)}}/g,(token,index) => examples[Number(index)-1] || token) || "Your message preview"}</p>
      {footer && <small>{footer}</small>}
      {buttons.map((button,index) => <div className="template-preview-action" key={button.id ?? index}>{button.label || buttonNames[button.type]}</div>)}
    </div>
  </div>;
}
