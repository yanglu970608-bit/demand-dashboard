/* Shared projection/transport only. Viewer pages never load editor code or source data. */
(() => {
  'use strict';
  const roles=['director','kol','plan','image','cross'];
  const codes=['CB','CF','CR','DF','JC','VF','LS'];
  const nonCodes=['TU+MT','RD','DEER','CBR+BJO+SORT+HOLE'];
  const api='https://mjqjcwwthhjofmxyrulp.supabase.co/rest/v1';
  const key='sb_publishable_rhvEeAOZiOaZvGSQt06mjg_dedjeQ3S';
  const validMonth=m=>typeof m==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m)&&m>='2026-11';
  const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
  const text=v=>typeof v==='string'&&v.length<=250;
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
  const validNumbers=(o,keys)=>keys.every(k=>numeric(o[k]));
  const unique=(rows,allowed)=>Array.isArray(rows)&&rows.length===allowed.length&&new Set(rows.map(r=>r.product)).size===allowed.length&&rows.every(r=>allowed.includes(r.product));
  function validate(p,view) {
    if(!p||p.schemaVersion!==1||!validMonth(p.month)) return false;
    const r=p.period;
    if(!exact(r,['start','end','days','weeks','warning'])||!validNumbers(r,['days','weeks'])||!text(r.warning)
      ||r.days<0||r.days>367||r.weeks<0||r.weeks>74||!Number.isInteger(r.days)||!Number.isInteger(r.weeks)
      ||![r.start,r.end].every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v)))
      ||r.start>r.end||(Date.parse(r.end)-Date.parse(r.start))/86400000>366) return false;
    if(view==='products') return exact(p,['schemaVersion','month','period','products','nonSlots'])
      &&unique(p.products,codes)&&p.products.every(row=>exact(row,['product',...roles])&&roles.every(k=>Number.isSafeInteger(row[k])&&row[k]>=0&&row[k]<=1e7))
      &&unique(p.nonSlots,nonCodes)&&p.nonSlots.every(row=>exact(row,['product','demand','reservedTime'])&&validNumbers(row,['demand','reservedTime'])&&row.demand>=0&&Number.isInteger(row.demand)&&row.reservedTime>=0);
    const gnums=['demand','innovation','playable','total','chengdu','actual','avgTime','people','fulltime','leave','temporary'];
    if(view!=='groups'||!exact(p,['schemaVersion','month','period','slotsDemand','beijing','chengdu'])||!numeric(p.slotsDemand)
      ||!Array.isArray(p.beijing)||p.beijing.length!==4||!Array.isArray(p.chengdu)||p.chengdu.length!==2) return false;
    const assigned=p.beijing.flatMap(g=>g.products);
    return assigned.length===7&&new Set(assigned).size===7&&assigned.every(c=>codes.includes(c))
      &&p.beijing.every(g=>exact(g,['name','owner','products','capacity','chengduWeek',...gnums])&&text(g.name)&&text(g.owner)&&Array.isArray(g.products)
        &&validNumbers(g,gnums)&&['capacity','chengduWeek'].every(k=>g[k]===null||numeric(g[k])))
      &&p.chengdu.every((g,i)=>exact(g,['name','owner','products','required','capacity','people','leave','participating'])
        &&text(g.name)&&text(g.owner)&&g.participating===(i===0)&&validNumbers(g,['required','capacity','people','leave'])
        &&unique(g.products,i===0?['SLOTS','TU+MT','RD','DEER']:['TU+MT'])
        &&g.products.every(r=>exact(r,['product','demand','days','avgTime'])&&validNumbers(r,['demand','days','avgTime'])));
  }
  async function request(path) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const res=await fetch(api+path,{headers:{apikey:key},signal:controller.signal,cache:'no-store'});
      const result=await res.json();
      if(!res.ok) {
        const raw=result.message||'';
        throw new Error(res.status===404?'分享服务尚未配置，请先执行 supabase-published.sql。':
          raw.includes('VERSION_CONFLICT')?'此月份已被其他页面发布，请重新检查后再发布。':
          raw.includes('RATE_LIMIT')?'发布间隔至少5秒，请稍后重试。':
          raw.includes('DAILY_PUBLISH_LIMIT')?'该分享版今天已达到100次发布限制。':
          raw.includes('PUBLISH_PAUSED')?'管理员已暂停发布。':
          raw.includes('INVALID_SHARE_PAYLOAD')?'分享数据格式不符合要求，未发布。':
          raw.includes('LIMIT')?'分享存储已达到限制，请联系项目管理员。':`分享请求失败（${res.status}）。`);
      }
      return result;
    } catch(e) {
      if(e.name==='AbortError') throw new Error('连接超时，尚未确认结果，请重试。');
      throw e;
    } finally {clearTimeout(timer);}
  }
  const storageKey=view=>'demand-published-local-v1:'+view;
  function validateRows(rows,view) {
    if(!Array.isArray(rows)||rows.length>120||rows.some(r=>r.view_id!==view||r.month!==r.payload?.month||!validate(r.payload,view)||!Number.isSafeInteger(r.revision)||r.revision<1||!text(r.updated_at)||isNaN(Date.parse(r.updated_at)))
      ||new Set(rows.map(r=>r.month)).size!==rows.length) throw new Error('已发布数据校验失败，保留当前显示。');
    return rows.sort((a,b)=>a.month.localeCompare(b.month));
  }
  async function read(view,local=false) {
    if(!['products','groups'].includes(view)) throw new Error('分享类型错误');
    const rows=local?JSON.parse(localStorage.getItem(storageKey(view))||'[]'):
      await request(`/demand_published_months?view_id=eq.${view}&month=gte.2026-11&select=view_id,month,payload,revision,updated_at&order=month.asc&limit=120`);
    return validateRows(rows,view);
  }
  window.DemandShare={roles,codes,validMonth,validate,validateRows,read,storageKey};
})();
