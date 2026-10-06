import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';

export function createCalendarStore({ settingsForTenant, poolFactory, env=process.env }) {
  const pools = new Map();
  async function poolFor(tenant) {
    const cfg = settingsForTenant(tenant);
    if (!cfg?.configured) throw new Error('calendar_database_unavailable');
    if (!pools.has(cfg.databaseUrl)) pools.set(cfg.databaseUrl, (async () => {
      const factory = poolFactory || (async options => { const { Pool } = await import('pg'); return new Pool(options); });
      const pool=await factory({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000, application_name: 'am-leaf-calendar' });
      pool.on?.('error',()=>{});
      return pool;
    })());
    return pools.get(cfg.databaseUrl);
  }
  async function tx(tenant, work) {
    const client = await (await poolFor(tenant)).connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.tenantId]);
      const value = await work(client, tenant.tenantId);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  const json = value => JSON.stringify(value);
  async function ready(tenant) { return tx(tenant, async c => { await c.query('SELECT request_id FROM leaf_calendar.requests LIMIT 0'); return true; }); }
  // Explicit operator setup only: reviewed additive schema, no automatic boot migration.
  async function provision(tenant) {
    const prefix=tenant.envPrefix,connectionPrefix=tenant.operationalMemory?.connectionEnvPrefix||prefix;
    const value=name=>env[prefix+'_'+name]||env[connectionPrefix+'_'+name]||env[name];
    const url=value('AM_MEMORY_MIGRATION_DATABASE_URL');if(!url)throw Object.assign(new Error('migration_unavailable'),{code:'MIGRATION_NOT_CONFIGURED'});
    const runtime=await (await poolFor(tenant)).connect();
    let role;
    try {const identity=(await runtime.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if(identity.rolsuper||identity.rolbypassrls)throw new Error('runtime_role_must_enforce_rls');role='"'+identity.name.replaceAll('"','""')+'"';}
    finally {runtime.release();}
    const {Client}=await import('pg');const cfg=settingsForTenant(tenant);
    const db=new Client({connectionString:url,ssl:cfg.databaseSsl?{rejectUnauthorized:false}:undefined,connectionTimeoutMillis:8000});
    try {await db.connect();await db.query('BEGIN');
      await db.query(await readFile(new URL('../../versions/AM-IMP-2026.1006.07/schemas/leaf-calendar.sql',import.meta.url),'utf8'));
      await db.query('GRANT USAGE ON SCHEMA leaf_calendar TO '+role);
      await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA leaf_calendar TO '+role);
      await db.query('COMMIT');}
    catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
    finally{await db.end().catch(()=>{});}
    return ready(tenant);
  }
  async function service(tenant) {
    return tx(tenant,async(c,t)=>(await c.query('SELECT * FROM leaf_calendar.service_config WHERE tenant_id=$1',[t])).rows[0]||null);
  }
  async function configure(tenant,data) {
    return tx(tenant,async(c,t)=>c.query(`INSERT INTO leaf_calendar.service_config(tenant_id,base_url,encrypted_key)
      VALUES($1,$2,$3::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET base_url=EXCLUDED.base_url,encrypted_key=EXCLUDED.encrypted_key,updated_at=now()`,[t,data.baseUrl,json(data.encryptedKey)]));
  }
  async function syncActor(tenant,userId,identity) {
    return tx(tenant,async(c,t)=>(await c.query(`INSERT INTO leaf_calendar.actors(tenant_id,line_user_id,account,fingerprint)
      VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,line_user_id) DO UPDATE SET
      account=EXCLUDED.account,fingerprint=EXCLUDED.fingerprint,
      editing_id=CASE WHEN actors.fingerprint=EXCLUDED.fingerprint THEN actors.editing_id ELSE NULL END,
      editing_revision=CASE WHEN actors.fingerprint=EXCLUDED.fingerprint THEN actors.editing_revision ELSE NULL END,
      updated_at=now() RETURNING *`,[t,userId,identity.account,identity.fingerprint])).rows[0]);
  }
  async function insert(tenant, input) {
    return tx(tenant, async (c,t) => (await c.query(`INSERT INTO leaf_calendar.requests(tenant_id,request_id,line_user_id,kind,status,payload,source_evidence,fingerprint)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT DO NOTHING RETURNING request_id`,
    [t,input.id,input.userId,input.kind,input.status || 'queued',json(input.payload || {}),json(input.source),input.fingerprint])).rows.length > 0);
  }
  async function owned(tenant, userId, id) {
    return tx(tenant, async (c,t) => (await c.query('SELECT * FROM leaf_calendar.requests WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3',[t,userId,id])).rows[0] || null);
  }
  async function pending(tenant, userId) {
    return tx(tenant, async (c,t) => (await c.query(`SELECT * FROM leaf_calendar.requests WHERE tenant_id=$1 AND line_user_id=$2 AND kind='draft'
      AND status IN ('pending','needs_details') AND expires_at>now() ORDER BY created_at DESC LIMIT 6`,[t,userId])).rows);
  }
  async function lease(tenant) {
    const token = crypto.randomUUID();
    return tx(tenant, async (c,t) => {
      await c.query("UPDATE leaf_calendar.requests SET status='expired',notified=false WHERE tenant_id=$1 AND status IN ('queued','pending','needs_details') AND expires_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now())",[t]);
      return (await c.query(`WITH next AS (SELECT request_id FROM leaf_calendar.requests
      WHERE tenant_id=$1 AND available_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now()) AND
      (status IN ('queued','confirmed','saving','notice') OR (status IN ('pending','needs_details') AND prompted_revision<revision)
       OR (status IN ('saved','failed','cancelled','expired') AND notified=false)) ORDER BY created_at,request_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE leaf_calendar.requests r SET lease_token=$2,lease_expires_at=now()+interval '120 seconds',attempt_count=attempt_count+1,
      status=CASE WHEN r.status='confirmed' THEN 'saving' ELSE r.status END
      FROM next WHERE r.tenant_id=$1 AND r.request_id=next.request_id RETURNING r.*`,[t,token])).rows[0] || null;
    });
  }
  async function settle(tenant, row, changes) {
    return tx(tenant, async (c,t) => (await c.query(`UPDATE leaf_calendar.requests SET status=COALESCE($4,status),result=COALESCE($5::jsonb,result),
      error_code=$6,prompted_revision=CASE WHEN $7 THEN revision ELSE prompted_revision END,notified=CASE WHEN $8 THEN true ELSE notified END,
      lease_token=NULL,lease_expires_at=NULL,available_at=now()+($9::text||' seconds')::interval,updated_at=now()
      WHERE tenant_id=$1 AND request_id=$2 AND lease_token=$3 RETURNING request_id`,
    [t,row.request_id,row.lease_token,changes.status || null,changes.result ? json(changes.result) : null,changes.errorCode || null,
      changes.prompted===true,changes.notified===true,changes.delay || 0])).rows.length > 0);
  }
  async function storeDrafts(tenant, intake, drafts) {
    return tx(tenant, async (c,t) => {
      const held = await c.query('SELECT request_id FROM leaf_calendar.requests WHERE tenant_id=$1 AND request_id=$2 AND lease_token=$3 FOR UPDATE',[t,intake.request_id,intake.lease_token]);
      if (!held.rows.length) return false;
      if (intake.payload.editId) {
        if (drafts.length !== 1) throw new Error('edit_requires_single_event');
        const draft = drafts[0];
        const updated = await c.query(`UPDATE leaf_calendar.requests SET payload=$5::jsonb,status=$6,revision=revision+1,prompted_revision=0,
          source_evidence=jsonb_set(source_evidence,'{updates}',COALESCE(source_evidence->'updates','[]'::jsonb)||jsonb_build_array($7::jsonb),true),updated_at=now()
          WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3 AND revision=$4 AND status IN ('pending','needs_details')
          AND expires_at>now() AND lease_token IS NULL RETURNING request_id`,
        [t,intake.line_user_id,intake.payload.editId,intake.payload.editRevision,json(draft.payload),draft.status,json(intake.source_evidence)]);
        if (!updated.rows.length) throw new Error('draft_changed');
        await c.query('UPDATE leaf_calendar.actors SET editing_id=NULL,editing_revision=NULL WHERE tenant_id=$1 AND line_user_id=$2',[t,intake.line_user_id]);
      } else {
        for (const draft of drafts) await c.query(`INSERT INTO leaf_calendar.requests(tenant_id,request_id,line_user_id,kind,status,payload,source_evidence,fingerprint)
          VALUES($1,$2,$3,'draft',$4,$5::jsonb,$6::jsonb,$7) ON CONFLICT DO NOTHING`,
        [t,draft.id,intake.line_user_id,draft.status,json(draft.payload),json(intake.source_evidence),intake.fingerprint]);
      }
      await c.query("UPDATE leaf_calendar.requests SET status='done',lease_token=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND request_id=$2 AND lease_token=$3",[t,intake.request_id,intake.lease_token]);
      return true;
    });
  }
  async function control(tenant, userId, { action, id, revision, evidence }) {
    return tx(tenant, async (c,t) => {
      const row = (await c.query('SELECT * FROM leaf_calendar.requests WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3 AND kind=\'draft\' FOR UPDATE',[t,userId,id])).rows[0];
      if (!row) return { code:'missing' };
      if (row.revision !== revision) return { code:'changed' };
      if(action==='retry' && row.status==='failed' && row.confirmed_at && ['GOOGLE_UNAVAILABLE','NETWORK_UNCERTAIN','GOOGLE_NOT_CONNECTED','INTERNAL_ERROR'].includes(row.error_code)) {
        await c.query("UPDATE leaf_calendar.requests SET status='confirmed',attempt_count=0,error_code=NULL,notified=false,available_at=now() WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3",[t,userId,id]);
        return {code:'confirmed_now',row};
      }
      if (['saved','saving','confirmed'].includes(row.status)) return { code:row.status,row };
      if (!['pending','needs_details'].includes(row.status) || new Date(row.expires_at).getTime()<=Date.now()) return {code:'expired'};
      if (action==='edit') {
        await c.query(`UPDATE leaf_calendar.requests SET status='needs_details',revision=revision+1,prompted_revision=0,
          payload=jsonb_set(payload,'{missing}',COALESCE(payload->'missing','[]'::jsonb)||'"請補充要修改的內容"'::jsonb),
          source_evidence=jsonb_set(source_evidence,'{updates}',COALESCE(source_evidence->'updates','[]'::jsonb)||jsonb_build_array($4::jsonb),true),
          lease_token=NULL,lease_expires_at=NULL,expires_at=now()+interval '24 hours'
          WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3`,[t,userId,id,json(evidence||{action})]);
        await c.query('UPDATE leaf_calendar.actors SET editing_id=$3,editing_revision=$4 WHERE tenant_id=$1 AND line_user_id=$2',[t,userId,id,revision+1]);
        return {code:'editing',row};
      }
      if (action==='confirm' && row.status!=='pending') return {code:'needs_details',row};
      if (action==='confirm' && row.prompted_revision!==row.revision) return {code:'changed',row};
      if (!['confirm','cancel'].includes(action)) return {code:'missing'};
      await c.query(`UPDATE leaf_calendar.requests SET status=$4,confirmed_at=CASE WHEN $4='confirmed' THEN now() ELSE confirmed_at END,
        source_evidence=source_evidence||jsonb_build_object('confirmation',$5::jsonb),
        notified=false,attempt_count=0,lease_token=NULL,lease_expires_at=NULL,available_at=now(),updated_at=now()
        WHERE tenant_id=$1 AND line_user_id=$2 AND request_id=$3`,[t,userId,id,action==='confirm'?'confirmed':'cancelled',json(evidence||{action})]);
      return {code:action==='confirm'?'confirmed_now':'cancelled_now',row};
    });
  }
  return {ready,provision,service,configure,syncActor,insert,owned,pending,lease,settle,storeDrafts,control,
    close:async()=>{for(const readyPool of pools.values()) await (await readyPool).end?.();}};
}
