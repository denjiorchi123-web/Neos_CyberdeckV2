#!/usr/bin/env python3
"""
cyberdeck_mesh.py (v2.3 - SQLite Persistence & DNS)
Runs on every Pi. Handles beacon broadcast, peer discovery,
IP self-assignment, mesh routing, service discovery, DNS, and local monitoring API.
"""

import socket
import threading
import time
import hmac
import hashlib
import json
import subprocess
import logging
import os
import sys
import random
import uuid
import sqlite3

from collections import deque
from http.server import HTTPServer, BaseHTTPRequestHandler
from logging.handlers import RotatingFileHandler

# ─── CONFIG ───────────────────────────────────────────────────────────────────
_raw_secret = os.getenv("MESH_SECRET", "GHOSTWIRE_ALPHA_7")
SHARED_SECRET  = _raw_secret.encode() if isinstance(_raw_secret, str) else _raw_secret
BEACON_PORT    = int(os.getenv("MESH_BEACON_PORT", 5005))
MESH_PORT      = int(os.getenv("MESH_CONTROL_PORT", 5006))
API_PORT       = int(os.getenv("MESH_API_PORT", 5007))
DNS_PORT       = int(os.getenv("MESH_DNS_PORT", 5353))
IFACE          = os.getenv("MESH_IFACE", "eth0")
SUBNET_BASE    = "192.168.10"
IP_POOL_START  = 10
IP_POOL_END    = 50
PEER_TIMEOUT   = 15
MANUAL_IP      = None

# Dynamic OS-aware pathing for data directory
DATA_DIR = os.getenv("MESH_DATA_DIR", 
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data") if os.name == "nt" 
    else "/var/lib/mesh")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "mesh.db")

