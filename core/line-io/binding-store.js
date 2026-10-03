import { ioError } from './store.js';

export function createBindingStore(pool) {
  async function transaction(work) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK').catch(() => {}); if(error.code==='23505') throw ioError(409,'binding_conflict'); throw error; }
    finally { db.release(); }
  }
  const expire = () => pool.query("UPDATE line_bindings.bindings SET status='expired',code_hash=NULL WHERE status IN ('pending_line','pending_confirmation') AND expires_at<=now()");
  let lastPurge=0;
  const purge = async (force=false) => {
    if(!force && Date.now()-lastPurge<3600000) return;
    await transaction(async db=>{
      await db.query(`DELETE FROM line_io.line_io_events e USING line_bindings.bindings b
        WHERE e.tenant_key=b.tenant_key AND e.payload->>'bindingId'=b.id::text AND e.received_at<now()-interval '90 days'`);
      await db.query(`DELETE FROM line_io.line_io_sends s WHERE s.created_at<now()-interval '90 days'
        AND EXISTS(SELECT 1 FROM line_bindings.bindings b WHERE b.tenant_key=s.tenant_key AND b.client_id=s.client_id)`);
      await db.query(`DELETE FROM line_bindings.bindings WHERE status IN ('expired','revoked') AND COALESCE(revoked_at,expires_at)<now()-interval '90 days'`);
    });
    lastPurge=Date.now();
  };
  const all = async () => { await expire();await purge(); return (await pool.query('SELECT * FROM line_bindings.bindings WHERE group_id IS NOT NULL')).rows; };
  const get = async (id) => (await pool.query(`WITH expired AS (
    UPDATE line_bindings.bindings SET status='expired',code_hash=NULL
    WHERE status IN ('pending_line','pending_confirmation') AND expires_at<=now()
    RETURNING *
  )
  SELECT * FROM expired WHERE id=$1
  UNION ALL
  SELECT * FROM line_bindings.bindings b WHERE id=$1
    AND NOT EXISTS (SELECT 1 FROM expired e WHERE e.id=b.id)`,[id])).rows[0];
  const current = async (tenant, client, account) => {
    await expire();
    return (await pool.query("SELECT * FROM line_bindings.bindings WHERE tenant_key=$1 AND client_id=$2 AND external_user_id=$3 AND status IN ('bound','suspended')",[tenant,client,account])).rows[0];
  };
  async function start(value) {
    await expire();
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${value.tenantKey}/${value.clientId}/${value.account}`]);
      const count = await db.query("SELECT count(*)::int AS n FROM line_bindings.bindings WHERE tenant_key=$1 AND client_id=$2 AND external_user_id=$3 AND created_at>now()-interval '10 minutes'",[value.tenantKey,value.clientId,value.account]);
      if(count.rows[0].n>=5) throw ioError(429,'binding_rate_limited');
      await db.query("UPDATE line_bindings.bindings SET status='expired',code_hash=NULL WHERE tenant_key=$1 AND client_id=$2 AND external_user_id=$3 AND status IN ('pending_line','pending_confirmation')",[value.tenantKey,value.clientId,value.account]);
      return (await db.query(`INSERT INTO line_bindings.bindings(id,tenant_key,client_id,external_user_id,display_name,status,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,'pending_line',$6,$7) RETURNING *`,[value.id,value.tenantKey,value.clientId,value.account,value.displayName,value.hash,value.expiresAt])).rows[0];
    });
  }
  async function candidate(hash, event, proof) {
    return transaction(async db => {
      const replay = (await db.query('SELECT * FROM line_bindings.bindings WHERE event_id=$1',[event.webhookEventId])).rows[0];
      if(replay) return replay;
      const row = (await db.query("SELECT * FROM line_bindings.bindings WHERE code_hash=$1 AND status='pending_line' AND expires_at>now() FOR UPDATE",[hash])).rows[0];
      if(!row) throw ioError(400,'invalid_binding_code');
      return (await db.query(`UPDATE line_bindings.bindings SET status='pending_confirmation',code_hash=NULL,group_id=$2,user_id=$3,group_name=$4,user_name=$5,event_id=$6,checked_at=now()
        WHERE id=$1 RETURNING *`,[row.id,event.source.groupId,event.source.userId,proof.groupName,proof.userName,event.webhookEventId])).rows[0];
    });
  }
  async function confirm(id, tenant, client, account, proof, resume=false) {
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenant}/${client}/${account}`]);
      const row=(await db.query('SELECT * FROM line_bindings.bindings WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row || row.tenant_key!==tenant || row.client_id!==client || row.external_user_id!==account) throw ioError(404,'binding_not_found');
      if(row.status==='bound') return row;
      if(!(resume && row.status==='suspended') && (row.status!=='pending_confirmation' || new Date(row.expires_at)<=new Date())) throw ioError(409,'binding_not_confirmable');
      if(row.group_id!==proof.groupId || row.user_id!==proof.userId) throw ioError(409,'candidate_changed');
      await db.query("UPDATE line_bindings.bindings SET status='revoked',revoked_at=now() WHERE tenant_key=$1 AND client_id=$2 AND external_user_id=$3 AND status IN ('bound','suspended') AND id<>$4",[tenant,client,account,id]);
      return (await db.query("UPDATE line_bindings.bindings SET status='bound',confirmed_at=COALESCE(confirmed_at,now()),checked_at=now(),group_name=$2,user_name=$3 WHERE id=$1 RETURNING *",[id,proof.groupName,proof.userName])).rows[0];
    });
  }
  const suspend = async group => {
    await pool.query("UPDATE line_bindings.bindings SET status='suspended' WHERE group_id=$1 AND status='bound'",[group]);
    await pool.query("UPDATE line_bindings.bindings SET status='expired',code_hash=NULL WHERE group_id=$1 AND status='pending_confirmation'",[group]);
  };
  const findCode = async hash => (await pool.query("SELECT * FROM line_bindings.bindings WHERE code_hash=$1 AND status='pending_line' AND expires_at>now()",[hash])).rows[0];
  const checked = (id,proof) => pool.query('UPDATE line_bindings.bindings SET checked_at=now(),group_name=$2,user_name=$3 WHERE id=$1',[id,proof.groupName,proof.userName]);
  async function revoke(id,tenant,client,account) {
    const result=await pool.query("UPDATE line_bindings.bindings SET status='revoked',code_hash=NULL,revoked_at=now() WHERE id=$1 AND tenant_key=$2 AND client_id=$3 AND external_user_id=$4 RETURNING *",[id,tenant,client,account]);
    if(!result.rows.length) throw ioError(404,'binding_not_found');
    await pool.query("UPDATE line_bindings.bindings SET status='expired',code_hash=NULL WHERE tenant_key=$1 AND client_id=$2 AND external_user_id=$3 AND status IN ('pending_line','pending_confirmation')",[tenant,client,account]);
    return result.rows[0];
  }
  return {all,get,current,start,candidate,confirm,suspend,checked,revoke,findCode,purge};
}
