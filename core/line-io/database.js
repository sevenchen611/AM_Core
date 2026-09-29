// Values are deployment-local. Aliases permit existing connection configuration
// without copying a database credential into source or another configuration.
export function lineIoDatabaseConfig(env) {
  const connectionString = env.AMCORE_LINE_IO_DATABASE_URL || env[env.AMCORE_LINE_IO_DATABASE_ENV];
  if (!connectionString) throw new Error('LINE I/O requires a deployment-local PostgreSQL URL');
  const mode = env.AMCORE_LINE_IO_DATABASE_SSL || env[env.AMCORE_LINE_IO_DATABASE_SSL_ENV] || '';
  if (!['', 'true', 'false', 'verify-full'].includes(mode)) throw new Error('Unsupported LINE I/O database SSL mode');
  return { connectionString, ...(mode === 'false' ? { ssl: false }
    : mode ? { ssl: { rejectUnauthorized: true } } : {}) };
}
