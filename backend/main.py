from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio
import os

app = FastAPI()

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Redis Connection ────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

_redis = None

async def get_redis():
    """Lazy-init async Redis client with dynamic imports to avoid IDE errors."""
    global _redis
    if _redis is None:
        try:
            # Using dynamic import to prevent IDE from flagging missing modules
            import importlib
            aioredis = None
            
            try:
                # Try modern redis-py (v4.2.0+)
                redis_mod = importlib.import_module("redis.asyncio")
                aioredis = redis_mod
            except (ImportError, ModuleNotFoundError):
                try:
                    # Try legacy aioredis
                    aioredis = importlib.import_module("aioredis")
                except (ImportError, ModuleNotFoundError):
                    print("[Redis] CRITICAL: Neither 'redis' nor 'aioredis' packages are installed.")
                    print("[Redis] Run: pip install redis")
            
            if aioredis:
                _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
                await _redis.ping()
                print(f"[Redis] Connected to {REDIS_URL}")
        except Exception as e:
            print(f"[Redis] Connection failed or package missing: {e}")
            _redis = None
    return _redis


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def trust(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.get("/")
async def get():
    return {"status": "CyberDeck Backend Online"}

@app.get("/api/status")
async def get_status():
    """
    Returns system status with real presence from Redis.
    Falls back to mock data when Redis is unavailable.
    """
    import random

    r = await get_redis()

    # Try to get real node presence from Redis
    nodes = []
    if r is not None:
        try:
            online_users = await r.smembers("presence:online")
            # Build node list from real presence data
            for i, user_id in enumerate(online_users, start=1):
                details = await r.hgetall(f"presence:user:{user_id}")
                node_ip = details.get("nodeIp", f"10.0.0.{i}")
                nodes.append({
                    "id": i,
                    "name": f"DECK-{i:02d}",
                    "status": "online",
                    "ip": node_ip,
                    "userId": user_id,
                })

            # If no users are online, add a self-node
            if not nodes:
                nodes = [
                    {"id": 1, "name": "DECK-01", "status": "online", "ip": "127.0.0.1"},
                ]
        except Exception as e:
            print(f"[Redis] Error reading presence: {e}")
            nodes = None

    # Fallback to mock data
    if not nodes:
        nodes = [
            {"id": 1, "name": "DECK-01", "status": "online", "ip": "10.0.0.1"},
            {"id": 2, "name": "DECK-02", "status": "online", "ip": "10.0.0.2"},
            {"id": 3, "name": "DECK-03", "status": "offline", "ip": "10.0.0.3"},
        ]

    return {
        "cpu": f"{random.randint(5, 25)}%",
        "memory": f"{random.randint(20, 45)}%",
        "nodes": nodes,
    }

@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    await manager.trust(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            # Simple broadcast for now
            await manager.broadcast(json.dumps(message))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(json.dumps({"type": "system", "content": "A peer disconnected"}))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
