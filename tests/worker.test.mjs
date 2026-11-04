// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

/* ---- tiny fake Supabase (PostgREST + auth) and fake GitHub ---- */
function makeWorld() {
  const tables = {
    user_roles: [{ user_id: 'admin1', role: 'admin' }, { user_id: 'staff1', role: 'staff' }, { user_id: 'blogger', role: 'staff' }],
    staff_permissions: [{ user_id: 'blogger', can_manage_blog: true }, { user_id: 'staff1', can_manage_blog: false }],
    profiles: [{ id: 'admin1', display_name: 'Lokesh' }],
    leads: [],
    blog_posts: [{
      id: '11111111-1111-1111-1111-111111111111', slug: 'my-article', status: 'draft', title: 'My article', h1: '', description: 'A description.',
      summary: '', category: 'GST', blocks: [{ t: 'p', v: 'Hello' }], related: ['free-trial'], cover_data: 'data:image/webp;base64,UklGRg==',
      cover_alt: 'cover', publish_date: '2026-11-05', publish_time: '10:30',
    }],
  };
  const tokens = { 'tok-admin': 'admin1', 'tok-staff': 'staff1', 'tok-blogger': 'blogger' };
  const authUsers = [
    { id: 'admin1', email: 'a@x.co', last_sign_in_at: null, created_at: '2026-01-01' },
    { id: 'staff1', email: 's@x.co', last_sign_in_at: null, created_at: '2026-01-01', banned_until: '2999-01-01T00:00:00Z' },
  ];
  const log = { github: [], authCalls: [], dropColumn: null };

  const match = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'limit', 'on_conflict', 'order'].includes(k)) continue;
      if (k === 'or') {
        const m = /mobile\.eq\.(\d+),email\.eq\."([^"]+)"/.exec(v);
        if (m && !(row.mobile === m[1] || row.email === m[2])) return false;
        continue;
      }
      if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
      if (v.startsWith('gte.') && !(row[k] >= v.slice(4))) return false;
    }
    return true;
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const J = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    if (url.hostname === 'api.github.com') {
      const path = url.pathname.split('/contents/')[1];
      log.github.push({ method, path, body });
      if (method === 'GET') {
        if (path === 'scripts/resource-pages.json') return new Response('{"slug": "blog/taken-slug"}', { status: 200 });
        if (path.startsWith('content/blog/') && log.github.some((g) => g.method === 'PUT' && g.path === path)) return J({ sha: 'abc' });
        return new Response('{}', { status: 404 });
      }
      return J({});
    }
    if (url.pathname.startsWith('/auth/v1/user')) {
      const t = (init.headers.authorization || '').replace('Bearer ', '');
      return tokens[t] ? J({ id: tokens[t] }) : J({ msg: 'bad' }, 401);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users')) {
      log.authCalls.push({ method, path: url.pathname, body });
      if (method === 'GET') return J({ users: authUsers });
      if (method === 'POST') return J({ id: 'new-user' });
      return J({});
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.replace('/rest/v1/', '');
      const rows = tables[table] || (tables[table] = []);
      const params = [...url.searchParams.entries()];
      if (method === 'GET') return J(rows.filter((r) => match(r, params)));
      if (method === 'POST') {
        if (log.dropColumn && body && log.dropColumn in body) return J({ message: `Could not find the '${log.dropColumn}' column of '${table}'` }, 400);
        const keyCols = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
        const existing = keyCols.length && rows.find((r) => keyCols.every((c) => r[c] === body[c]));
        if (existing) Object.assign(existing, body); else rows.push({ created_at: new Date().toISOString(), ...body }); // the real database stamps created_at
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') { rows.filter((r) => match(r, params)).forEach((r) => Object.assign(r, body)); return new Response(null, { status: 204 }); }
      if (method === 'DELETE') { tables[table] = rows.filter((r) => !match(r, params)); return new Response(null, { status: 204 }); }
    }
    throw new Error('unexpected request ' + method + ' ' + url);
  };
  return { tables, log };
}

const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', GITHUB_TOKEN: 'ghp', ASSETS: { fetch: async () => new Response('page') } };
const req = (path, { method = 'POST', token, origin, body, form } = {}) => new Request('https://crm.taxpower.co' + path, {
  method,
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(origin ? { origin } : {}), 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
  body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body),
});
const call = (r) => worker.fetch(r, env);
const goodLead = { name: 'Rahul Patil', mobile: '9876543210', email: 'Rahul@Example.com', product: 'TaxPower GST', page: 'https://taxpower.co/pricing', company: 'Patil Traders' };

test('website enquiry is saved as a lead with its source', async () => {
  const w = makeWorld();
  const r = await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: goodLead }));
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://taxpower.co');
  assert.equal(w.tables.leads.length, 1);
  assert.equal(w.tables.leads[0].email, 'rahul@example.com');
  assert.equal(w.tables.leads[0].source, 'Website form');
  assert.equal(w.tables.leads[0].status, 'new');
});

test('same enquiry twice within two minutes is stored once', async () => {
  const w = makeWorld();
  await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: goodLead }));
  const r = await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: goodLead }));
  assert.equal((await r.json()).duplicate, true);
  assert.equal(w.tables.leads.length, 1);
});

test('bad input, foreign origins and bots are rejected quietly', async () => {
  const w = makeWorld();
  assert.equal((await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: { ...goodLead, mobile: '123' } }))).status, 400);
  assert.equal((await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: { ...goodLead, email: 'nope' } }))).status, 400);
  assert.equal((await call(req('/api/public/lead', { origin: 'https://evil.example', form: goodLead }))).status, 403);
  const bot = await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: { ...goodLead, website: 'http://spam' } }));
  assert.equal(bot.status, 200);
  assert.equal(w.tables.leads.length, 0);
});

