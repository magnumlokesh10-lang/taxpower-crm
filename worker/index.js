// TaxPower CRM - Cloudflare Worker.
// Serves the CRM screens (public/) and three small APIs:
//   POST /api/public/lead   website enquiry forms -> leads
//   /api/public/staff       admin: team logins and roles
//   POST /api/public/blog   publish / unpublish blog articles to the website repo
// No framework and no npm packages: it talks to Supabase and GitHub with plain fetch.

const SITE_URL = 'https://taxpower.co';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_ORIGINS = [
  'https://taxpower.co', 'https://www.taxpower.co', 'https://crm.taxpower.co',
  'http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:5500', 'http://127.0.0.1:5500',
];

/* ---------------- small helpers ---------------- */

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function missing(env, names) {
  const gone = names.filter((n) => !env[n]);
  return gone.length ? `Server setup incomplete: ${gone.join(', ')} not set.` : '';
}

/* ---------------- Supabase over plain HTTP ---------------- */

function db(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = (extra) => ({ apikey: key, authorization: `Bearer ${key}`, ...extra });

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: headers({
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {}),
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data && data.message) || text || `HTTP ${res.status}` };
  }

  async function auth(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${base}/auth/v1/${path}`, {
      method,
      headers: headers({ 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data && (data.msg || data.message || data.error_description)) || `HTTP ${res.status}` };
  }

  // Who is calling? Validates the sign-in token the CRM screens send.
  async function userFromToken(token) {
    if (!token) return null;
    const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    return user && user.id ? user : null;
  }

  return { rest, auth, userFromToken };
}

function bearer(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

async function requireUser(request, env, mode) {
  const bad = missing(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (bad) return { error: json({ error: bad }, 500) };
  const sb = db(env);
  const user = await sb.userFromToken(bearer(request));
  if (!user) return { error: json({ error: 'Please sign in again.' }, 401) };

  const roles = await sb.rest(`user_roles?user_id=eq.${user.id}&select=role`);
  const isAdmin = Array.isArray(roles.data) && roles.data.some((r) => r.role === 'admin');
  if (mode === 'admin') {
    if (!isAdmin) return { error: json({ error: 'Only an administrator can do this.' }, 403) };
    return { sb, user };
  }
  if (mode === 'blog') {
    let allowed = isAdmin;
    if (!allowed) {
      const perm = await sb.rest(`staff_permissions?user_id=eq.${user.id}&select=can_manage_blog`);
      allowed = Array.isArray(perm.data) && !!(perm.data[0] && perm.data[0].can_manage_blog);
    }
    if (!allowed) return { error: json({ error: 'You do not have permission to publish blog articles.' }, 403) };
    return { sb, user };
  }
  return { sb, user };
}

/* ---------------- website enquiry -> lead ---------------- */

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https:\/\/([a-z0-9-]+\.)*taxpower\.(co|org)$/i.test(origin);
}

function leadCors(origin) {
  const h = { vary: 'Origin' };
  if (isAllowedOrigin(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
    h['access-control-max-age'] = '86400';
  }
  return h;
}

async function readForm(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return (await request.json().catch(() => ({}))) || {};
  const params = new URLSearchParams(await request.text().catch(() => ''));
  const out = {};
  params.forEach((v, k) => { out[k] = k === 'product' && out[k] ? `${out[k]}, ${v}` : v; });
  return out;
}

async function handleLead(request, env) {
  const origin = request.headers.get('origin');
  const cors = leadCors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
  if (origin && !isAllowedOrigin(origin)) return json({ error: 'Origin not allowed' }, 403, cors);

  const body = await readForm(request);
  // Honeypot: real visitors never fill these hidden fields.
  if (clean(body.website, 200) || clean(body.fax, 200) || clean(body._hp, 200)) return json({ ok: true }, 200, cors);

  const name = clean(body.name, 120);
  const mobileRaw = clean(body.mobile, 20).replace(/\D/g, '');
  const mobile = mobileRaw.length > 10 ? mobileRaw.slice(-10) : mobileRaw;
  const email = clean(body.email, 160).toLowerCase();
  const gstinRaw = clean(body.gstin, 15).toUpperCase();
  const gstin = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstinRaw) ? gstinRaw : '';

  if (name.length < 2) return json({ error: 'Please enter your full name.' }, 400, cors);
  if (mobile.length !== 10) return json({ error: 'Please enter a valid 10 digit mobile number.' }, 400, cors);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400, cors);

  const bad = missing(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (bad) return json({ error: 'Could not save your enquiry. Please try again.' }, 500, cors);
  const sb = db(env);

  // Flood protection: the same mobile or email within 2 minutes is ignored.
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const recent = await sb.rest(
    `leads?select=id&created_at=gte.${encodeURIComponent(since)}&or=(mobile.eq.${mobile},email.eq."${email.replace(/"/g, '')}")&limit=1`,
  );
  if (Array.isArray(recent.data) && recent.data.length > 0) return json({ ok: true, duplicate: true }, 200, cors);

  const record = {
    name,
    company: clean(body.company, 160),
    mobile,
    email,
    gstin,
    address: clean(body.address, 300),
    city: clean(body.city, 80),
    state: clean(body.state, 80),
    product: clean(body.product, 300),
    purpose: clean(body.purpose, 200),
    page: clean(body.page, 300),
    submitted_at_text: clean(body.submittedAt || body.submitted_at_text, 80),
    status: 'new',
    source: 'Website form',
  };
  let res = await sb.rest('leads', { method: 'POST', body: record, prefer: 'return=minimal' });
  if (!res.ok && /source/i.test(res.error || '')) {
    // Older database without the "source" column: never lose a lead because of it.
    const { source, ...withoutSource } = record;
    res = await sb.rest('leads', { method: 'POST', body: withoutSource, prefer: 'return=minimal' });
  }
  if (!res.ok) return json({ error: 'Could not save your enquiry. Please try again.' }, 500, cors);
  return json({ ok: true }, 201, cors);
}

