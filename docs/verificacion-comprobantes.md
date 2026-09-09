# Verificación de comprobantes

Cuando un usuario sube el comprobante de la transferencia, el backend lo verifica
automáticamente antes de activar los números.

## Cómo funciona

1. El archivo (imagen o PDF) se sube a S3.
2. Se manda a la API de OpenAI (modelo de visión) que **extrae** los datos del
   comprobante en JSON estricto: monto, moneda, alias/CBU y nombre del destinatario,
   nombre/CUIL del emisor, fecha, nº de operación, banco, y si parece genuino.
3. **El código** (`backend/src/lib/receiptChecks.js`) compara lo extraído contra lo
   esperado:
   - Monto **exacto** al total de la orden.
   - Destinatario = nuestro alias / CBU / titular.
   - Emisor a nombre del usuario (nombre y/o DNI vía CUIL).
   - Fecha ≥ fecha de reserva de los números, y no más vieja que `RECEIPT_CHECK_MAX_AGE_DAYS`.
   - El nº de operación no fue usado en otra compra.
4. Veredicto:
   - **pass** → la orden se aprueba sola, los números se activan al instante.
   - **reject** (problema claro: monto distinto, CUIL de otra persona, destinatario
     equivocado, fecha anterior) → la orden queda "rechazada". El usuario ve el detalle
     y puede subir otro comprobante o **pedir revisión** (pasa a la cola manual).
   - **review** (no se pudo leer algún dato con certeza) → cola de revisión manual.

## Si algo falla

- Sin `OPENAI_API_KEY`, o si la API falla / tarda demasiado, o si se superó el límite
  de intentos (`RECEIPT_CHECK_MAX_ATTEMPTS`): **todo va a revisión manual**. La
  verificación nunca frena una venta.

## Configuración (`backend/.env`)

| Variable | Default | Qué hace |
|---|---|---|
| `OPENAI_API_KEY` | — | Sin esto, todo va a revisión manual. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Para producción, el mejor modelo de visión disponible. |
| `RECEIPT_CHECK_ENABLED` | `true` | Apagar la verificación por completo. |
| `RECEIPT_CHECK_AUTOAPPROVE` | `true` | Si es `false`, un pass no aprueba solo: queda para que un admin confirme. |
| `RECEIPT_CHECK_MIN_CONFIDENCE` | `0.7` | Confianza mínima para aprobar solo. |
| `RECEIPT_CHECK_MAX_ATTEMPTS` | `3` | Comprobantes rechazados antes de forzar revisión manual. |
| `RECEIPT_CHECK_MAX_AGE_DAYS` | `10` | Antigüedad máxima del comprobante. |

## Privacidad

Los comprobantes (con nombres, CUIL, números de cuenta) se envían a OpenAI. Por API,
OpenAI **no** los usa para entrenar. Conviene mencionarlo en los términos.

## Tests

```bash
npm test -w backend    # incluye los tests de receiptChecks
```