test('a lead is still saved when the database has no "source" column yet', async () => {
  const w = makeWorld();
  w.log.dropColumn = 'source';
  const r = await call(req('/api/public/lead', { origin: 'https://taxpower.co', form: goodLead }));
  assert.equal(r.status, 201);
  assert.equal(w.tables.leads.length, 1);
  assert.equal('source' in w.tables.leads[0], false);
});

test('team API needs an administrator', async () => {
  makeWorld();
  assert.equal((await call(req('/api/public/staff', { method: 'GET' }))).status, 401);
  assert.equal((await call(req('/api/public/staff', { method: 'GET', token: 'tok-staff' }))).status, 403);
  const r = await call(req('/api/public/staff', { method: 'GET', token: 'tok-admin' }));
  const data = await r.json();
  assert.equal(data.users.length, 2);
  assert.equal(data.users.find((u) => u.id === 'admin1').role, 'admin');
  assert.equal(data.users.find((u) => u.id === 'staff1').active, false);
});

test('team safety rules: no self-demotion, no disabling yourself, keep one admin', async () => {
  makeWorld();
  const patch = (body) => call(req('/api/public/staff', { method: 'PATCH', token: 'tok-admin', body }));
  assert.equal((await patch({ id: 'admin1', role: 'staff' })).status, 400);
  assert.equal((await patch({ id: 'admin1', active: false })).status, 400);
  assert.equal((await patch({ id: 'staff1', password: 'short' })).status, 400);
});

test('admin can change a role, disable a login and create a user', async () => {
  const w = makeWorld();
  assert.equal((await call(req('/api/public/staff', { method: 'PATCH', token: 'tok-admin', body: { id: 'staff1', role: 'admin' } }))).status, 200);
  assert.ok(w.tables.user_roles.some((r) => r.user_id === 'staff1' && r.role === 'admin'));
  assert.equal(w.tables.user_roles.filter((r) => r.user_id === 'staff1').length, 1);
  await call(req('/api/public/staff', { method: 'PATCH', token: 'tok-admin', body: { id: 'blogger', active: false } }));
  assert.deepEqual(w.log.authCalls.at(-1).body, { ban_duration: '876000h' });
  const created = await call(req('/api/public/staff', { method: 'POST', token: 'tok-admin', body: { email: 'N@X.co', password: 'longenough1', role: 'staff', display_name: 'New' } }));
  assert.equal((await created.json()).id, 'new-user');
  assert.ok(w.tables.user_roles.some((r) => r.user_id === 'new-user' && r.role === 'staff'));
  assert.ok(w.tables.staff_permissions.some((p) => p.user_id === 'new-user'));
});

test('new staff login gets exactly the permissions the admin ticked', async () => {
  const w = makeWorld();
  await call(req('/api/public/staff', { method: 'POST', token: 'tok-admin', body: { email: 'p@x.co', password: 'longenough1', role: 'staff', permissions: { can_add_leads: true, can_edit_leads: false, can_manage_blog: true } } }));
  const row = w.tables.staff_permissions.find((p) => p.user_id === 'new-user');
  assert.equal(row.can_add_leads, true);
  assert.equal(row.can_edit_leads, false);
  assert.equal(row.can_manage_blog, true);
  assert.equal(row.can_export, true);
});

const postId = '11111111-1111-1111-1111-111111111111';

test('blog publishing needs the blog permission', async () => {
  makeWorld();
  assert.equal((await call(req('/api/public/blog', { token: 'tok-staff', body: { id: postId } }))).status, 403);
  assert.equal((await call(req('/api/public/blog', { body: { id: postId } }))).status, 401);
});

test('publishing commits the cover first, then the article, and marks it live', async () => {
  const w = makeWorld();
  const r = await call(req('/api/public/blog', { token: 'tok-blogger', body: { id: postId } }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, 'https://taxpower.co/blog/my-article');
  const puts = w.log.github.filter((g) => g.method === 'PUT');
  assert.deepEqual(puts.map((p) => p.path), ['asset/blog/my-article.webp', 'content/blog/my-article.json']);
  const article = JSON.parse(Buffer.from(puts[1].body.content, 'base64').toString());
  assert.equal(article.cover, 'asset/blog/my-article.webp');
  assert.equal(article.published, '2026-11-05');
  assert.equal(article.time, '10:30');
  assert.equal(w.tables.blog_posts[0].status, 'published');
});

test('a web address already used by a built-in article is refused', async () => {
  const w = makeWorld();
  w.tables.blog_posts[0].slug = 'taken-slug';
  const r = await call(req('/api/public/blog', { token: 'tok-admin', body: { id: postId } }));
  assert.equal(r.status, 400);
  assert.equal(w.log.github.filter((g) => g.method === 'PUT').length, 0);
});

test('unpublish removes the article file and returns it to draft', async () => {
  const w = makeWorld();
  await call(req('/api/public/blog', { token: 'tok-admin', body: { id: postId } }));
  const r = await call(req('/api/public/blog', { token: 'tok-admin', body: { id: postId, action: 'unpublish' } }));
  assert.equal(r.status, 200);
  assert.ok(w.log.github.some((g) => g.method === 'DELETE' && g.path === 'content/blog/my-article.json'));
  assert.equal(w.tables.blog_posts[0].status, 'draft');
});

test('missing GitHub token gives a clear message, screens are served with noindex', async () => {
  makeWorld();
  const r = await worker.fetch(req('/api/public/blog', { token: 'tok-admin', body: { id: postId } }), { ...env, GITHUB_TOKEN: '' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /GITHUB_TOKEN/);
  const page = await call(new Request('https://crm.taxpower.co/'));
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await call(new Request('https://crm.taxpower.co/crm/index.html'))).status, 301);
});
