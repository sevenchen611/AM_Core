// Operator recovery for existing previews only. Default is a count-only dry run.
import {loadTenants} from '../core/tenants.js';
import {createOperationalMemory} from '../core/operational-memory.js';
import {createCalendarStore} from '../core/leaf-calendar/store.js';
const args=process.argv.slice(2),apply=args.includes('--apply');
const value=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
const expected=value('--expected-commit');
if(apply&&(!/^[a-f0-9]{40}$/u.test(expected)||expected!==process.env.RENDER_GIT_COMMIT)){
  console.error('Recovery requires the verified live commit via --expected-commit.');process.exit(1);
}
const logger={warn(){},log(){},info(){}};
const tenants=loadTenants(process.env,logger).filter(t=>t.runtimeEnabled!==false);
const target=value('--tenant');
if(target&&!tenants.some(t=>t.key===target)){console.error('Unknown target tenant.');process.exit(1);}
const memory=createOperationalMemory({env:process.env,logger});
const store=createCalendarStore({settingsForTenant:t=>memory.settingsForTenant(t)});
try{
  for(const tenant of tenants.filter(t=>!target||t.key===target)){
    if(!memory.settingsForTenant(tenant).configured)continue;
    try{
      if(!await store.ready(tenant)||!await store.service(tenant))continue;
      console.log(JSON.stringify({tenant:tenant.key,...await store.retryUnprompted(tenant,{apply})}));
    }catch{console.error(JSON.stringify({tenant:tenant.key,error:'preview_recovery_unavailable'}));process.exitCode=1;}
  }
}finally{await store.close();}