try:
    config_path = os.path.join(DATA_DIR, "mesh_config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            cfg = json.load(f)
            if cfg.get("beacon_port"): BEACON_PORT = int(cfg["beacon_port"])
            if cfg.get("control_port"): MESH_PORT = int(cfg["control_port"])
            if cfg.get("api_port"): API_PORT = int(cfg["api_port"])
            if cfg.get("manual_ip"): MANUAL_IP = cfg["manual_ip"]
except Exception:
    pass

log_path = os.path.join(DATA_DIR, "mesh.log")
file_handler = RotatingFileHandler(log_path, maxBytes=1024*1024, backupCount=1)
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logging.basicConfig(level=logging.DEBUG, handlers=[file_handler])
log = logging.getLogger("mesh")

def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    log.error("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

sys.excepthook = handle_exception

# ─── SQLITE DATABASE ─────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS nodes (
            mac TEXT PRIMARY KEY,
            hostname TEXT,
            status TEXT DEFAULT 'online',
            connect_count INTEGER DEFAULT 1,
            last_ip TEXT,
            first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS leases (
            ip TEXT PRIMARY KEY,
            mac TEXT,
            granter_mac TEXT,
            is_static INTEGER DEFAULT 0,
            granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            renewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            released_at TIMESTAMP,
            release_reason TEXT,
            expires_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS dns_names (
            name TEXT PRIMARY KEY,
            mac TEXT,
            ip TEXT,
            name_type TEXT DEFAULT 'auto',
            is_active INTEGER DEFAULT 1,
            ttl INTEGER DEFAULT 60,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mac TEXT,
            service_name TEXT,
            port INTEGER,
            meta TEXT,
            is_active INTEGER DEFAULT 1,
            advertised_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(mac, service_name)
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            event_type TEXT,
            mac TEXT,
            details TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT,
            ip_used TEXT,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            left_at TIMESTAMP,
            duration_s INTEGER,
            leave_type TEXT
        );
    ''')
    conn.commit()
    conn.close()

init_db()

# ─── SHARED STATE ─────────────────────────────────────────────────────────────
peers      = {}          # mac -> {ip, last_seen, hostname, joined_at}
peers_lock = threading.Lock()
my_ip      = None
my_mac     = None
my_hostname = socket.gethostname()

last_request_time = 0.0  # Used to prevent IP request spam

# services: name -> {mac -> {ip, port, meta, last_seen}}
local_services = {}
network_services = {}
services_lock = threading.Lock()

# State machine variables
mesh_state = "SEARCHING"  # SEARCHING | LISTENING | PAIRED | FULL_MESH
state_lock = threading.Lock()

def set_state(new_state):
    global mesh_state
    with state_lock:
        if mesh_state != new_state:
            log.info(f"State transition: {mesh_state} -> {new_state}")
            mesh_state = new_state

# ─── HMAC BEACON ──────────────────────────────────────────────────────────────
def make_beacon(mac: str, hostname: str, ip: str | None, b_type: str = "HELLO", extra: dict = None) -> bytes:
    payload = {
        "mac":      mac,
        "hostname": hostname,
        "ip":       ip,
        "ts":       int(time.time()),
        "type":     b_type
    }
    if extra:
        payload.update(extra)
    payload_str = json.dumps(payload).encode()
    sig = hmac.new(SHARED_SECRET, payload_str, hashlib.sha256).hexdigest()
    return json.dumps({"payload": payload_str.decode(), "sig": sig}).encode()

def verify_beacon(raw: bytes) -> dict | None:
    try:
        outer = json.loads(raw)
        payload_bytes = outer["payload"].encode()
        expected = hmac.new(SHARED_SECRET, payload_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, outer["sig"]):
            log.warning("Beacon HMAC mismatch — rejected")
            return None
        data = json.loads(outer["payload"])
        if abs(time.time() - data["ts"]) > 30:
            log.warning("Beacon replay detected — rejected")
            return None
        return data
    except Exception:
        return None

# ─── MAC / IP UTILITIES ───────────────────────────────────────────────────────
def get_mac(iface: str) -> str:
    try:
        if os.name != 'nt':
            path = f"/sys/class/net/{iface}/address"
            if os.path.exists(path):
                with open(path) as f:
                    return f.read().strip().replace(":", "")
        mac_num = uuid.getnode()
        mac_hex = ''.join(['{:02x}'.format((mac_num >> elements) & 0xff) for elements in range(0,8*6,8)][::-1])
        return mac_hex
    except Exception:
        return f"mock_{random.randint(1000, 9999)}"

def set_ip(iface: str, ip: str):
    log.info(f"Setting IP {ip}/24 on {iface}")
    if os.name == 'nt':
        return 
    subprocess.run(["ip", "addr", "flush", "dev", iface], check=False)
    subprocess.run(["ip", "addr", "add", f"{ip}/24", "dev", iface], check=False)
    subprocess.run(["ip", "link", "set", iface, "up"], check=False)

def next_free_ip() -> str | None:
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT ip FROM leases WHERE released_at IS NULL")
    active_ips = {row[0] for row in c.fetchall()}
    conn.close()
    
    if my_ip:
        active_ips.add(my_ip)
        
    for n in range(IP_POOL_START, IP_POOL_END + 1):
        candidate = f"{SUBNET_BASE}.{n}"
        if candidate not in active_ips:
            return candidate
    return None

# ─── BEACON BROADCASTER ───────────────────────────────────────────────────────
def beacon_loop():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    except: pass
    try: sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except: pass
    
    while True:
        with state_lock:
            current = mesh_state

        interval = 5
        b_type = "HELLO"
        do_send = True

        if current == "SEARCHING":
            interval = 5
        elif current == "LISTENING":
            interval = 5
            do_send = False # Silent mode, wait for auth
        elif current == "PAIRED":
            interval = 15 # Quiet heartbeat
        elif current == "FULL_MESH":
            interval = 60 # Very quiet
            b_type = "RENEW"

        if do_send:
            try:
                msg = make_beacon(my_mac, my_hostname, my_ip, b_type=b_type)
                sock.sendto(msg, ("<broadcast>", BEACON_PORT))
                log.debug(f"Broadcast {b_type} beacon (State: {current})")
                
                # Advertise local services
                with services_lock:
                    for name, s in local_services.items():
                        s_msg = make_beacon(my_mac, my_hostname, my_ip, b_type="SERVICE_ADVERTISE", extra={
                            "service": name,
                            "port": s["port"],
                            "meta": s.get("meta", {})
                        })
                        sock.sendto(s_msg, ("<broadcast>", BEACON_PORT))
            except Exception as e:
                log.error(f"Beacon send error: {e}")
        
        time.sleep(interval)

# ─── BEACON LISTENER ──────────────────────────────────────────────────────────
def listen_loop():
    global my_ip, last_request_time
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except: pass
    try: sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    except: pass
    sock.bind(("", BEACON_PORT))

    while True:
        try:
            raw, addr = sock.recvfrom(4096)
            data = verify_beacon(raw)
            if not data:
                continue

            mac      = data["mac"]
            hostname = data["hostname"]
            peer_ip  = data["ip"]
            b_type   = data.get("type", "HELLO")

            if mac == my_mac:
                continue

            log.debug(f"Received {b_type} beacon from {hostname} ({mac})")
            now = time.time()
            
            with state_lock:
                current_state = mesh_state

            conn = get_db()
            c = conn.cursor()

            with peers_lock:
                known = mac in peers
                if not known:
                    peers[mac] = {"ip": peer_ip, "hostname": hostname, "joined_at": now}
                    log.info(f"New peer: {hostname} ({mac}) at {peer_ip}")
                    
                    # Log JOIN event and register node
                    c.execute('''
                        INSERT INTO nodes (mac, hostname, last_ip, connect_count)
                        VALUES (?, ?, ?, 1)
                        ON CONFLICT(mac) DO UPDATE SET 
                            status='online', 
                            last_seen=CURRENT_TIMESTAMP, 
                            last_ip=?,
                            connect_count=connect_count+1
                    ''', (mac, hostname, peer_ip, peer_ip))
                    
                    c.execute("INSERT INTO events (event_type, mac) VALUES ('JOIN', ?)", (mac,))
                    
                    if peer_ip:
                        c.execute('''
                            INSERT INTO dns_names (name, mac, ip, name_type)
                            VALUES (?, ?, ?, 'auto')
                            ON CONFLICT(name) DO UPDATE SET ip=?, is_active=1, updated_at=CURRENT_TIMESTAMP
                        ''', (f"{hostname}.mesh", mac, peer_ip, peer_ip))
                        
                    conn.commit()

                peers[mac]["last_seen"] = now
                peers[mac]["ip"] = peer_ip
                peer_count = len(peers)
                
                # Update RENEW
                if b_type == "RENEW" and peer_ip:
                    c.execute("UPDATE leases SET renewed_at=CURRENT_TIMESTAMP, expires_at=datetime('now', '+1 hour') WHERE mac=?", (mac,))
                    conn.commit()

            # State Machine Transitions
            if current_state == "SEARCHING" and not known and b_type == "HELLO":
                set_state("LISTENING")
            
            if known:
                if peer_count >= 2:
                    set_state("FULL_MESH")
                elif peer_count >= 1:
                    set_state("PAIRED")

            # Targeted Reply
            if b_type == "HELLO" and current_state in ("LISTENING", "PAIRED", "FULL_MESH") and peer_ip:
                try:
                    reply_msg = make_beacon(my_mac, my_hostname, my_ip, b_type="REPLY")
                    unicast_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    unicast_sock.sendto(reply_msg, (peer_ip, BEACON_PORT))
                    unicast_sock.close()
                except: pass

            # Service Handlers
            if b_type == "SERVICE_ADVERTISE":
                s_name = data.get("service")
                if s_name:
                    with services_lock:
                        if s_name not in network_services:
                            network_services[s_name] = {}
                        network_services[s_name][mac] = {
                            "ip": peer_ip,
                            "port": data.get("port"),
                            "meta": data.get("meta", {}),
                            "last_seen": now
                        }
                    meta_str = json.dumps(data.get("meta", {}))
                    c.execute('''
                        INSERT INTO services (mac, service_name, port, meta, is_active)
                        VALUES (?, ?, ?, ?, 1)
                        ON CONFLICT(mac, service_name) DO UPDATE SET port=?, meta=?, is_active=1, advertised_at=CURRENT_TIMESTAMP
                    ''', (mac, s_name, data.get("port"), meta_str, data.get("port"), meta_str))
                    conn.commit()

            # IP Request Logic
            if my_ip is None and peer_ip:
                with peers_lock:
                    if now - last_request_time > 8.0:
                        last_request_time = now
                        threading.Thread(target=request_ip_from, args=(peer_ip,), daemon=True).start()
            
            conn.close()
        except Exception as e:
            pass

# ─── IP REQUEST ───────────────────────────────────────────────────────
def request_ip_from(peer_ip: str):
    global my_ip
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((peer_ip, MESH_PORT))
        req = json.dumps({"type": "ip_request", "mac": my_mac, "hostname": my_hostname}).encode()
        sock.sendall(req + b"\n")
        resp = json.loads(sock.recv(1024).decode().strip())
        sock.close()

        if resp.get("type") == "ip_grant" and resp.get("ip"):
            assigned = resp["ip"]
            log.info(f"IP granted: {assigned}")
            set_ip(IFACE, assigned)
            my_ip = assigned
    except Exception as e:
        log.error(f"IP request to {peer_ip} failed: {e}")
        db = get_db()
        db.execute("INSERT INTO events (event_type, mac, details) VALUES ('AUTH_FAIL', ?, ?)", (my_mac, f"Failed to get IP from {peer_ip}"))
        db.commit()
        db.close()

# ─── MESH CONTROL SERVER ─────────────────────────────────────────────────
def control_server():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try: srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except: pass
    srv.bind(("", MESH_PORT))
    srv.listen(10)
    log.info(f"Control server listening on :{MESH_PORT}")

    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle_control, args=(conn, addr), daemon=True).start()

def handle_control(conn_sock, addr):
    try:
        data = json.loads(conn_sock.recv(1024).decode().strip())
        if data.get("type") == "ip_request":
            req_mac  = data["mac"]
            req_host = data["hostname"]
            new_ip = next_free_ip()
            if new_ip:
                with peers_lock:
                    peers[req_mac] = {"ip": new_ip, "hostname": req_host, "last_seen": time.time(), "joined_at": time.time()}
                
                db = get_db()
                db.execute('''
                    INSERT INTO leases (ip, mac, granter_mac, expires_at) 
                    VALUES (?, ?, ?, datetime('now', '+1 hour'))
                ''', (new_ip, req_mac, my_mac))
                db.execute("INSERT INTO events (event_type, mac, details) VALUES ('IP_GRANT', ?, ?)", (req_mac, f"Granted {new_ip}"))
                db.commit()
                db.close()
                
                resp = {"type": "ip_grant", "ip": new_ip}
            else:
                resp = {"type": "ip_deny", "reason": "pool_exhausted"}
            conn_sock.sendall(json.dumps(resp).encode() + b"\n")
    except Exception as e:
        pass
    finally:
        conn_sock.close()

# ─── DEAD PEER REAPER ─────────────────────────────────────────────────────────
def reaper_loop():
    while True:
        time.sleep(5)
        now = time.time()
        
        db = get_db()
        
        with peers_lock:
            dead = [mac for mac, v in peers.items() if now - v["last_seen"] > PEER_TIMEOUT]
            for mac in dead:
                log.info(f"Peer timed out: {peers[mac]['hostname']} ({mac})")
                del peers[mac]
                
                db.execute("UPDATE leases SET released_at=CURRENT_TIMESTAMP, release_reason='timeout' WHERE mac=? AND released_at IS NULL", (mac,))
                db.execute("UPDATE nodes SET status='offline' WHERE mac=?", (mac,))
                db.execute("UPDATE dns_names SET is_active=0 WHERE mac=?", (mac,))
                db.execute("UPDATE services SET is_active=0 WHERE mac=?", (mac,))
                db.execute("INSERT INTO events (event_type, mac) VALUES ('TIMEOUT', ?)", (mac,))
                
            if len(peers) == 0:
                set_state("SEARCHING")
                
        with services_lock:
            for s_name in list(network_services.keys()):
                dead_prov = [m for m, v in network_services[s_name].items() if now - v["last_seen"] > PEER_TIMEOUT]
                for m in dead_prov:
                    del network_services[s_name][m]
                if not network_services[s_name]:
                    del network_services[s_name]
                    
        db.commit()
        db.close()

# ─── DNS SERVER (PORT 5353) ──────────────────────────────────────────────────
def build_dns_response(data, ip_str=None):
    tx_id = data[:2]
    flags = b'\x81\x80' if ip_str else b'\x81\x83' # 8180=OK, 8183=NXDOMAIN
    questions = data[4:6]
    answers = b'\x00\x01' if ip_str else b'\x00\x00'
    header = tx_id + flags + questions + answers + b'\x00\x00\x00\x00'
    
    idx = 12
    while data[idx] != 0:
        idx += data[idx] + 1
    idx += 5
    question = data[12:idx]
    
    response = header + question
    if ip_str:
        ip_bytes = bytes(map(int, ip_str.split('.')))
        answer = b'\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04' + ip_bytes
        response += answer
    return response

def dns_server():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except: pass
    sock.bind(('0.0.0.0', DNS_PORT))
    log.info(f"DNS Server listening on UDP :{DNS_PORT}")
    
    # Rate limit tracking (token bucket approach per IP)
    query_counts = {}
    
    while True:
        try:
            data, addr = sock.recvfrom(512)
            if len(data) < 12: continue
            
            # Simple rate limit (max 10 queries per second per IP)
            now = int(time.time())
            client_ip = addr[0]
            if client_ip not in query_counts or query_counts[client_ip][0] != now:
                query_counts[client_ip] = [now, 1]
            else:
                query_counts[client_ip][1] += 1
                if query_counts[client_ip][1] > 20:
                    continue # Drop packet
            
            # Subnet check (192.168.10.x only)
            if not client_ip.startswith("192.168.10.") and client_ip != "127.0.0.1":
                continue
            
            idx = 12
            qname_parts = []
            while True:
                length = data[idx]
                if length == 0:
                    break
                idx += 1
                qname_parts.append(data[idx:idx+length].decode(errors='ignore'))
                idx += length
            
            domain = ".".join(qname_parts).lower()
            
            ip_answer = None
            if domain.endswith(".mesh"):
                db = get_db()
                c = db.cursor()
                c.execute("SELECT ip FROM dns_names WHERE name = ? AND is_active = 1", (domain,))
                row = c.fetchone()
                db.close()
                
                if row and row[0]:
                    ip_answer = row[0]
            
            res = build_dns_response(data, ip_answer)
            sock.sendto(res, addr)
        except Exception as e:
            pass

# ─── API SERVER (PORT 5007) ─────────────────────────────────────────────────
class DiagnosticHandler(BaseHTTPRequestHandler):
    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_cors()
        self.end_headers()

        now = time.time()
        if self.path == '/peers':
            with peers_lock:
                out = {my_mac: {"ip": my_ip, "hostname": my_hostname, "last_seen": now, "joined_at": now}}
                for k, v in peers.items():
                    out[k] = dict(v)
                self.wfile.write(json.dumps(out).encode())
                
        elif self.path == '/services':
            with services_lock:
                out = {}
                for name, provs in network_services.items():
                    out[name] = [v for k, v in provs.items()]
                for name, s in local_services.items():
                    if name not in out:
                        out[name] = []
                    out[name].append({"ip": my_ip, "port": s["port"], "meta": s.get("meta", {}), "last_seen": now})
                self.wfile.write(json.dumps(out).encode())
                
        elif self.path == '/health':
            self.wfile.write(json.dumps({
                "ip": my_ip,
                "mac": my_mac,
                "hostname": my_hostname,
                "state": mesh_state,
                "timestamp": now
            }).encode())
        elif self.path == '/restart':
            self.wfile.write(json.dumps({"status": "restarting"}).encode())
            threading.Timer(0.5, lambda: os._exit(0)).start()
        else:
            self.wfile.write(b'{}')
            
    def do_POST(self):
        if self.path == '/register_service':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                try:
                    body = self.rfile.read(content_length)
                    req_data = json.loads(body.decode())
                    s_name = req_data.get("service")
                    s_port = req_data.get("port")
                    if s_name and s_port:
                        with services_lock:
                            local_services[s_name] = {"port": int(s_port), "meta": req_data.get("meta", {})}
                        
                        db = get_db()
                        db.execute('''
                            INSERT INTO services (mac, service_name, port, meta, is_active)
                            VALUES (?, ?, ?, ?, 1)
                            ON CONFLICT(mac, service_name) DO UPDATE SET port=?, meta=?, is_active=1, advertised_at=CURRENT_TIMESTAMP
                        ''', (my_mac, s_name, s_port, json.dumps(req_data.get("meta", {})), s_port, json.dumps(req_data.get("meta", {}))))
                        db.commit()
                        db.close()

                        log.info(f"Registered local service: {s_name} on port {s_port}")
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_cors()
                        self.end_headers()
                        self.wfile.write(json.dumps({"status": "registered", "service": s_name}).encode())
                        return
                except Exception as e:
                    pass
                    
        self.send_response(400)
        self.send_header('Content-Type', 'application/json')
        self.send_cors()
        self.end_headers()
        self.wfile.write(json.dumps({"error": "invalid payload"}).encode())

    def log_message(self, format, *args):
        pass # Silence standard HTTP logs

def api_server():
    api_server = HTTPServer(('0.0.0.0', API_PORT), DiagnosticHandler)
    log.info(f"API Server listening on :{API_PORT}")
    api_server.serve_forever()

# ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
def bootstrap():
    global my_ip, my_mac

    my_mac = get_mac(IFACE)
    log.info(f"Starting mesh node | MAC: {my_mac} | Host: {my_hostname}")

    time.sleep(random.uniform(0, 2.0))

    if MANUAL_IP:
        candidate = MANUAL_IP
        log.info(f"Using MANUAL IP assigned via UI: {candidate}")
    else:
        seed = int(my_mac[-2:], 16) % (IP_POOL_END - IP_POOL_START) + IP_POOL_START
        candidate = f"{SUBNET_BASE}.{seed}"
        log.info(f"Bootstrap Auto IP: {candidate}")

    set_ip(IFACE, candidate)
    my_ip = candidate

# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    bootstrap()

    threads = [
        threading.Thread(target=beacon_loop,    daemon=True),
        threading.Thread(target=listen_loop,    daemon=True),
        threading.Thread(target=control_server, daemon=True),
        threading.Thread(target=reaper_loop,    daemon=True),
        threading.Thread(target=api_server,     daemon=True),
        threading.Thread(target=dns_server,     daemon=True),
    ]
    for t in threads:
        t.start()

    log.info("Mesh node running. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down.")
