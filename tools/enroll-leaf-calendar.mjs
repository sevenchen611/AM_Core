import {readFile} from 'node:fs/promises';
import {calendarAdminKey} from '../core/leaf-calendar/index.js';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:'';};
const secret=process.env.LINE_CHANNEL_SECRET;
const keyFile=value('--key-file'),tenantKey=value('--tenant'),baseUrl=value('--dailylog-base'),platformBase=value('--platform-base');
if(!secret||!keyFile||!tenantKey||!baseUrl||!platformBase)throw new Error('Provide private key file, tenant and both HTTPS service origins.');
for(const origin of [baseUrl,platformBase])if(new URL(origin).protocol!=='https:')throw new Error('HTTPS required.');
const apiKey=(await readFile(keyFile,'utf8')).trim();
const r=await fetch(new URL('/portal/admin/leaf-calendar/pairings',platformBase),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+calendarAdminKey(secret)},
  body:JSON.stringify({tenantKey,baseUrl,apiKey}),signal:AbortSignal.timeout(30000)});
const result=await r.json().catch(()=>({}));
if(!r.ok||result.ok!==true){console.error(JSON.stringify({ok:false,status:r.status,error:result.error||'Calendar setup unavailable'}));process.exitCode=1;}
else console.log(JSON.stringify({ok:true,command:result.command,expiresInSeconds:result.expiresInSeconds}));
