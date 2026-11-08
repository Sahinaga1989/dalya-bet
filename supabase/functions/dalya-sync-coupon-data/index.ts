import {createClient} from "npm:@supabase/supabase-js@2";
Deno.serve(async(req:Request)=>{
 const headers={"Access-Control-Allow-Origin":"https://sahinaga1989.github.io","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
 const out=(status:number,obj:unknown)=>new Response(JSON.stringify(obj),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return out(405,{message:"Method not allowed"});
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return out(503,{message:"Server config missing"});
  const authorization=req.headers.get("Authorization")||"";
  if(!authorization.startsWith("Bearer "))return out(401,{message:"Login required"});
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error}=await caller.auth.getUser();
  if(error||!user)return out(401,{message:"Invalid session"});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:state}=await admin.from("dalya_sync_state").select("last_started").eq("id",1).single();
  if(state?.last_started&&Date.now()-Date.parse(state.last_started)<10*60*1000)return out(200,{message:"Recently synchronized"});
  const {data:claimed,error:claimError}=await admin.from("dalya_sync_state").update({last_started:new Date().toISOString()}).eq("id",1).or(state?.last_started?"last_started.is.null,last_started.lt."+new Date(Date.now()-10*60*1000).toISOString():"last_started.is.null").select("id");
  if(claimError||!claimed?.length)return out(200,{message:"Sync in progress"});
  const root="https://raw.githubusercontent.com/Sahinaga1989/dalya-bet/main/";
  const get=async(file:string)=>{const response=await fetch(root+file+"?t="+Date.now(),{signal:AbortSignal.timeout(18000)});if(!response.ok)throw Error("GitHub "+file+" "+response.status);return response.json()};
  const [scores,odds]=await Promise.all([get("scores.json"),get("odds.json")]);
  if(!Array.isArray(scores.response)||!odds.matches||typeof odds.matches!=="object")throw Error("Invalid data");
  const now=Date.now(), fixtures=[];
  for(const m of scores.response){
   const id=String(m?.fixture?.id||"");
   const time=Date.parse(m?.fixture?.date||"");
   if(!/^\d{4,15}$/.test(id)||!Number.isFinite(time)||time<=now-86400000||time>now+32*86400000)continue;
   fixtures.push({id,payload:m,updated_at:new Date().toISOString()});
  }
  for(let i=0;i<fixtures.length;i+=100){const {error:e}=await admin.from("dalya_match_data").upsert(fixtures.slice(i,i+100),{onConflict:"id"});if(e)throw Error("Fixtures sync failed: "+e.message)}
  const rows=[];
  for(const [id,v] of Object.entries(odds.matches) as [string,any][]){
   if(!/^\d{4,15}$/.test(id))continue;
   const parse=(x:any)=>{if(x===null||x===undefined||x==="")return null;const n=Number(x);return Number.isFinite(n)&&n>=1&&n<=1000?n:null};
   const updated=Date.parse(v?.fetched_at||"");
   if(!Number.isFinite(updated)||updated>now+600000)continue;
   rows.push({fixture_id:id,odd_1:parse(v["1"]),odd_x:parse(v.X),odd_2:parse(v["2"]),updated_at:new Date(updated).toISOString()});
  }
  for(let i=0;i<rows.length;i+=100){const {error:e}=await admin.from("dalya_coupon_odds").upsert(rows.slice(i,i+100),{onConflict:"fixture_id"});if(e)throw Error("Odds sync failed: "+e.message)}
  await admin.from("dalya_sync_state").update({last_completed:new Date().toISOString()}).eq("id",1);
  return out(200,{message:"Synchronized",fixtures:fixtures.length,odds:rows.length});
 }catch(e){return out(500,{message:"Sync failed; existing data preserved",detail:String(e).slice(0,200)})}
});