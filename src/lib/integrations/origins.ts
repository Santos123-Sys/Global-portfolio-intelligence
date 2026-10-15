/** Only an explicitly configured HTTPS root can host an embedded financial module. */
export function financialOrigin(value:string|undefined):string|null{
 try{const u=new URL(value??'');return u.protocol==='https:'&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash?u.origin:null;}catch{return null;}
}
