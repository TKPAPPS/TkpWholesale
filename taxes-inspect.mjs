const URL=process.env.ODOO_URL,DB=process.env.ODOO_DB,LOGIN=process.env.ODOO_ADMIN_LOGIN,KEY=process.env.ODOO_ADMIN_API_KEY
async function rpc(s,m,a){const r=await fetch(`${URL}/jsonrpc`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'call',params:{service:s,method:m,args:a},id:1})});const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error.data?.message||j.error));return j.result}
const kw=(uid,mo,me,p,k={})=>rpc('object','execute_kw',[DB,uid,KEY,mo,me,p,k])
const uid=await rpc('common','authenticate',[DB,LOGIN,KEY,{}])
const t=await kw(uid,'account.tax','read',[[2,185,187,207,228,302,339,602,19]],{fields:['id','name','amount','price_include','company_id','type_tax_use']})
t.forEach(x=>console.log(`  tax ${String(x.id).padEnd(4)} amt=${x.amount} incl=${x.price_include} use=${x.type_tax_use} company=${JSON.stringify(x.company_id)} "${x.name}"`))
