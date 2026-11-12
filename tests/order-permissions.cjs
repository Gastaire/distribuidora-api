const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const calls = [];
let owner = 2;
const query = async (sql, params) => {
    calls.push({sql, params});
    if (sql.includes('FROM clientes')) return {rows: [{id: 8, vendedor_id: owner}]};
    if (sql.includes('password_hash')) return {rows: [{password_hash: 'hash', rol: 'admin', activo: true}]};
    if (sql.includes('FROM pedido_items')) return {rows: [{producto_id: 3, cantidad: 2, nombre_producto: 'QA', precio_congelado: '50'}]};
    if (sql.includes('FROM productos')) return {rows: [{nombre: 'QA', precio_unitario: '99', codigo_sku: 'QA'}]};
    return {rows: [{id: 1}]};
};
const moduleMock = {exports: {}};
vm.runInNewContext(fs.readFileSync('src/controllers/pedidos.controller.js', 'utf8'), {
    module: moduleMock, __dirname: '/tmp', console,
    require: name => name === '../services/syncReceipt' ? require('../src/services/syncReceipt') : name === '../db' ? {pool: {query, connect: async () => ({query, release() {}})}} : name === 'bcryptjs' ? {compare: async password => password === 'correct'} : require(name)
});
const run = async (method, body, user = {id: 1, nombre: 'QA', rol: 'admin'}) => {
    calls.length = 0;
    const res = {code: 200, status(code) {this.code = code; return this;}, json(body) {this.body = body;}};
    await moduleMock.exports[method]({params: {id: 1}, body, user}, res);
    return res;
};
(async () => {
    let result = await run('createPedido', {cliente_id: 8, items: [{producto_id: 3, cantidad: 2}], lista_precios_id: 1}, {id: 1, nombre: 'QA', rol: 'vendedor'});
    assert.equal(result.code, 403);
    assert.ok(!calls.some(call => call.sql.startsWith('INSERT')));
    result = await run('updatePedidoItems', {items: [{producto_id: 3, cantidad: 3}]});
    assert.equal(result.code, 200);
    assert.equal(calls.find(call => call.sql.startsWith('INSERT INTO pedido_items')).params[3], '50');
    result = await run('updatePedidoItems', {items: [{producto_id: 3, cantidad: 3, precio_congelado: 40}], password: 'wrong'});
    assert.equal(result.code, 403);
    assert.ok(!calls.some(call => call.sql.startsWith('DELETE')));
    result = await run('updatePedidoItems', {items: [{producto_id: 3, cantidad: 3, precio_congelado: 40}], password: 'correct'});
    assert.equal(result.code, 200);
    assert.equal(calls.find(call => call.sql.startsWith('INSERT INTO pedido_items')).params[3], 40);
    assert.ok(calls.find(call => call.sql.startsWith('INSERT INTO actividad')).params[3].includes('50 a 40'));
    assert.ok(!calls.some(call => call.sql.startsWith('UPDATE productos')));
    result = await run('updatePedidoItems', {items: [{producto_id: 3, cantidad: 3, precio_congelado: -1}], password: 'correct'});
    assert.equal(result.code, 400);
    console.log('PASS ownership, frozen prices, password enforcement, price validation and audit');
})().catch(error => {console.error(error); process.exitCode = 1;});
