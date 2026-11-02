/* Local feature: quarter economics share the normal snapshot; CB remains the legacy storage ID. */
function quarterPair(date=new Date(`${selectedMonth}-01T12:00:00`)) {
  const year=date.getFullYear(),q=Math.floor(date.getMonth()/3)+1;
  return {current:`${year}-Q${q}`,previous:q===1?`${year-1}-Q4`:`${year}-Q${q-1}`,currentLabel:`Q${q}`,previousLabel:`Q${q===1?4:q-1}`};
}
function economics() {
  if(!store.productEconomics) {
    // Public deployment loads economics from the workspace, never bundled business values.
    store.productEconomics={quarters:{}};
  }
  return store.productEconomics.quarters;
}
function applyLocalQuarterInputs() {
  // Local-only data entry is intentionally excluded from the public deployment.
}
function productName(code) {return code==='CB'?'CC':code;}
function money(value) {return value===null||value===undefined?'—':'$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:2});}
function percent(value) {return value===null?'—':`${Math.sign(value)*Math.round(Math.abs(value))}%`;}
function portion(value,total) {return total>0?value/total*100:null;}
function productBar(label,value,kind='share') {
  const color=kind==='share'?'#79dfba':value<0?'#f67b8c':'#aeb9f5';
  return `<div class="pd-metric"><span>${label}</span><div class="pd-track"><i style="width:${value===null?0:Math.min(100,Math.abs(value))}%;background:${color};${kind==='change'&&value<0?'margin-left:auto':''}"></i></div></div>`;
}
function productEconomicsTotals(codes) {
  const q=economics()[quarterPair().current]||{};
  return codes.reduce((s,c)=>s+(Number(q[c]?.spend)||0),0);
}
let planRolesCollapsed=false;
function planBaseRows() {return store.planBases?.[selectedMonth]?.data||data;}
function ensurePlanBase() {
  store.planBases??={};
  const base=store.planBases[selectedMonth]??={data:structuredClone(data),live:true};
  if(!base.live) {
    // Keep the old unsynchronized draft recoverable; never apply it silently.
    base.legacyDraft??={adjustments:structuredClone(store.planAdjustments?.[selectedMonth]||{}),
      nonSlots:structuredClone(base.nonSlots),chengduDemands:structuredClone(base.chengduDemands)};
    base.live=true;
    data.forEach(row=>numericKeys.forEach(key=>updatePlanDelta(row,key)));
  }
  return base;
}
function updatePlanDelta(row,key) {
  const baseline=planBaseRows().find(r=>r.product===row.product)||row;
  const adjustments=planAdjustments();
  adjustments[row.product]??={};
  const value=row[key]-baseline[key];
  if(value===0&&adjustments[row.product][key]===undefined) return;
  adjustments[row.product][key]=value;
}
const planSortOptions=[
  ['default','默认产品顺序'],['roi-asc','回报比：低 → 高'],['roi-desc','回报比：高 → 低'],
  ['spend-desc','日花：高 → 低'],['spend-asc','日花：低 → 高'],
  ['change-asc','日花变化：低 → 高'],['change-desc','日花变化：高 → 低']
];
function orderedProducts(rows) {
  const mode=store.planSort?.[selectedMonth]||'default';
  if(!planSortOptions.some(([key])=>key===mode)||mode==='default') return [...rows];
  const [field,direction]=mode.split('-'),pair=quarterPair(),quarters=economics();
  const value=row=>{
    const entry=quarters[pair.current]?.[row.product];
    if(field!=='change') return entry?.[field]??null;
    const old=quarters[pair.previous]?.[row.product]?.spend;
    return old>0&&entry?.spend!=null?(entry.spend-old)/old:null;
  };
  return rows.map((row,index)=>({row,index,v:value(row)})).sort((a,b)=>{
    if(a.v===null||b.v===null) return a.v===b.v?a.index-b.index:a.v===null?1:-1;
    return (direction==='asc'?a.v-b.v:b.v-a.v)||a.index-b.index;
  }).map(item=>item.row);
}
function remainingPlanCross() {
  const month=store.months[selectedMonth],chengdu=month.chengduGroups[0];
  const avg=chengdu.products.find(row=>row.product==='SLOTS')?.avgTime;
  if(!(avg>0)||groups.some(g=>!(g.avgTime>0))) return null;
  const beijing=groups.reduce((sum,g)=>sum+groupCapacity(g)-groupActual(g),0);
  const days=chengdu.people*period().days-chengdu.leave-chengdu.products.reduce((sum,r)=>sum+chengduDays(r,month),0);
  return Math.round(beijing+days/avg);
}
function directorKolChange() {
  return data.reduce((sum,row)=>{
    const base=planBaseRows().find(r=>r.product===row.product)||row;
    return sum+row.director+row.kol-base.director-base.kol;
  },0);
}
function remainingDirectorKol() {
  const targets=store.planTargets?.[selectedMonth];
  return targets?.directorKol==null?null:targets.directorKol-(directorKolChange()-(targets.directorKolAnchor||0));
}
function directorKolResetCapacity() {
  return data.reduce((sum,row)=>{
    const base=planBaseRows().find(r=>r.product===row.product)||row;
    return sum+Math.max(row.director,base.director)+Math.max(row.kol,base.kol);
  },0);
}
function renderPlanTargets() {
  const target=remainingDirectorKol(),remaining=remainingPlanCross();
  return `<section class="panel pd-targets"><div title="北京余量（条）＋成都余量（天）÷成都SLOTS单需求制作时间；正数可增量，负数需减量">
    策跨需增减量（<strong data-plan-remaining>${remaining===null?'无法计算':signed(remaining)}</strong>）条
    ${remaining===null?'<div class="hint">请填写大于0的单需求制作时间</div>':''}</div>
    <div><label>编导KOL需增减（<input type="number" min="${-directorKolResetCapacity()}" max="10000000" step="1" data-plan-target="directorKol" value="${target??''}" title="重填目标会清零旧减量；最多可减 ${directorKolResetCapacity()} 条" aria-label="编导KOL需增减量">）条</label></div></section>`;
}
function proposedNonSlots() {
  return store.months[selectedMonth].nonSlots.map(row=>({...row}));
}
function planAdjustments() {
  store.planAdjustments??={};store.planAdjustments[selectedMonth]??={};
  return store.planAdjustments[selectedMonth];
}
function proposedRows() {
  return data.map(row=>({...row}));
}
function sortHeading(label,field) {
  const mode=store.planSort?.[selectedMonth]||'default';
  const direction=mode===`${field}-asc`?'ascending':mode===`${field}-desc`?'descending':'none';
  return `<th aria-sort="${direction}">${label}<button class="pd-sort" data-sort-field="${field}" aria-label="${label}排序" title="点击切换升序、降序、默认顺序"><span class="${direction==='ascending'?'active':''}">▴</span><span class="${direction==='descending'?'active':''}">▾</span></button></th>`;
}
function renderProductDemandStats() {
  const slots=data.map(r=>r.product),non=proposedNonSlots();
  const ss=productEconomicsTotals(slots),ns=productEconomicsTotals(non.map(r=>r.product));
  const sq=proposedRows().reduce((s,r)=>s+total(r),0),nq=non.reduce((s,r)=>s+r.demand,0);
  const cards=[['SLOTS日花',money(ss)],['SLOTS日花占比',percent(portion(ss,ss+ns))],
    ['非SLOTS日花',money(ns)],['非SLOTS日花占比',percent(portion(ns,ss+ns))],
    ['SLOTS数量',sq],['SLOTS数量占比',percent(portion(sq,sq+nq))],
    ['非SLOTS数量',nq],['非SLOTS数量占比',percent(portion(nq,sq+nq))]];
  document.getElementById('stats').innerHTML=cards.map(([label,value])=>`<article class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></article>`).join('');
}
function renderProductDemand() {
  ensurePlanBase();
  const root=document.getElementById('product-view');
  const offsets=[...root.querySelectorAll('.pd-pair')].map(el=>el.scrollLeft);
  const active=root.contains(document.activeElement)?document.activeElement:null;
  const focused=active?.matches('input[data-plan-role],input[data-plan-target]')?{attributes:[...active.attributes].filter(a=>a.name.startsWith('data-')),captured:active.dataset.undoCaptured}:null;
  const pair=quarterPair(),quarter=economics()[pair.current]||{},priorQuarter=economics()[pair.previous]||{};
  const prev=store.months[previousMonth(selectedMonth)];
  const groupsOfProducts=[
    {name:'SLOTS',rows:orderedProducts(proposedRows()),slots:true},
    {name:'非SLOTS',rows:orderedProducts(proposedNonSlots()),slots:false}
  ];
  const input=(code,field,value)=>`<input ${field==='spend'?'type="text" inputmode="decimal"':'type="number" min="0" max="10000000" step="0.1"'} data-economics="${code}" data-field="${field}" value="${value==null?'':field==='spend'?Number(value).toLocaleString('en-US',{maximumFractionDigits:2}):Math.round(value)}" placeholder="未填写" aria-label="${productName(code)} ${field==='roi'?'产出回报比':'日花'}">`;
  document.getElementById('product-view').innerHTML=renderPlanTargets()+groupsOfProducts.map(group=>{
    const spendTotal=productEconomicsTotals(group.rows.map(r=>r.product));
    const oldSpend=group.rows.reduce((s,r)=>s+(Number(priorQuarter[r.product]?.spend)||0),0);
    const count=r=>group.slots?total(r):r.demand;
    const countTotal=group.rows.reduce((s,r)=>s+count(r),0);
    const deltaFor=r=>{
      if(group.slots) return numericKeys.reduce((s,k)=>s+(Number(planAdjustments()[r.product]?.[k])||0),0);
      const old=(group.slots?prev?.data:prev?.nonSlots)?.find(p=>p.product===r.product);
      return old?count(r)-count(old):null;
    };
    const economicsRows=group.rows.map(r=>{
      const c=r.product,v=quarter[c]||{},old=priorQuarter[c]?.spend??null;
      const change=old>0&&v.spend!==null&&v.spend!==undefined?(v.spend-old)/old*100:null;
      return `<tr><th>${productName(c)}</th><td>${money(old)}</td><td>${input(c,'spend',v.spend)}</td>
        <td>${input(c,'roi',v.roi)}<span class="pd-unit">%</span><div class="pd-track"><i style="width:${Math.min(100,Math.max(0,v.roi||0))}%;background:#aeb9f5"></i></div></td>
        <td>${productBar(percent(v.spend==null?null:portion(v.spend,spendTotal)),v.spend==null?null:portion(v.spend,spendTotal))}</td>
        <td>${productBar(old===0&&v.spend>0?'新增':percent(change),change,'change')}</td></tr>`;
    }).join('');
    const deltas=group.rows.map(deltaFor),combined=deltas.includes(null)?null:deltas.reduce((s,n)=>s+n,0);
    const roleHeads=group.slots&&!planRolesCollapsed?numericKeys.map(k=>`<th>${k==='image'?'图片':roleLabels[k]}增减</th>`).join(''):'';
    const maxDelta=Math.max(1,...deltas.filter(v=>v!==null).map(Math.abs));
    const planningRows=group.rows.map(r=>{
      const base=planBaseRows().find(p=>p.product===r.product),delta=deltaFor(r);
      return `<tr><th>${productName(r.product)}</th><td>${count(r)}</td>
        <td>${productBar(percent(portion(count(r),countTotal)),portion(count(r),countTotal))}</td>
        <td>${productBar(delta===null?'—':`${delta>0?'+':''}${delta}`,delta===null?null:delta/maxDelta*100,'change')}</td>
        ${group.slots&&!planRolesCollapsed?numericKeys.map(k=>`<td><input type="number" step="1" min="${-base[k]}" max="${10000000-base[k]}" data-plan-product="${r.product}" data-plan-role="${k}" value="${planAdjustments()[r.product]?.[k]??''}" aria-label="${productName(r.product)} ${roleLabels[k]}增减"></td>`).join(''):''}</tr>`;
    }).join('');
    return `<section class="panel pd-section ${group.slots?'':'pd-nonslots'}"><div class="pd-heading"><h2>${group.name}产品需求量</h2>${group.slots?`<div class="pd-actions"><button class="btn" data-toggle-roles aria-expanded="${!planRolesCollapsed}">${planRolesCollapsed?'展开':'收起'}岗位增减</button><button class="btn primary" data-ai-suggest>AI建议</button></div>`:''}</div><div class="pd-pair">
      <div class="pd-table"><table><thead><tr><th>产品</th><th title="${pair.previous}">${pair.previousLabel}日花</th><th title="${pair.current}">${pair.currentLabel}日花</th>${sortHeading('产出回报比','roi')}${sortHeading(`${pair.currentLabel}日花占比`,'spend')}${sortHeading('日花变化','change')}</tr></thead><tbody>${economicsRows}</tbody>
      <tfoot><tr><th>合计</th><td>${money(oldSpend)}</td><td>${money(spendTotal)}</td><td>—</td><td>${percent(portion(spendTotal,spendTotal))}</td><td>${percent(oldSpend>0?(spendTotal-oldSpend)/oldSpend*100:null)}</td></tr></tfoot></table></div>
      <div class="pd-table pd-planning ${group.slots&&!planRolesCollapsed?'':'pd-compact'}"><table><thead><tr><th>产品</th><th>计划量</th><th>需求量占比</th><th>需求量变化</th>${roleHeads}</tr></thead><tbody>${planningRows}</tbody><tfoot><tr><th>合计</th><td>${countTotal}</td><td>${percent(portion(countTotal,countTotal))}</td><td>${combined===null?'—':combined}</td>${group.slots&&!planRolesCollapsed?numericKeys.map(k=>`<td>${group.rows.reduce((s,r)=>s+(Number(planAdjustments()[r.product]?.[k])||0),0)}</td>`).join(''):''}</tr></tfoot></table></div>
      </div></section>`;
  }).join('');
  if(focused) {
    const selector='input'+focused.attributes.filter(a=>a.name!=='data-undo-captured').map(a=>`[${a.name}="${a.value}"]`).join('');
    const replacement=root.querySelector(selector);
    if(replacement) {
      replacement.replaceWith(active);active.focus({preventScroll:true});
      if(focused.captured) active.dataset.undoCaptured=focused.captured;
    }
  }
  root.querySelectorAll('.pd-pair').forEach((el,i)=>el.scrollLeft=offsets[i]||0);
  renderProductDemandStats();
}
function setupProductDemand() {
  const style=document.createElement('style');
  style.textContent=`
    .shell:has(#product-view:not([hidden])){max-width:1740px}
    .pd-pair{display:grid;grid-template-columns:minmax(760px,1fr) minmax(1080px,1.4fr);gap:24px;align-items:start;overflow-x:auto;padding-bottom:10px}
    .pd-pair{scrollbar-width:thin;scrollbar-color:#a8b5c8 #edf1f6}
    .pd-pair::-webkit-scrollbar{height:10px}.pd-pair::-webkit-scrollbar-track{background:#edf1f6;border-radius:6px}.pd-pair::-webkit-scrollbar-thumb{background:#a8b5c8;border-radius:6px}
    .pd-pair:has(.pd-compact){grid-template-columns:minmax(760px,1fr) minmax(600px,1fr)}
    .pd-section h2{margin:0 0 18px;font-size:18px}.pd-table{overflow:hidden;border:1px solid var(--line);border-radius:12px}
    .pd-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.pd-heading h2{margin:0}
    .pd-targets{display:flex;justify-content:space-evenly;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:18px;text-align:center}.pd-targets label{display:flex;align-items:center;justify-content:center;gap:8px}.pd-targets .hint{margin-top:8px}
    .pd-sort{display:inline-flex;vertical-align:middle;flex-direction:column;justify-content:center;line-height:9px;border:0;background:transparent;padding:4px 3px;margin-left:3px;color:#9ba6b6;cursor:pointer}.pd-sort .active{color:#365bd6}.pd-sort:focus-visible{outline:2px solid #a7b7ea;border-radius:4px}
    body,input,button,select,textarea,dialog{font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif}
    #dashboard-content :is(table,input,button,select){font-family:inherit}
    #dashboard-content #group-body :is([data-gderived="actual"],[data-gderived="capacity"],[data-gderived="gap"]),
    #dashboard-content #chengdu-body :is([data-csum],[data-ccapacity],[data-cgap],.c2,.c3),
    #dashboard-content #group-body tr>:is(:nth-child(2),:nth-child(3)),
    #dashboard-content [data-move-product],#dashboard-content #product-view tbody th,
    #dashboard-content #editor-body tr>:first-child,#dashboard-content #non-slots-body tr>:first-child{font-weight:700}
    #dashboard-content #chengdu-body .slots-row>td:nth-child(n+3):nth-child(-n+6) input{background:transparent!important}
    .pd-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pd-actions select{padding:8px 12px;background:#fff;color:var(--text);border:1px solid var(--line);border-radius:8px}
    #product-view .pd-targets input{border:1px solid #d7dce5;background:#fff}
    #product-view table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:560px;font-size:14px}
    #dashboard-content #product-view tbody :is(th,td){height:80px;vertical-align:middle}
    #product-view .pd-nonslots table tr>:first-child{width:210px}
    #dashboard-content #product-view input[data-plan-role]{border-color:#d7dce5;background:#fff}
    #product-view .pd-planning table{min-width:720px}#product-view th,#product-view td{text-align:center;padding:12px 6px;height:62px;box-sizing:border-box}
    #product-view .pd-compact table{min-width:400px}
    #product-view thead th{height:48px;background:var(--table-head);white-space:nowrap}
    #product-view input{width:78px;max-width:100%;text-align:center;border:1px solid transparent;background:transparent;border-radius:7px;padding:7px 3px;font:inherit}
    #product-view input:focus{outline:2px solid #a7b7ea;background:white}#product-view input:hover{background:#f3f6fc}
    #product-view [data-field="spend"]{width:98px;height:35px;padding:6px 7px;font:inherit;color:var(--text)}#product-view tfoot td,#product-view tfoot th{background:#f2f5fb;font-weight:600}
    .pd-unit{color:#68768a}.pd-metric{min-width:50px}.pd-track{height:7px;background:#f0f2f7;border-radius:4px;overflow:hidden;margin-top:9px}
    .pd-track i{display:block;height:100%;border-radius:4px}
  `;
  document.head.appendChild(style);
  setupPlanSuggestions();
  document.getElementById('product-view').addEventListener('click',e=>{
    if(e.target.closest('[data-ai-suggest]')) openPlanSuggestions();
    const sort=e.target.closest('[data-sort-field]');
    if(sort&&cloud.ready) {
      const field=sort.dataset.sortField,mode=store.planSort?.[selectedMonth]||'default';
      store.planSort??={};
      store.planSort[selectedMonth]=mode===`${field}-asc`?`${field}-desc`:mode===`${field}-desc`?'default':`${field}-asc`;
      render();saveMonths();
    }
    if(e.target.closest('[data-toggle-roles]')) {planRolesCollapsed=!planRolesCollapsed;renderProductDemand();}
  });
  document.getElementById('product-view').addEventListener('input',e=>{
    const el=e.target;
    el.setCustomValidity('');
    if(!cloud.ready||!el.matches('[data-plan-role],[data-plan-target]')||el.validity.badInput) return;
    let value=Number(el.value);
    if(!Number.isSafeInteger(value)) return;
    if(el.dataset.planTarget) {
      el.min=String(-directorKolResetCapacity());
      if(value<Number(el.min)) {value=Number(el.min);el.value=String(value);}
    }
    // A delta is measured against the fixed baseline, so -baseline is the
    // largest possible reduction (the resulting role quantity becomes zero).
    if(el.dataset.planRole&&value<Number(el.min)) {
      value=Number(el.min);
      el.value=String(value);
    }
    if(!el.checkValidity()) return;
    if(el.dataset.planRole) {
      const row=data.find(r=>r.product===el.dataset.planProduct),key=el.dataset.planRole;
      const base=planBaseRows().find(r=>r.product===row.product);
      const quantity=base[key]+value;
      if(quantity<0||quantity>10000000) return;
      if(row[key]===quantity&&(planAdjustments()[row.product]?.[key]??'')===(el.value===''?'':value)) return;
      rememberNumberEdit(el);ensurePlanBase();
      row[key]=quantity;
      planAdjustments()[row.product]??={};
      if(el.value==='') delete planAdjustments()[row.product][key];
      else planAdjustments()[row.product][key]=value;
    } else {
      const target=el.value===''?undefined:value;
      if((remainingDirectorKol()??undefined)===target) return;
      rememberNumberEdit(el);
      ensurePlanBase();
      data.forEach(row=>{
        const base=planBaseRows().find(r=>r.product===row.product);
        ['director','kol'].forEach(key=>{
          if(row[key]>=base[key]) return;
          row[key]=base[key];
          updatePlanDelta(row,key);
        });
      });
      store.planTargets??={};store.planTargets[selectedMonth]??={};
      if(target===undefined) {
        delete store.planTargets[selectedMonth].directorKol;
        delete store.planTargets[selectedMonth].directorKolAnchor;
      } else {
        store.planTargets[selectedMonth].directorKol=target;
        store.planTargets[selectedMonth].directorKolAnchor=directorKolChange();
      }
    }
    renderEditor();renderOutputs();saveMonths();
  });
  document.getElementById('product-view').addEventListener('change',e=>{
    const el=e.target;
    if(!cloud.ready||!el.matches('input')) return;
    if(el.matches('[data-plan-role],[data-plan-target]')) {
      if(!el.checkValidity()) el.reportValidity();
      return;
    }
    const raw=el.dataset.field==='spend'?el.value.trim().replaceAll(',',''):el.value;
    if(el.dataset.field==='spend'&&raw!==''&&(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(el.value.trim())||Number(raw)>10000000)) {
      el.setCustomValidity('请输入0至10,000,000的日花金额，最多保留两位小数。');el.reportValidity();return;
    }
    if(!el.checkValidity()) {el.reportValidity();renderProductDemand();return;}
    if(el.dataset.economics) {
      rememberUndo();
      const q=quarterPair().current,quarters=economics();
      quarters[q]??={};quarters[q][el.dataset.economics]??={spend:null,roi:null};
      quarters[q][el.dataset.economics][el.dataset.field]=raw===''?null:Number(raw);
    } else return;
    render();saveMonths();
  });
  // Compatibility: rename visible CB labels, without invalidating historical IDs or the existing SQL schema.
  const relabel=()=>{
    const root=document.getElementById('dashboard-content'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;while((node=walker.nextNode())) if(/\bCB\b/.test(node.nodeValue)) node.nodeValue=node.nodeValue.replace(/\bCB\b/g,'CC');
    root.querySelectorAll('[aria-label],[title]').forEach(el=>{
      ['aria-label','title'].forEach(key=>{const v=el.getAttribute(key);if(v&&/\bCB\b/.test(v)) el.setAttribute(key,v.replace(/\bCB\b/g,'CC'));});
    });
  };
  const observer=new MutationObserver(relabel);observer.observe(document.getElementById('dashboard-content'),{childList:true,subtree:true,characterData:true});
  relabel();
}
