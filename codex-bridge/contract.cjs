const assert = require('node:assert/strict');
const roles = ['plan','cross','director','kol','image'];
function validateRequest(input) {
  assert.match(input.month, /^\d{4}-(0[1-9]|1[0-2])$/);
  assert.ok(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 100);
  for (const key of ['planCross','directorKol']) assert.ok(Number.isSafeInteger(input.targets[key]) && Math.abs(input.targets[key]) <= 1000000);
  const seen = new Set();
  const rows = input.rows.map(r => {
    assert.match(r.product, /^[A-Z0-9+_-]{1,50}$/);
    assert.ok(!seen.has(r.product)); seen.add(r.product);
    const base = {};
    for (const k of roles) {
      assert.ok(Number.isSafeInteger(r.base[k]) && r.base[k] >= 0 && r.base[k] <= 10000000);
      base[k] = r.base[k];
    }
    const metrics = {};
    for (const k of ['roi','planCrossRoi','directorRoi','spendShare','demandShare','trend']) {
      assert.ok(r.metrics[k] == null || (Number.isFinite(r.metrics[k]) && Math.abs(r.metrics[k]) <= 1000000));
      metrics[k] = r.metrics[k] ?? null;
    }
    return {product:r.product,base,metrics};
  });
  return {month:input.month,targets:{planCross:input.targets.planCross,directorKol:input.targets.directorKol},rows};
}
function validateResult(request, result) {
  assert.ok(Array.isArray(result.rows) && result.rows.length === request.rows.length);
  const seen = new Set(), sums = {planCross:0,directorKol:0};
  for (const r of result.rows) {
    const b=request.rows.find(x=>x.product===r.product)?.base;
    assert.ok(b && !seen.has(r.product)); seen.add(r.product);
    for (const [k,ks] of [['planCross',['plan','cross']],['directorKol',['director','kol']]]) {
      assert.ok(Number.isSafeInteger(r[k]) && Math.abs(r[k]) <= 1000000);
      assert.ok(ks.reduce((n,key)=>n+b[key],0)+r[k]>=0);
      sums[k]+=r[k];
    }
    assert.ok(typeof r.reason==='string' && r.reason.length<=500);
  }
  assert.deepEqual(sums,request.targets);
  return result;
}
function splitPair(amount,a,b) {
  const first=a+b ? Math.round(amount*a/(a+b)) : amount;
  return [first,amount-first];
}
module.exports={validateRequest,validateResult,splitPair};
