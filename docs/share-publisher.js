/* Editor-only integration. Never loaded by share-products.html/share-groups.html. */
async function publishShareSnapshot(view,payload,expectedRevision) {
  if(!DemandShare.validate(payload,view)) throw new Error('当前数据不完整或超出范围，未发布。');
  if(cloud.local) {
    const rows=await DemandShare.read(view,true),old=rows.find(r=>r.month===payload.month);
    if((old?.revision||0)!==expectedRevision) throw new Error('本地分享版本冲突，请重试。');
    if(old&&JSON.stringify(old.payload)===JSON.stringify(payload)) return old;
    const record={view_id:view,month:payload.month,payload,revision:expectedRevision+1,updated_at:new Date().toISOString()};
    localStorage.setItem(DemandShare.storageKey(view),JSON.stringify([...rows.filter(r=>r.month!==payload.month),record]));
    return record;
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(cloud.url+'/rest/v1/rpc/publish_demand_month',{
      method:'POST',headers:{apikey:cloud.key,'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({target_view:view,target_month:payload.month,expected_revision:expectedRevision,snapshot:payload})
    });
    const result=await response.json();
    if(!response.ok) {
      const message=result.message||'';
      throw new Error(message.includes('VERSION_CONFLICT')?'此月份已被其他页面发布，请重新检查后再发布。':
        message.includes('RATE_LIMIT')?'发布间隔至少5秒，请稍后重试。':
        message.includes('DAILY_PUBLISH_LIMIT')?'该分享版今天已达到100次发布限制。':
        message.includes('PUBLISH_PAUSED')?'管理员已暂停发布。':
        message.includes('INVALID_SHARE_PAYLOAD')?'分享数据格式不符合要求，未发布。':
        message.includes('LIMIT')?'分享存储已达到限制，请联系项目管理员。':
        response.status===404?'分享服务尚未配置，请先执行 supabase-published.sql。':`发布失败（${response.status}）。`);
    }
    DemandShare.validateRows([result],view);
    return result;
  } catch(e) {
    if(e.name==='AbortError')throw new Error('发布超时，结果尚未确认；重试前会重新检查云端版本。');
    throw e;
  } finally {clearTimeout(timer);}
}
function buildPublishedSnapshot(view) {
  const month=store.months[selectedMonth],range=period(),{start,end,days,weeks}=range;
  const snapshot={schemaVersion:1,month:selectedMonth,period:{start,end,days,weeks,warning:document.getElementById('range-status').textContent}};
  if(view==='products') {
    snapshot.products=orderedProducts(month.data).map(r=>({product:r.product,...Object.fromEntries(numericKeys.map(k=>[k,r[k]]))}));
    snapshot.nonSlots=orderedProducts(month.nonSlots).map(r=>({product:r.product,demand:r.demand,reservedTime:r.reservedTime}));
  } else {
    const safe=n=>Number.isFinite(n)?n:null;
    snapshot.slotsDemand=month.data.reduce((n,r)=>n+r.plan+r.cross,0);
    snapshot.beijing=month.groups.map(g=>({
      name:g.name,owner:g.owner,products:[...g.products],demand:groupDemand(g),
      innovation:g.innovation,playable:g.playable,total:groupTotal(g),chengdu:g.chengdu,
      chengduWeek:weeks?safe(g.chengdu/weeks*month.chengduGroups[0].products.find(r=>r.product==='SLOTS').avgTime):null,
      actual:groupActual(g),capacity:safe(groupCapacity(g)),avgTime:g.avgTime,people:g.people,
      fulltime:g.fulltime,leave:g.leave,temporary:g.temporary
    }));
    snapshot.chengdu=month.chengduGroups.map((g,i)=>({
      name:g.name,owner:g.owner,participating:i===0,people:i===0?g.people:0,leave:i===0?g.leave:0,
      products:g.products.map(r=>({product:r.product,demand:chengduDemand(r,month),days:chengduDays(r,month),avgTime:r.avgTime})),
      required:i===0?g.products.reduce((n,r)=>n+chengduDays(r,month),0):0,
      capacity:i===0?g.people*days-g.leave:0
    }));
  }
  if(!DemandShare.validate(snapshot,view)) throw new Error('当前月份存在无效数据，未生成分享内容。');
  return snapshot;
}
function renderSharePublishControls() {
  document.querySelectorAll('[data-share-publish]').forEach(btn=>btn.disabled=!DemandShare.validMonth(selectedMonth));
  document.querySelectorAll('[data-share-status]').forEach(el=>{
    el.textContent=!DemandShare.validMonth(selectedMonth)?'仅支持发布2026年11月及以后的月份。':
      location.protocol==='file:'?'本地试用：只更新本地分享预览，不会写入线上数据。':'仅在点击更新后发布当前月份，不会同步未发布的编辑。';
  });
}
function setupSharePublisher() {
  const titles={products:'产品需求量',groups:'小组调量'};
  for(const [view,id] of [['products','edit-view'],['groups','group-view']]) {
    const panel=document.createElement('div');panel.className='share-publish-tools';
    panel.innerHTML=`<div class="share-publish-actions"><button class="btn" data-share-publish="${view}">更新分享数据</button><a class="btn" href="./share-${view}.html" target="_blank" rel="noopener">预览分享版</a><button class="btn" data-share-copy="${view}">复制分享链接</button></div><p class="hint" role="status" data-share-status="${view}"></p>`;
    document.getElementById(id).querySelector('.panel-head').after(panel);
  }
  const style=document.createElement('style');
  style.textContent='.share-publish-tools{margin:0 0 16px}.share-publish-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.share-publish-actions a{text-decoration:none}.share-publish-tools .hint{text-align:right;margin:8px 0}.share-publish-tools [data-error=true]{color:#b14343}';
  document.head.appendChild(style);
  document.addEventListener('click',async e=>{
    const copy=e.target.closest('[data-share-copy]');
    if(copy) {
      const status=document.querySelector(`[data-share-status="${copy.dataset.shareCopy}"]`);
      if(location.protocol==='file:') {status.textContent='当前为本地测试，正式链接需部署后使用；请先点击“预览分享版”。';return;}
      const url=new URL(`share-${copy.dataset.shareCopy}.html`,location.href).href;
      try {await navigator.clipboard.writeText(url);status.textContent='分享链接已复制，仅展示该界面的已发布数据。';}
      catch(_) {status.textContent=`请复制此分享链接：${url}`;}
      return;
    }
    const button=e.target.closest('[data-share-publish]');
    if(!button||cloud.modalOpen||cloud.actionPending||!cloud.ready||cloud.conflict) return;
    const view=button.dataset.sharePublish,status=document.querySelector(`[data-share-status="${view}"]`);
    button.disabled=true;cloud.actionPending=true;status.dataset.error='false';
    try {
      status.textContent='正在检查已发布版本…';
      const snapshot=buildPublishedSnapshot(view),fingerprint=JSON.stringify(snapshot);
      const rows=await DemandShare.read(view,cloud.local),prior=rows.find(r=>r.month===snapshot.month);
      const ok=await cloud.ask({title:cloud.local?'本地试发布':'更新分享数据',
        description:`将${prior?'替换':'新增'}${monthLabel(snapshot.month)}的“${titles[view]}”分享数据。其他月份和另一个分享版不变。${cloud.local?'这次仅保存到本地预览。':'发布后持有链接的人即可查看；此前发布版本将保留在后台历史中。'}`,submit:cloud.local?'更新本地预览':'发布当前月份'});
      if(!ok){status.textContent='已取消，没有更新分享数据。';return;}
      if(selectedMonth!==snapshot.month||JSON.stringify(buildPublishedSnapshot(view))!==fingerprint) throw new Error('编辑数据已变化，请重新检查后再发布。');
      status.textContent='正在更新分享数据…';
      const record=await publishShareSnapshot(view,snapshot,prior?.revision||0);
      status.textContent=`${cloud.local?'本地预览已更新':'发布成功'} · ${monthLabel(snapshot.month)} · 最后更新 ${new Date(record.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`;
    } catch(error) {
      status.dataset.error='true';status.textContent=`${error.message} 可再次点击“更新分享数据”重试；不会清除当前编辑数据。`;
    } finally {
      cloud.actionPending=false;button.disabled=!DemandShare.validMonth(selectedMonth);
      if(cloud.dirty&&!cloud.conflict) {clearTimeout(cloud.timer);cloud.timer=setTimeout(()=>cloud.flush(),200);}
    }
  });
  renderSharePublishControls();
}
