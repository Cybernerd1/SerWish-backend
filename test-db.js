const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres.ddpuslezetfrxilqwsex:Ayush275303@aws-1-ap-south-1.pooler.supabase.com:5432/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});

(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("✅ Connected:", res.rows);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();