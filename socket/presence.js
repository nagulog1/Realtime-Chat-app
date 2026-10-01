// Tracks who is online. A user can have several tabs open,
// so we count socket connections per user id.
const connections = new Map(); // userId -> Set(socketId)

function addConnection(userId, socketId) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  const set = connections.get(userId);
  set.add(socketId);
  return set.size === 1; // true = user just came online
}

function removeConnection(userId, socketId) {
  const set = connections.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    connections.delete(userId);
    return true; // true = user just went offline
  }
  return false;
}

function isOnline(userId) {
  return connections.has(userId);
}

function onlineUserIds() {
  return [...connections.keys()];
}

module.exports = { addConnection, removeConnection, isOnline, onlineUserIds };
