import { UserRecord } from './index.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
    }
  }
}
