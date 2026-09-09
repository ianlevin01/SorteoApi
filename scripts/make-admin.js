import { getUserByDni, updateUserRole } from '../src/repositories/userRepository.js';
import { normalizeDni } from '../src/lib/argentina.js';

const dni = normalizeDni(process.argv[2]);

if (!dni) {
  console.error('Uso: npm run make-admin -- <dni>');
  process.exit(1);
}

const user = await getUserByDni(dni);
if (!user) {
  console.error(`No existe un usuario con DNI ${dni}. Que se registre primero desde la web.`);
  process.exit(1);
}

await updateUserRole(dni, 'admin');
console.log(`Listo: ${dni} (${user.firstName} ${user.lastName}) ahora es admin.`);
