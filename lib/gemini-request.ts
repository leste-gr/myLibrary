export function sameOriginRequest(request:Request) {
  try {const origin=new URL(request.headers.get("origin")??"");return ["http:","https:"].includes(origin.protocol)&&origin.host===request.headers.get("host");}catch{return false;}
}
