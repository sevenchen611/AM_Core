import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {calendarAdminKey} from '../core/leaf-calendar/index.js';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:'';};
const secret=process.env.LINE_CHANNEL_SECRET;
const serviceFile=value('--service-env'),tenantKey=value('--tenant'),platformBase=value('--platform-base');
if(!secret||!serviceFile||!tenantKey||!platformBase)throw new Error('Provide private shared service env, tenant and HTTPS platform origin.');
if(new URL(platformBase).protocol!=='https:')throw new Error('HTTPS required.');
const config=parseEnv(await readFile(serviceFile,'utf8'));
const r=await fetch(new URL('/portal/admin/leaf-calendar/service',platformBase),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+calendarAdminKey(secret)},
  body:JSON.stringify({tenantKey,baseUrl:config.DAILYLOG_BASE_URL,apiKey:config.DAILYLOG_CALENDAR_API_KEY}),signal:AbortSignal.timeout(30000)});
const result=await r.json().catch(()=>({}));
if(!r.ok||result.ok!==true){console.error(JSON.stringify({ok:false,status:r.status,error:result.error||'Calendar setup unavailable'}));process.exitCode=1;}
else console.log(JSON.stringify({ok:true,tenant:result.tenantKey,configured:result.configured}));
