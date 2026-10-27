import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newDb } from 'pg-mem';
import request from 'supertest';
import ejs from 'ejs';
import { createApp } from '../index.js';
import { createFeaturesRouter } from '../features/router.js';
import express from 'express';

const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
function setup() {
  const memory = newDb();
  memory.public.none(schema);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const app = createApp(pool, { sessionSecret: 'isolated-test-secret', saltRounds: 4 });
  return { pool, app, agent: request.agent(app) };
}
async function register(agent, email = 'alice@example.com') {
  await agent.post('/register').type('form').send({ email, password: 'test-password' }).expect(302).expect('Location', '/watched');
}
const film = { name: "Schindler's List", poster: '/poster.jpg' };

test('public pages, static files and protected routes respond', async () => {
  const { app } = setup();
  for (const route of ['/', '/login', '/register', '/css/styles.css', '/js/where_to_watch.js']) await request(app).get(route).expect(200);
  for (const route of ['/watched','/watch_later','/friends','/search','/tonights_pick']) await request(app).get(route).expect(302);
  await request(app).get('/api/where_to_watch?id=1').expect(401);
  await request(app).post('/put_watched').send(film).expect(401).expect(({body}) => assert.equal(body.status, 'unauthenticated'));
});
test('registration hashes passwords, authenticates and preserves empty-list notifications', async () => {
  const { agent, pool } = setup();
  await register(agent);
  const stored = (await pool.query('SELECT * FROM credentials')).rows[0];
  assert.notEqual(stored.password, 'test-password');
  await pool.query('INSERT INTO credentials VALUES ($1,$2)', ['bob@example.com', 'unused']);
  await pool.query('INSERT INTO friend_request VALUES ($1,$2)', ['alice@example.com','bob@example.com']);
  await pool.query('INSERT INTO recommendations VALUES ($1,$2,$3,$4)', [film.name,film.poster,'alice@example.com','bob@example.com']);
  const page = await agent.get('/watched').expect(200);
  assert.match(page.text, /bob@example.com/);
  assert.match(page.text, /data-name="Schindler&#39;s List"/);
  assert.match(page.text, /OOPS! Nothing to Show HERE!/);
});
test('duplicate and invalid registrations complete with useful errors', async () => {
  const { agent } = setup();
  await register(agent);
  await agent.post('/register').type('form').send({ email:'alice@example.com',password:'x' }).expect(409);
  await agent.post('/register').type('form').send({email:'bad',password:'x'}).expect(400);
  await agent.post('/register').type('form').send({email:'test@example.com',password:'x'.repeat(73)}).expect(400);
});
test('unknown user and incorrect passwords return to login; correct password signs in', async () => {
  const { app, agent } = setup();
  await register(agent);
  const login = request.agent(app);
  for (const data of [{username:'nobody@example.com',password:'x'}, {username:'alice@example.com',password:'wrong'}]) {
    await login.post('/login').type('form').send(data).expect(302).expect('Location','/login');
  }
  await login.post('/login').type('form').send({username:'alice@example.com',password:'test-password'}).expect(302).expect('Location','/watched');
  await login.get('/watched').expect(200);
});
test('registration database errors return 500 instead of hanging', async () => {
  const app = createApp({query:async () => {throw new Error('Simulated unavailable database');}}, {saltRounds:4});
  await request(app).post('/register').type('form').send({email:'alice@example.com',password:'x'}).expect(500);
  await request(app).post('/login').type('form').send({username:'alice@example.com',password:'x'}).expect(500);
});
test('movie lists support add, duplicates, move and remove', async () => {
  const { agent, pool } = setup();
  await register(agent);
  for (const [route,status] of [['/watch_later_post','done'],['/watch_later_post','present'],['/put_watched','done'],['/put_watched','present'],['/watch_later_post','watched']]) {
    await agent.post(route).send(film).expect(200).expect(({body}) => assert.equal(body.status,status));
  }
  assert.equal((await pool.query('SELECT * FROM watch_later')).rows.length,0);
  await agent.get('/watched').expect(200);
  await agent.post('/remove_watched').send(film).expect(({body}) => assert.equal(body.status,'done'));
  await agent.post('/watch_later_post').send(film);
  await agent.get('/watch_later').expect(200);
  await agent.post('/remove_watch_later').send(film).expect(({body}) => assert.equal(body.status,'done'));
  await agent.post('/put_watched').send({}).expect(400);
});
test('friend requests cannot target self, nonexistent users or fabricate acceptance', async () => {
  const { agent } = setup(); await register(agent);
  await agent.post('/friend_req').send({mail:'alice@example.com'}).expect(400);
  await agent.post('/friend_req').send({mail:'nobody@example.com'}).expect(404);
  await agent.post('/accept_friend').send({email:'nobody@example.com'}).expect(404);
});
test('friend request acceptance creates reciprocal friendship and removes pending request', async () => {
  const { agent, app, pool } = setup(); await register(agent);
  const bob = request.agent(app); await register(bob,'bob@example.com');
  await agent.post('/friend_req').send({mail:'bob@example.com'}).expect(({body}) => assert.equal(body.status,'done'));
  await bob.post('/friend_req').send({mail:'alice@example.com'}).expect(({body}) => assert.equal(body.status,'already'));
  await bob.post('/accept_friend').send({email:'alice@example.com'}).expect(({body}) => assert.equal(body.status,'done'));
  assert.equal((await pool.query('SELECT * FROM friends')).rows.length,2);
  assert.equal((await pool.query('SELECT * FROM friend_request')).rows.length,0);
  await agent.get('/friends').expect(200);
});
test('recommendations require friendship and acceptance uses saved poster, not forged data', async () => {
  const { agent, app, pool } = setup(); await register(agent);
  const bob = request.agent(app); await register(bob,'bob@example.com');
  await agent.post('/recommend_movie').send({...film,email:'bob@example.com'}).expect(403);
  await agent.post('/accept_recommendation').send(film).expect(404);
  await pool.query('INSERT INTO friends VALUES ($1,$2)', ['alice@example.com','bob@example.com']);
  await agent.post('/recommend_movie').send({...film,email:'bob@example.com'}).expect(({body}) => assert.equal(body.status,'done'));
  await bob.post('/accept_recommendation').send({...film,poster:'/forged.jpg'}).expect(({body}) => assert.equal(body.status,'done'));
  assert.equal((await pool.query('SELECT * FROM watch_later')).rows[0].poster,film.poster);
  assert.equal((await pool.query('SELECT * FROM recommendations')).rows.length,0);
});
test('search encodes special characters and handles upstream failure', async () => {
  const {agent} = setup(); await register(agent);
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(new URL(url).searchParams.get('query'), 'A & B #1');
      return {ok:true,json:async () => ({results:[{original_title:'A & B #1',poster_path:'/x',popularity:1}]})};
    };
    await agent.post('/search').type('form').send({search:'A & B #1'}).expect(200);
    globalThis.fetch = async () => ({ok:false,status:401});
    const result = await agent.post('/search').type('form').send({search:'anything'}).expect(200);
    assert.match(result.text,/OOPS!/);
    await agent.post('/search').type('form').send({search:' '}).expect(400);
  } finally { globalThis.fetch = oldFetch; }
});
test('failed movie transaction rolls back and releases its checked-out client', async () => {
  const {agent,pool} = setup(); await register(agent);
  const calls=[]; const connect=pool.connect.bind(pool);
  pool.connect=async () => {
    const client=await connect(); const query=client.query.bind(client); const release=client.release.bind(client);
    client.query=async (sql,args) => {calls.push(sql); if(sql.startsWith('DELETE FROM watch_later')) throw new Error('Simulated delete failure'); return query(sql,args);};
    client.release=() => {calls.push('RELEASE'); client.query=query; client.release=release; release();};
    return client;
  };
  await agent.post('/put_watched').send(film).expect(({body}) => assert.equal(body.status,'error'));
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1),'RELEASE');
  assert.ok(!calls.includes('COMMIT'));
  // pg-mem does not implement rollback; this test verifies client lifecycle only.
});
test('active EJS templates render and inline JavaScript parses with adversarial names', async () => {
  const locals={movies:[{...film,movie_name:film.name,original_title:film.name,poster_path:film.poster}],friends:[{email:"o'connor@example.com"}],emails:[{email_2:'</script><script>bad()</script>@example.com'}],friendRequests:[{sender:"o'connor@example.com"}],recs:[{movie_name:film.name,poster:film.poster}],alert:'test'};
  for (const name of ['home','login','register','watched','watch_later','search','friends','tonights_pick']) {
    const data = name==='tonights_pick' ? {...locals,friends:["o'connor@example.com"], selected:[]} : locals;
    const html = await ejs.renderFile(fileURLToPath(new URL(`../views/${name}.ejs`,import.meta.url)),data);
    for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1],{filename:name});
    assert.ok(!html.includes('</script><script>bad()'));
  }
});

