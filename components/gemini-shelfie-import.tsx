"use client";
import { useState } from "react";
import { useTranslations } from "./language-provider";
import { ShelfieReview } from "./shelfie-review";
import { parseManualGenaiImport, type ManualGenaiImport } from "@/lib/manual-genai-import";

export function GeminiShelfieImport({userId,collections,configured}:{userId:string;collections:{id:string;slug:string;name:string}[];configured:boolean}) {
  const t=useTranslations();const [payload,setPayload]=useState<ManualGenaiImport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <>
    {!payload&&<form className="shelfie-form gemini-photo-form" onSubmit={async event=>{
      event.preventDefault();setError("");const form=new FormData(event.currentTarget);
      const files=form.getAll("photos").filter((file):file is File=>file instanceof File&&file.size>0);
      if(!files.length||files.length>3||files.reduce((n,file)=>n+file.size,0)>3*1024*1024){setError("Choose up to 3 photos, no more than 3 MB in total.");return;}
      setBusy(true);
      try {
        const response=await fetch("/api/gemini/analyse",{method:"POST",body:form});const result=await response.json();
        if(!response.ok)throw new Error(result.error||"Could not read the books. Please try another photo.");
        setPayload(parseManualGenaiImport(result.payload));
      }catch(reason){setError(reason instanceof Error?reason.message:"Could not read the books. Please try another photo.");}
      finally{setBusy(false);}
    }}>
      <label htmlFor="shelf-photos">{t("Shelf photos")}</label>
      <input id="shelf-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={busy||!configured}/>
      <p>{t("Choose up to 3 photos, no more than 3 MB in total.")}</p><p>{t("Up to 100 books per import. Split larger shelves into separate imports.")}</p>
      <label className="choice-row"><input type="checkbox" name="consent" value="yes" required disabled={busy||!configured}/><span>{t("Send these photos to Google Gemini to identify the books. Photos are processed for this request and are not saved by Shelfie Street.")}</span></label>
      <p className="privacy-note">{t("Google processes photos and book metadata under its own terms. Depending on the API tier, Google may use submitted content to improve its products.")} <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">{t("Google Gemini terms")}</a></p>
      {!configured&&<p role="status">{t("Gemini photo import is not configured yet.")}</p>}
      <button type="submit" className="primary-button" disabled={busy||!configured}>{busy?t("Reading your photos…"):t("Identify books")}</button>
      {busy&&<p role="status">{t("Reading your photos…")}</p>}
    </form>}
    {error&&<p role="alert" className="form-error">{t(error)}</p>}
    {payload&&<><p>{t("Review the recognised books, choose a collection, and import. Cover searches start after the books are saved.")}</p>
      <ShelfieReview key={JSON.stringify(payload)} userId={userId} collections={collections} initialPayload={payload} discoverCovers />
      <button type="button" className="secondary-button" onClick={()=>setPayload(null)}>{t("Choose different photos")}</button></>}
  </>;
}
