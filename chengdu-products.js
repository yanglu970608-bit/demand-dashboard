/* Dynamic non-SLOTS rows, validated by the shared workspace and publishing APIs. */
function setupChengduProducts() {
  const button=document.createElement('button');
  button.className='btn';button.id='add-chengdu-product';button.textContent='＋ 新增产品行';
  document.querySelector('#chengdu-view .panel-head').append(button);
  const dialog=document.createElement('dialog');
  dialog.id='chengdu-product-dialog';
  dialog.innerHTML=`<form id="chengdu-product-form">
    <h2>新增产品行</h2><p class="hint">添加到当前月份，并联动到非SLOTS产品需求量、需求量方案。制作天数自动计算。</p>
    <label>负责小组<select name="group"><option value="0">成都</option><option value="1">素材支持</option></select></label>
    <label>产品名称<input name="product" list="chengdu-known-products" required maxlength="30" placeholder="输入新产品，或选择已有产品" autocomplete="off"></label>
    <datalist id="chengdu-known-products"></datalist>
    <label>产品需求（条）<input name="demand" type="number" min="0" max="10000000" step="1" value="0" required></label>
    <label>单需求制作时间（天）<input name="avgTime" type="number" min="0" max="10000000" step="0.1" value="1" required></label>
    <div class="new-product-days">产品制作天数：<strong id="new-product-days">0</strong> 天</div>
    <p id="new-product-error" role="alert"></p>
    <div class="new-product-actions"><button class="btn" type="button" id="cancel-chengdu-product">取消</button><button class="btn primary" type="submit">添加并联动</button></div>
  </form>`;
  document.body.append(dialog);
  const style=document.createElement('style');
  style.textContent=`#chengdu-product-dialog{border:1px solid #e5e7eb;border-radius:18px;padding:24px;width:440px;max-width:calc(100vw - 32px);color:#172033;font:14px/1.5 "Microsoft YaHei",sans-serif}#chengdu-product-dialog::backdrop{background:#17203355}#chengdu-product-dialog h2{margin-top:0}#chengdu-product-dialog label{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:15px 0}#chengdu-product-dialog input,#chengdu-product-dialog select{width:220px;max-width:60%;padding:9px;border:1px solid #d7dce5;border-radius:9px;background:white;text-align:center}#chengdu-product-dialog .new-product-days{padding:12px;background:#f2f5fb;border-radius:10px;text-align:center}#new-product-error{color:#bc3636;min-height:21px}.new-product-actions{display:flex;justify-content:flex-end;gap:10px}#add-chengdu-product{white-space:nowrap}#chengdu-view .panel-head{flex-wrap:wrap}`;
  document.head.append(style);
  const form=dialog.querySelector('form'),field=name=>form.elements.namedItem(name);
  const error=message=>document.getElementById('new-product-error').textContent=message;
  const close=()=>{dialog.close();cloud.modalOpen=false;};
  button.onclick=()=>{
    if(!cloud.ready||cloud.modalOpen)return;
    form.reset();error('');document.getElementById('new-product-days').textContent='0';
    const list=document.getElementById('chengdu-known-products');list.replaceChildren();
    store.months[selectedMonth].nonSlots.forEach(r=>{const option=document.createElement('option');option.value=r.product;list.append(option);});
    cloud.modalOpen=true;dialog.showModal();field('product').focus();
  };
  document.getElementById('cancel-chengdu-product').onclick=close;
  dialog.addEventListener('cancel',()=>{cloud.modalOpen=false;});
  form.oninput=()=>{error('');document.getElementById('new-product-days').textContent=Number((Number(field('demand').value)*Number(field('avgTime').value)).toFixed(6));};
  form.onsubmit=e=>{
    e.preventDefault();
    const month=store.months[selectedMonth],group=month.chengduGroups[Number(field('group').value)];
    const name=field('product').value.trim().toUpperCase();
    if(!/^[A-Z0-9\u4e00-\u9fff][A-Z0-9\u4e00-\u9fff +_.()-]{0,29}$/.test(name))return error('名称限30字，可使用中文、字母、数字、空格、+、-、_、.、括号。');
    if(['SLOTS','CC',...data.map(r=>r.product)].includes(name))return error('SLOTS产品由北京调量联动，请勿在此重复添加。');
    const code=month.nonSlots.find(r=>r.product.toUpperCase()===name)?.product||name;
    if(group.products.some(r=>r.product===code))return error('该小组已经有这个产品，请直接修改已有行。');
    if(group.products.length>=30||(!month.nonSlots.some(r=>r.product===code)&&month.nonSlots.length>=60))return error('当前产品数量已达到上限。');
    const demand=Number(field('demand').value),avgTime=Number(field('avgTime').value);
    if(!form.checkValidity())return form.reportValidity();
    rememberUndo();
    group.products.push({product:code,demand,avgTime});
    syncChengdu(month);close();render();saveMonths();
  };
}
