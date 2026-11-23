const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const runtime=path.resolve(__dirname,'../.local-backups/codex-bridge');
fs.mkdirSync(runtime,{recursive:true});
const file=path.join(runtime,'queue-config.json');
if(!fs.existsSync(file)){
  const source=fs.readFileSync(path.resolve(__dirname,'../docs/shared-cloud.js'),'utf8');
  fs.writeFileSync(file,JSON.stringify({
    id:crypto.randomUUID(),url:source.match(/url:'([^']+)'/)[1],key:source.match(/key:'([^']+)'/)[1],
    submitToken:crypto.randomBytes(32).toString('hex'),workerToken:crypto.randomBytes(32).toString('hex')
  }),{flag:'wx',mode:0o600});
}
const config=JSON.parse(fs.readFileSync(file,'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const provision=`insert into public.demand_ai_workers(id,submit_hash,worker_hash) values ('${config.id}','${hash(config.submitToken)}','${hash(config.workerToken)}') on conflict(id) do nothing;`;
fs.writeFileSync(path.join(runtime,'queue-install.sql'),fs.readFileSync(path.resolve(__dirname,'../supabase-ai-queue.sql'),'utf8')+'\n'+provision);
fs.writeFileSync(path.join(runtime,'云端AI配对码.txt'),config.submitToken);
console.log(provision);
console.log('Cloud pairing code saved locally; never add .local-backups to Git.');
