"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export async function api(resource, form, query = "") {
  const response = await fetch("/api/workspace/" + resource + query, form ? { method:"POST", body:form } : { cache:"no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function PublicForm({ deletion = false, login = false }) {
  const router = useRouter();
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(false);
    setMessage("");
    try {
      const result = await api(login ? "login" : "public", new FormData(form));
      if (login) { router.replace("/dashboard"); router.refresh(); return; }
      form.reset();
      setMessage("Request received. Reference " + result.reference);
    } catch (failure) { setError(true); setMessage(failure.message); }
    finally { setPending(false); }
  }
  return <form className="form" onSubmit={submit}>
    {!login && <><label>Name<input name="name" required maxLength={120} autoComplete="name"/></label>
    <label>WhatsApp number<input name="phone" required type="tel" maxLength={30} autoComplete="tel" placeholder="+91 …"/></label></>}
    <label>Email{!login && " (optional)"}<input name="email" type="email" maxLength={254} required={login} autoComplete="email"/></label>
    {login ? <label>Password<input required name="password" type="password" maxLength={256} autoComplete="current-password"/></label> : <>
      {deletion ? <label>Request type<select name="kind"><option>Delete my data</option><option>Anonymize my data</option></select></label> : <input type="hidden" name="kind" value="Support"/>}
      <label>Additional details<textarea name="details" maxLength={2000} rows={4}/></label>
      <label hidden aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
      {deletion && <label className="checkbox"><input required type="checkbox" name="consent" value="yes"/> I have read the <Link href="/privacy-policy">privacy policy</Link> and agree to be contacted to verify this request.</label>}
    </>}
    <button disabled={pending}>{pending ? "Submitting…" : login ? "Sign in" : "Submit request"}</button>
    {message && <p className={error ? "alert" : "success"} role={error ? "alert" : "status"}>{message}</p>}
  </form>;
}