/* ---------------- team logins (admin) ---------------- */

async function handleStaff(request, env) {
  const ctx = await requireUser(request, env, 'admin');
  if (ctx.error) return ctx.error;
  const { sb, user } = ctx;

  if (request.method === 'GET') {
    const list = await sb.auth('admin/users?page=1&per_page=200');
    if (!list.ok) return json({ error: list.error }, 400);
    const [roles, profiles] = await Promise.all([sb.rest('user_roles?select=user_id,role'), sb.rest('profiles?select=id,display_name')]);
    const roleRows = Array.isArray(roles.data) ? roles.data : [];
    const profileRows = Array.isArray(profiles.data) ? profiles.data : [];
    const users = (list.data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      role: roleRows.some((r) => r.user_id === u.id && r.role === 'admin') ? 'admin' : 'staff',
      display_name: (profileRows.find((p) => p.id === u.id) || {}).display_name || '',
      last_sign_in_at: u.last_sign_in_at,
      created_at: u.created_at,
      active: !u.banned_until || new Date(u.banned_until).getTime() < Date.now(),
    }));
    return json({ users });
  }

  const body = await request.json().catch(() => ({}));

  if (request.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'staff';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Valid email required' }, 400);
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
    const created = await sb.auth('admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
    if (!created.ok || !created.data || !created.data.id) return json({ error: created.error || 'Could not create user' }, 400);
    const id = created.data.id;
    await sb.rest('profiles?on_conflict=id', { method: 'POST', body: { id, display_name: clean(body.display_name, 80) }, prefer: 'resolution=merge-duplicates,return=minimal' });
    await sb.rest('user_roles?on_conflict=user_id,role', { method: 'POST', body: { user_id: id, role }, prefer: 'resolution=merge-duplicates,return=minimal' });
    const asked = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
    const pick = (key, fallback) => (role === 'admin' ? true : typeof asked[key] === 'boolean' ? asked[key] : fallback);
    await upsertPermissions(sb, id, {
      can_add_leads: pick('can_add_leads', false),
      can_edit_leads: pick('can_edit_leads', true),
      can_convert_leads: pick('can_convert_leads', true),
      can_export: pick('can_export', true),
      can_manage_blog: pick('can_manage_blog', false),
    });
    return json({ ok: true, id, email, role });
  }

  if (request.method === 'PATCH') {
    const id = String(body.id || '');
    if (!id) return json({ error: 'User id required' }, 400);
    const admins = await sb.rest('user_roles?role=eq.admin&select=user_id');
    const adminIds = (Array.isArray(admins.data) ? admins.data : []).map((r) => r.user_id);

    if (body.role && body.role !== 'admin' && body.role !== 'staff') return json({ error: 'Invalid role' }, 400);
    if (id === user.id && body.role === 'staff') return json({ error: 'You cannot remove your own admin access' }, 400);
    if (id === user.id && body.active === false) return json({ error: 'You cannot disable your own account' }, 400);
    if (body.role === 'staff' && adminIds.length <= 1 && adminIds.includes(id)) return json({ error: 'At least one administrator is required' }, 400);
    if (body.password !== undefined && String(body.password).length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    const attrs = {};
    if (body.password) attrs.password = String(body.password);
    if (body.active === false) attrs.ban_duration = '876000h';
    if (body.active === true) attrs.ban_duration = 'none';
    if (Object.keys(attrs).length) {
      const upd = await sb.auth(`admin/users/${id}`, { method: 'PUT', body: attrs });
      if (!upd.ok) return json({ error: upd.error }, 400);
    }
    if (typeof body.display_name === 'string') {
      await sb.rest('profiles?on_conflict=id', { method: 'POST', body: { id, display_name: clean(body.display_name, 80) }, prefer: 'resolution=merge-duplicates,return=minimal' });
    }
    if (body.role) {
      await sb.rest(`user_roles?user_id=eq.${id}`, { method: 'DELETE' });
      await sb.rest('user_roles', { method: 'POST', body: { user_id: id, role: body.role }, prefer: 'return=minimal' });
      if (body.role === 'admin') await upsertPermissions(sb, id, { can_add_leads: true, can_edit_leads: true, can_convert_leads: true, can_export: true, can_manage_blog: true });
    }
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    const id = String(body.id || '');
    if (!id) return json({ error: 'User id required' }, 400);
    if (id === user.id) return json({ error: 'You cannot remove your own account' }, 400);
    const del = await sb.auth(`admin/users/${id}`, { method: 'DELETE' });
    if (!del.ok) return json({ error: del.error }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function upsertPermissions(sb, userId, perms) {
  let res = await sb.rest('staff_permissions?on_conflict=user_id', { method: 'POST', body: { user_id: userId, ...perms }, prefer: 'resolution=merge-duplicates,return=minimal' });
  if (!res.ok && /can_manage_blog/i.test(res.error || '')) {
    const { can_manage_blog, ...older } = perms; // database update not applied yet
    res = await sb.rest('staff_permissions?on_conflict=user_id', { method: 'POST', body: { user_id: userId, ...older }, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  return res;
}

/* ---------------- blog publishing ---------------- */

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function github(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('Publishing is not set up yet: the GITHUB_TOKEN secret is missing. Ask the administrator to add it.');
  const repo = env.GITHUB_REPO || 'magnumlokesh10-lang/taxpower-update';
  const branch = env.GITHUB_BRANCH || 'main';
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'taxpower-crm' };
  const api = `https://api.github.com/repos/${repo}/contents`;

  async function getFile(path) {
    const res = await fetch(`${api}/${path}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub could not read ${path} (${res.status}).`);
    return res.json();
  }
  async function putFile(path, contentBase64, message) {
    const existing = await getFile(path);
    const res = await fetch(`${api}/${path}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message, content: contentBase64, branch, ...(existing ? { sha: existing.sha } : {}) }),
    });
    if (!res.ok) throw new Error(`GitHub refused to save ${path} (${res.status}). ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }
  async function deleteFile(path, message) {
    const existing = await getFile(path);
    if (!existing) return;
    const res = await fetch(`${api}/${path}`, {
      method: 'DELETE',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message, sha: existing.sha, branch }),
    });
    if (!res.ok) throw new Error(`GitHub refused to remove ${path} (${res.status}).`);
  }
  async function readText(path) {
    const res = await fetch(`${api}/${path}?ref=${encodeURIComponent(branch)}`, { headers: { ...headers, accept: 'application/vnd.github.raw+json' } });
    return res.ok ? res.text() : '';
  }
  return { putFile, deleteFile, readText };
}

async function handleBlog(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ctx = await requireUser(request, env, 'blog');
  if (ctx.error) return ctx.error;
  const { sb } = ctx;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const action = body.action === 'unpublish' ? 'unpublish' : 'publish';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Article id is required.' }, 400);

  const found = await sb.rest(`blog_posts?id=eq.${id}&select=*`);
  const post = Array.isArray(found.data) ? found.data[0] : null;
  if (!post) return json({ error: 'Article not found.' }, 404);
  if (!SLUG_RE.test(post.slug)) return json({ error: 'The web address (slug) is not valid.' }, 400);

  let gh;
  try { gh = github(env); } catch (e) { return json({ error: e.message }, 500); }

  try {
    if (action === 'unpublish') {
      await gh.deleteFile(`content/blog/${post.slug}.json`, `Unpublish blog article: ${post.slug}`);
      await sb.rest(`blog_posts?id=eq.${id}`, { method: 'PATCH', body: { status: 'draft' }, prefer: 'return=minimal' });
      return json({ ok: true, message: 'The article will disappear from the website in about 2 minutes.' });
    }

    if (!String(post.title || '').trim() || !String(post.description || '').trim()) return json({ error: 'Add a title and a short description before publishing.' }, 400);
    if (!Array.isArray(post.blocks) || post.blocks.length === 0) return json({ error: 'The article has no content yet.' }, 400);
    if (post.status !== 'published') {
      const builtIn = await gh.readText('scripts/resource-pages.json');
      if (builtIn.includes(`"slug": "blog/${post.slug}"`) || builtIn.includes(`"slug":"blog/${post.slug}"`)) {
        return json({ error: 'This web address is already used by another article. Change the slug.' }, 400);
      }
    }

    let coverPath;
    const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(post.cover_data || '');
    if (m) {
      coverPath = `asset/blog/${post.slug}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      await gh.putFile(coverPath, m[2], `Blog cover image: ${post.slug}`);
    }

    const date = post.publish_date || istToday();
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(post.publish_time || '') ? post.publish_time : '09:00';
    const article = {
      title: post.title,
      h1: post.h1 || post.title,
      description: post.description,
      summary: post.summary || post.description,
      category: post.category || 'Guide',
      published: date,
      time,
      blocks: post.blocks,
      related: post.related || [],
    };
    if (coverPath) { article.cover = coverPath; article.cover_alt = post.cover_alt || post.title; }
    await gh.putFile(
      `content/blog/${post.slug}.json`,
      bytesToBase64(new TextEncoder().encode(JSON.stringify(article, null, 2) + '\n')),
      `${post.status === 'published' ? 'Update' : 'Publish'} blog article: ${post.slug}`,
    );
    await sb.rest(`blog_posts?id=eq.${id}`, { method: 'PATCH', body: { status: 'published', published_at: new Date().toISOString(), publish_date: date }, prefer: 'return=minimal' });
    return json({ ok: true, url: `${SITE_URL}/blog/${post.slug}`, message: 'Sent for publishing. The article will be live in about 2 minutes.' });
  } catch (e) {
    return json({ error: e.message || 'Publishing failed.' }, 502);
  }
}

/* ---------------- entry point ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/public/lead') return handleLead(request, env);
    if (path === '/api/public/staff') return handleStaff(request, env);
    if (path === '/api/public/blog') return handleBlog(request, env);
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    // Old bookmarks of the CRM screen
    if (path === '/crm' || path === '/crm/index.html') return Response.redirect(`${url.origin}/${url.search}`, 301);

    const res = await env.ASSETS.fetch(request);
    // Keep the private CRM out of search engines and caches.
    const out = new Response(res.body, res);
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    if (path === '/' || path.endsWith('.html')) out.headers.set('cache-control', 'no-cache');
    return out;
  },
};
