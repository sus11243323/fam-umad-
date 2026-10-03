import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const DASHBOARD_KEY = import.meta.env.VITE_DASHBOARD_KEY || '';
const headers = DASHBOARD_KEY ? { Authorization: `Bearer ${DASHBOARD_KEY}` } : {};

async function login(username, password) {
  const r = await fetch(`${API}/api/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Login failed');
  return j;
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [data, setData] = useState(null);
  const [selectedGuild, setSelectedGuild] = useState('');
  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [reason, setReason] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [banning, setBanning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/api/session`, { credentials: 'include', headers }).then(r => { if (r.ok) setAuthenticated(true); });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const socket = io(API, { transports: ['websocket', 'polling'], withCredentials: true, auth: DASHBOARD_KEY ? { token: DASHBOARD_KEY } : undefined });
    socket.on('telemetry', setData);
    return () => socket.close();
  }, [authenticated]);

  async function handleLogin(e) {
    e.preventDefault(); setLoggingIn(true); setLoginError('');
    try { await login(loginUser, loginPass); setAuthenticated(true); setLoginPass(''); }
    catch (e) { setLoginError(e.message); }
    finally { setLoggingIn(false); }
  }

  async function logout() { await fetch(`${API}/api/logout`, { method: 'POST', credentials: 'include', headers }); setAuthenticated(false); setData(null); }

  const guilds = data?.discord?.guilds || [];
  const currentGuild = useMemo(() => guilds.find(g => g.id === selectedGuild), [guilds, selectedGuild]);

  async function scanGuild(guildId = selectedGuild) {
    if (!guildId) return;
    setSelectedGuild(guildId); setSelectedUser(null); setError(''); setMessage(''); setLoadingMembers(true);
    try {
      const r = await fetch(`${API}/api/guilds/${guildId}/members`, { headers, credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not scan server');
      setMembers(j.members || []);
    } catch (e) { setError(e.message); setMembers([]); }
    finally { setLoadingMembers(false); }
  }

  async function banUser() {
    if (!selectedGuild || !selectedUser || banning) return;
    const ok = window.confirm(`Ban ${selectedUser.displayName} (@${selectedUser.username}) from ${currentGuild?.name}?\n\nThis is a real Discord ban.`);
    if (!ok) return;
    setBanning(true); setError(''); setMessage('Sending ban request to Discord…');
    try {
      const r = await fetch(`${API}/api/guilds/${selectedGuild}/members/${selectedUser.id}/ban`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ reason })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ban failed');
      setMessage(`Ban completed: ${j.username}`); setSelectedUser(null); setReason('');
      await scanGuild(selectedGuild);
    } catch (e) { setError(e.message); setMessage(''); }
    finally { setBanning(false); }
  }

  const filtered = members.filter(m => [m.displayName, m.username, m.globalName, m.id].filter(Boolean).some(v => v.toLowerCase().includes(query.toLowerCase())));

  if (!authenticated) return <div className="login-screen"><form className="login-card" onSubmit={handleLogin}><div className="login-logo">C</div><div className="eyebrow">CENTRAL HVH</div><h1>Secure Control Center</h1><p>Sign in to access the live Discord monitoring and moderation panel.</p><input autoComplete="username" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Username" required/><input autoComplete="current-password" type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Password" required/><button className="login-button" disabled={loggingIn}>{loggingIn ? 'AUTHENTICATING…' : 'SIGN IN'}</button>{loginError && <div className="login-error">{loginError}</div>}<small>Protected by the CENTRAL HVH backend.</small></form></div>;

  return <div className="app">
    <header><div className="brand"><div className="logo">C</div><div>CENTRAL HVH<small>DISCORD BOT CONTROL CENTER</small></div></div><div className="status"><span className={`dot ${data?.bot?.online ? '' : 'off'}`}></span>{data?.bot?.online ? `LOGGED IN AS ${data.bot.username}` : 'CONNECTING…'}<button className="logout" onClick={logout}>LOG OUT</button></div></header>
    <main>
      <section className="hero"><div><h1>Bot Control Center</h1><p>Live Discord telemetry and server administration through the bot.</p></div><div className="badge">● LIVE · REAL BOT DATA</div></section>
      <section className="grid">
        <div className="card"><div className="metric">Bot status</div><div className={`value ${data?.bot?.online ? 'green' : ''}`}>{data?.bot?.online ? 'ONLINE' : 'OFFLINE'}</div><div className="sub">{data?.bot?.username || 'Waiting for Discord'}</div></div>
        <div className="card"><div className="metric">Gateway ping</div><div className="value cyan">{data?.bot?.ping ?? '—'} ms</div><div className="sub">Live Discord latency</div></div>
        <div className="card"><div className="metric">Bot uptime</div><div className="value purple">{fmtUptime(data?.bot?.uptimeMs || 0)}</div><div className="sub">Since Discord login</div></div>
        <div className="card"><div className="metric">Servers</div><div className="value">{guilds.length}</div><div className="sub">Guilds the bot can manage</div></div>
      </section>

      <section className="admin card"><div className="section-title"><div><h2>Server scanner & moderation</h2><p>Select a server to load its live member list.</p></div><span className="pill">BOT CONNECTED</span></div>
        <div className="toolbar"><select value={selectedGuild} onChange={e => scanGuild(e.target.value)}><option value="">Select a Discord server…</option>{guilds.map(g => <option key={g.id} value={g.id}>{g.name} · {g.memberCount} members</option>)}</select><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search username, display name or ID…" disabled={!selectedGuild}/><button onClick={() => scanGuild()} disabled={!selectedGuild || loadingMembers}>{loadingMembers ? 'SCANNING…' : 'SCAN SERVER'}</button></div>
        {error && <div className="alert error">⚠ {error}</div>}
        {message && <div className="alert">✓ {message}</div>}
        <div className="moderation-layout">
          <div className="member-list">{!selectedGuild ? <div className="empty">Choose a server to begin a live member scan.</div> : loadingMembers ? <div className="empty">Fetching members from Discord…</div> : filtered.length === 0 ? <div className="empty">No matching members.</div> : filtered.map(m => <button className={`member ${selectedUser?.id === m.id ? 'selected' : ''}`} key={m.id} onClick={() => setSelectedUser(m)}><img src={m.avatar} /><span><b>{m.displayName}</b><small>@{m.username} · {m.id}</small></span>{m.bot && <em>BOT</em>}</button>)}</div>
          <aside className="action-card"><h3>Ban member</h3>{selectedUser ? <><div className="selected-user"><img src={selectedUser.avatar}/><div><b>{selectedUser.displayName}</b><small>@{selectedUser.username}</small></div></div><label>Reason (optional)<textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason shown in the Discord audit log" maxLength={500}/></label><button className="danger" onClick={banUser} disabled={banning}>{banning ? 'STARTING BAN…' : 'START BAN PROCESS'}</button><p className="warning">This performs a real Discord ban. The bot must have <b>Ban Members</b> permission and a role high enough to ban the selected user.</p></> : <div className="empty">Select a member from the scan to prepare the moderation action.</div>}</aside>
        </div>
      </section>

      <section className="bottom"><div className="card"><h2>Connected servers</h2>{guilds.map(g => <button className="server-row" key={g.id} onClick={() => scanGuild(g.id)}><span>{g.icon ? <img src={g.icon}/> : <b>{g.name.slice(0,2).toUpperCase()}</b>}<span><strong>{g.name}</strong><small>{g.memberCount} members · {g.id}</small></span></span><span className="pill">MANAGE</span></button>)}</div><div className="card"><h2>Runtime</h2><div className="row"><span>Node.js</span><b>{data?.runtime?.node || '—'}</b></div><div className="row"><span>Memory</span><b>{data?.runtime?.heapUsedMb ?? '—'} MB heap</b></div><div className="row"><span>CPU cores</span><b>{data?.runtime?.cpuCount ?? '—'}</b></div><div className="row"><span>Process ID</span><b>{data?.runtime?.pid ?? '—'}</b></div></div></section>
      <footer>CENTRAL HVH · Real Discord control panel · Never expose your bot token in the frontend.</footer>
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App />);
