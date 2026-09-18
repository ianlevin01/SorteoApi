import { listAllUsers, getUserByDni } from '../repositories/userRepository.js';
import { listOrdersByBuyer } from '../repositories/orderRepository.js';
import { publicUser } from './authService.js';
import { notFound } from '../lib/errors.js';

const MAX_RESULTS = 200;

/** Saca acentos para que buscar "jose" encuentre "José". */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Buscador de clientes para el admin: nombre, DNI, email o WhatsApp, todo en
 * un mismo campo de búsqueda. La tabla de usuarios es chica (comercio local),
 * así que un Scan + filtro en memoria alcanza; no hace falta un índice de
 * texto para esto.
 */
export async function adminSearchUsers(query) {
  const q = normalize(query).trim();
  const all = await listAllUsers();
  const filtered = q
    ? all.filter((u) => normalize(`${u.firstName} ${u.lastName} ${u.dni} ${u.email} ${u.whatsapp}`).includes(q))
    : all;
  return filtered
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, MAX_RESULTS)
    .map(publicUser);
}

/** Perfil completo de un cliente + su historial de pedidos (para el admin). */
export async function adminGetUser(dni) {
  const user = await getUserByDni(dni);
  if (!user) throw notFound('No encontramos ese cliente');

  const orders = (await listOrdersByBuyer(dni)).filter((o) => o.status !== 'failed');

  return {
    user: publicUser(user),
    orders: orders
      .map((o) => ({
        orderId: o.orderId,
        raffleId: o.raffleId,
        raffleTitle: o.raffleTitle,
        status: o.status,
        chances: o.chances,
        amount: o.amount,
        numbers: o.numbers,
        createdAt: o.createdAt,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}
