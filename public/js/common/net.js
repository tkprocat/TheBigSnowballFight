// Talking to the lobby server: your session, actions (POST /api/<action>) and room updates (GET /events).
export const NET = { ok: false, code: null, token: null, id: null, es: null, view: null };

export function sessGet() { try { const s = JSON.parse(sessionStorage.getItem('sb_session') || 'null'); return s && s.code && s.token ? s : null; } catch { return null; } }
function sessSet(v) { try { sessionStorage.setItem('sb_session', JSON.stringify(v)); } catch {} }
function sessClear() { try { sessionStorage.removeItem('sb_session'); } catch {} }

export async function api(action, body = {}) {
  let res, data;
  try {
    res = await fetch('/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: NET.code, token: NET.token, ...body }) });
    data = await res.json();
  } catch { throw new Error('Could not reach the game server'); }
  if (!data.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// Is the game server here? (Not when the page is opened as a file.)
export async function checkServer() {
  try {
    if (!/^https?:$/.test(location.protocol)) return false;
    const d = await (await fetch('/api/hello')).json();
    NET.ok = !!(d && d.ok && d.game === 'snowball');
  } catch { NET.ok = false; }
  return NET.ok;
}

// Open the room's event stream. `on.view(v)` gets full room views, `on.event(name, data)` the named events,
// and `on.lost()` is called if the room is gone.
export function connect({ code, token, id }, on) {
  if (NET.es) NET.es.close();
  Object.assign(NET, { code, token, id, view: null });
  sessSet({ code, token, id });
  const es = new EventSource('/events?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token));
  NET.es = es;
  es.onmessage = (e) => { try { const v = JSON.parse(e.data); if (v && typeof v === 'object') { NET.view = v; on.view(v); } } catch (err) { console.error(err); } };
  for (const name of ['aim', 'say', 'rt', 'notice']) es.addEventListener(name, (e) => { try { on.event(name, JSON.parse(e.data)); } catch (err) { console.error(err); } });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED && NET.es === es) {
      NET.code = null; sessClear(); es.close(); NET.es = null;
      on.lost();
    }
  };
}

export function leaveOnline() {
  const { code, token } = NET;
  if (NET.es) NET.es.close();
  NET.es = null; NET.code = null; NET.token = null; NET.view = null;
  sessClear();
  if (code && token) fetch('/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, token }) }).catch(() => {});
}
