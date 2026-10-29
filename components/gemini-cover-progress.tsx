"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "./language-provider";
type Job={id:string;status:string;attempts:number;outcome:{notes?:string;error?:string;coverUrl?:string;searchSuggestions?:string;queries?:string[];sources?:{title:string;url:string}[]};copy:{legacy_id:string;work:{title:string}}|null};
export function GeminiCoverProgress({importId,collectionUrl}:{importId:string;collectionUrl:string}) {
  const t=useTranslations();const [jobs,setJobs]=useState<Job[]>([]),[running,setRunning]=useState(true),[loaded,setLoaded]=useState(false),[error,setError]=useState("");
  const alive=useRef(true),active=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function request(action:"status"|"next") {
    const response=await fetch("/api/gemini/covers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({importId,action})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"Cover search failed.");return result.jobs as Job[];
  }
  useEffect(()=>{
    if(!running||active.current)return;
    active.current=true;
    (async()=>{
      try {
        let current=await request("status");if(!alive.current)return;setJobs(current);setLoaded(true);
        // A single book per request gives every book its own context and budget.
        while(alive.current&&runRef.current&&current.some(job=>job.status==="pending"||job.status==="running")) {
          current=await request("next");if(!alive.current)return;setJobs(current);
          await new Promise(resolve=>setTimeout(resolve,current.some(job=>job.status==="running")?5000:1800));
        }
        if(alive.current)setRunning(false);
      }catch(reason){if(alive.current){setError(reason instanceof Error?reason.message:"Cover search failed.");setRunning(false);}}
      finally{active.current=false;}
    })();
  // The request loop follows runRef so Pause takes effect after the current book.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[running,importId]);
  const runRef=useRef(running);runRef.current=running;
  const finished=jobs.filter(job=>!["pending","running"].includes(job.status)).length;
  return <section className="gemini-progress">
    <p>{t("Your books are saved. Cover searches run one book at a time while this page is open. Progress is saved; return to this page to resume.")}</p>
    <Link className="secondary-button" href={collectionUrl}>{t("View collection")}</Link>
    <p role="status">{loaded?t("{0} of {1} cover searches processed",[finished,jobs.length]):t("Loading cover searches…")}</p>
    {loaded&&<progress value={finished} max={Math.max(1,jobs.length)} aria-label={t("Cover search progress")}/>}
    <div className="collection-editor-actions"><button className="secondary-button" type="button" onClick={()=>{setError("");setRunning(!running);}}>{running?t("Pause after current book"):t("Resume cover searches")}</button></div>
    {error&&<p className="form-error" role="alert">{t(error)}</p>}
    {loaded&&!jobs.length&&<p>{t("No missing covers in this import.")}</p>}
    <ul className="gemini-job-list">{jobs.map(job=><li key={job.id}><strong>{job.copy?.work?.title??job.copy?.legacy_id??t("Book")}</strong><span>{t(({pending:"Waiting",running:"Searching…",found:"Cover found",not_found:"No suitable cover found",failed:"No suitable cover found",skipped:"Existing cover kept"} as Record<string,string>)[job.status]??job.status)}</span>
      {(job.outcome.notes||job.outcome.error)&&<p>{job.outcome.error?t("No suitable cover found"):t(job.outcome.notes??"")}</p>}
      {Boolean(job.outcome.sources?.length)&&<details className="import-disclosure"><summary>{t("Search sources")}</summary><>{job.outcome.searchSuggestions&&<iframe title={t("Search suggestions")} sandbox="allow-popups" srcDoc={job.outcome.searchSuggestions} className="gemini-search-suggestions"/>}<ul>{job.outcome.sources?.filter(source=>source.url.startsWith("https://")).map((source,index)=><li key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></></details>}
    </li>)}</ul>
  </section>;
}
