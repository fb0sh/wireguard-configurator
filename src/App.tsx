import { useState, useCallback, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  generateKeyPair,
  generatePresharedKey,
} from './wireguard';
import './App.css';

function parseCidr(vpnCidr: string): { network: string; prefix: number } {
  const [net, p] = vpnCidr.split('/');
  return { network: net, prefix: Number(p) };
}

function incrementIp(ip: string, n: number): string {
  const parts = ip.split('.').map(Number);
  let val = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
  val += n;
  return [
    (val >>> 24) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 8) & 0xff,
    val & 0xff,
  ].join('.');
}

function App() {
  const [serverHost, setServerHost] = useState('server-dns-or-ip');
  const [listenPort, setListenPort] = useState(51820);
  const [vpnCidr, setVpnCidr] = useState('10.10.1.0/24');
  const [clientCount, setClientCount] = useState(1);
  const [clientAllowedIPs, setClientAllowedIPs] = useState('0.0.0.0/0, ::/0');
  const [clientDns, setClientDns] = useState('1.1.1.1');
  const [keepalive, setKeepalive] = useState(25);
  const [postUpText, setPostUpText] = useState(
    'iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -I POSTROUTING -o eth0 -j MASQUERADE\nip6tables -A FORWARD -i %i -j ACCEPT; ip6tables -t nat -I POSTROUTING -o eth0 -j MASQUERADE'
  );
  const [preDownText, setPreDownText] = useState(
    'iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE\nip6tables -D FORWARD -i %i -j ACCEPT; ip6tables -t nat -D POSTROUTING -o eth0 -j MASQUERADE'
  );
  const [usePresharedKey, setUsePresharedKey] = useState(false);
  const [showQR, setShowQR] = useState(true);

  const [serverPrivateKey, setServerPrivateKey] = useState('');
  const [serverPublicKey, setServerPublicKey] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [qrDataUrls, setQrDataUrls] = useState<Record<number, string>>({});

  const generateKeys = useCallback(() => {
    const kp = generateKeyPair();
    setServerPrivateKey(kp.privateKey);
    setServerPublicKey(kp.publicKey);
  }, []);

  useEffect(() => {
    if (!serverPrivateKey) generateKeys();
  }, []);

  const serverAddress = useMemo(() => {
    const { network } = parseCidr(vpnCidr);
    return incrementIp(network, 1) + '/32';
  }, [vpnCidr]);

  // Regenerate everything (keys + structure) whenever settings change
  const allClientData = useMemo(() => {
    const { network } = parseCidr(vpnCidr);
    return Array.from({ length: clientCount }, (_, i) => {
      const ckp = generateKeyPair();
      const psk = usePresharedKey ? generatePresharedKey() : '';
      return {
        index: i + 1,
        privateKey: ckp.privateKey,
        publicKey: ckp.publicKey,
        presharedKey: psk,
        address: incrementIp(network, i + 2) + '/32',
        allowedIPs: clientAllowedIPs,
        dns: clientDns,
        keepalive,
        showQR: showQR,
      };
    });
  }, [clientCount, vpnCidr, clientAllowedIPs, clientDns, keepalive, usePresharedKey, showQR]);

  const postUpLines = useMemo(
    () => postUpText.split('\n').filter(Boolean),
    [postUpText]
  );
  const preDownLines = useMemo(
    () => preDownText.split('\n').filter(Boolean),
    [preDownText]
  );

  const serverConfig = useMemo(() => {
    const lines: string[] = [
      '[Interface]',
      `Address = ${serverAddress}`,
      `ListenPort = ${listenPort}`,
      `PrivateKey = ${serverPrivateKey || '(generated)'}`,
    ];
    for (const line of postUpLines) lines.push(`PostUp = ${line}`);
    for (const line of preDownLines) lines.push(`PreDown = ${line}`);
    lines.push('');
    for (const c of allClientData) {
      lines.push(`[Peer]`);
      lines.push(`PublicKey = ${c.publicKey}`);
      if (c.presharedKey) lines.push(`PresharedKey = ${c.presharedKey}`);
      lines.push(`AllowedIPs = ${c.address}`);
      lines.push('');
    }
    return lines.join('\n');
  }, [serverAddress, listenPort, serverPrivateKey, postUpLines, preDownLines, allClientData]);

  const clientConfigs = useMemo(
    () =>
      allClientData.map((c) => {
        const lines: string[] = [
          '[Interface]',
          `PrivateKey = ${c.privateKey}`,
          `Address = ${c.address}`,
        ];
        if (c.dns) lines.push(`DNS = ${c.dns}`);
        lines.push('');
        lines.push('[Peer]');
        lines.push(`PublicKey = ${serverPublicKey || '(generated)'}`);
        lines.push(`Endpoint = ${serverHost || 'server-dns-or-ip'}:${listenPort}`);
        if (c.presharedKey) lines.push(`PresharedKey = ${c.presharedKey}`);
        lines.push(`AllowedIPs = ${c.allowedIPs}`);
        if (c.keepalive > 0) lines.push(`PersistentKeepalive = ${c.keepalive}`);
        lines.push('');
        return lines.join('\n');
      }),
    [allClientData, serverPublicKey, serverHost, listenPort]
  );

  // Generate QR codes
  useEffect(() => {
    if (!showQR) return;
    const generateQRs = async () => {
      const qrs: Record<number, string> = {};
      for (let i = 0; i < allClientData.length; i++) {
        try {
          qrs[i] = await QRCode.toDataURL(clientConfigs[i], {
            width: 240,
            margin: 2,
            color: { dark: '#2c3e50', light: '#ffffff' },
          });
        } catch { /* ignore */ }
      }
      setQrDataUrls(qrs);
    };
    generateQRs();
  }, [clientConfigs, showQR]);

  const copyToClipboard = async (text: string, index?: number) => {
    try {
      await navigator.clipboard.writeText(text);
      if (index !== undefined) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      }
    } catch { /* ignore */ }
  };

  const downloadConfig = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-inner">
          <a className="navbar-brand" href="#">
            <svg viewBox="0 0 773.45 1347.45" className="wg-logo">
              <path fill="currentColor" d="M349.03,774.84c-12.17,6.44-21.54,11.18-30.71,16.29-37.52,20.9-69.6,48.26-95.16,82.77-8.26,11.16-13.94,12.05-26.53,4.36-163.69-100.1-174.21-351.32,4.55-460.68C340.22,332.51,517.86,384.5,584.42,512.42c12.61,24.24,14.22,61.57,6.23,87C563.06,687.23,497.94,736.47,408.55,757.39c26.35-22.56,47.33-48.15,54.01-83.49,6.73-35.61-.39-67.81-21.04-97.07-31.37-44.45-92.03-62.74-142.72-43.49-55.03,20.9-85.18,71.12-79.75,132.86C224.09,723.55,267.61,760.72,349.03,774.84Z"/>
              <path fill="currentColor" d="M0,1061.47c13.15-88.71,117.03-170.41,204.88-161.09-27.21,36.8-39.78,78.42-42.81,119.94-29.19,5.38-56.7,8.99-83.41,15.77C52.36,1042.77,26.88,1052.65,0,1061.47Z"/>
              <path fill="currentColor" d="M651.83,834.47c-7.4-6.4-12.09-6.4-20.78-.84q-44.18,28.27-90.24,53.56c-17.56,9.66-36.58,16.68-58.61,26.52,7.56,1.95,11.2,2.87,14.83,3.83,82.34,21.91,126.33,94.2,106.84,175.16-17.33,72-90.42,118.03-161.25,105.89-59.05-10.12-110.6-59.16-119.21-117.92-9.38-64.03,22.51-125.62,79.25-151.42,31.47-14.31,63.79-26.77,95.19-41.23,35.7-16.44,74.29-29.43,105.46-52.32,77.35-56.8,125.12-135.01,143.75-229.4,11.16-56.54,10.4-112.84-15.47-166.52-19.85-41.2-52.43-71.13-87.43-98.45-36.02-28.11-74.15-53.52-110-81.82-9.7-7.66-16.25-20.87-20.74-32.84-1.9-5.08,4.29-18.84,8.43-19.58,20.98-4.47,43.22-6.23,66.82-6.82,25.82-.97,51.71-.15,77.57.19,5.61.07,13.22-.65,16.44,2.51,13.39,13.17,23.9,4.7,33.19-3.97,7.82-7.29,13.4-16.99,19.62-25.17-3.78-.56-11.52-2.51-19.3-2.69-26-.62-52.04-.22-78.02-1.18-4.63-.17-9.09-4.94-13.63-7.58,4.78-1.9,9.54-5.4,14.33-5.44,44.85-.42,89.7-.25,134.59-.25,.05-23.34-31.14-55.29-58.85-63.95-.21,3.16-.4,6.1-.61,9.23-27.53.65-54.56.14-79.11-12.91-6.47-3.44-10.7-11.09-15.96-16.8-6.63-7.19-12.07-16.43-20.15-21.12-16.57-9.61-34.65-16.58-51.93-25C485.43-3.78,420.57-2.73,350.9,3.65c41.64,9.69,79.25,18.45,116.87,27.2q-.64,3.43-1.28,6.86C416.18,44.46,368.59,26.01,319.38,19.17c18.14,9.72,36.7,19.34,54.56,28.53,19,8.51,38.52,15.71,58.08,23.58C407.18,92.51,382.25,97.16,351.01,90.03c-17.07-3.9-35.13-5.97-52.56-5.12-18.01.88-36.14,5.31-52.49,16.24,17.51,8.88,33.64,16.24,48.86,25.17,6.28,3.68,13.47,9.93,15.22,16.38,4.19,15.44,5.4,31.69,7.82,47.62-28.67,3.25-79.07,32.4-89.26,51.37,44.06,8.48,92.03-1.78,134.06,26.62-13.84,10.48-46.09,23.51-57.91,32.46,14.62,3.83,48.5,1.95,61.75,1.06,11.16-.76,16.31-1.03,20.88,2.73l80.42,66.34c13.64,10.99,68.72,63.13,83.1,95.9,12.24,27.9,13.74,51.64,13.74,57.43,0,22.12-4.08,45.02-12.6,67.02-4.49,11.4-17.66,36.65-44.83,66.08-42.11,45.62-96.27,70.27-155.5,82.49-137.72,28.4-252.15,175.47-219.85,337.61,37.71,189.3,246.65,291.78,417.39,201.74,110.36-58.2,168.87-171.75,153.19-295.36C742.24,944.34,708.46,883.43,651.83,834.47ZM580.28,103.54c4.92-3.76,9.98-6.92,16.08-1.89,3.47,2.86,6.85,5.82,11.05,9.41-5.22,2.76-9.46,5.08-13.78,7.26-6.05,3.05-10.57,1.01-14.23-3.81C576.43,110.6,575.9,106.89,580.28,103.54Z"/>
            </svg>
            WireGuard Configurator
          </a>
        </div>
      </nav>

      <div className="container">
        <div className="page-header" style={{ textAlign: 'center', border: 'none', paddingBottom: 0 }}>
          <h1 style={{ fontSize: 36 }}>WireGuard Configurator</h1>
          <p style={{ fontSize: 16 }}>Generate server and client configurations &mdash; Set up your own VPN</p>
        </div>

        {/* ── FORM ── */}
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-group">
                <label>Server Host</label>
                <input type="text" value={serverHost} onChange={e => setServerHost(e.target.value)} className="input" />
              </div>
              <div className="form-group">
                <label>Server Listen Port</label>
                <input type="number" value={listenPort} onChange={e => setListenPort(Number(e.target.value))} min={1} max={65535} className="input" />
              </div>

              <div className="form-group full-width">
                <label>Number of Clients: {clientCount}</label>
                <input type="range" min={1} max={20} value={clientCount} onChange={e => setClientCount(Number(e.target.value))} style={{ width: '100%', accentColor: '#ae373a' }} />
              </div>

              <div className="form-group">
                <label>VPN CIDR</label>
                <select value={vpnCidr} onChange={e => setVpnCidr(e.target.value)} className="input">
                  <option value="10.10.1.0/24">10.10.1.0/24</option>
                  <option value="10.20.2.0/24">10.20.2.0/24</option>
                  <option value="10.30.3.0/24">10.30.3.0/24</option>
                  <option value="10.40.4.0/24">10.40.4.0/24</option>
                  <option value="172.16.0.0/24">172.16.0.0/24</option>
                  <option value="192.168.100.0/24">192.168.100.0/24</option>
                </select>
              </div>

              <div className="form-group">
                <label>Client Allowed IPs</label>
                <input type="text" value={clientAllowedIPs} onChange={e => setClientAllowedIPs(e.target.value)} className="input" />
              </div>

              <div className="form-group">
                <label>Client DNS <span style={{ fontWeight: 400, textTransform: 'none', color: '#95a5a6' }}>optional</span></label>
                <input type="text" value={clientDns} onChange={e => setClientDns(e.target.value)} className="input" />
              </div>

              <div className="form-group">
                <label>Client Persistent Keepalive secs</label>
                <input type="number" value={keepalive} onChange={e => setKeepalive(Number(e.target.value))} min={0} max={3600} className="input" />
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="form-group full-width">
                <label>PostUp</label>
                <textarea value={postUpText} onChange={e => setPostUpText(e.target.value)} rows={3} className="input" style={{ fontFamily: 'Source Code Pro, monospace', fontSize: 13 }} />
              </div>
              <div className="form-group full-width">
                <label>PreDown</label>
                <textarea value={preDownText} onChange={e => setPreDownText(e.target.value)} rows={3} className="input" style={{ fontFamily: 'Source Code Pro, monospace', fontSize: 13 }} />
              </div>
            </div>

            <div className="form-group full-width" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="checkbox-label" style={{ margin: 0 }}>
                  <input type="checkbox" checked={usePresharedKey} onChange={e => setUsePresharedKey(e.target.checked)} />
                  Preshared Key
                </label>
                <label className="checkbox-label" style={{ margin: 0 }}>
                  <input type="checkbox" checked={showQR} onChange={e => setShowQR(e.target.checked)} />
                  Show QR Code
                </label>
                <button className="btn btn-sm" onClick={generateKeys} title="Regenerate server keys">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                  Regenerate Keys
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── SERVER ── */}
        <div className="panel" style={{ borderColor: '#ae373a' }}>
          <div className="panel-heading" style={{ background: '#ae373a', borderColor: '#ae373a' }}>
            <h3 className="panel-title" style={{ color: '#fff' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>
              Server
            </h3>
          </div>
          <div className="panel-body">
            <div className="btn-group" style={{ marginBottom: 10 }}>
              <button className="btn btn-sm" onClick={() => copyToClipboard(serverConfig)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy
              </button>
              <button className="btn btn-sm" onClick={() => downloadConfig(serverConfig, 'server.conf')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download
              </button>
            </div>
            <pre className="config-block"><code>{serverConfig}</code></pre>
          </div>
        </div>

        {/* ── CLIENTS ── */}
        <div className="panel">
          <div className="panel-heading">
            <h3 className="panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Clients
            </h3>
          </div>
          <div className="panel-body">
            {allClientData.map((c, idx) => (
              <div key={idx} className={`client-card ${idx === copiedIndex ? 'result-card' : ''}`}>
                <div className="client-header">
                  <span className="client-badge">#{c.index}</span>
                  <span className="client-name-display">Client {c.index} &mdash; {c.address}</span>
                  <div className="btn-group">
                    <button className="btn btn-sm" onClick={() => copyToClipboard(clientConfigs[idx], idx)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      {copiedIndex === idx ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="btn btn-sm" onClick={() => downloadConfig(clientConfigs[idx], `client-${c.index}.conf`)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download
                    </button>
                  </div>
                </div>
                <div className="output-layout">
                  <pre className="config-block"><code>{clientConfigs[idx]}</code></pre>
                  {c.showQR && qrDataUrls[idx] && (
                    <div className="qr-sidebar">
                      <img src={qrDataUrls[idx]} alt={`QR for client ${c.index}`} className="qr-code" />
                      <p className="qr-hint">Scan with the WireGuard mobile app</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── SETUP GUIDE ── */}
        <div className="panel">
          <div className="panel-heading">
            <h3 className="panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              Setup Guide
            </h3>
          </div>
          <div className="panel-body">
            <details className="tutorial-details" open>
              <summary>How to set up the WireGuard server</summary>
              <div style={{ padding: 16 }}>
                <ol className="tutorial-steps">
                  <li>
                    <strong>Install WireGuard on your server</strong>
                    <div className="code-block-wrapper">
                      <pre className="tutorial-code"><code>sudo apt update
sudo apt install wireguard iptables -y</code></pre>
                    </div>
                  </li>
                  <li>
                    <strong>Enable IP forwarding</strong>
                    <div className="code-block-wrapper">
                      <pre className="tutorial-code"><code>sudo sysctl -w net.ipv4.ip_forward=1</code></pre>
                    </div>
                  </li>
                  <li>
                    <strong>Save the server config</strong>
                    <p>Copy the server configuration above and save it as <code>/etc/wireguard/server.conf</code></p>
                  </li>
                  <li>
                    <strong>Start WireGuard</strong>
                    <div className="code-block-wrapper">
                      <pre className="tutorial-code"><code>sudo wg-quick up server</code></pre>
                    </div>
                  </li>
                  <li>
                    <strong>Verify</strong>
                    <div className="code-block-wrapper">
                      <pre className="tutorial-code"><code>sudo wg show</code></pre>
                    </div>
                  </li>
                </ol>
              </div>
            </details>

            <details className="tutorial-details">
              <summary>Client Setup</summary>
              <div style={{ padding: 16 }}>
                <p>Import the downloaded <code>.conf</code> file into the WireGuard app on your device, or scan the QR code with the mobile app.</p>
                <ul style={{ paddingLeft: 20 }}>
                  <li><strong>Windows / macOS:</strong> Download from <a href="https://www.wireguard.com/install/" target="_blank" rel="noopener">wireguard.com/install</a></li>
                  <li><strong>Android:</strong> <a href="https://play.google.com/store/apps/details?id=com.wireguard.android" target="_blank" rel="noopener">Google Play</a></li>
                  <li><strong>iOS:</strong> <a href="https://apps.apple.com/app/wireguard/id1441195209" target="_blank" rel="noopener">App Store</a></li>
                  <li><strong>Linux:</strong> <code>sudo apt install wireguard</code></li>
                </ul>
              </div>
            </details>

            <details className="tutorial-details">
              <summary>Notes</summary>
              <div style={{ padding: 16 }}>
                <ul style={{ paddingLeft: 20 }}>
                  <li>Any edit immediately updates all configurations and QR codes.</li>
                  <li>Each line in PostUp (or PreDown) creates a separate PostUp (or PreDown) in the generated server config.</li>
                  <li><code>eth0</code> may not always be the interface name on your host; change it in PostUp/PreDown if needed.</li>
                  <li>To regenerate keys, click the <strong>Regenerate Keys</strong> button.</li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      </div>

      <footer className="footer">
        <p>WireGuard Configurator &mdash; Generated entirely in your browser. No data is sent to any server.</p>
      </footer>
    </div>
  );
}

export default App;
