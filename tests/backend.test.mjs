import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let db;
const id = () => randomUUID();
const orgA = id(), orgB = id(), adminA = id(), staffA = id(), adminB = id();
const deviceUser = id(), foreignDeviceUser = id(), unpairedUser = id();
const patientA = id(), patientB = id(), patientA2 = id();
let deviceA, deviceB;

async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec(`begin; set local role ${role};`);
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)`, [user ?? '', role]);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (e) { await db.exec('rollback'); throw e; }
}
async function event(type = 'MEDICINE', payload = {}, patient = patientA, org = orgA, creator = adminA, options = {}) {
  const eventId = id();
  const time = new Date(Date.now() - (options.hoursAgo ?? 0) * 3600000 - 60000).toISOString();
  await db.query(`insert into public.care_events(id,organization_id,patient_id,event_type,title,scheduled_date,scheduled_time,timezone,payload,created_by,created_at)
    values($1,$2,$3,$4,'Test activity',$5::timestamptz::date,$5::timestamptz::time,'UTC',$6,$7,now()-interval '3 days')`,
    [eventId,org,patient,type,time,JSON.stringify(payload),creator]);
  return eventId;
}
const responseSql = `select public.submit_response($1,$2,$3,$4,$5::jsonb,$6::timestamptz) as id`;
const respond = (e, answer, data = {}, requestId = id(), time = new Date().toISOString(), user = deviceUser, patient = patientA) =>
  as(user,responseSql,[requestId,patient,e,answer,JSON.stringify(data),time]);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth, public to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  for (const filename of ['202609230001_schema.sql','202609230002_workflows.sql','202609230003_scheduling.sql','202609230004_realtime.sql','202609230006_null_assignment_guard.sql','202609240001_numeric_pairing_codes.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  }
  for (const user of [adminA,staffA,adminB,deviceUser,foreignDeviceUser,unpairedUser]) await db.query('insert into auth.users values ($1)',[user]);
  await db.query(`insert into public.organizations(id,name,timezone) values ($1,'Test A','UTC'),($2,'Test B','UTC')`,[orgA,orgB]);
  await db.query(`insert into public.profiles(id,organization_id,full_name,role) values ($1,$2,'Admin A','admin'),($3,$2,'Staff A','caretaker'),($4,$5,'Admin B','admin')`,[adminA,orgA,staffA,adminB,orgB]);
  await db.query(`insert into public.patients(id,organization_id,name,other_notes) values ($1,$2,'Synthetic A','PRIVATE_NOTE_SENTINEL'),($3,$4,'Synthetic B','PRIVATE_B'),($5,$2,'Synthetic A2','PRIVATE_A2')`,[patientA,orgA,patientB,orgB,patientA2]);
  for (const [admin, user, patient] of [[adminA,deviceUser,patientA],[adminB,foreignDeviceUser,patientB]]) {
    const [{code}] = await as(admin,`select public.create_pairing_code()->>'code' as code`);
    const [{device}] = await as(user,`select public.pair_device($1,'Test Pi') as device`,[code]);
    await as(admin,`update public.devices set assigned_patient_id=$1 where id=$2`,[patient,device]);
    if (admin === adminA) deviceA = device; else deviceB = device;
  }
});
after(async () => { if (db) await db.close(); });

test('every application table has RLS and signed-out users have no table access', async () => {
  const tables = await db.query(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'`);
  assert.equal(tables.rows.length,14);
  for (const table of tables.rows) {
    assert.equal(table.relrowsecurity,true,table.relname);
    await assert.rejects(as(null,`select * from public.${table.relname}`,[],'anon'),/permission denied/);
  }
});
test('caregivers see only their organization and cannot create cross-tenant relationships', async () => {
  assert.equal((await as(staffA,'select * from public.patients')).length,2);
  assert.equal((await as(adminB,'select * from public.patients')).length,1);
  await assert.rejects(as(staffA,`insert into public.patients(organization_id,name) values($1,'Forbidden')`,[orgB]),/row-level security/);
  await assert.rejects(as(adminA,`update public.patients set assigned_caretaker_id=$1 where id=$2`,[adminB,patientA]),/foreign key/);
  await assert.rejects(as(adminA,`insert into public.care_events(organization_id,patient_id,event_type,title,scheduled_date,scheduled_time,created_by)
    values($1,$2,'MEDICINE','Invalid',current_date,current_time,$3)`,[orgA,patientB,adminA]),/foreign key/);
});
test('device context has no notes and direct patient/profile access returns no rows', async () => {
  assert.equal((await as(deviceUser,'select * from public.patients')).length,0);
  assert.equal((await as(deviceUser,'select * from public.profiles')).length,0);
  const [{context}] = await as(deviceUser,'select public.device_context() as context');
  assert.deepEqual(Object.keys(context).sort(),['device_id','patient_id','patient_name','timezone']);
  assert.equal(context.patient_id,patientA);
  assert.ok(!JSON.stringify(context).includes('PRIVATE'));
});
test('unprofiled accounts gain no data or administrative powers', async () => {
  assert.equal((await as(unpairedUser,'select * from public.patients')).length,0);
  await assert.rejects(as(unpairedUser,'select public.create_pairing_code()'),/Administrator/);
  await assert.rejects(as(staffA,'select public.create_pairing_code()'),/Administrator/);
  await assert.rejects(as(unpairedUser,'select public.provision_caregiver($1,$2,$3,$4)',[unpairedUser,orgA,'Intruder','admin']),/Administrator/);
  await assert.rejects(as(deviceUser,`select public.run_maintenance()`),/permission denied/);
});
test('pairing is single-use, expires, and cannot attach a caregiver account', async () => {
  const [{code}] = await as(adminA,`select public.create_pairing_code()->>'code' as code`);
  assert.match(code, /^\d{6}$/);
  await assert.rejects(as(staffA,`select public.pair_device($1,'Bad')`,[code]),/dedicated/);
  const [{d}] = await as(unpairedUser,`select public.pair_device($1,'Spare') as d`,[code.slice(0,3)+' '+code.slice(3)]);
  assert.ok(d, 'spaced code accepted');
  const another = id(); await db.query('insert into auth.users values($1)',[another]);
  assert.equal((await as(another,`select public.pair_device($1,'Replay') as d`,[code]))[0].d, null);
  const [{code:expired}] = await as(adminA,`select public.create_pairing_code()->>'code' as code`);
  await db.exec(`update public.pairing_codes set expires_at=now()-interval '1 minute' where not used`);
  assert.equal((await as(another,`select public.pair_device($1,'Expired') as d`,[expired]))[0].d, null);
});
test('a new pairing code cancels the previous one; only admins can read codes', async () => {
  const [{code:first}] = await as(adminA,`select public.create_pairing_code()->>'code' as code`);
  await as(adminA,`select public.create_pairing_code()`);
  const u = id(); await db.query('insert into auth.users values($1)',[u]);
  assert.equal((await as(u,`select public.pair_device($1,'Old') as d`,[first]))[0].d, null);
  assert.equal((await as(staffA,'select * from public.pairing_codes')).length, 0);
  assert.ok((await as(adminA,'select * from public.pairing_codes')).length > 0);
});
test('wrong pairing codes are rate limited per account and globally', async () => {
  await db.exec('delete from private.pairing_attempts');
  const [{code}] = await as(adminA,`select public.create_pairing_code()->>'code' as code`);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6,'0');
  const u = id(); await db.query('insert into auth.users values($1)',[u]);
  for (let i = 0; i < 5; i++) assert.equal((await as(u,`select public.pair_device($1,'Guess') as d`,[wrong]))[0].d, null);
  await assert.rejects(as(u,`select public.pair_device($1,'Guess')`,[code]),/Too many wrong codes/);
  for (let n = 0; n < 5; n++) {
    const v = id(); await db.query('insert into auth.users values($1)',[v]);
    for (let i = 0; i < 5; i++) await as(v,`select public.pair_device($1,'Guess')`,[wrong]);
  }
  const w = id(); await db.query('insert into auth.users values($1)',[w]);
  await assert.rejects(as(w,`select public.pair_device($1,'Right')`,[code]),/temporarily paused/);
  await db.exec('delete from private.pairing_attempts');
  assert.ok((await as(w,`select public.pair_device($1,'Right') as d`,[code]))[0].d, 'pairs once the window clears');
});
test('device sees only its assigned events, cannot directly mutate them, and cannot submit to another patient', async () => {
  const a = await event(); const b = await event('MEDICINE',{},patientB,orgB,adminB);
  const visible = await as(deviceUser,'select id from public.care_events');
  assert.ok(visible.some(x=>x.id===a)); assert.ok(!visible.some(x=>x.id===b));
  assert.equal((await as(deviceUser,`update public.care_events set status='COMPLETED' where id=$1 returning id`,[a])).length,0);
  await assert.rejects(respond(b,'YES',{},id(),new Date().toISOString(),deviceUser,patientB),/assignment/);
});
test('medicine NO atomically creates response, alert, history and status; retry is idempotent', async () => {
  const e = await event(); const submission = id(), time = new Date().toISOString();
  await respond(e,'NO',{},submission,time); await respond(e,'NO',{},submission,time);
  const result = await as(staffA,`select status,(select count(*)::int from public.patient_responses where event_id=$1) as responses,
    (select count(*)::int from public.alerts where event_id=$1) as alerts from public.care_events where id=$1`,[e]);
  assert.deepEqual(result[0],{status:'ALERT',responses:1,alerts:1});
  await assert.rejects(respond(e,'YES',{},submission,time),/Idempotency/);
  await assert.rejects(respond(e,'NO'),/already closed/);
});
test('meal YES completes without an alert; NO creates a meal alert', async () => {
  const yes = await event('MEAL'); await respond(yes,'YES');
  assert.equal((await as(staffA,'select * from public.alerts where event_id=$1',[yes])).length,0);
  const no = await event('MEAL'); await respond(no,'NO');
  assert.equal((await as(staffA,'select alert_type from public.alerts where event_id=$1',[no]))[0].alert_type,'MEAL_NOT_COMPLETED');
});
test('check-in validates choices and generates configured alerts', async () => {
  const e = await event('DAILY_CHECK_IN',{answers:['Fine','Unwell'],concerning_answers:['Unwell']});
  await assert.rejects(respond(e,'Invented'),/configured choices/);
  await respond(e,'Unwell');
  assert.equal((await as(staffA,'select alert_type from public.alerts where event_id=$1',[e]))[0].alert_type,'CONCERNING_CHECK_IN');
});
test('tasks complete from a display receipt without asking the patient', async () => {
  const e = await event('TASK'); await respond(e,'DISPLAYED');
  assert.deepEqual((await as(staffA,'select status,response_required from public.care_events where id=$1',[e]))[0],{status:'COMPLETED',response_required:false});
});
test('patient help and not-right requests are urgent; hungry remains a message; retries do not duplicate', async () => {
  for (const code of ['HELP','NOT_RIGHT','HUNGRY']) {
    const submission = id();
    await as(deviceUser,'select public.send_patient_request($1,$2,$3)',[submission,patientA,code]);
    await as(deviceUser,'select public.send_patient_request($1,$2,$3)',[submission,patientA,code]);
    const alerts = await as(staffA,`select priority from public.alerts where dedupe_key=$1`,['request:'+submission]);
    assert.equal(alerts.length,code==='HUNGRY'?0:1);
    if (alerts.length) assert.equal(alerts[0].priority,'HIGH');
  }
});
test('caregiver messages are delivered and acknowledged once and are private to the patient', async () => {
  const message = id();
  await as(staffA,'select public.send_caregiver_message($1,$2,$3)',[message,patientA,'Hello']);
  await assert.rejects(as(adminB,'select public.send_caregiver_message($1,$2,$3)',[id(),patientA,'Forbidden']),/Caregiver/);
  assert.equal((await as(foreignDeviceUser,'select * from public.messages where id=$1',[message])).length,0);
  await assert.rejects(as(foreignDeviceUser,'select public.acknowledge_message($1,null)',[message]),/Message not available/);
  await as(deviceUser,'select public.acknowledge_message($1,$2)',[message,patientA]);
  await as(deviceUser,'select public.acknowledge_message($1,$2)',[message,patientA]);
  const [m] = await as(staffA,'select delivered_at,acknowledged_at from public.messages where id=$1',[message]);
  assert.ok(m.delivered_at); assert.ok(m.acknowledged_at);
  assert.equal((await as(staffA,`select * from public.interaction_logs where action='MESSAGE_ACKNOWLEDGED' and data->>'message_id'=$1`,[message])).length,1);
});
test('only same-organization staff can review alerts and review identity is recorded', async () => {
  const e=await event(); await respond(e,'NO');
  const [{id:alert}] = await as(staffA,'select id from public.alerts where event_id=$1',[e]);
  await assert.rejects(as(adminB,'select public.review_alert($1)',[alert]),/Caregiver/);
  await assert.rejects(as(deviceUser,'select public.review_alert($1)',[alert]),/Caregiver/);
  await as(staffA,'select public.review_alert($1)',[alert]);
  const [row] = await as(staffA,'select reviewed,reviewed_by from public.alerts where id=$1',[alert]);
  assert.deepEqual(row,{reviewed:true,reviewed_by:staffA});
});
test('maintenance detects missed events without a device and accepts a later queued response', async () => {
  const e = await event('MEDICINE',{},patientA,orgA,adminA,{hoursAgo:2});
  await db.exec('select public.run_maintenance(); select public.run_maintenance();');
  assert.equal((await as(staffA,'select status from public.care_events where id=$1',[e]))[0].status,'MISSED');
  assert.equal((await as(staffA,`select * from public.alerts where event_id=$1 and alert_type='MISSED_EVENT'`,[e])).length,1);
  await respond(e,'YES',{},id(),new Date(Date.now()-90*60000).toISOString());
  assert.equal((await as(staffA,'select status from public.care_events where id=$1',[e]))[0].status,'COMPLETED');
});
test('heartbeat uses server time, throttles writes, and offline alerts do not repeat per outage', async () => {
  await as(deviceUser,`select public.device_heartbeat('0.1','{"display":true}')`);
  const [first] = await as(adminA,'select last_seen from public.devices where id=$1',[deviceA]);
  await as(deviceUser,`select public.device_heartbeat('0.1')`);
  const [second] = await as(adminA,'select last_seen from public.devices where id=$1',[deviceA]);
  assert.equal(String(first.last_seen),String(second.last_seen));
  await db.query(`update public.devices set last_seen=now()-interval '4 minutes' where id=$1`,[deviceA]);
  await db.exec('select public.run_maintenance(); select public.run_maintenance();');
  assert.equal((await as(adminA,`select * from public.alerts where device_id=$1 and alert_type='DEVICE_OFFLINE'`,[deviceA])).length,1);
  await as(deviceUser,`select public.device_heartbeat('0.1')`);
  assert.equal((await as(adminA,'select status from public.devices where id=$1',[deviceA]))[0].status,'ONLINE');
});
test('recurring schedules generate bounded dated events, update future payloads, and disable safely', async () => {
  const config=id();
  await as(staffA,`insert into public.medicines(id,organization_id,patient_id,name,dosage,scheduled_time,start_date)
    values($1,$2,$3,'Synthetic medicine','Demo only','08:00',current_date+1)`,[config,orgA,patientA]);
  await as(staffA,'select public.refresh_schedules(7)'); await as(staffA,'select public.refresh_schedules(7)');
  let rows = await as(staffA,'select * from public.care_events where source_id=$1',[config]);
  assert.equal(rows.length,7); assert.ok(rows.every(r=>r.payload.dosage==='Demo only'));
  await as(staffA,`update public.medicines set dosage='Updated demo' where id=$1`,[config]);
  await as(staffA,'select public.refresh_schedules(7)');
  rows = await as(staffA,'select * from public.care_events where source_id=$1',[config]);
  assert.ok(rows.every(r=>r.payload.dosage==='Updated demo'));
  await as(staffA,'update public.medicines set enabled=false where id=$1',[config]);
  await as(staffA,'select public.refresh_schedules(7)');
  assert.ok((await as(staffA,'select status from public.care_events where source_id=$1',[config])).every(r=>r.status==='SKIPPED'));
});
test('reassignment rejects queued results for the previous patient and revocation blocks the device', async () => {
  const e = await event();
  await as(adminA,'update public.devices set assigned_patient_id=$1 where id=$2',[patientA2,deviceA]);
  await assert.rejects(respond(e,'YES'),/assignment/);
  await as(adminA,'update public.devices set revoked_at=now() where id=$1',[deviceA]);
  await assert.rejects(as(deviceUser,'select public.device_context()'),/authentication/);
  assert.equal((await as(deviceUser,'select * from public.care_events')).length,0);
});

test('hosted smoke script validates the loop and rolls back its fixtures', async () => {
  const beforeCount = (await db.query('select count(*)::int as n from auth.users')).rows[0].n;
  await db.exec(await readFile(new URL('../supabase/tests/hosted_smoke.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,beforeCount);
});
