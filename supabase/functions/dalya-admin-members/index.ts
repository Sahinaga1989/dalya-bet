import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req: Request) => {
 const headers={"Access-Control-Allow-Origin":"https://sahinaga1989.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
 const send=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return send(405,{message:"Yalnızca POST."});
 try{
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!secret)return send(503,{message:"Sunucu ayarları eksik."});
 const token=req.headers.get("Authorization")||"";
 if(!token.startsWith("Bearer "))return send(401,{message:"Oturum gerekli."});
 const client=createClient(url,anon,{global:{headers:{Authorization:token}}});
 const {data:{user},error}=await client.auth.getUser();
 if(error||!user)return send(401,{message:"Oturum geçersiz."});
 const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:role,error:roleError}=await admin.from("dalya_admins").select("user_id").eq("user_id",user.id).maybeSingle();
 if(roleError||!role)return send(403,{message:"Yönetici yetkisi gerekli."});
 const payload=await req.json().catch(()=>({}));
 const page=Number(payload?.page)||1;
 if(!Number.isInteger(page)||page<1||page>100000)return send(400,{message:"Sayfa geçersiz."});
 const {data,error:listError}=await admin.auth.admin.listUsers({page,perPage:100});
 if(listError)return send(500,{message:"Üye listesi alınamadı."});
 const ids=data.users.map(u=>u.id);
 const {data:wallets,error:walletError}=ids.length?await admin.from("dalya_wallets").select("user_id,balance").in("user_id",ids):{data:[],error:null};
 if(walletError)return send(500,{message:"Bakiyeler alınamadı."});
 const balances=new Map((wallets||[]).map(w=>[w.user_id,w.balance]));
 const members=data.users.map(u=>({id:u.id,email:u.email||"",created_at:u.created_at,last_sign_in_at:u.last_sign_in_at||null,confirmed:!!u.email_confirmed_at,invited:!!u.invited_at,banned_until:u.banned_until||null,balance:balances.get(u.id)??0}));
 return send(200,{members,page,has_more:data.users.length===100});
 }catch{return send(500,{message:"Üye listesi alınamadı."});}
});