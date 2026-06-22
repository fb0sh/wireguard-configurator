# WireGuard Configurator

A browser-based WireGuard configuration generator built with React + TypeScript + Vite.

All cryptographic operations are performed client-side using [tweetnacl](https://github.com/dchest/tweetnacl-js). No data is sent to any server.

## Features

- **Server configuration** — generate `wg0.conf` with custom interface settings, PostUp/PreDown rules
- **Client configurations** — auto-generate per-client keys and configs, with CIDR auto-increment
- **QR codes** — scan client configs directly with the WireGuard mobile app
- **Real-time updates** — any edit instantly regenerates all configs and QR codes
- **Setup guide** — built-in tutorial for server and client deployment
- **Brand theme** — styled to match the official WireGuard website design

## Screenshots

<img width="1331" height="797" alt="image" src="https://github.com/user-attachments/assets/f23a108e-1a01-4361-be60-6cd29456557c" />

<img width="1321" height="792" alt="image" src="https://github.com/user-attachments/assets/e82eddb6-e45b-419b-9213-fe15e5341c3c" />


## Usage

```bash
npm install
npm run dev      # development server at http://localhost:5173
npm run build    # production build to ./dist
npm run preview  # preview production build
```

## Tech Stack

| Dependency | Purpose |
|---|---|
| React 19 | UI framework |
| TypeScript 6 | Type safety |
| Vite 8 | Build tool / dev server |
| tweetnacl | Key pair generation (Curve25519) |
| qrcode | QR code rendering |

## How it works

1. Fill in the server details (host, port, VPN CIDR, PostUp/PreDown)
2. Set the number of clients — each gets a unique CIDR and key pair
3. Configs and QR codes update instantly as you edit
4. Copy or download individual config files

All keys (`PrivateKey`, `PresharedKey`) are generated in-browser using `tweetnacl`'s `box.keyPair()` and `randomBytes()`.

## License

MIT
