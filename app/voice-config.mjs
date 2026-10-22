// Long-lived Cloudflare credentials stay on the server. Clients receive only
// short-lived TURN credentials, after room authentication and admission.
export function iceProvider(env = process.env, fetcher = fetch) {
  const key = env.TURN_KEY_ID, token = env.TURN_KEY_API_TOKEN;
  if (Boolean(key) !== Boolean(token)) throw new Error('Set both TURN_KEY_ID and TURN_KEY_API_TOKEN, or neither.');
  if (key && !/^[a-fA-F0-9]{32}$/.test(key)) throw new Error('TURN_KEY_ID must be the Cloudflare TURN key ID.');
  return async () => {
    if (!key) return { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], relay: false };
    const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Relay configuration unavailable.');
    const result = await response.json();
    const iceServers = result.iceServers?.map(server => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => typeof url === 'string' && /^(stun|turn|turns):(?:stun|turn)\.cloudflare\.com:(3478|5349|443|80)(\?transport=(udp|tcp))?$/.test(url));
      if (!urls.length) return null;
      return { urls, ...(typeof server.username === 'string' && typeof server.credential === 'string' ? { username: server.username, credential: server.credential } : {}) };
    }).filter(Boolean);
    if (!iceServers?.some(server => server.urls.some(url => /^turns?:/.test(url)) && server.credential)) throw new Error('Relay configuration unavailable.');
    return { iceServers, relay: true };
  };
}
