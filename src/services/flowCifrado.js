import crypto from 'node:crypto';
import axios from 'axios';
import config from '../config/env.js';

/**
 * CIFRADO DE WHATSAPP FLOWS (el formulario de agendar)
 *
 * Meta exige que el formulario y el bot hablen cifrado:
 *
 *   1. Meta inventa una llave AES para cada pedido, la cifra con NUESTRA
 *      llave pública (RSA) y manda los datos cifrados con esa AES.
 *   2. Nosotros abrimos la AES con la llave privada, leemos el pedido y
 *      respondemos cifrando con la misma AES y el vector "volteado".
 *
 * La llave privada vive SOLO en Railway (FLOW_PRIVATE_KEY). La pública se
 * le registra a Meta al arrancar (registrarLlavePublica). Todo con node:crypto,
 * sin dependencias nuevas.
 *
 * https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

const TAG = 16;   // bytes del sello de AES-GCM, al final de los datos

/** La llave privada desde la variable. Railway a veces guarda los saltos como "\n". */
export function llavePrivada(pem = config.FLOW_PRIVATE_KEY) {
  if (!pem) return null;
  // Se aceptan pegadas con comillas alrededor o con los saltos como "\n".
  const limpio = String(pem).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  // También en UNA línea (base64 del archivo entero): es lo más seguro para
  // pegar en Railway, que a veces daña los textos de varias líneas.
  const desdeBase64 = limpio.includes('-----BEGIN')
    ? null
    : Buffer.from(limpio.replace(/\s+/g, ''), 'base64').toString('utf8');

  const texto = limpio.includes('-----BEGIN')
    ? limpio
    : (desdeBase64?.includes('-----BEGIN') ? desdeBase64 : null);
  if (!texto) {
    console.error('⚠️ FLOW_PRIVATE_KEY no parece una llave: debe empezar con la línea BEGIN PRIVATE KEY del archivo.');
    return null;
  }

  try {
    return crypto.createPrivateKey(texto);
  } catch (error) {
    console.error('⚠️ FLOW_PRIVATE_KEY no es una llave válida:', error.message);
    return null;
  }
}

/** La pública que le corresponde, en el formato que pide Meta. */
export function llavePublicaPem(privada = llavePrivada()) {
  if (!privada) return null;
  return crypto.createPublicKey(privada).export({ type: 'spki', format: 'pem' });
}

/**
 * Abre un pedido de Meta. Lanza error si no se puede: la ruta responde 421,
 * que es como Meta entiende "refresca la llave pública y reintenta".
 */
export function descifrarPedido(cuerpo, privada = llavePrivada()) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = cuerpo || {};
  if (!privada || !encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error('Pedido incompleto o sin llave privada');
  }

  const aes = crypto.privateDecrypt(
    { key: privada, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  const datos = Buffer.from(encrypted_flow_data, 'base64');
  const iv = Buffer.from(initial_vector, 'base64');

  const descifrador = crypto.createDecipheriv('aes-128-gcm', aes, iv);
  descifrador.setAuthTag(datos.subarray(-TAG));

  const texto = Buffer.concat([
    descifrador.update(datos.subarray(0, -TAG)),
    descifrador.final(),
  ]).toString('utf8');

  return { pedido: JSON.parse(texto), aes, iv };
}

/** Cifra la respuesta con la misma AES y el vector con cada bit invertido. */
export function cifrarRespuesta(respuesta, aes, iv) {
  const volteado = Buffer.from(iv.map(byte => ~byte & 0xff));
  const cifrador = crypto.createCipheriv('aes-128-gcm', aes, volteado);

  return Buffer.concat([
    cifrador.update(JSON.stringify(respuesta), 'utf8'),
    cifrador.final(),
    cifrador.getAuthTag(),
  ]).toString('base64');
}

/**
 * Le registra a Meta nuestra llave pública, si no la tiene ya. Corre al
 * arrancar en Railway: así no hace falta el token en ningún computador.
 */
export async function registrarLlavePublica() {
  if (!config.FLOW_PRIVATE_KEY) {
    console.log('🔐 Formulario: sin FLOW_PRIVATE_KEY, no hay llave que registrar (formulario apagado).');
    return;
  }

  const publica = llavePublicaPem();
  if (!publica) {
    console.error('⚠️ Formulario: FLOW_PRIVATE_KEY está puesta pero no es una llave válida. No se registró nada.');
    return;
  }

  const url = `https://graph.facebook.com/${config.API_VERSION}/${config.BUSINESS_PHONE}/whatsapp_business_encryption`;
  const headers = { Authorization: `Bearer ${config.API_TOKEN}` };

  try {
    // Meta la devuelve directo ({ business_public_key, ..._signature_status }),
    // no dentro de una lista. Se aceptan las dos formas por si cambia.
    const respuesta = (await axios.get(url, { headers, timeout: 15000 })).data || {};
    const actual = respuesta.business_public_key ?? respuesta.data?.[0]?.business_public_key;

    if (String(actual || '').trim() === publica.trim()) {
      console.log('🔐 Formulario: Meta ya tiene nuestra llave pública.');
      return;
    }

    await axios.post(url, new URLSearchParams({ business_public_key: publica }), { headers, timeout: 15000 });
    console.log('🔐 Formulario: llave pública registrada en Meta.');
  } catch (error) {
    console.error('⚠️ Formulario: no se pudo registrar la llave pública:',
      error?.response?.data?.error?.message || error?.message);
  }
}