function featureApp(query) {
  const app = express();
  app.set('views',fileURLToPath(new URL('../views',import.meta.url)));
  app.use(express.urlencoded({extended:true}));
  app.use(express.json());
  app.use((req,res,next) => {req.isAuthenticated=()=>true; req.user={email:'alice@example.com'};next();});
  app.use(createFeaturesRouter({query}));
  return app;
}
test('Watch Party excludes forged friends and deduplicates party members', async () => {
  const app = featureApp(async (sql,args) => {
    if(sql.includes('SELECT DISTINCT email_2')) return {rows:[{email:'bob@example.com'}]};
    if(sql.includes('FROM watch_later wl')) {
      assert.deepEqual(args[0],['alice@example.com','bob@example.com']);
      return {rows:[{movie_name:film.name,poster:film.poster,wanted_by:2,who:args[0]}]};
    }
    throw new Error('Unexpected query');
  });
  await request(app).get('/tonights_pick').expect(200);
  const result=await request(app).post('/tonights_pick').send({friends:['bob@example.com','bob@example.com','stranger@example.com']}).expect(200);
  assert.match(result.text,/Perfect Match/);
  const invalid=await request(app).post('/tonights_pick').send({friends:['stranger@example.com']}).expect(200);
  assert.match(invalid.text,/Pick at least one friend/);
});
test('Watch Party reroll excludes previous choice; fallback works with an empty library', async () => {
  let overlap=true;
  const app = featureApp(async (sql) => {
    if(sql.includes('SELECT DISTINCT email_2')) return {rows:[{email:'bob@example.com'}]};
    if(sql.includes('FROM watch_later wl')) return {rows:overlap ? ['First','Second'].map(movie_name=>({movie_name,poster:'/p',wanted_by:2,who:[]})) : []};
    return {rows:[]};
  });
  let page=await request(app).post('/tonights_pick').send({friends:'bob@example.com',last:'First'}).expect(200);
  assert.match(page.text,/data-name="Second"/);
  overlap=false;
  const oldFetch=globalThis.fetch;
  try {
    globalThis.fetch=async () => ({ok:true,json:async () => ({results:[{id:1,original_title:'Fallback',poster_path:'/p'}]})});
    page=await request(app).post('/tonights_pick').send({friends:'bob@example.com'}).expect(200);
    assert.match(page.text,/data-name="Fallback"/);
  } finally {globalThis.fetch=oldFetch;}
});
test('streaming region is read after environment setup and cached providers are deduplicated', async () => {
  const previous=process.env.WATCH_REGION; process.env.WATCH_REGION='US';
  try {
    const app=featureApp(async (sql,args) => {
      assert.equal(args[1],'US');
      return {rows:[{data:{flatrate:[{provider_id:1,provider_name:'Provider'}],ads:[{provider_id:1,provider_name:'Provider'}],link:'https://example.com/watch'}}]};
    });
    const result=await request(app).get('/api/where_to_watch?id=1').expect(200);
    assert.equal(result.body.region,'US');
    assert.equal(result.body.providers.length,1);
    assert.equal(result.body.kind,'stream');
  } finally {if(previous===undefined) delete process.env.WATCH_REGION; else process.env.WATCH_REGION=previous;}
});
test('provider lookup fetches and caches rent/buy availability and handles failed requests', async () => {
  const calls=[];
  const app=featureApp(async (sql,args) => {calls.push([sql,args]);return {rows:[]};});
  const oldFetch=globalThis.fetch;
  try {
    globalThis.fetch=async () => ({ok:true,json:async () => ({results:{IN:{rent:[{provider_id:2,provider_name:'Rental'}]}}})});
    let response=await request(app).get('/api/where_to_watch?id=10').expect(200);
    assert.equal(response.body.kind,'rent');
    assert.ok(calls.some(([sql])=>sql.includes('INSERT INTO watch_providers')));
    globalThis.fetch=async () => ({ok:false,status:503});
    response=await request(app).get('/api/where_to_watch?id=10').expect(200);
    assert.equal(response.body.status,'error');
  } finally {globalThis.fetch=oldFetch;}
});
