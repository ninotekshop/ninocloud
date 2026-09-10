const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function run() {
  const hash = await bcrypt.hash('ninotek@123', 10);
  console.log('Generated hash:', hash);

  const client = new Client({
    connectionString: 'postgresql://postgres.qiagwtpazotvmkqlvkyi:1xipVh2lqoLuYMxK@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?options=-c%20search_path%3Dnino,public',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query('UPDATE nino.users SET password_hash = $1 WHERE username = $2', [hash, 'owner']);
  console.log('Rows updated for owner:', res.rowCount);
  await client.query('UPDATE nino.users SET password_hash = $1 WHERE username = $2', [hash, 'cashier']);
  await client.end();
  console.log('Successfully updated Supabase user passwords!');
}

run().catch(console.error);
