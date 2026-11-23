// Local pilot only. No Supabase write access and no model credentials in the browser.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),crypto=require('node:crypto'),os=require('node:os');
const {validateRequest,validateResult,balanceLimits}=require('./contract.cjs');
const runtime=path.resolve(__dirname,'../.local-backups/codex-bridge');
fs.mkdirSync(runtime,{recursive:true});
const tokenPath=path.join(runtime,'pairing-token');
if(!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
const token=fs.readFileSync(tokenPath,'utf8').trim();
const origins=new Set(['null','https://yanglu970608-bit.github.io','http://127.0.0.1:4318']);
let busy=false,lastStarted=0,queuePolling=false;
function overrides() {
  // Keep the installed model provider/auth, but disable configured connectors/plugins.
  const configPath=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml');
  const config=fs.existsSync(configPath)?fs.readFileSync(configPath,'utf8'):'';
  const out=['-c','approval_policy="never"','-c','features.shell_tool=false','-c','web_search="disabled"'];
  for(const match of config.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gm)) out.push('-c',`mcp_servers.${match[1]}.enabled=false`);
  for(const match of config.matchAll(/^\[plugins\."([^"]+)"\]\s*$/gm)) out.push('-c',`plugins."${match[1]}".enabled=false`);
  return out;
}
const policy=`你是需求量分配顾问。只依据提供的JSON数字分析，输出符合schema的JSON。禁止调用工具、读取文件或联网；不要修改任何数据。
targets是相对于计划起点base的最终增减总数，不能在已调整量上重复累加。必须严格满足策跨planCross和编导KOL directorKol各自的目标总和。
先根据综合产出回报比roi决定产品整体增减规模，再用planCrossRoi和directorRoi决定岗位组倾斜。指标1代表100%，不是利润率。null是未填写，不等于0。
日花占比spendShare和需求占比demandShare是辅助，但有实际影响：日花高、需求占比低可以适当多加；综合效率低限制整体增量，不能只因单岗位优秀而大幅增加整个产品。
均衡分布是必须认真落实的分配目标，而非最后随口参考：先按产品数量计算平均调整量，以此形成较均衡的基础分配，再按综合表现温和加减；不要直接按效率比例把增量集中到少数产品。通常优先在平均调整量上下约35%的附近分配，差5条仅为参考，不是固定差距或必须用满的范围。
必须区分产品总调整量与岗位调整量：总调整量足够覆盖产品且两个岗位组同向时，各产品应有适度同向调整。增量时弱产品少增而不是不给，但弱岗位可以0增量或减量，把该产品的增量分给相对较好的岗位；减量时优质产品少减、低效产品适度多减，优先从低效岗位减，受已有数量限制。不为覆盖所有岗位而给低效岗位硬加数量。
产品的综合表现决定总量的适度差别；岗位回报比只决定内部倾斜，不应反过来让弱产品获得最高总增量。高综合效率但日花体量小的产品适当多增，不应过度放大。完全依据本次数据判断，不固定任何产品的优劣标签。
若两个岗位目标相反、总净量小于产品数或减量受已有数量限制，则优先满足可行性和准确总量，仍应尽量分散。输入附带balanceLimits时，它是随本次平均量变化的宽松防偏斜范围，不代表应把两端差距用满，更不要求岗位均分。
只有所选月份为1/4/7/10月时考虑trend；其他月份忽略trend，说明也不得提日花变化。不要写虚构的模型最优结论或预期收益。
返回每个产品的planCross、directorKol整数增减。不得把任一岗位组减为负数量。图片不变。不要拆分组内岗位，程序按基期数量比例拆分，主要增量自然落在编导和策划。
reason简述实际分配依据，不写“综合建议X条”，需求占比与日花占比比较无需附具体占比数字。请在输出前检查两组求和。`;
function generate(input,feedback='',deadline=Date.now()+180000) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),dir=path.join(runtime,id);
    fs.mkdirSync(dir);
    const output=path.join(dir,'answer.json');
    const args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only',...overrides(),
      '-C',dir,'--output-schema',path.join(__dirname,'result.schema.json'),'--output-last-message',output,'-'];
    const child=spawn(process.env.DEMAND_CODEX_BIN||'codex',args,{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let diagnostic='',expired=false;
    child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-2000);});
    const timer=setTimeout(()=>{expired=true;child.kill();},Math.max(1,deadline-Date.now()));
    child.stdin.on('error',()=>{});
    child.once('error',e=>{clearTimeout(timer);reject(Error('无法启动Codex，请检查安装和登录状态。'));});
    child.once('exit',code=>{
      clearTimeout(timer);
      if(expired) return reject(Error('Codex计算超过3分钟，请稍后重试。'));
      if(code!==0 || !fs.existsSync(output)) return reject(Error('Codex未成功返回，请检查本机登录、额度和网络。'));
      try {
        const result=validateResult(input,JSON.parse(fs.readFileSync(output,'utf8')));
        resolve(result);
      } catch(error){
        if(!feedback&&deadline-Date.now()>15000){
          resolve(generate(input,'上次结果未通过校验：'+error.message+' 请重新生成完整分配，准确满足两个岗位总量与产品均衡要求。',deadline));
        }else reject(Error('模型结果未通过数量或均衡校验，未修改任何数据。请重新生成。'));
      }
    });
    child.stdin.end(policy+'\n'+feedback+'\n输入数据：\n'+JSON.stringify({...input,balanceLimits:balanceLimits(input)}));
  });
}
function reply(res,status,obj) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin && !origins.has(origin)) return reply(res,403,{error:'不允许的页面来源'});
  if(origin) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network','true');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  if(supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected)) return reply(res,401,{error:'请先连接本机Codex，配对码不正确'});
  if(req.method==='GET' && req.url==='/health') return reply(res,200,{ok:true,busy,mode:'local-pilot'});
  if(req.method!=='POST' || req.url!=='/suggest') return reply(res,404,{error:'不存在的操作'});
  if(busy||queuePolling) return reply(res,409,{error:'Codex正在处理一条建议，请稍后再试'});
  if(Date.now()-lastStarted<10000) return reply(res,429,{error:'请求过于频繁，请稍后重试'});
  let raw='',input;
  try {
    for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>100000) throw Error('too large');}
    input=validateRequest(JSON.parse(raw));
  } catch {return reply(res,400,{error:'输入数据不完整或不合法'});}
  busy=true;lastStarted=Date.now();
  try {reply(res,200,{result:await generate(input)});}
  catch(e){reply(res,502,{error:e.message});}
  finally {busy=false;}
});
server.listen(4318,'127.0.0.1',()=>{
  console.log('Codex本地助手已启动，只接受本机连接。关闭此进程即停止。');
  console.log('配对码保存在：'+tokenPath);
});
// Cloud transport: the worker capability can claim/finish jobs, not edit demand data.
const queueFile=path.join(runtime,'queue-config.json');
if(fs.existsSync(queueFile)){
  const queue=JSON.parse(fs.readFileSync(queueFile,'utf8'));
  let reported=false;
  async function rpc(name,body){
    const response=await fetch(queue.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:queue.key,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:queue.workerToken,...body}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok)throw Error('queue unavailable');
    return result;
  }
  async function tick(){
    if(queuePolling||busy)return;
    queuePolling=true;
    try{
      const job=await rpc('demand_ai_claim',{});
      if(reported){console.log('云端任务队列已恢复');reported=false;}
      if(job){
        busy=true;
        let result=null,error=null;
        try{result=await generate(validateRequest(job.input));}
        catch(e){error='建议生成失败或未通过校验，请检查助手状态后重试。';}
        // Retry completion using the same job identity; never regenerate on a network retry.
        for(let attempt=0;attempt<3;attempt++){
          try{await rpc('demand_ai_finish',{p_id:job.id,p_result:result,p_error:error});break;}
          catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000));}
        }
        console.log(error?'云端建议未通过校验，未修改业务数据':'云端建议已返回，等待用户确认应用');
      }
    }catch(e){if(!reported){console.log('暂时无法连接云端任务队列，将自动重试');reported=true;}}
    finally{busy=false;queuePolling=false;}
  }
  setInterval(tick,3000);tick();
}
