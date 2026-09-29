// Deployment-owned OA routing metadata, separate from tenant message stores.
export function createDirectoryStore(pool) {
  async function transaction(work) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await work(db);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { db.release(); }
  }
  async function seed(groups) {
    await transaction(async (db) => {
      for (const group of groups) {
        await db.query(`INSERT INTO line_directory.groups (group_id, name) VALUES ($1,$2)
          ON CONFLICT (group_id) DO UPDATE SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE groups.name END`,
        [group.groupId, group.name || '']);
        for (const [userId, name] of Object.entries(group.members || {})) {
          await db.query(`INSERT INTO line_directory.members (group_id,user_id,display_name) VALUES ($1,$2,$3)
            ON CONFLICT (group_id,user_id) DO UPDATE SET display_name = CASE WHEN EXCLUDED.display_name <> ''
            THEN EXCLUDED.display_name ELSE members.display_name END`, [group.groupId,userId,name || '']);
        }
      }
    });
  }
  async function observe(records) {
    await transaction(async (db) => {
      for (const r of records) {
        await db.query(`INSERT INTO line_directory.groups (group_id,presence,state_at,last_seen_at)
          VALUES ($1,$2,$3,$3) ON CONFLICT (group_id) DO UPDATE SET
          last_seen_at = GREATEST(groups.last_seen_at,EXCLUDED.last_seen_at),
          presence = CASE WHEN EXCLUDED.state_at > groups.state_at OR
            (EXCLUDED.state_at = groups.state_at AND EXCLUDED.presence = 'left') THEN EXCLUDED.presence ELSE groups.presence END,
          state_at = GREATEST(groups.state_at,EXCLUDED.state_at)`, [r.groupId,r.presence,r.at]);
        for (const member of r.members) {
          await db.query(`INSERT INTO line_directory.members (group_id,user_id,membership,state_at,last_seen_at)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (group_id,user_id) DO UPDATE SET
            last_seen_at = GREATEST(members.last_seen_at,EXCLUDED.last_seen_at),
            membership = CASE WHEN EXCLUDED.state_at > members.state_at OR
              (EXCLUDED.state_at = members.state_at AND EXCLUDED.membership = 'left') THEN EXCLUDED.membership ELSE members.membership END,
            state_at = GREATEST(members.state_at,EXCLUDED.state_at)`,
          [r.groupId,member.userId,member.membership,r.at,member.interacted ? r.at : 0]);
        }
      }
    });
  }
  async function groups({ groupIds = null, after = '', limit }) {
    const { rows } = await pool.query(`SELECT group_id AS "groupId",name,presence,last_seen_at::text AS "lastSeenAt"
      FROM line_directory.groups WHERE ($1::text[] IS NULL OR group_id = ANY($1)) AND group_id > $2
      ORDER BY group_id LIMIT $3`, [groupIds,after,limit + 1]);
    return { rows: rows.slice(0,limit), hasMore: rows.length > limit };
  }
  async function group(groupId) {
    const { rows } = await pool.query('SELECT group_id FROM line_directory.groups WHERE group_id = $1',[groupId]);
    return Boolean(rows.length);
  }
  async function members({ groupId, after = '', limit }) {
    const { rows } = await pool.query(`SELECT user_id AS "userId",display_name AS "displayName",membership,
      last_seen_at::text AS "lastSeenAt" FROM line_directory.members WHERE group_id = $1 AND user_id > $2
      ORDER BY user_id LIMIT $3`, [groupId,after,limit + 1]);
    return { rows: rows.slice(0,limit),hasMore: rows.length > limit };
  }
  return { seed, observe, groups, group, members };
}
