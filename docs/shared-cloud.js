/* Public shared workspace. No passwords, admin keys, or private business data here. */
'use strict';
function createSharedCloud(app) {
  const cloud={
    url:'https://mjqjcwwthhjofmxyrulp.supabase.co',
    key:'sb_publishable_rhvEeAOZiOaZvGSQt06mjg_dedjeQ3S',
    ready:false,revision:0,dirty:false,busy:false,conflict:false,timer:null,poll:null,base:null,draft:null,
    cacheKey:'demand-shared-cache-v1',draftKey:'demand-shared-draft-v1',selectionKey:'demand-shared-selected-month',
    deviceKey:'demand-shared-device-id',deviceId:null,initialized:false,lastSeen:null,
    el(id) { return document.getElementById(id); },
    message(text,error=false) { const e=this.el('cloud-message');e.textContent=text;e.dataset.error=String(error); },
    status(text,error=false) { const e=this.el('save-status');e.textContent=text;e.dataset.error=String(error); },
    lock(value) { this.ready=!value;this.el('dashboard-content').inert=value; },
    read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch(_) { return null; } },
    write(key,value) { try { localStorage.setItem(key,JSON.stringify(value));return true; } catch(_) { return false; } },
    async request(path,body) {
      let response;
      try {
        response=await fetch(this.url+path,{
          method:body===undefined?'GET':'POST',headers:{apikey:this.key,'Content-Type':'application/json'},
          ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000),cache:'no-store'
        });
      } catch(_) { throw new Error('网络异常：尚未同步。修改已保留，请联网后重试。'); }
      const text=await response.text();
      let result;try { result=JSON.parse(text); } catch(_) { throw new Error('云端响应异常，未确认同步成功。'); }
      if(!response.ok) {
        const raw=result.message||result.code||'';
        const err=new Error(response.status===404?'共享数据库尚未配置：请在 Supabase SQL Editor 执行 supabase-shared.sql。'
          :raw.includes('VERSION_CONFLICT')?'版本冲突：其他访问者已修改数据，已停止覆盖。'
          :raw.includes('RATE_LIMIT')?'保存频率较高，稍后自动重试。'
          :raw.includes('DAILY_WRITE_LIMIT')?'今天已达到2000次共享保存限制，请联系项目管理员。'
          :raw.includes('WRITES_PAUSED')?'管理员已暂停公共编辑。'
          :raw.includes('INVALID_PAYLOAD')?'数据格式校验未通过，未保存到云端。'
          :`同步失败（${response.status}），请重试或联系管理员。`);
        err.code=raw;throw err;
      }
      return result;
    },
    normalize(payload) {
      const copy=structuredClone(payload);
      const safe=(v,depth=0)=>{
        if(depth>18) throw new Error('数据层级过多。');
        if(typeof v==='string'&&(v.length>200||/[<>&"']/.test(v))) throw new Error('数据包含不支持的文本，已停止加载。');
        if(typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>10000000)) throw new Error('数值超出支持范围。');
        if(v&&typeof v==='object') for(const [key,value] of Object.entries(v)) {
          if(['__proto__','prototype','constructor'].includes(key)) throw new Error('不安全的数据字段。');
          safe(value,depth+1);
        }
      };
      safe(copy);
      if(!copy||!copy.months||Array.isArray(copy.months)||!copy.months['2026-08']||Object.keys(copy.months).length>120)
        throw new Error('月份数据不完整或超过120个月。');
      const products=['CB','CF','CR','DF','JC','VF','LS'],non=['TU+MT','RD','DEER','CBR+BJO+SORT+HOLE'];
      const num=(v,integer=false)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&(!integer||Number.isSafeInteger(v));
      for(const [month,m] of Object.entries(copy.months)) {
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'2026-08'||!Array.isArray(m.data)||m.data.length!==7||!Array.isArray(m.groups)||m.groups.length!==4)
          throw new Error('月份或小组结构异常。');
        if(m.data.some((r,i)=>r.product!==products[i]||['director','kol','plan','image','cross'].some(k=>!num(r[k],true))))
          throw new Error('产品需求必须是非负整数。');
        app.migrate(m);
        if(m.nonSlots.length!==4||m.nonSlots.some((r,i)=>r.product!==non[i]||!num(r.demand,true)||!num(r.reservedTime)))
          throw new Error('非SLOTS结构异常。');
        const assigned=m.groups.flatMap(g=>g.products||[]);
        if(assigned.length!==7||new Set(assigned).size!==7||assigned.some(p=>!products.includes(p))) throw new Error('北京产品归属重复或遗漏。');
        for(const g of m.groups) {
          if(typeof g.name!=='string'||typeof g.owner!=='string'||
            ['innovation','playable','chengdu','fulltime','leave','temporary'].some(k=>!num(g[k],true))||
            !num(g.people)||!num(g.avgTime)||g.avgTime<=0) throw new Error('北京小组参数异常。');
        }
        if(m.chengduGroups.length!==2) throw new Error('成都小组结构异常。');
        m.chengduGroups.forEach((g,i)=>{
          const codes=i===0?['SLOTS','TU+MT','RD','DEER']:['TU+MT'];
          if(typeof g.name!=='string'||typeof g.owner!=='string'||!num(g.people)||!num(g.leave,true)||g.products.length!==codes.length||
            g.products.some((r,j)=>r.product!==codes[j]||!num(r.demand,true)||!num(r.avgTime))) throw new Error('成都小组参数异常。');
        });
        if(m.dateRange) {
          const {start,end}=m.dateRange;
          if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||
            !Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||start>end||(Date.parse(end)-Date.parse(start))/86400000>366)
            throw new Error('日期范围异常。');
        }
        // Baselines are obsolete local reset metadata; omit from shared snapshots.
        delete m.baseline;
      }
      safe(copy);
      if(!copy.months[copy.selectedMonth]) copy.selectedMonth=Object.keys(copy.months).sort().at(-1);
      if(new Blob([JSON.stringify(copy)]).size>1000000) throw new Error('共享数据超过1MB限制。');
      return copy;
    },
    wire(payload=app.get()) {
      const copy=this.normalize(payload);
      // Selected month is a local view preference; switching months never changes everyone's view.
      copy.selectedMonth=Object.keys(copy.months).sort().at(-1);return copy;
    },
    fingerprint(v) {
      if(Array.isArray(v)) return '['+v.map(x=>this.fingerprint(x)).join(',')+']';
      if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+this.fingerprint(v[k])).join(',')+'}';
      return JSON.stringify(v);
    },
    equal(a,b) { return this.fingerprint(a)===this.fingerprint(b); },
    adopt(payload) {
      const data=this.normalize(payload),preferred=this.read(this.selectionKey)||app.get().selectedMonth;
      if(data.months[preferred]) data.selectedMonth=preferred;
      app.set(data);
    },
    backup(payload=app.get()) {
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download=`需求量看板备份-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    },
    keepDraft() {
      this.draft={payload:structuredClone(app.get()),revision:this.revision};
      if(!this.write(this.draftKey,this.draft)) this.message('无法保存本地应急副本，请保持页面打开并下载备份。',true);
    },
    clearDraft() { this.draft=null;try { localStorage.removeItem(this.draftKey); } catch(_) {} },
    async fetchRow() {
      const rows=await this.request('/rest/v1/demand_shared_state?id=eq.1&select=payload,revision,updated_at');
      if(!Array.isArray(rows)||rows.length!==1) throw new Error('共享工作区未建立，请执行共享版SQL。');
      return rows[0];
    },
    async start() {
      if(this.busy) return;
      this.busy=true;this.status('正在读取云端…');this.lock(true);
      try {
        let id=this.read(this.deviceKey);
        if(typeof id!=='string') { id=crypto.randomUUID();this.write(this.deviceKey,id); }
        this.deviceId=id; // Only a diagnostic identifier, never an access credential.
        this.draft=this.read(this.draftKey);
        const row=await this.fetchRow();
        if(row.payload===null) {
          this.revision=row.revision;this.base=null;
          this.el('cloud-migrate').hidden=false;this.el('cloud-import').hidden=false;
          this.message('云端为空。请在原电脑打开本地看板，核对后迁移真实数据；也可导入已有JSON备份。不会自动上传空白模板。');
          this.status('等待首次导入');this.initialized=false;
        } else {
          const normalized=this.wire(row.payload);
          this.base=normalized;this.revision=row.revision;this.write(this.cacheKey,row);this.initialized=true;
          if(this.draft) {
            this.adopt(this.draft.payload);this.dirty=true;
            this.conflict=this.draft.revision!==row.revision;
            this.el('cloud-reload').hidden=false;this.el('cloud-recover').hidden=this.conflict;
            this.status('发现未同步修改',true);
            this.message(this.conflict?'云端已有更新。当前显示本地草稿，请先备份，再读取最新云端；不会覆盖他人修改。':'发现未同步草稿，点击“恢复未同步修改”继续保存。',true);
          } else {
            this.adopt(normalized);this.lock(false);this.status('已同步云端');
            this.message('公共共享数据：所有访问者均可编辑。修改会同步给其他人。');
          }
        }
        this.el('cloud-retry').hidden=true;
      } catch(error) {
        const cache=this.read(this.cacheKey);
        try {
          if(this.draft?.payload && cache?.payload) {
            this.adopt(this.draft.payload);this.revision=this.draft.revision;this.base=this.wire(cache.payload);
            this.dirty=true;this.initialized=true;this.lock(false);
          } else if(cache?.payload) {
            this.adopt(cache.payload);this.revision=cache.revision;this.base=this.wire(cache.payload);
            this.initialized=true;this.lock(false);
          }
        } catch(_) { this.lock(true); }
        this.status('同步失败',true);this.message(error.message,true);this.el('cloud-retry').hidden=false;
      } finally { this.busy=false; }
      if(!this.poll) this.poll=setInterval(()=>{if(!document.hidden) this.sync();},5000);
    },
    queueSave() {
      this.write(this.selectionKey,app.get().selectedMonth);
      if(!this.ready||!this.initialized||this.conflict) return false;
      try {
        if(this.equal(this.wire(),this.base)&&!this.busy) { this.dirty=false;this.clearDraft();return true; }
      } catch(error) { this.message(error.message,true);return false; }
      this.dirty=true;this.keepDraft();this.status('修改待同步…');
      clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),1200);return true;
    },
    showConflict() {
      this.conflict=true;this.lock(true);this.keepDraft();
      this.el('cloud-reload').hidden=false;this.el('cloud-recover').hidden=true;this.el('cloud-retry').hidden=true;
      this.status('同步冲突，已保留本地草稿',true);
      this.message('其他访问者已更新云端。为避免覆盖较新数据，请先下载当前备份，再读取云端；根据备份重新调整。',true);
    },
    async flush() {
      if(this.busy||!this.dirty||this.conflict||!this.ready) return;
      this.busy=true;clearTimeout(this.timer);let payload;
      try {
        payload=this.wire();this.status('正在保存到云端…');
        const result=await this.request('/rest/v1/rpc/save_demand_shared',{expected_revision:this.revision,new_payload:payload});
        if(!result||result.revision<=this.revision||!this.equal(result.payload,payload)) throw new Error('保存结果未通过校验。');
        this.revision=result.revision;this.base=payload;this.write(this.cacheKey,result);
        this.dirty=!this.equal(this.wire(),payload);
        if(this.dirty) this.keepDraft();else this.clearDraft();
        this.el('cloud-retry').hidden=true;
        this.status(this.dirty?'后续修改待同步…':'已保存到云端');
        this.message('保存成功。数据和历史版本已写入 Supabase。');
      } catch(error) {
        this.keepDraft();
        if(error.code?.includes('VERSION_CONFLICT')) this.showConflict();
        else {
          this.status('未同步，请勿清理浏览器数据',true);this.message(error.message,true);this.el('cloud-retry').hidden=false;
          if(error.code?.startsWith('RATE_LIMIT')) this.timer=setTimeout(()=>this.flush(),1500);
        }
        this.busy=false;return;
      }
      this.busy=false;if(this.dirty) this.timer=setTimeout(()=>this.flush(),1200);
    },
    async sync() {
      if(this.busy||this.conflict) return;
      if(!this.initialized) { await this.start();return; }
      if(this.dirty) { await this.flush();return; }
      this.busy=true;
      try {
        const row=await this.fetchRow();
        if(row.revision!==this.revision) {
          // A user may have edited while the read request was in flight.
          if(this.dirty) { this.showConflict();return; }
          const normalized=this.wire(row.payload);
          if(document.activeElement?.matches('#dashboard-content input')) return;
          this.adopt(normalized);this.base=normalized;this.revision=row.revision;this.write(this.cacheKey,row);
          this.status('已同步其他访问者的更新');this.message('已读取云端最新数据。');
        }
        this.el('cloud-retry').hidden=true;
      } catch(error) { this.message(error.message,true);this.el('cloud-retry').hidden=false; }
      finally { this.busy=false; }
    },
    async initialize() {
      if(this.busy||this.initialized) return;
      if(!confirm('这些数据将公开给所有访问者，所有人都能修改。请确认是要分享的真实数据；会先下载备份。继续吗？')) return;
      this.backup();this.busy=true;
      try {
        const payload=this.wire();
        const result=await this.request('/rest/v1/rpc/save_demand_shared',{expected_revision:this.revision,new_payload:payload});
        const verify=await this.fetchRow();
        if(verify.revision!==result.revision||!this.equal(verify.payload,payload)) throw new Error('初始化后校验不一致，请重新读取云端。');
        this.base=payload;this.revision=verify.revision;this.initialized=true;this.dirty=false;
        this.adopt(payload);this.clearDraft();this.write(this.cacheKey,verify);this.lock(false);
        this.el('cloud-migrate').hidden=true;this.el('cloud-import').hidden=true;
        this.status('已保存到云端');this.message('公共数据导入成功。原数据及备份未删除。');
      } catch(error) { this.message(error.message,true);this.el('cloud-retry').hidden=false; }
      finally { this.busy=false; }
    },
    async importFile(file) {
      if(this.initialized) { this.message('云端已有数据，禁止直接覆盖导入。',true);return; }
      try {
        if(file.size>1048576) throw new Error('备份超过1MB。');
        this.adopt(this.normalize(JSON.parse(await file.text())));
        this.message('备份已载入预览，尚未上传。核对后点击“备份并公开当前数据”。');
      } catch(error) { this.message(`导入失败：${error.message}`,true); }
    },
    recover() {
      if(this.conflict||this.busy||!this.draft) return;
      this.lock(false);this.dirty=true;this.el('cloud-recover').hidden=true;this.el('cloud-reload').hidden=true;this.flush();
    },
    async reloadRemote() {
      if(this.busy||!confirm('先下载当前数据备份，再读取云端最新数据。未同步改动不会覆盖云端。继续吗？')) return;
      this.backup();this.busy=true;this.lock(true);clearTimeout(this.timer);
      try {
        const row=await this.fetchRow();if(!row.payload) throw new Error('云端尚无数据。');
        this.adopt(row.payload);this.base=this.wire(row.payload);this.revision=row.revision;
        this.dirty=false;this.conflict=false;this.initialized=true;this.clearDraft();this.write(this.cacheKey,row);
        this.lock(false);this.el('cloud-reload').hidden=true;this.el('cloud-recover').hidden=true;
        this.status('已读取云端最新数据');this.message('之前的当前数据已下载备份。');
      } catch(error) { this.message(error.message,true); }
      finally { this.busy=false; }
    },
    deleteMonth() {
      if(!this.ready||this.busy) return;
      const current=app.get(),month=current.selectedMonth;
      if(month==='2026-08') { this.message('2026年8月是基础月份，保留用于历史对比，不能删除。',true);return; }
      if(!confirm(`删除共享数据中的 ${month}？所有访问者都会受影响。删除前将下载备份，数据库仍保留历史版本。`)) return;
      this.backup();const copy=structuredClone(current);delete copy.months[month];
      copy.selectedMonth=Object.keys(copy.months).sort().at(-1);app.set(copy);this.queueSave();
    }
  };
  document.getElementById('cloud-backup').addEventListener('click',()=>cloud.backup());
  document.getElementById('cloud-migrate').addEventListener('click',()=>cloud.initialize());
  document.getElementById('cloud-recover').addEventListener('click',()=>cloud.recover());
  document.getElementById('cloud-reload').addEventListener('click',()=>cloud.reloadRemote());
  document.getElementById('cloud-retry').addEventListener('click',()=>cloud.initialized?cloud.sync():cloud.start());
  document.getElementById('cloud-import').addEventListener('click',()=>document.getElementById('cloud-import-file').click());
  document.getElementById('cloud-import-file').addEventListener('change',e=>{if(e.target.files[0]) cloud.importFile(e.target.files[0]);e.target.value='';});
  document.getElementById('delete-month').addEventListener('click',()=>cloud.deleteMonth());
  window.addEventListener('focus',()=>cloud.sync());
  window.addEventListener('online',()=>cloud.sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) cloud.sync();});
  window.addEventListener('beforeunload',e=>{if(cloud.dirty||cloud.busy||cloud.draft){e.preventDefault();e.returnValue='';}});
  return cloud;
}
