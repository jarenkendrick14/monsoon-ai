import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { logger } from './utils/logger.js';

interface AlertClient {
  ws: WebSocket;
  userId: string;
}

interface GovClient {
  ws: WebSocket;
}

const alertClients = new Set<AlertClient>();
const govClients = new Set<GovClient>();

let alertWss: WebSocketServer | null = null;
let govWss: WebSocketServer | null = null;

export function setupWebSocket(server: Server): void {
  alertWss = new WebSocketServer({ noServer: true });
  govWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = req.url ?? '';

    if (url.startsWith('/ws/alerts')) {
      alertWss!.handleUpgrade(req, socket, head, (ws) => {
        alertWss!.emit('connection', ws, req);
      });
    } else if (url.startsWith('/ws/gov')) {
      govWss!.handleUpgrade(req, socket, head, (ws) => {
        govWss!.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  alertWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const userId = params.get('userId') ?? 'unknown';

    const client: AlertClient = { ws, userId };
    alertClients.add(client);
    logger.debug(`WS /ws/alerts connected: userId=${userId}`);

    ws.on('close', () => {
      alertClients.delete(client);
      logger.debug(`WS /ws/alerts disconnected: userId=${userId}`);
    });

    ws.on('error', (err) => logger.debug('WS alert error', err));
  });

  govWss.on('connection', (ws: WebSocket) => {
    const client: GovClient = { ws };
    govClients.add(client);
    logger.debug('WS /ws/gov connected');

    ws.on('close', () => {
      govClients.delete(client);
      logger.debug('WS /ws/gov disconnected');
    });

    ws.on('error', (err) => logger.debug('WS gov error', err));
  });

  logger.info('WebSocket server ready on /ws/alerts and /ws/gov');
}

export function broadcastAlert(userId: string, payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const client of alertClients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

export function broadcastGov(payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const client of govClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}
