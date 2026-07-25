import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.LOAD_TEST_API_URL || "http://localhost:3001").replace(/\/$/, "");
const sizes = (process.env.LOAD_TEST_SIZES || "10,50,100").split(",").map(Number).filter(Boolean);

async function createRoom() {
  const userId = randomUUID();
  const response = await fetch(`${apiUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Load test", userId }),
  });
  if (!response.ok) throw new Error(`Room creation failed (${response.status}).`);
  return { ...(await response.json()), userId };
}

async function run(size) {
  const room = await createRoom();
  const durations = [];
  const connectParticipant = (index, host = false) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = io(apiUrl, { transports: ["websocket"], reconnection: false, forceNew: true });
    const timeout = setTimeout(() => { socket.disconnect(); reject(new Error(`Participant ${index + 1} timed out.`)); }, 20_000);
    socket.on("connect", () => {
      socket.emit("room:join", {
        code: room.code,
        userId: index === 0 ? room.userId : randomUUID(),
        name: `Load listener ${index + 1}`,
        avatar: "🎧",
        ...(host ? { hostToken: room.hostToken } : {}),
      }, (result) => {
        clearTimeout(timeout);
        if (!result?.ok) { socket.disconnect(); reject(new Error(result?.error || "Join rejected.")); return; }
        durations.push(performance.now() - startedAt);
        resolve(socket);
      });
    });
    socket.on("connect_error", reject);
  });
  const host = await connectParticipant(0, true);
  if (size > 50) {
    await new Promise((resolve, reject) => host.emit("room:settings", { maxParticipants: 100 }, (result) => result?.ok ? resolve() : reject(new Error(result?.error || "Could not raise room capacity."))));
  }
  const guests = await Promise.all(Array.from({ length: Math.max(0, size - 1) }, (_, index) => connectParticipant(index + 1)));
  const sockets = [host, ...guests];
  const sorted = durations.sort((a, b) => a - b);
  console.log(JSON.stringify({
    participants: size,
    minMs: Math.round(sorted[0]),
    p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    maxMs: Math.round(sorted.at(-1)),
  }));
  sockets.forEach((socket) => socket.disconnect());
}

for (const size of sizes) await run(size);
