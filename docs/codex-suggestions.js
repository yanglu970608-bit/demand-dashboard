// Capability-protected cloud queue. Model/worker credentials never enter this file.
(()=>{
  const endpoint='http://127.0.0.1:4318',key='demand-codex-local-pairing',cloudKey='demand-codex-cloud-pairing';
  let controller=null;
  const fullscreenStyle=document.createElement('style');
  fullscreenStyle.textContent='#plan-suggestion-dialog.suggestion-fullscreen{width:100vw!important;max-width:100vw!important;height:100dvh;max-height:100dvh!important;inset:0;margin:0;border-radius:0;box-sizing:border-box}';
  document.head.appendChild(fullscreenStyle);
  function setFullscreen(value){
    if(!planSuggestion)return;
    planSuggestion.fullscreen=value;
    const dialog=document.getElementById('plan-suggestion-dialog');
    dialog.classList.toggle('suggestion-fullscreen',value);
    const button=dialog.querySelector('[data-suggest-fullscreen]');
    if(button){button.textContent=value?'退出全屏':'全屏';button.setAttribute('aria-pressed',String(value));}
    requestAnimationFrame(syncSuggestionScrollbar);
  }
  const token=()=>localStorage.getItem(cloudKey)||localStorage.getItem(key)||'';
  async function cloudRpc(name,body,signal){
    const response=await fetch(cloud.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:cloud.key,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok)throw Error(result.message||'云端AI队列连接失败');
    return result;
  }
  async function queueSuggestion(body,signal,credential){
    const id=crypto.randomUUID();
    try{
      // Same id is reused on a transient submit failure; database submission is idempotent.
      for(let attempt=0;attempt<2;attempt++){
        try{await cloudRpc('demand_ai_submit',{p_token:credential,p_id:id,p_input:body},signal);break;}
        catch(e){if(signal.aborted||attempt===1||e.name!=='TypeError')throw e;}
      }
      let failures=0;
      while(!signal.aborted){
        let job;
        try{job=await cloudRpc('demand_ai_result',{p_token:credential,p_id:id},signal);failures=0;}
        catch(e){if(signal.aborted||++failures>=3)throw e;}
        if(job?.status==='done')return {result:job.result};
        if(job&&['failed','cancelled','expired'].includes(job.status))throw Error(job.error||'AI任务已取消或过期');
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      throw new DOMException('Cancelled','AbortError');
    }catch(e){
      // Cancellation never deletes or edits business data.
      cloudRpc('demand_ai_cancel',{p_token:credential,p_id:id}).catch(()=>{});
      throw e;
    }
  }
  async function call(route,body,signal,credential=token()) {
    if(localStorage.getItem(cloudKey)){
      if(route==='/suggest')return queueSuggestion(body,signal,credential);
      return cloudRpc('demand_ai_status',{p_token:credential},signal);
    }
    const response=await fetch(endpoint+route,{method:body?'POST':'GET',headers:{
      'Authorization':'Bearer '+credential,...(body?{'Content-Type':'application/json'}:{})
    },body:body?JSON.stringify(body):undefined,signal});
    const result=await response.json();
    if(!response.ok) throw Error(result.error||'本机Codex暂时无法连接');
    return result;
  }
  function pairing() {
    let dialog=document.getElementById('codex-pair-dialog');
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='codex-pair-dialog';
      dialog.style.cssText='border:0;border-radius:16px;padding:24px;max-width:440px;color:var(--text);box-shadow:0 20px 80px #0003';
      dialog.innerHTML='<h3>连接Codex AI助手</h3><p>输入云端AI配对码。可在其他电脑提交建议，但负责计算的电脑需要保持助手运行。配对码仅在当前浏览器保存，不是模型密钥。</p><input type="password" autocomplete="off" aria-label="Codex云端配对码" placeholder="云端AI配对码" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #ddd;border-radius:8px"><p role="status" style="color:#b33434"></p><div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn" data-pair-cancel>取消</button><button class="btn primary" data-pair-connect>连接</button></div>';
      document.body.appendChild(dialog);
      dialog.querySelector('[data-pair-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('[data-pair-connect]').onclick=async()=>{
        const button=dialog.querySelector('[data-pair-connect]'),value=dialog.querySelector('input').value.trim();
        if(!/^[a-f0-9]{64}$/.test(value)){dialog.querySelector('[role=status]').textContent='请输入正确的云端AI配对码';return;}
        button.disabled=true;
        try {
          const status=await cloudRpc('demand_ai_status',{p_token:value});
          if(!status.online)throw Error('负责计算的电脑未连接，请先启动Codex助手');
          localStorage.setItem(cloudKey,value);dialog.querySelector('input').value='';dialog.close();
          await generate();
        } catch(e){dialog.querySelector('[role=status]').textContent=e.message||'连接失败，请检查助手和网络。';}
        finally {button.disabled=false;}
      };
    }
    dialog.querySelector('[role=status]').textContent='';dialog.showModal();
  }
  function requestFor(s) {
    return {month:s.month,targets:Object.fromEntries([
      ['planCross',['plan','cross']],['directorKol',['director','kol']]
    ].map(([key,roles])=>[key,s.goals[key]+s.rows.reduce((sum,row)=>{
      const b=s.base.find(r=>r.product===row.product);
      return sum+roles.reduce((n,k)=>n+row[k]-b[k],0);
    },0)])),rows:s.rows.map((r,i)=>({
      product:r.product,base:Object.fromEntries(numericKeys.map(k=>[k,s.base.find(b=>b.product===r.product)[k]])),
      metrics:Object.fromEntries(['roi','planCrossRoi','directorRoi','spendShare','demandShare','trend'].map(k=>[k,s.metrics[i][k==='demandShare'?'share':k]??null]))
    }))};
  }
  function checkResult(request,result) {
    if(!Array.isArray(result.rows)||result.rows.length!==request.rows.length)throw Error('模型产品清单不完整');
    const seen=new Set(),sum={planCross:0,directorKol:0};
    const draft=result.rows.map(r=>{
      const b=request.rows.find(x=>x.product===r.product)?.base;
      if(!b||seen.has(r.product))throw Error('模型产品清单不匹配');seen.add(r.product);
      const row={product:r.product,image:0};
      for(const [key,ks] of [['planCross',['plan','cross']],['directorKol',['director','kol']]]) {
        const n=r[key],base=b[ks[0]]+b[ks[1]];
        if(!Number.isSafeInteger(n)||base+n<0||Math.abs(n)>1000000)throw Error('模型数量未通过校验');
        const first=base?Math.round(n*b[ks[0]]/base):n;
        row[ks[0]]=first;row[ks[1]]=n-first;sum[key]+=n;
      }
      if(numericKeys.some(k=>b[k]+row[k]<0||b[k]+row[k]>10000000))throw Error('模型岗位数量超出范围');
      if(typeof r.reason!=='string'||r.reason.length>500)throw Error('模型说明不合法');
      return row;
    });
    if(sum.planCross!==request.targets.planCross||sum.directorKol!==request.targets.directorKol)throw Error('模型结果未满足目标总量');
    return draft;
  }
  async function generate() {
    const s=planSuggestion;if(!s||s.codexBusy)return;
    if(!token()){pairing();return;}
    s.codexBusy=true;s.codexError='';s.codexFailed=false;s.codexNeedsPair=false;
    controller=new AbortController();const active=controller;
    const timer=setTimeout(()=>active.abort(),190000);
    renderPlanSuggestions();
    try {
      if(s.remaining.planCross===null||s.remaining.directorKol===null)throw Error('请先确认策跨承载力和编导KOL调量目标，再生成AI建议');
      const request=requestFor(s);
      const {result}=await call('/suggest',request,active.signal);
      if(planSuggestion!==s)return;
      if(s.fingerprint!==suggestionFingerprint())throw Error('原始数据已变化，请取消并重新生成');
      const draft=checkResult(request,result);
      // Match product identity, never rely on model response order.
      s.draft=s.rows.map(r=>({...draft.find(d=>d.product===r.product),image:r.image-s.base.find(b=>b.product===r.product).image}));
      s.aiReasons=Object.fromEntries(result.rows.map(r=>[r.product,r.reason]));
      s.aiSource=true;s.edited.clear();
    } catch(e) {
      if(planSuggestion===s){s.codexFailed=true;s.codexError=e.name==='AbortError'?'已取消或计算超时，未修改数据':e.message==='Failed to fetch'?'无法连接本机助手，请检查启动状态及浏览器本机网络权限':e.message;}
    } finally {
      clearTimeout(timer);if(controller===active)controller=null;
      s.codexBusy=false;if(planSuggestion===s)renderPlanSuggestions();
    }
  }
  const renderOriginal=renderPlanSuggestions,updateOriginal=updatePlanSuggestionPreview;
  renderPlanSuggestions=function(){
    renderOriginal();
    const s=planSuggestion,heading=document.querySelector('.suggestion-heading h2');
    const fullscreen=document.createElement('button');fullscreen.className='btn';
    fullscreen.dataset.suggestFullscreen='';fullscreen.onclick=()=>setFullscreen(!s.fullscreen);
    heading.querySelector('[data-suggest-screenshot]').after(fullscreen);
    const dialog=document.getElementById('plan-suggestion-dialog');
    if(!dialog.dataset.fullscreenReady){
      dialog.dataset.fullscreenReady='true';
      dialog.addEventListener('cancel',e=>{
        if(planSuggestion?.fullscreen){e.preventDefault();e.stopImmediatePropagation();setFullscreen(false);}
      },true);
    }
    setFullscreen(!!s.fullscreen);
    const button=document.createElement('button');button.className='btn';
    button.textContent=token()?'重新生成AI建议':'连接Codex AI';
    button.disabled=!!s.codexBusy;button.onclick=()=>token()?generate():pairing();heading.appendChild(button);
    const status=document.createElement('p');status.setAttribute('role','status');
    status.textContent=s.codexBusy?'Codex正在分析，建议通过校验后才会展示，请稍候…':s.codexError||'';
    status.style.color=s.codexError?'#b33434':'var(--muted)';
    heading.parentElement.appendChild(status);
    document.querySelector('.suggestion-tag').textContent=s.codexBusy?'AI计算中':s.aiSource?'Codex真实模型建议':s.codexNeedsPair?'等待连接AI':'本地规则预览';
    if(token()){
      const settings=document.createElement('button');settings.className='btn';settings.textContent='连接设置';settings.onclick=pairing;
      settings.disabled=!!s.codexBusy;heading.appendChild(settings);
    }
    if(s.aiSource){
      const rules=document.querySelector('.suggestion-rules p');
      if(rules)rules.textContent='由Codex真实模型先作较均衡的产品基础分配，再按综合回报比、日花与需求占比适度调整总量；岗位效率决定内部倾斜，弱岗位可以不增加。程序校验准确总量，并在可行时按平均调整量的宽松范围拦截过度集中结果，不固定差5条；仅季度首月考虑日花变化。点击应用才修改数据。';
    }
  };
  updatePlanSuggestionPreview=function(){
    updateOriginal();const s=planSuggestion;
    document.querySelectorAll('#plan-suggestion-dialog td[data-suggest-role-cell]').forEach(cell=>{
      const number=cell.querySelector('input,span')||cell;
      const value=Number(number.matches('input')?number.value:number.textContent);
      number.style.color=Number.isFinite(value)&&value!==0?'#dc2626':'';
    });
    if(s.aiSource){
      const totals=s.draft.map(r=>numericKeys.reduce((n,k)=>n+r[k],0)),low=Math.min(...totals),high=Math.max(...totals);
      s.rows.forEach((r,i)=>{
        document.querySelector(`[data-suggest-reason="${i}"]`).textContent=low!==high&&(totals[i]===low||totals[i]===high)?s.aiReasons[r.product]||'':'';
      });
    }
    if(s.codexBusy||s.codexFailed||s.codexNeedsPair)document.getElementById('suggestion-apply').disabled=true;
    document.querySelectorAll('[data-suggest-role],[data-suggest-sort],[data-suggest-screenshot]').forEach(el=>el.disabled=!!s.codexBusy);
  };
  const openOriginal=openPlanSuggestions,closeOriginal=closePlanSuggestions,applyOriginal=applyPlanSuggestions;
  openPlanSuggestions=function(){
    const prior=planSuggestion;openOriginal();
    if(planSuggestion&&planSuggestion!==prior){
      if(token())generate();
      else{planSuggestion.codexNeedsPair=true;renderPlanSuggestions();pairing();}
    }
  };
  closePlanSuggestions=function(){controller?.abort();setFullscreen(false);closeOriginal();};
  applyPlanSuggestions=function(){if(planSuggestion?.codexBusy||planSuggestion?.codexFailed||planSuggestion?.codexNeedsPair)return;applyOriginal();};
})();
