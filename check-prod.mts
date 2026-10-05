import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const rows = await sql`select slug, status, source_tweet_id, created_at from claims where status = 'needs_info' order by created_at desc limit 4`;
console.log('needs_info:', JSON.stringify(rows));
const recent = await sql`select slug, status, source_tweet_id, created_at from claims order by created_at desc limit 2`;
console.log('newest:', JSON.stringify(recent));
await sql.end();
