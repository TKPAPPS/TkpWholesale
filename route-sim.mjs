const URL=process.env.ODOO_URL,DB=process.env.ODOO_DB,LOGIN=process.env.ODOO_ADMIN_LOGIN,KEY=process.env.ODOO_ADMIN_API_KEY
async function rpc(s,m,a){const r=await fetch(`${URL}/jsonrpc`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'call',params:{service:s,method:m,args:a},id:1})});const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error.data?.message||j.error));return j.result}
const kw=(uid,mo,me,p,k={})=>rpc('object','execute_kw',[DB,uid,KEY,mo,me,p,k])
const uid=await rpc('common','authenticate',[DB,LOGIN,KEY,{}])

// Exactly the reads the route now performs, same field lists
const id=816892
const move=(await kw(uid,'account.move','read',[[id]],{fields:['id','name','invoice_date','invoice_date_due','amount_total','amount_residual','amount_untaxed','amount_tax','payment_state','currency_id','commercial_partner_id','state','move_type','narration','partner_id','company_id','invoice_origin','ref','payment_reference','invoice_payment_term_id']}))[0]
const lines=await kw(uid,'account.move.line','search_read',[[['move_id','=',id],['display_type','=','product']]],
  {fields:['id','name','quantity','price_unit','price_subtotal','price_total','product_id','product_uom_id'],order:'sequence, id'})
const billTo=(await kw(uid,'res.partner','read',[[move.partner_id[0]]],{fields:['id','name','street','street2','city','zip','state_id','country_id','vat']}))[0]
const company=(await kw(uid,'res.company','read',[[move.company_id[0]]],{fields:['name','street','street2','city','zip','state_id','country_id','phone','email','vat']}))[0]
const variantIds=[...new Set(lines.map(l=>l.product_id?l.product_id[0]:0).filter(Boolean))]
const variants=variantIds.length?await kw(uid,'product.product','read',[variantIds],{fields:['id','default_code']}):[]
const websiteCompanyId=(await kw(uid,'website','read',[[3]],{fields:['company_id']}))[0].company_id[0]

const skuMap={}; variants.forEach(v=>skuMap[v.id]=v.default_code||'')
console.log('=== RENDERED INVOICE (simulating the route + page) ===\n')
console.log(`ISSUED BY : ${company.name}`)
console.log(`            ${[company.street,company.street2].filter(Boolean).join(', ')}`)
console.log(`            ${[company.zip,company.city,company.state_id?company.state_id[1]:''].filter(Boolean).join(' ')}, ${company.country_id?company.country_id[1]:''}`)
console.log(`            Tax ID: ${company.vat||'(none - line hidden)'}   Phone: ${company.phone||'-'}`)
console.log(`  wordmark shown? ${move.company_id[0]===websiteCompanyId ? 'YES (is portal company)' : 'NO (different group company - correct)'}`)
console.log(`\nINVOICE   : ${move.name}   issued ${move.invoice_date}   due ${move.invoice_date_due}   order ${move.invoice_origin||'-'}`)
console.log(`BILL TO   : ${billTo.name}`)
console.log(`            ${[billTo.street,billTo.street2].filter(Boolean).join(', ')}`)
console.log(`            ${[billTo.zip,billTo.city,billTo.state_id?billTo.state_id[1]:''].filter(Boolean).join(' ')}, ${billTo.country_id?billTo.country_id[1]:''}`)
console.log(`            Tax ID: ${billTo.vat||'(none - line hidden)'}`)
console.log(`\nLINES (${lines.length}):`)
lines.forEach(l=>console.log(`  ${String(l.name).slice(0,40).padEnd(42)} sku=${(l.product_id?skuMap[l.product_id[0]]:'').padEnd(10)} uom=${(l.product_uom_id?l.product_uom_id[1]:'').padEnd(8)} qty=${String(l.quantity).padStart(4)} unit=${String(l.price_unit).padStart(8)} amount=${String(l.price_subtotal).padStart(8)}`))
const lineSum=Math.round(lines.reduce((s,l)=>s+l.price_subtotal,0)*100)/100
console.log(`\nTOTALS    : subtotal ${move.amount_untaxed}   VAT ${move.amount_tax}   TOTAL ${move.amount_total}   due ${move.amount_residual}`)
console.log(`CHECK     : sum(lines)=${lineSum} vs amount_untaxed=${move.amount_untaxed}  -> ${Math.abs(lineSum-move.amount_untaxed)<0.01?'MATCH':'MISMATCH'}`)
const days=Math.floor((Date.UTC(2026,7,5)-Date.UTC(...move.invoice_date_due.split('-').map((v,i)=>i===1?+v-1:+v)))/86400000)
console.log(`STATUS    : residual ${move.amount_residual} -> ${move.amount_residual<=0?'Paid in full':`Overdue by ${days} days`}`)
console.log(`FOOTER    : terms=${move.invoice_payment_term_id?move.invoice_payment_term_id[1]:'(none - hidden)'}  ref=${move.payment_reference||move.ref||'-'}  note=${move.narration||'(none - hidden)'}`)
