import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { Connection, ConnectionManager, Model, Collection } = await import(process.env.BENCH_SOURCE + '/src/index.ts');
const connection = new Connection({ url: process.env.MYSQL_TEST_URL });
ConnectionManager.setDefault(connection);
class User extends Model { static casts = { active: 'boolean' }; }
const select = () => User.select('id','name','email','email_verified_at as emailVerifiedAt','active','created_at as createdAt','updated_at as updatedAt').orderBy('id');
const stages: Record<string,number[]> = { sqlAwait:[], hydration:[], modelToJSON:[], stringify:[], fullModelJson:[], fullRawJson:[] };
let checksum=''; let rawTypes: Record<string,string> = {};
try {
 for (let i=-20;i<101;i++) {
  const sql=select().toSql();
  let start=performance.now(); const rows=await connection.query(sql);const sqlAwait=performance.now()-start;
  start=performance.now();const models=new Collection(rows.map((row:any)=>(Model as any).hydrateOwnedRow.call(User,row,connection)));const hydration=performance.now()-start;
  start=performance.now();const objects=models.toJSON();const modelToJSON=performance.now()-start;
  start=performance.now();const text=JSON.stringify(objects);const stringify=performance.now()-start;
  start=performance.now();const full=await select().json();const fullModelJson=performance.now()-start;
  start=performance.now();const direct=await select().rawJson();const fullRawJson=performance.now()-start;
  rawTypes=Object.fromEntries(Object.entries(rows[0]).map(([key,value])=>[key,value instanceof Date?'Date':typeof value]));
  assert.equal(rows.length,500);assert.equal(JSON.stringify(full),text);assert.equal(JSON.stringify(direct),text);
  checksum=createHash('sha256').update(text).digest('hex');
  if(i>=0) for(const [key,value] of Object.entries({sqlAwait,hydration,modelToJSON,stringify,fullModelJson,fullRawJson})) stages[key].push(value);
 }
 console.log(JSON.stringify({rows:500,samples:101,warmups:20,responseSha256:checksum,rawTypes,stages}));
} finally { await connection.close(); }
