/* Read-only renderer: only published projections; no editor scripts or mutation calls. */
(() => {
  'use strict';
  const view=document.body.dataset.shareView,local=location.protocol==='file:';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const product=c=>c==='CB'?'CC':c,labels={director:'编导',kol:'KOL',plan:'策划',image:'策划图片',cross:'跨界'};
  const rounded=n=>Math.sign(n)*Math.round(Math.abs(n));
  const fmt=(n,digits=2)=>n===null||!Number.isFinite(n)?'—':String(Number(n.toFixed(digits)));
  const sum=(rows,key)=>rows.reduce((n,r)=>n+(key==='total'?DemandShare.roles.reduce((s,k)=>s+r[k],0):r[key]),0);
  const previous=m=>{const [y,n]=m.split('-').map(Number);return `${n===1?y-1:y}-${String(n===1?12:n-1).padStart(2,'0')}`;};
  const monthName=m=>`${m.slice(0,4)}年${Number(m.slice(5))}月`;
  const cacheKey='demand-share-view-cache-v1:'+view;
  let records=[],selected='',mode='month',busy=false,lastSignature='',filtered=new Set(DemandShare.codes);
  let pickerYear=2026;
  const arrow=right=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${right?'m9 5 7 7-7 7':'m15 5-7 7 7 7'}"/></svg>`;
  const calendar='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16M8 14h1m3 0h1m3 0h1M8 17h1m3 0h1"/></svg>';
  $('share-month').parentElement.hidden=true;
  document.querySelector('.controls').insertAdjacentHTML('afterbegin',`<span class="control-label">月份</span><div class="month-picker">
    <div class="month-bar"><button class="arrow-btn" id="share-previous-month" aria-label="上个月">${arrow(false)}</button><button id="share-month-trigger" aria-label="选择月份" aria-controls="share-month-popup" aria-expanded="false">—</button><button class="arrow-btn" id="share-next-month" aria-label="下个月">${arrow(true)}</button></div>
    <div class="month-popup" id="share-month-popup" hidden><div class="year-bar"><button class="arrow-btn" id="share-previous-year" aria-label="上一年">${arrow(false)}</button><strong id="share-picker-year"></strong><button class="arrow-btn" id="share-next-year" aria-label="下一年">${arrow(true)}</button></div><div class="month-grid" id="share-month-grid"></div></div></div>`);
  document.querySelector('.range-label').innerHTML=`<span class="control-label">日期范围</span><div class="date-range-fields" id="share-range"><div class="date-field" aria-label="开始日期（只读）">${calendar}<span id="share-range-start">—</span></div><div class="date-field" aria-label="结束日期（只读）">${calendar}<span id="share-range-end">—</span></div></div>`;
  function closeMonthPicker(){ $('share-month-popup').hidden=true;$('share-month-trigger').setAttribute('aria-expanded','false'); }
  function renderMonthPicker(){
    $('share-month-trigger').textContent=selected?monthName(selected):'暂无已发布月份';
    $('share-month-trigger').disabled=!records.length;
    const index=records.findIndex(r=>r.month===selected);
    $('share-previous-month').disabled=index<=0;
    $('share-next-month').disabled=index<0||index>=records.length-1;
    const years=records.map(r=>Number(r.month.slice(0,4)));
    $('share-picker-year').textContent=`${pickerYear}年`;
    $('share-previous-year').disabled=!years.some(y=>y<pickerYear);
    $('share-next-year').disabled=!years.some(y=>y>pickerYear);
    $('share-month-grid').innerHTML=Array.from({length:12},(_,i)=>{
      const m=`${pickerYear}-${String(i+1).padStart(2,'0')}`;
      return `<button data-month="${m}" aria-pressed="${m===selected}" ${records.some(r=>r.month===m)?'':'disabled'}>${i+1}月</button>`;
    }).join('');
  }
  function choosePublishedMonth(month){
    if(!records.some(r=>r.month===month))return;
    selected=month;pickerYear=Number(month.slice(0,4));closeMonthPicker();render();
  }
  function stat(label,value,cls=''){return `<article class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value ${cls}">${esc(value)}</div></article>`;}
  function gap(capacity,required){
    if(capacity===null) return {text:'—',cls:''};
    const n=rounded(capacity)-rounded(required);
    return {text:n===0?'平衡':`${n>0?'缺':'超'}${Math.abs(n)}`,cls:n===0?'gap-balanced':n>0?'gap-ok':'gap-risk'};
  }
  function deltaText(n,unit,weekly=false) {
    if(n===null)return '';
    const value=weekly?Number(n.toFixed(1)):n;
    if(value===0)return '';
    return `${value>0?'+':''}${fmt(value,weekly?1:2)} ${unit}`;
  }
  function deltaHTML(n,unit,weekly=false){return `<div class="delta ${n>0?'up':n<0?'down':''}">${esc(deltaText(n,unit,weekly))}</div>`;}
  function renderProducts(p,old) {
    const rows=p.products.filter(r=>filtered.has(r.product)),keys=mode==='week'?['director','plan','cross']:DemandShare.roles;
    const weekly=mode==='week',unit=weekly?'条/周':'条/月',weeks=p.period.weeks;
    const value=n=>weekly?(weeks?n/weeks:null):n;
    const compare=(list,key)=> {
      if(!old)return null;
      const prior=old.products.filter(r=>list.some(x=>x.product===r.product));
      if(prior.length!==list.length)return null;
      const current=sum(list,key),before=sum(prior,key);
      return weekly?(weeks&&old.period.weeks?current/weeks-before/old.period.weeks:null):current-before;
    };
    const totalChange=compare(rows,'total'),nonTotal=sum(p.nonSlots,'demand');
    const stats=[stat('SLOTS需求量',`${fmt(value(sum(rows,'total')),weekly?1:2)} ${unit}`)];
    if(old)stats.push(stat('对比上月变化',totalChange===null?'暂无可比周量':deltaText(totalChange,unit,weekly)||'无变化'));
    stats.push(stat('非SLOTS需求量',`${nonTotal} 条/月`));
    if(old)stats.push(stat('对比上月变化',deltaText(nonTotal-sum(old.nonSlots,'demand'),'条/月')||'无变化'));
    $('share-stats').innerHTML=stats.join('');
    $('share-products-head').innerHTML='<tr>'+['产品','总量',...keys.map(k=>labels[k])].map(v=>`<th>${v}</th>`).join('')+'</tr>';
    const cells=list=>['total',...keys].map(k=>`<td><span class="quantity">${fmt(value(sum(list,k)),weekly?1:2)}</span>${deltaHTML(compare(list,k),unit,weekly)}</td>`).join('');
    $('share-products-body').innerHTML=rows.map(r=>`<tr><th scope="row">${esc(product(r.product))}</th>${cells([r])}</tr>`).join('')||`<tr><td class="empty" colspan="${keys.length+2}">没有符合筛选条件的产品</td></tr>`;
    $('share-products-foot').innerHTML=`<tr><th>合计</th>${cells(rows)}</tr>`;
    const ncells=list=>['demand','reservedTime'].map(k=>{
      const n=sum(list,k),prior=old?.nonSlots.filter(r=>list.some(x=>x.product===r.product));
      const change=prior&&prior.length===list.length?n-sum(prior,k):null;
      return `<td><span class="quantity">${k==='reservedTime'?Math.round(n):fmt(n)}</span>${deltaHTML(change===null?null:k==='reservedTime'?Math.round(change):change,k==='demand'?'条/月':'天/月')}</td>`;
    }).join('');
    $('share-non-body').innerHTML=p.nonSlots.map(r=>`<tr><th>${esc(r.product)}</th>${ncells([r])}</tr>`).join('');
    $('share-non-foot').innerHTML=`<tr><th>合计</th>${ncells(p.nonSlots)}</tr>`;
    document.querySelectorAll('[data-share-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shareMode===mode)));
    $('share-week-note').textContent=weekly?`本月按 ${weeks} 周计算${old?`；上月按 ${old.period.weeks} 周计算`:''}。${weeks===0?'所选范围无工作周，周均量无法计算。':''}`:'';
    $('share-filter-title').textContent=`产品筛选（${filtered.size===7?'全部':`${filtered.size}项`}）`;
    $('share-filter-note').textContent=`显示 ${rows.length} / ${p.products.length} 个产品；SLOTS汇总与合计随筛选更新。${!old&&selected>'2026-11'?'上月尚未发布，不显示变化。':''}`;
  }
  function renderGroups(p,old) {
    const stats=[stat('SLOTS策跨需求量',`${p.slotsDemand} 条/月`)];
    if(old)stats.push(stat('对比上月变化',deltaText(p.slotsDemand-old.slotsDemand,'条/月')||'无变化'));
    stats.push(stat('工作日',`${p.period.days} 天`),stat('工作周',`${p.period.weeks} 周`));$('share-stats').innerHTML=stats.join('');
    const actual=sum(p.beijing,'actual'),capacity=p.beijing.some(g=>g.capacity===null)?null:sum(p.beijing,'capacity'),bgap=gap(capacity,actual);
    $('share-beijing-summary').innerHTML=stat('实际小组总量（条）',fmt(actual))+stat('人员总承载力（条）',capacity===null?'—':rounded(capacity))+stat('整体余量 / 缺口（条）',bgap.text,bgap.cls);
    $('share-beijing-body').innerHTML=p.beijing.map(g=>{
      const status=gap(g.capacity,g.actual);
      return `<tr><th class="fixed f1">${esc(g.name)}</th><td class="fixed f2">${esc(g.owner)}</td><td class="fixed f3"><div class="products">${g.products.map(c=>`<span class="product-chip">${esc(product(c))}</span>`).join('')}</div></td>
        ${['demand','innovation','playable','total','chengdu'].map(k=>`<td>${fmt(g[k])}</td>`).join('')}<td><span class="tint">${g.chengduWeek===null?'—':g.chengduWeek.toFixed(1)}</span></td>
        <td class="strong">${fmt(g.actual)}</td><td class="strong">${g.capacity===null?'—':rounded(g.capacity)}</td><td class="strong ${status.cls}">${status.text}</td>
        ${['avgTime','people','fulltime','leave','temporary'].map(k=>`<td>${fmt(g[k])}</td>`).join('')}</tr>`;
    }).join('');
    const participating=p.chengdu.filter(g=>g.participating),required=sum(participating,'required'),ccap=sum(participating,'capacity'),cgap=gap(ccap,required);
    $('share-chengdu-summary').innerHTML=stat('应制作总天数（天）',fmt(required))+stat('人员总承载力（天）',rounded(ccap))+stat('整体余量 / 缺口（天）',cgap.text,cgap.cls);
    $('share-chengdu-body').innerHTML=p.chengdu.map(g=>g.products.map((r,i)=>{
      const span=`rowspan="${g.products.length}"`,status=gap(g.capacity,g.required),slots=r.product==='SLOTS';
      return `<tr>${i===0?`<th class="fixed f1" ${span}>${esc(g.name)}</th><td class="fixed f2" ${span}>${esc(g.owner)}</td>`:''}
        <th class="fixed f3 ${slots?'slots slots-start':''}">${esc(r.product)}</th><td class="${slots?'slots':''}">${fmt(r.demand)}</td><td class="${slots?'slots':''}">${fmt(r.days)}</td><td class="${slots?'slots slots-end':''}">${fmt(r.avgTime)}</td>
        ${i===0?`<td class="strong" ${span}>${g.participating?fmt(g.required):'—'}</td><td class="strong" ${span}>${g.participating?rounded(g.capacity):'—'}</td><td class="strong ${g.participating?status.cls:''}" ${span}>${g.participating?status.text:'—'}</td><td ${span}>${g.participating?fmt(g.people):'—'}</td><td ${span}>${g.participating?fmt(g.leave):'—'}</td>`:''}</tr>`;
    }).join('')).join('');
  }
  function render() {
    const current=records.find(r=>r.month===selected);
    $('share-month').innerHTML=records.map(r=>`<option value="${r.month}">${monthName(r.month)}</option>`).join('');
    $('share-month').value=selected;$('share-month').disabled=!records.length;
    renderMonthPicker();
    $('share-empty').hidden=Boolean(current);$('share-content').hidden=!current;
    if(!current){$('share-range-start').textContent='—';$('share-range-end').textContent='—';$('share-updated').textContent='';$('share-calendar').textContent='';return;}
    const p=current.payload,old=selected==='2026-11'?null:records.find(r=>r.month===previous(selected))?.payload;
    $('share-range-start').textContent=p.period.start.replaceAll('-','/');
    $('share-range-end').textContent=p.period.end.replaceAll('-','/');
    $('share-updated').textContent=`最后更新时间：${new Date(current.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`;
    $('share-calendar').textContent=p.period.warning;
    if(view==='products')renderProducts(p,old);else renderGroups(p,old);
  }
  async function refresh() {
    if(busy)return;busy=true;$('share-refresh').disabled=true;
    $('share-status').textContent=records.length?'正在检查更新…':'正在读取已发布数据…';
    try {
      const next=await DemandShare.read(view,local),signature=JSON.stringify(next);
      records=next;if(!records.some(r=>r.month===selected))selected=records.at(-1)?.month||'';
      if(signature!==lastSignature){lastSignature=signature;render();}
      try {if(!local)localStorage.setItem(cacheKey,signature);}catch(_){}
      $('share-status').textContent=local?'本地分享预览 · 不代表线上已发布':'已读取最新发布数据';$('share-status').classList.remove('error');
    } catch(e) {
      $('share-status').textContent=`${e.message} ${records.length?'当前保留上次读取的数据。':'请点击“刷新数据”重试。'}`;$('share-status').classList.add('error');
    } finally {busy=false;$('share-refresh').disabled=false;}
  }
  $('share-month').addEventListener('change',e=>choosePublishedMonth(e.target.value));
  $('share-month-trigger').addEventListener('click',()=>{
    const opening=$('share-month-popup').hidden;
    if(opening){pickerYear=Number(selected.slice(0,4));renderMonthPicker();}
    $('share-month-popup').hidden=!opening;$('share-month-trigger').setAttribute('aria-expanded',String(opening));
  });
  for(const [id,step] of [['previous',-1],['next',1]]){
    $(`share-${id}-month`).addEventListener('click',()=>choosePublishedMonth(records[records.findIndex(r=>r.month===selected)+step]?.month));
    $(`share-${id}-year`).addEventListener('click',()=>{pickerYear+=step;renderMonthPicker();});
  }
  $('share-month-grid').addEventListener('click',e=>{const b=e.target.closest('button[data-month]');if(b&&!b.disabled)choosePublishedMonth(b.dataset.month);});
  document.addEventListener('click',e=>{if(!e.target.closest('.month-picker'))closeMonthPicker();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMonthPicker();const f=document.querySelector('.product-filter');if(f)f.open=false;}});
  $('share-refresh').addEventListener('click',refresh);
  if(view==='products') {
    $('share-products-filter').innerHTML=DemandShare.codes.map(c=>`<label><input type="checkbox" value="${c}" checked>${product(c)}</label>`).join('');
    $('share-products-filter').addEventListener('change',e=>{if(e.target.checked)filtered.add(e.target.value);else filtered.delete(e.target.value);render();});
    document.querySelectorAll('[data-share-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.shareMode;render();}));
    const filter=all=>{filtered=new Set(all?DemandShare.codes:[]);$('share-products-filter').querySelectorAll('input').forEach(i=>i.checked=all);render();};
    $('share-select-all').addEventListener('click',()=>filter(true));$('share-select-none').addEventListener('click',()=>filter(false));
    document.addEventListener('click',e=>{if(!e.target.closest('.product-filter'))document.querySelector('.product-filter').open=false;});
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
  window.addEventListener('storage',e=>{if(local&&e.key===DemandShare.storageKey(view))refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  try {
    if(!local){records=DemandShare.validateRows(JSON.parse(localStorage.getItem(cacheKey)||'[]'),view);selected=records.at(-1)?.month||'';render();}
  } catch(_){}
  refresh();
})();
