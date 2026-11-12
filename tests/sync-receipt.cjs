const assert = require('node:assert/strict');
const {readReceipt, writeReceipt} = require('../src/services/syncReceipt');
const receipts = [];
const calls = [];
const client = {query:async(sql, params)=>{
 calls.push(sql);
 if (sql.startsWith('INSERT')) receipts.push({user:params[0],kind:params[2],detalle:params[3]});
 if (sql.startsWith('SELECT detalle')) return {rows:receipts.filter(row=>row.user===params[0] && row.kind===params[1] && row.detalle.split('\n')[0]===params[2])};
 return {rows:[]};
}};
(async()=>{
 const req={body:{sync_request_id:'local_qa-123'},user:{id:7,nombre:'QA'}};
 assert.equal(await readReceipt(client,req,'SYNC_PEDIDO'),null);
 await writeReceipt(client,req,'SYNC_PEDIDO',{pedido_id:51});
 assert.deepEqual(await readReceipt(client,req,'SYNC_PEDIDO'),{pedido_id:51});
 await assert.rejects(()=>readReceipt(client,{...req,body:{...req.body,items:[{cantidad:9}]}},'SYNC_PEDIDO'), error=>error.status===409 && error.existing_id===51);
 assert.equal(await readReceipt(client,{...req,user:{id:8}},'SYNC_PEDIDO'),null);
 assert.equal(await readReceipt(client,req,'SYNC_CLIENTE'),null);
 assert.ok(calls[0].includes('pg_advisory_xact_lock'));
 await assert.rejects(()=>readReceipt(client,{...req,body:{sync_request_id:'bad\nkey'}},'SYNC_PEDIDO'));
 assert.equal(await readReceipt(client,{...req,body:{}},'SYNC_PEDIDO'),null);
 console.log('PASS persistent confirmation lookup, user/type isolation, transaction lock and legacy compatibility');
})().catch(error=>{console.error(error);process.exitCode=1;});
