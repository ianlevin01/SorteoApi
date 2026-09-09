import { env } from './env.js';

const p = env.dynamo.tablePrefix;

export const TABLES = {
  users: `${p}users`,
  raffles: `${p}raffles`,
  tickets: `${p}tickets`,
  orders: `${p}orders`,
};

export const INDEXES = {
  usersByEmail: 'email-index',
  rafflesByStatus: 'status-index',
  ticketsByOwner: 'owner-index',
  ticketsByCode: 'code-index',
  ordersByBuyer: 'buyer-index',
  ordersByStatus: 'status-index',
};
