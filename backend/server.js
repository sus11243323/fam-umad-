import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import os from 'node:os';
import process from 'node:process';
import crypto from 'node:crypto';
import { Client, GatewayIntentBits, Partials, PermissionsBitField } from 'discord.js';
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';

const PORT = Number(process.env.PORT || 3001);
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || 'http://localhost:5173';
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'HVHCentral';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'HVHCENTRAL12';
const sessions = new Set();
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: DASHBOARD_ORIGIN === '*' ? true : DASHBOARD_ORIGIN, credentials: true } });

app.use(cors({ origin: DASHBOARD_ORIGIN === '*' ? true : DASHBOARD_ORIGIN, credentials: true }));
app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

const startedAt = Date.now();
let ready = false;

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function auth(req, res, next) {
  if (DASHBOARD_KEY && req.headers.authorization === `Bearer ${DASHBOARD_KEY}`) return next();
  const session = cookieValue(req, 'central_hvh_session');
  if (session && sessions.has(session)) return next();
  return res.status(401).json({ error: 'Dashboard authentication required' });
}

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if (username !== DASHBOARD_USERNAME || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const session = crypto.randomBytes(32).toString('hex');
  sessions.add(session);
  res.setHeader('Set-Cookie', `central_hvh_session=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  return res.json({ ok: true, username: DASHBOARD_USERNAME });
});

app.post('/api/logout', auth, (req, res) => {
  const session = cookieValue(req, 'central_hvh_session');
  if (session) sessions.delete(session);
  res.setHeader('Set-Cookie', 'central_hvh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/session', auth, (_req, res) => res.json({ ok: true, username: DASHBOARD_USERNAME }));

function memberView(member) {
  return {
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName || null,
    displayName: member.displayName,
    avatar: member.user.displayAvatarURL({ size: 64 }),
    bot: member.user.bot,
    joinedAt: member.joinedTimestamp,
    roles: member.roles.cache.filter(r => r.id !== member.guild.id).map(r => ({ id: r.id, name: r.name }))
  };
}

function snapshot() {
  const guilds = [...client.guilds.cache.values()].map(g => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
    icon: g.iconURL({ size: 64 })
  }));
  return {
    bot: {
      online: ready && client.isReady(),
      username: client.user?.tag || null,
      id: client.user?.id || null,
      ping: client.ws.ping,
      uptimeMs: client.uptime || 0,
      processUptimeMs: Math.round(process.uptime() * 1000)
    },
    discord: { guildCount: guilds.length, userCount: guilds.reduce((n, g) => n + (g.memberCount || 0), 0), guilds },
    runtime: {
      node: process.version,
      platform: process.platform,
      cpuCount: os.cpus().length,
      memoryMb: Math.round(os.totalmem() / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      load1m: os.loadavg()[0],
      pid: process.pid
    },
    serverStartedAt: startedAt,
    timestamp: Date.now()
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, ready, bot: client.user?.tag || null }));
app.get('/api/guilds', auth, (_req, res) => res.json(snapshot().discord.guilds));

app.get('/api/guilds/:guildId/members', auth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(req.params.guildId);
    const members = await guild.members.fetch();
    const query = String(req.query.q || '').trim().toLowerCase();
    let list = [...members.values()].map(memberView);
    if (query) list = list.filter(m => [m.username, m.globalName, m.displayName, m.id].filter(Boolean).some(v => v.toLowerCase().includes(query)));
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json({ guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount }, members: list });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/ban', auth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(req.params.guildId);
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionsBitField.Flags.BanMembers)) return res.status(403).json({ error: 'Bot is missing Ban Members permission in this server.' });
    const member = await guild.members.fetch(req.params.userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'User is not currently in this server.' });
    if (!member.bannable) return res.status(403).json({ error: 'Discord will not allow this bot to ban that user. Check role hierarchy and permissions.' });
    if (member.id === client.user.id) return res.status(400).json({ error: 'The bot cannot ban itself.' });
    const reason = String(req.body?.reason || 'Banned from CENTRAL HVH web control panel').slice(0, 500);
    await member.ban({ reason, deleteMessageSeconds: 0 });
    res.json({ ok: true, guildId: guild.id, userId: member.id, username: member.user.tag, reason });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

io.use((socket, next) => {
  const authHeader = socket.handshake.headers.authorization;
  const cookie = String(socket.handshake.headers.cookie || '');
  const match = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('central_hvh_session='));
  const session = match ? decodeURIComponent(match.slice('central_hvh_session='.length)) : '';
  if ((DASHBOARD_KEY && authHeader === `Bearer ${DASHBOARD_KEY}`) || (session && sessions.has(session))) return next();
  next(new Error('Dashboard authentication required'));
});

io.on('connection', socket => socket.emit('telemetry', snapshot()));
setInterval(() => io.emit('telemetry', snapshot()), 2000);

client.once('ready', () => {
  ready = true;
  console.log(`Logged in as ${client.user.tag}`);
});
client.on('error', console.error);

server.listen(PORT, () => console.log(`CENTRAL HVH backend listening on http://localhost:${PORT}`));

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
