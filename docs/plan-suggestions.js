/* Offline, deterministic planning rules. No model calls and no preview writes. */
const suggestionRoleLimit=10000000;
let planSuggestion=null;

// Bounded largest-remainder allocation. Runtime depends on products, not quantity.
function allocateSuggestionUnits(amount,weights,caps,spread=false) {
  const out=caps.map(()=>0);
  let left=Math.min(Math.max(0,Math.round(amount)),caps.reduce((s,n)=>s+n,0));
  let active=caps.map((cap,i)=>i).filter(i=>caps[i]>0);
  if(spread&&left>=active.length) {
    active.forEach(i=>out[i]++);
    left-=active.length;
  }
  while(left>0) {
    active=active.filter(i=>out[i]<caps[i]);
    if(!active.length) break;
    const weightSum=active.reduce((s,i)=>s+Math.max(0,weights[i]),0);
    const quotas=active.map(i=>({i,q:left*(weightSum?Math.max(0,weights[i])/weightSum:1/active.length)}));
    for(const {i,q} of quotas) {
      const n=Math.min(caps[i]-out[i],Math.floor(q));
      out[i]+=n;left-=n;
    }
    for(const {i} of quotas.sort((a,b)=>(b.q%1)-(a.q%1)||a.i-b.i)) {
      if(left>0&&out[i]<caps[i]) {out[i]++;left--;}
    }
  }
  return out;
}
function spreadSuggestionUnits(amount,weights,caps,span=0) {
  // Offsets plus integer remainders: PC spans at most 3, DK 2 (5 combined).
  const min=Math.min(...weights),max=Math.max(...weights);
  const offsets=weights.map(w=>max>min?Math.round(span*(w-min)/(max-min)):0);
  const target=Math.min(Math.max(0,Math.round(amount)),caps.reduce((s,n)=>s+n,0));
  let low=-span,high=Math.min(target,Math.max(0,...caps));
  const at=(i,level)=>Math.min(caps[i],Math.max(0,level+offsets[i]));
  while(low<high) {
    const mid=Math.ceil((low+high)/2);
    if(caps.reduce((s,n,i)=>s+at(i,mid),0)<=target) low=mid;
    else high=mid-1;
  }
  const out=caps.map((n,i)=>at(i,low));
  let left=target-out.reduce((s,n)=>s+n,0);
  const order=caps.map((_,i)=>i).filter(i=>out[i]<caps[i]).sort((a,b)=>weights[b]-weights[a]||a-b);
  for(const i of order) if(left>0) {out[i]++;left--;}
  return out;
}
function suggestionMetrics(rows,quarters,pair,month=selectedMonth) {
  const includeTrend=[1,4,7,10].includes(Number(month.split('-')[1]));
  const current=quarters[pair.current]||{},previous=quarters[pair.previous]||{};
  const spendTotal=rows.reduce((s,r)=>s+(current[r.product]?.spend||0),0);
  const quantityTotal=rows.reduce((s,r)=>s+total(r),0);
  const metrics=rows.map(row=>{
    const v=current[row.product]||{},old=previous[row.product]?.spend;
    const share=quantityTotal?total(row)/quantityTotal:1/rows.length;
    const spendShare=v.spend!=null&&spendTotal>0?v.spend/spendTotal:null;
    const roi=v.roi==null?null:v.roi/100;
    const trend=old>0&&v.spend!=null?(v.spend-old)/old:null;
    // ROI leads; a 10-percentage-point share deficit adds 0.02 priority.
    const clamp=n=>Math.max(-1,Math.min(1,n));
    const score=1+.12*clamp((roi??1)-1)+(includeTrend ? .05*clamp(trend??0) : 0)+.20*clamp((spendShare??share)-share);
    return {share,spendShare,roi,trend,includeTrend,score};
  });
  const sum=metrics.reduce((s,m)=>s+m.score,0);
  return metrics.map(m=>({...m,weight:sum?m.score/sum:1/rows.length}));
}
function suggestPool(rows,roles,net,metrics) {
  const quantities=rows.map(r=>roles.reduce((s,k)=>s+r[k],0));
  const all=quantities.reduce((s,n)=>s+n,0);
  const delta=quantities.map(()=>0);
  if(net>0) {
    const adds=spreadSuggestionUnits(net,metrics.map(m=>m.weight),
      quantities.map(n=>roles.length*suggestionRoleLimit-n),roles.includes('plan')?2:1);
    adds.forEach((n,i)=>delta[i]=n);
  } else if(net<0) {
    const cuts=spreadSuggestionUnits(Math.min(-net,all),metrics.map(m=>1/Math.max(.001,m.weight)),quantities,roles.includes('plan')?2:1);
    delta.forEach((_,i)=>delta[i]=-cuts[i]);
  }
  return rows.map((row,i)=>{
    const values=roles.map(k=>row[k]);
    const amounts=allocateSuggestionUnits(Math.abs(delta[i]),values,
      values.map(n=>delta[i]<0?n:suggestionRoleLimit-n));
    return Object.fromEntries(roles.map((key,j)=>[key,row[key]+(delta[i]<0?-amounts[j]:amounts[j])]));
  });
}
function suggestionFingerprint() {
  return JSON.stringify([selectedMonth,store.months[selectedMonth],store.planBases?.[selectedMonth],
    store.planTargets?.[selectedMonth],store.productEconomics]);
}
function openPlanSuggestions() {
  if(!cloud.ready||cloud.conflict||cloud.modalOpen||cloud.actionPending) return;
  ensurePlanBase();
  const rows=structuredClone(orderedProducts(data)),base=structuredClone(planBaseRows());
  const quarters=structuredClone(economics()),pair=quarterPair();
  const metrics=suggestionMetrics(rows,quarters,pair);
  const remaining={planCross:remainingPlanCross(),directorKol:remainingDirectorKol()};
  const goals={planCross:remaining.planCross??0,directorKol:remaining.directorKol??0};
  const hasChange=Object.values(goals).some(n=>n!==0);
  const recommend=(roles,key)=>{
    if(!hasChange||remaining[key]===null) return rows;
    const starts=rows.map(row=>({...row,...Object.fromEntries(roles.map(k=>[k,base.find(r=>r.product===row.product)[k]]))}));
    const finalNet=goals[key]+rows.reduce((sum,row,i)=>sum+roles.reduce((v,k)=>v+row[k]-starts[i][k],0),0);
    return suggestPool(starts,roles,finalNet,metrics);
  };
  const pc=recommend(['plan','cross'],'planCross');
  const dk=recommend(['director','kol'],'directorKol');
  const draft=rows.map((row,i)=>{
    const start=base.find(r=>r.product===row.product);
    const final={...row,plan:pc[i].plan,cross:pc[i].cross,director:dk[i].director,kol:dk[i].kol};
    return {product:row.product,...Object.fromEntries(numericKeys.map(k=>[k,final[k]-start[k]]))};
  });
  planSuggestion={month:selectedMonth,rows,base,quarters,pair,metrics,remaining,goals,draft,
    fingerprint:suggestionFingerprint(),edited:new Set(),rolesCollapsed:false};
  cloud.modalOpen=true;
  renderPlanSuggestions();
  document.getElementById('plan-suggestion-dialog').showModal();
  document.getElementById('suggestion-cancel').focus();
}
function suggestionRows() {
  return planSuggestion.draft.map(row=>{
    const base=planSuggestion.base.find(r=>r.product===row.product);
    return {product:row.product,...Object.fromEntries(numericKeys.map(k=>[k,base[k]+row[k]]))};
  });
}
function suggestionReason(m) {
  const reasons=[];
  if(m.roi===null) reasons.push('未填回报比，按中性效率估算');
  else reasons.push(`产出回报比${m.roi>1?'高':m.roi<1?'偏低':'持平'}（${percent(m.roi*100)}）`);
  if(m.spendShare===null) reasons.push('日花数据不足，按中性处理');
  else {
    const gap=m.spendShare-m.share;
    reasons.push(`需求占比${Math.abs(gap)<1e-9?'等于':gap>0?'低于':'高于'}日花占比`);
  }
  if(m.includeTrend) {
    if(m.trend===null) reasons.push('日花变化数据不足，未参与计算');
    else if(m.trend===0) reasons.push('日花与上季度持平');
    else reasons.push(`日花较上季度${m.trend>0?'增长':'下降'}${percent(Math.abs(m.trend)*100)}`);
  }
  return reasons.join('；')+'。';
}
function suggestionSortHeading(label,field) {
  return `<th aria-sort="none">${label}<button class="pd-sort" data-suggest-sort="${field}" aria-label="${label}排序" title="点击切换升序、降序、默认顺序"><span>▴</span><span>▾</span></button></th>`;
}
function sortPlanSuggestion(field) {
  const s=planSuggestion;
  s.sort=s.sort?.field===field?(s.sort.direction==='asc'?{field,direction:'desc'}:null):{field,direction:'asc'};
  const indices=s.rows.map((_,i)=>i);
  if(s.sort) indices.sort((a,b)=>{
    const x=s.metrics[a][field],y=s.metrics[b][field];
    return x===null?(y===null?a-b:1):y===null?-1:
      (s.sort.direction==='asc'?x-y:y-x)||a-b;
  });
  const root=document.getElementById('plan-suggestion-content');
  root.querySelectorAll('tbody').forEach(body=>{
    const rows=[...body.children];
    indices.forEach(i=>body.appendChild(rows.find(r=>Number(r.dataset.suggestionIndex)===i)));
  });
  root.querySelectorAll('[data-suggest-sort]').forEach(button=>{
    const active=s.sort?.field===button.dataset.suggestSort;
    button.parentElement.setAttribute('aria-sort',active?(s.sort.direction==='asc'?'ascending':'descending'):'none');
    button.children[0].classList.toggle('active',active&&s.sort.direction==='asc');
    button.children[1].classList.toggle('active',active&&s.sort.direction==='desc');
  });
}
let suggestionCaptureLibrary;
async function exportPlanSuggestion() {
  const button=document.querySelector('[data-suggest-screenshot]');
  if(!planSuggestion||button.disabled) return;
  const root=document.getElementById('plan-suggestion-content');
  const status=document.getElementById('suggestion-export-status');
  const month=planSuggestion.month;
  button.disabled=true;status.textContent='正在生成完整截图…';
  try {
    if(!window.html2canvas) {
      if(!suggestionCaptureLibrary) suggestionCaptureLibrary=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='./html2canvas.min.js';
        script.onload=resolve;
        script.onerror=()=>{script.remove();suggestionCaptureLibrary=null;reject(new Error('截图组件加载失败'));};
        document.head.appendChild(script);
      });
      await suggestionCaptureLibrary;
    }
    const width=Math.ceil(root.querySelector('.suggestion-pair').scrollWidth+48);
    const canvas=await window.html2canvas(root,{
      backgroundColor:'#ffffff',scale:1.5,logging:false,windowWidth:width+80,
      onclone(doc) {
        const dialog=doc.getElementById('plan-suggestion-dialog');
        Object.assign(dialog.style,{width:width+'px',maxHeight:'none',height:'auto',overflow:'visible',position:'absolute',top:'0',left:'0',margin:'0'});
        const content=doc.getElementById('plan-suggestion-content');
        Object.assign(content.style,{width:width+'px',boxSizing:'border-box'});
        const pair=content.querySelector('.suggestion-pair');
        pair.style.overflow='visible';pair.scrollLeft=0;
        content.querySelectorAll('button,#suggestion-export-status').forEach(el=>el.style.display='none');
        content.querySelectorAll('details').forEach(el=>{
          if(!el.open) el.remove();
          else {
            const expanded=doc.createElement('div');
            expanded.className=el.className;expanded.innerHTML=el.innerHTML;
            el.replaceWith(expanded);
          }
        });
        content.querySelectorAll('input').forEach(el=>{
          const value=doc.createElement('span');value.textContent=el.value;
          el.replaceWith(value);
        });
      }
    });
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('无法生成PNG');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`${month}-AI建议-${Date.now()}.png`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent='截图已下载，包含全部表格内容。';
  } catch(error) {
    status.textContent='截图失败，请再次点击“全屏截图”重试。';
  } finally {button.disabled=false;}
}
function renderPlanSuggestions() {
  const s=planSuggestion,{pair}=s,cur=s.quarters[pair.current]||{},prior=s.quarters[pair.previous]||{};
  const spendTotal=s.rows.reduce((sum,r)=>sum+(cur[r.product]?.spend||0),0);
  const oldTotal=s.rows.reduce((sum,r)=>sum+(prior[r.product]?.spend||0),0);
  const econ=s.rows.map((row,i)=>{
    const code=row.product,v=cur[code]||{},old=prior[code]?.spend??null,m=s.metrics[i];
    return `<tr data-suggestion-index="${i}"><th>${productName(code)}</th><td>${money(old)}</td><td>${money(v.spend)}</td>
      <td>${productBar(percent(v.roi??null),v.roi??null,'roi')}</td>
      <td>${productBar(percent(m.spendShare===null?null:m.spendShare*100),m.spendShare===null?null:m.spendShare*100)}</td>
      <td>${productBar(old===0&&v.spend>0?'新增':percent(m.trend===null?null:m.trend*100),m.trend===null?null:m.trend*100,'change')}</td></tr>`;
  }).join('');
  const planning=s.draft.map((row,i)=>{
    const base=s.base.find(r=>r.product===row.product);
    return `<tr data-suggestion-index="${i}"><th>${productName(row.product)}</th><td class="suggestion-inline-reason"><span data-suggest-reason="${i}"></span><small data-suggest-edited="${i}"></small></td><td data-suggest-total="${i}"></td>
      <td data-suggest-share="${i}"></td><td data-suggest-change="${i}"></td>
      ${numericKeys.map(k=>`<td data-suggest-role-cell>${k==='image'?`<span title="图片不参与自动调整">${row[k]}</span>`:
        `<input type="number" step="1" min="${-base[k]}" max="${suggestionRoleLimit-base[k]}" value="${row[k]}" data-suggest-row="${i}" data-suggest-role="${k}" aria-label="${productName(row.product)} ${roleLabels[k]}建议增减">`}</td>`).join('')}</tr>`;
  }).join('');
  const warnings=[];
  if(s.remaining.planCross===null) warnings.push('缺少有效制作时间：策跨暂保持当前数量。');
  if(s.remaining.directorKol===null) warnings.push('未填写编导KOL目标：该两岗位暂保持当前数量。');
  document.getElementById('plan-suggestion-content').innerHTML=`
    <div class="suggestion-heading"><div><h2 id="plan-suggestion-title">AI建议 <button class="btn" data-suggest-screenshot>全屏截图</button><span class="suggestion-tag">本地规则计算</span></h2><p>${monthLabel(s.month)} · SLOTS产品需求量</p></div></div>
    <p id="suggestion-export-status" role="status"></p>
    <p class="suggestion-explanation">岗位输入框为相对计划起点的最终增减，应用后替换旧值，不叠加。图片保持不变；日花、回报比仅供参考，不在此修改。</p>
    ${warnings.length?`<p class="suggestion-warning">${warnings.join(' ')}</p>`:''}
    <div id="suggestion-summary" class="suggestion-summary" aria-live="polite"></div>
    <details class="suggestion-rules"><summary>建议如何计算</summary><p>先分散增减量，再综合回报比、需求占比与当季日花占比的差距分配。${s.metrics[0]?.includeTrend?'当前为季度首月，日花相较上季度的变化也参与计算。':'当前不是季度首月，日花变化不参与本次计算。'}回报比优先；需求占比低于日花占比时支持多增或少减，高于时支持少增或多减，但不强制两种占比一致。条件允许时两类岗位合计差距控制在约5条以内。总目标不变，不额外制造反向增减。可减量不足、图片或未设目标岗位已有调整时，差距可能扩大。调整说明仅展示生成建议时的判断依据，具体增减以输入值为准。手动修改不受此差距限制，但总量仍需匹配。这是本地规则计算，不是模型推理。</p></details>
    <div class="suggestion-table-actions"><button class="btn" data-suggest-toggle-roles aria-expanded="true">收起岗位增减</button></div>
    <div class="pd-pair suggestion-pair">
      <div class="pd-table"><table><thead><tr><th>产品</th><th>${pair.previousLabel}日花</th><th>${pair.currentLabel}日花</th>${suggestionSortHeading('产出回报比','roi')}${suggestionSortHeading(pair.currentLabel+'日花占比','spendShare')}${suggestionSortHeading('日花变化','trend')}</tr></thead>
        <tbody>${econ}</tbody><tfoot><tr><th>合计</th><td>${money(oldTotal)}</td><td>${money(spendTotal)}</td><td>—</td><td>${spendTotal?'100%':'—'}</td><td>${percent(oldTotal>0?(spendTotal-oldTotal)/oldTotal*100:null)}</td></tr></tfoot></table></div>
      <div class="pd-table suggestion-planning"><table><thead><tr><th>产品</th><th>调整说明</th><th>计划量</th><th>需求量占比</th><th>需求量变化</th>${numericKeys.map(k=>`<th data-suggest-role-cell>${k==='image'?'图片（保留）':roleLabels[k]+'增减'}</th>`).join('')}</tr></thead>
        <tbody>${planning}</tbody><tfoot id="suggestion-foot"></tfoot></table></div>
    </div>`;
  updatePlanSuggestionPreview();
}
function updatePlanSuggestionPreview() {
  const s=planSuggestion,rows=suggestionRows(),all=rows.reduce((sum,r)=>sum+total(r),0);
  const deltas=s.draft.map(row=>numericKeys.reduce((sum,k)=>sum+row[k],0));
  const minDelta=Math.min(...deltas),maxSignedDelta=Math.max(...deltas);
  const maxDelta=Math.max(1,...deltas.map(Math.abs));
  const root=document.getElementById('plan-suggestion-dialog');
  rows.forEach((row,i)=>{
    root.querySelector(`[data-suggest-total="${i}"]`).textContent=String(total(row));
    root.querySelector(`[data-suggest-share="${i}"]`).innerHTML=productBar(percent(portion(total(row),all)),portion(total(row),all));
    root.querySelector(`[data-suggest-change="${i}"]`).innerHTML=productBar(signed(deltas[i]),deltas[i]/maxDelta*100,'change');
    const showReason=minDelta!==maxSignedDelta&&(deltas[i]===minDelta||deltas[i]===maxSignedDelta);
    root.querySelector(`[data-suggest-reason="${i}"]`).textContent=showReason?suggestionReason(s.metrics[i]):'';
    root.querySelector(`[data-suggest-edited="${i}"]`).textContent=showReason&&s.edited.has(i)?'已手动修改':'';
  });
  document.getElementById('suggestion-foot').innerHTML=`<tr><th>合计</th><td></td><td>${all}</td><td>${all?'100%':'—'}</td><td>${signed(deltas.reduce((sum,n)=>sum+n,0))}</td>${numericKeys.map(k=>`<td data-suggest-role-cell ${s.rolesCollapsed?'hidden':''}>${signed(s.draft.reduce((sum,r)=>sum+r[k],0))}</td>`).join('')}</tr>`;
  let exact=true;
  document.getElementById('suggestion-summary').innerHTML=[
    ['planCross','策划＋跨界',['plan','cross']],['directorKol','编导＋KOL',['director','kol']]
  ].map(([key,label,roles])=>{
    const change=rows.reduce((sum,row,i)=>sum+roles.reduce((v,k)=>v+row[k]-s.rows[i][k],0),0);
    const gap=s.goals[key]-change;
    if(gap!==0) exact=false;
    return `<div><strong>${label}</strong><span>本次目标 ${signed(s.goals[key])} 条</span><span>建议净调整 ${signed(change)} 条</span><span class="${gap?'suggestion-error':''}">${gap?`还需调整 ${signed(gap)} 条`:'总量匹配'}</span></div>`;
  }).join('');
  const valid=[...root.querySelectorAll('[data-suggest-role]')].every(el=>{
    const n=Number(el.value);
    return !el.validity.badInput&&el.checkValidity()&&Number.isSafeInteger(n)&&n>=Number(el.min)&&n<=Number(el.max);
  });
  const feasible=rows.every(row=>numericKeys.every(k=>Number.isSafeInteger(row[k])&&row[k]>=0&&row[k]<=suggestionRoleLimit));
  document.getElementById('suggestion-apply').disabled=!valid||!exact||!feasible;
  document.getElementById('suggestion-validation').textContent=!valid||!feasible?
    '请输入有效整数，调整后的岗位数量须为0至10,000,000。':
    !exact?'建议总量尚未匹配目标，请调整输入；如目标超过可减量，请取消后修改目标或人员配置。':'';
}
function closePlanSuggestions() {
  document.getElementById('plan-suggestion-dialog').close();
  planSuggestion=null;cloud.modalOpen=false;
  if(cloud.dirty&&!cloud.conflict) {clearTimeout(cloud.timer);cloud.timer=setTimeout(()=>cloud.flush(),200);}
}
function applyPlanSuggestions() {
  if(!planSuggestion) return;
  updatePlanSuggestionPreview();
  if(document.getElementById('suggestion-apply').disabled) return;
  if(!cloud.ready||cloud.conflict||suggestionFingerprint()!==planSuggestion.fingerprint) {
    document.getElementById('suggestion-validation').textContent='原始数据已变化，请取消并重新生成建议，避免覆盖较新的数据。';
    document.getElementById('suggestion-apply').disabled=true;
    return;
  }
  const rows=suggestionRows();
  rememberUndo();
  data.forEach(row=>{
    const result=rows.find(r=>r.product===row.product);
    numericKeys.forEach(k=>{row[k]=result[k];updatePlanDelta(row,k);});
  });
  closePlanSuggestions();
  render();saveMonths();
  cloud.message('建议已应用，旧岗位增减已替换，三个界面已同步。可用 Ctrl+Z 撤销本次应用。');
}
function setupPlanSuggestions() {
  const style=document.createElement('style');
  style.textContent=`
    #plan-suggestion-dialog{width:min(1660px,calc(100vw - 32px));max-width:none;max-height:92vh;box-sizing:border-box;padding:0;border:0;border-radius:18px;box-shadow:0 24px 80px #13254040;color:var(--text);background:#fff}
    #plan-suggestion-dialog::backdrop{background:#15243e66}
    #plan-suggestion-content{padding:24px}
    .suggestion-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .suggestion-heading h2{margin:0;font-size:21px}.suggestion-heading p{margin:8px 0 0;color:var(--muted);font-size:14px}
    .suggestion-heading h2 .btn{margin-left:12px;vertical-align:middle;font-size:13px;font-weight:400}
    #suggestion-export-status{font-size:13px;color:var(--muted);margin:8px 0}
    .suggestion-tag{display:inline-block;font-size:12px;font-weight:400;padding:5px 9px;margin-left:8px;border-radius:7px;background:#edf2ff;color:#4761a1;vertical-align:middle}
    .suggestion-explanation,.suggestion-rules,.suggestion-warning{font-size:13px;line-height:1.7;color:var(--muted)}
    .suggestion-warning{background:#fff7e7;color:#866025;padding:10px 14px;border-radius:9px}
    .suggestion-rules{margin:12px 0 18px}.suggestion-rules summary{cursor:pointer}.suggestion-rules p{max-width:1000px}
    .suggestion-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
    .suggestion-summary>div{border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-around;gap:12px;flex-wrap:wrap;font-size:13px;text-align:center}
    .suggestion-summary strong{font-size:15px}.suggestion-error,#suggestion-validation{color:#b14343}
    #plan-suggestion-dialog table{width:100%;min-width:0;border-collapse:separate;border-spacing:0;table-layout:fixed;font:inherit;font-size:13px}
    #plan-suggestion-dialog :is(th,td){text-align:center;padding:10px 7px;box-sizing:border-box;font-weight:400}
    #plan-suggestion-dialog thead th{height:48px;background:#f6f8fc;white-space:nowrap}
    #plan-suggestion-dialog tbody :is(th,td){height:144px;border-bottom:1px solid var(--line)}
    #plan-suggestion-dialog tbody th{font-weight:700;background:white;color:var(--text)}
    #plan-suggestion-dialog tfoot :is(th,td){height:62px;background:#edf2fb;font-weight:600}
    #plan-suggestion-dialog input{width:82px;box-sizing:border-box;text-align:center;padding:8px 4px;border:1px solid #d7dce5;border-radius:8px;font:inherit;background:white;color:inherit}
    #plan-suggestion-dialog input:focus{outline:2px solid #a7b7ea}
    #plan-suggestion-dialog input:invalid{border-color:#d06565}
    #plan-suggestion-dialog .pd-table{border:0}
    .suggestion-table-actions{display:flex;justify-content:flex-end;margin:0 0 12px}
    .suggestion-pair{grid-template-columns:minmax(760px,1fr) minmax(1370px,1.7fr)}
    .suggestion-pair.suggestion-collapsed{grid-template-columns:minmax(760px,1fr) minmax(760px,1fr)}
    #plan-suggestion-dialog .suggestion-planning tr>:first-child{width:80px}
    #plan-suggestion-dialog .suggestion-planning tr>:nth-child(2){width:260px}
    #plan-suggestion-dialog .suggestion-inline-reason{white-space:normal;text-align:left;font-size:12px;line-height:1.6;color:var(--muted)}
    .suggestion-inline-reason small{display:block;color:#8c691f}
    .suggestion-footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:16px 24px;border-top:1px solid var(--line);background:white}
    #suggestion-validation{margin-right:auto;font-size:13px;line-height:1.5}
    @media(max-width:700px){#plan-suggestion-content{padding:16px}.suggestion-summary{grid-template-columns:1fr}.suggestion-footer{padding:12px 16px;flex-wrap:wrap}#suggestion-validation{width:100%}.suggestion-heading h2{font-size:18px}.suggestion-tag{margin-left:0}}
  `;
  document.head.appendChild(style);
  const dialog=document.createElement('dialog');
  dialog.id='plan-suggestion-dialog';dialog.setAttribute('aria-labelledby','plan-suggestion-title');
  dialog.innerHTML='<div id="plan-suggestion-content"></div><div class="suggestion-footer"><span id="suggestion-validation" role="status"></span><button class="btn" id="suggestion-cancel">取消</button><button class="btn primary" id="suggestion-apply">应用</button></div>';
  document.body.appendChild(dialog);
  dialog.addEventListener('cancel',e=>{e.preventDefault();closePlanSuggestions();});
  dialog.addEventListener('click',e=>{
    const sort=e.target.closest('[data-suggest-sort]');
    if(sort&&planSuggestion) sortPlanSuggestion(sort.dataset.suggestSort);
    if(e.target.closest('[data-suggest-screenshot]')) exportPlanSuggestion();
    const toggle=e.target.closest('[data-suggest-toggle-roles]');
    if(toggle&&planSuggestion) {
      const s=planSuggestion,pair=dialog.querySelector('.suggestion-pair');
      if(!s.rolesCollapsed) s.expandedScroll=pair.scrollLeft;
      s.rolesCollapsed=!s.rolesCollapsed;
      pair.classList.toggle('suggestion-collapsed',s.rolesCollapsed);
      dialog.querySelectorAll('[data-suggest-role-cell]').forEach(el=>el.hidden=s.rolesCollapsed);
      toggle.textContent=s.rolesCollapsed?'展开岗位增减':'收起岗位增减';
      toggle.setAttribute('aria-expanded',String(!s.rolesCollapsed));
      if(!s.rolesCollapsed) pair.scrollLeft=s.expandedScroll||0;
    }
    if(e.target.closest('#suggestion-cancel')) closePlanSuggestions();
    if(e.target.closest('#suggestion-apply')) applyPlanSuggestions();
  });
  dialog.addEventListener('input',e=>{
    const el=e.target;
    if(!planSuggestion||!el.matches('[data-suggest-role]')) return;
    const i=Number(el.dataset.suggestRow),key=el.dataset.suggestRole;
    let value=Number(el.value);
    if(!el.validity.badInput&&Number.isSafeInteger(value)) {
      if(value<Number(el.min)) {value=Number(el.min);el.value=String(value);}
      if(value<=Number(el.max)) {planSuggestion.draft[i][key]=value;planSuggestion.edited.add(i);}
    }
    updatePlanSuggestionPreview();
  });
}
