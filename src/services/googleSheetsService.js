import { google } from 'googleapis';
import path from 'path';
import {
  NOMBRES_DIAS,
  esTurnoValido,
  turnoAMinutos,
  turnosPorDefecto,
} from '../config/barbers.js';

const sheets = google.sheets('v4');

/**
 * Se lanza cuando Google Sheets no responde.
 *
 * Existe para poder distinguir "la agenda está vacía" de "no pude leer la
 * agenda". Antes las dos cosas se veían igual —una lista vacía— y el bot
 * terminaba ofreciendo turnos ya vendidos.
 */
export class SheetsUnavailableError extends Error {
  constructor(causa) {
    super(`Google Sheets no respondió: ${causa?.message || causa}`);
    this.name = 'SheetsUnavailableError';
    this.causa = causa;
  }
}

// El cliente de autenticación se creaba de cero en CADA función. Ahora se
// crea una sola vez: la librería de Google renueva el token por dentro.
let clienteAuth = null;

const getAuthClient = async () => {
  if (clienteAuth) return clienteAuth;

  clienteAuth = (async () => {
    try {
      let auth;

      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

        auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      } else {
        auth = new google.auth.GoogleAuth({
          keyFile: path.join(process.cwd(), 'src/credentials', 'credentials.json'),
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      }

      return await auth.getClient();
    } catch (error) {
      // Unas credenciales vencidas o mal puestas dejan al bot igual de ciego
      // que un fallo de lectura. Si esto se tragara, el bot creería que no
      // hay ningún turno ocupado y volvería a ofrecer horarios ya vendidos.
      throw new SheetsUnavailableError(error);
    }
  })();

  // Si falla, no dejar cacheada una promesa rota para siempre.
  clienteAuth.catch(error => {
    console.error('Error cargando credenciales de Google:', error?.message || error);
    clienteAuth = null;
  });

  return clienteAuth;
};

const SPREADSHEET_ID = '1vejgS9KOgo2FDm7sIG8v6SVMM1BFSPABMmwk43RbaVQ';

// ============================================================
// HORARIOS — pestaña `horarios`, con los del código como respaldo
// ============================================================
// Estructura esperada, una fila por barbero y día:
//
//   A: Barbero   B: Día        C: Turnos separados por coma
//   Bolon        Lunes         9am, 9:35am, 10:10am, 1:30pm, ...
//
// Reglas:
// - Pestaña ausente o ilegible → se usan los horarios de config/barbers.js.
//   Esto es a propósito: si esto dependiera solo de la hoja, un error de
//   Sheets dejaría al bot sin horarios para NADIE.
// - Falta la fila de un día → ese día usa el horario del código.
// - Fila presente con la celda vacía → ese día NO trabaja.
//
// Se cachea porque generateNextAvailableDates() llama a getAvailableSlots()
// 7 veces seguidas: sin caché serían 7 lecturas más por cada cliente.
const PESTANA_HORARIOS = 'horarios';
const CACHE_HORARIOS_MS = 5 * 60 * 1000;

let cacheHorarios = { datos: null, momento: 0 };

export const limpiarCacheHorarios = () => {
  cacheHorarios = { datos: null, momento: 0 };
};

const sinTildes = (texto) =>
  String(texto || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

export function interpretarFilasDeHorario(filas) {
  const resultado = {};

  (filas || []).slice(1).forEach((fila, indice) => {
    const barbero = (fila[0] || '').toLowerCase().trim();
    const dia = NOMBRES_DIAS.findIndex(d => sinTildes(d) === sinTildes(fila[1]));

    if (!barbero) return;

    if (dia === -1) {
      console.log(`Fila ${indice + 2} de "${PESTANA_HORARIOS}": día no reconocido → ${fila[1]}`);
      return;
    }

    const turnos = (fila[2] || '')
      .split(',')
      .map(turno => turno.trim().toLowerCase())
      .filter(Boolean);

    const validos = turnos.filter(esTurnoValido);
    const invalidos = turnos.filter(turno => !esTurnoValido(turno));

    if (invalidos.length) {
      console.log(
        `Fila ${indice + 2} de "${PESTANA_HORARIOS}": turnos con formato inválido, se ignoran → ${invalidos.join(', ')}`
      );
    }

    if (!resultado[barbero]) resultado[barbero] = {};
    resultado[barbero][dia] = validos;
  });

  return resultado;
}

async function leerHorariosDeLaHoja() {
  const vigente = cacheHorarios.datos
    && (Date.now() - cacheHorarios.momento) < CACHE_HORARIOS_MS;

  if (vigente) return cacheHorarios.datos;

  let datos = {};

  try {
    const authClient = await getAuthClient();

    const respuesta = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PESTANA_HORARIOS}'!A:C`,
      auth: authClient,
    });

    datos = interpretarFilasDeHorario(respuesta.data.values || []);
  } catch (error) {
    // Que la pestaña no exista NO es un error: es el estado normal hasta que
    // alguien la cree. Se cachea igual el resultado vacío, para no reintentar
    // la lectura en cada llamada.
    console.log(
      `Pestaña "${PESTANA_HORARIOS}" no disponible, se usan los horarios del código:`,
      error?.message || error
    );
  }

  cacheHorarios = { datos, momento: Date.now() };
  return datos;
}

/** Turnos de un barbero en un día: los de la hoja si están, si no los del código. */
export const obtenerTurnos = async (barbero, dia) => {
  const deLaHoja = await leerHorariosDeLaHoja();
  const clave = String(barbero || '').toLowerCase().trim();
  const delDia = deLaHoja[clave]?.[dia];

  if (Array.isArray(delDia)) return delDia;

  return turnosPorDefecto(clave, dia);
};

// GUARDAR FILA
async function addRowSheet(auth, values) {
  const request = {
    spreadsheetId: SPREADSHEET_ID,
    range: "'barber'!A:J",
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [values],
    },
    auth,
  };

  try {
    const response = (await sheets.spreadsheets.values.append(request)).data;
    return response;
  } catch (error) {
    console.error('Error en addRowSheet:', error);
    return null;
  }
}

// FUNCIÓN PRINCIPAL PARA GUARDAR
const appendToSheet = async (data) => {
  try {
    const authClient = await getAuthClient();

    console.log('Intentando guardar:', data);

    const result = await addRowSheet(authClient, data);

    limpiarCacheTurnos();   // la hoja cambio: lo cacheado quedo viejo
    console.log('Guardado correctamente:', result);

    return result;
  } catch (error) {
    console.error('Error en appendToSheet:', error);
    return null;
  }
};

// OBTENER TODAS LAS FILAS
// Caché corta de la hoja de turnos.
//
// Elegir barbero dispara 7 lecturas completas seguidas, una por cada fecha
// que se le ofrece al cliente. Con esto se convierten en una sola.
//
// ⚠️ Las validaciones finales piden datos FRESCOS a propósito. Si leyeran
// del caché, dos clientes podrían tomar el mismo turno dentro de la ventana
// y el caché habría empeorado justo lo que venimos a evitar.
// El caché es solo para MOSTRAR, nunca para decidir.
const CACHE_TURNOS_MS = 20 * 1000;

let cacheTurnos = { filas: null, momento: 0 };

export const limpiarCacheTurnos = () => {
  cacheTurnos = { filas: null, momento: 0 };
};

async function getSheetData(auth, { fresco = false } = {}) {
  const vigente = !fresco
    && cacheTurnos.filas
    && (Date.now() - cacheTurnos.momento) < CACHE_TURNOS_MS;

  if (vigente) return cacheTurnos.filas;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'barber'!A:J",
      auth,
    });

    const filas = response.data.values || [];
    cacheTurnos = { filas, momento: Date.now() };

    return filas;
  } catch (error) {
    console.error('Error leyendo sheet:', error?.message || error);

    // Antes aquí se devolvía []. Eso hacía que el bot concluyera que no hay
    // NINGÚN turno ocupado, y ofreciera horarios ya vendidos. Fallaba en
    // silencio y en la peor dirección. Ahora falla de frente, para que quien
    // llama pueda decirle la verdad al cliente.
    throw new SheetsUnavailableError(error);
  }
}

// VALIDAR DISPONIBILIDAD
export const isSlotAvailable = async (barber, date, time) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient, { fresco: true });

    const exists = rows.some(row => {
      const savedDate = (row[0] || '').toLowerCase().trim();
      const savedTime = (row[2] || '').toLowerCase().trim();
      const savedBarber = (row[5] || '').toLowerCase().trim();
      const savedStatus = (row[6] || '').toLowerCase().trim();

      return (
        savedBarber === barber.toLowerCase().trim() &&
        savedDate === date.toLowerCase().trim() &&
        savedTime === time.toLowerCase().trim() &&
        savedStatus === 'confirmado'
      );
    });

    return !exists;
  } catch (error) {
    console.error('Error validando disponibilidad:', error);
    return false;
  }
};

// OBTENER HORARIOS DISPONIBLES PARA UNA FECHA
export const getAvailableSlots = async (barber, date) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    const currentDate = new Date(`${date}T00:00:00`);
    const day = currentDate.getDay();

    // Fuente unica: config/barbers.js, o la pestana `horarios` si existe.
    const allSlots = await obtenerTurnos(barber, day);

    const occupied = rows
      .slice(1)
      .filter(row => {
        const savedDate = (row[0] || '').toLowerCase().trim();
        const savedBarber = (row[5] || '').toLowerCase().trim();
        const savedStatus = (row[6] || '').toLowerCase().trim();

        return (
          savedDate === date.toLowerCase().trim() &&
          savedBarber === barber.toLowerCase().trim() &&
          savedStatus === 'confirmado'
        );
      })
      .map(row => (row[2] || '').toLowerCase().trim());

    let available = allSlots.filter(slot =>
      !occupied.includes(slot.toLowerCase().trim())
    );

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    const normalizeDate = (value) => {
      const d = new Date(`${value}T00:00:00`);
      if (isNaN(d.getTime())) return value;

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');

      return `${y}-${m}-${dd}`;
    };

    const today = normalizeDate(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    );

    const selectedDate = normalizeDate(date);

    if (selectedDate === today) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      available = available.filter(slot =>
        slotToMinutes(slot) > currentMinutes
      );
    }

    return available;

  } catch (error) {
    if (error instanceof SheetsUnavailableError) throw error;
    console.error('Error obteniendo horarios disponibles:', error);
    return [];
  }
};

// DOBLE VALIDACIÓN DE DISPONIBILIDAD
export const checkAvailability = async (barber, date, time) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient, { fresco: true });

    const ocupado = rows.some(row => {
      const existingDate = (row[0] || '').toLowerCase().trim();
      const existingTime = (row[2] || '').toLowerCase().trim();
      const existingBarber = (row[5] || '').toLowerCase().trim();
      const existingStatus = (row[6] || '').toLowerCase().trim();

      return (
        existingBarber === barber.toLowerCase().trim() &&
        existingDate === date.toLowerCase().trim() &&
        existingTime === time.toLowerCase().trim() &&
        existingStatus === 'confirmado'
      );
    });

    return !ocupado;
  } catch (error) {
    if (error instanceof SheetsUnavailableError) throw error;
    console.error('Error en checkAvailability:', error);
    return false;
  }
};

// OBTENER HORARIOS YA AGENDADOS EN UNA FECHA
export const getBookedSlots = async (barber, date) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    const booked = rows
      .filter(row => {
        const savedDate = (row[0] || '').toLowerCase().trim();
        const savedBarber = (row[5] || '').toLowerCase().trim();
        const savedStatus = (row[6] || '').toLowerCase().trim();

        return (
          savedBarber === barber.toLowerCase().trim() &&
          savedDate === date.toLowerCase().trim() &&
          savedStatus === 'confirmado'
        );
      })
      .map(row => (row[2] || '').toLowerCase().trim());

    return booked;
  } catch (error) {
    console.error('Error en getBookedSlots:', error);
    return [];
  }
};

// Se conserva el nombre porque lo usan varias funciones de este archivo,
// pero el cálculo vive en config/barbers.js para no volver a tenerlo
// duplicado en dos sitios.
const slotToMinutes = (slot) => turnoAMinutos(slot);

export const getDailyScheduleByBarber = async (barber, date) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    const currentDate = new Date(`${date}T00:00:00`);
    const day = currentDate.getDay();

    // Fuente unica: config/barbers.js, o la pestana `horarios` si existe.
    const allSlots = await obtenerTurnos(barber, day);

    const bookedAppointments = rows
      .slice(1)
      .filter(row => {
        const savedDate = (row[0] || '').trim();
        const savedBarber = (row[5] || '').toLowerCase().trim();
        const savedStatus = (row[6] || '').toLowerCase().trim();

        return (
          savedDate === date &&
          savedBarber === barber.toLowerCase().trim() &&
          savedStatus === 'confirmado'
        );
      });

    const schedule = allSlots.map(slot => {
      const appointment = bookedAppointments.find(row => {
        const savedTime = (row[2] || '').toLowerCase().trim();

        return savedTime === slot.toLowerCase().trim();
      });

      if (appointment) {
        return {
          time: slot,
          status: 'ocupado',
          name: appointment[3] || '',
          phone: appointment[4] || ''
        };
      }

      return {
        time: slot,
        status: 'libre',
        name: '',
        phone: ''
      };
    });

    // 🔥 AGREGAR TURNOS HISTÓRICOS
    bookedAppointments.forEach(appointment => {
      const bookedTime = (appointment[2] || '').trim();

      const exists = schedule.some(
        item => item.time.toLowerCase().trim() === bookedTime.toLowerCase().trim()
      );

      if (!exists) {
        schedule.push({
          time: bookedTime,
          status: 'ocupado',
          name: appointment[3] || '',
          phone: appointment[4] || ''
        });
      }
    });

    return schedule.sort(
      (a, b) => slotToMinutes(a.time) - slotToMinutes(b.time)
    );

  } catch (error) {
    if (error instanceof SheetsUnavailableError) throw error;
    console.error('Error obteniendo agenda diaria del barbero:', error);
    return [];
  }
};

export const getUpcomingAppointmentsByPhone = async (phone) => {
    try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    if (!rows || rows.length < 2) return [];

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const appointments = rows
      .slice(1)
      .map((row, index) => ({
        row,
        rowNumber: index + 2
      }))
      .filter(({ row }) => {
        const savedPhone = (row[4] || '').trim();
        const savedStatus = (row[6] || '').toLowerCase().trim();
        const savedDate = (row[0] || '').trim();
        const savedTime = (row[2] || '').trim();

        if (savedPhone !== phone) return false;
        if (savedStatus !== 'confirmado') return false;
        if (!savedDate || !savedTime) return false;

        if (savedDate > currentDate) return true;
        if (savedDate === currentDate && slotToMinutes(savedTime) > currentMinutes) return true;

        return false;
      })
      .sort((a, b) => {
        const dateCompare = a.row[0].localeCompare(b.row[0]);
        if (dateCompare !== 0) return dateCompare;

        return slotToMinutes(a.row[2]) - slotToMinutes(b.row[2]);
      });

    if (appointments.length === 0) return [];

    return appointments.map(appointment => ({
      rowNumber: appointment.rowNumber,
      date: appointment.row[0] || '',
      displayDate: appointment.row[1] || '',
      time: appointment.row[2] || '',
      name: appointment.row[3] || '',
      phone: appointment.row[4] || '',
      barber: appointment.row[5] || '',
      status: appointment.row[6] || '',
      createdAt: appointment.row[7] || '',
    }));
  } catch (error) {
    if (error instanceof SheetsUnavailableError) throw error;
    console.error('Error en getUpcomingAppointmentsByPhone:', error);
    return [];
  }
};

export const updateAppointmentStatus = async (rowNumber, newStatus) => {
  try {
    const authClient = await getAuthClient();

    console.log(`Actualizando fila ${rowNumber} a estado: ${newStatus}`);

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'barber'!G${rowNumber}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[newStatus]],
      },
      auth: authClient,
    });

    limpiarCacheTurnos();   // la hoja cambio: lo cacheado quedo viejo
    console.log('Respuesta update status:', response.data);

    return response.data;
  } catch (error) {
    console.error('Error actualizando estado del turno:', error?.response?.data || error.message || error);
    return null;
  }
};

export const countUserAppointmentsSameDay = async (phone, date) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient, { fresco: true });

    const count = rows.filter(row => {
      const savedPhone = (row[4] || '').trim();
      const savedDate = (row[0] || '').trim();
      const status = (row[6] || '').toLowerCase().trim();

      return (
        savedPhone === phone &&
        savedDate === date &&
        status === 'confirmado'
      );
    }).length;

    return count;
  } catch (error) {
    if (error instanceof SheetsUnavailableError) throw error;
    console.error('Error contando citas del usuario en el mismo día:', error);
    return 0;
  }
};

export const getAppointmentsToRemind = async () => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    if (!rows || rows.length < 2) return [];

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    const appointments = rows
      .slice(1)
      .map((row, index) => ({
        row,
        rowNumber: index + 2
      }))
      .filter(({ row, rowNumber }) => {
        const status = (row[6] || '').toLowerCase().trim();
        const reminderSent = (row[9] || '').toLowerCase().trim();
        const appointmentDateTime = (row[8] || '').trim();

        if (status !== 'confirmado') return false;
        if (reminderSent === 'sí' || reminderSent === 'si') return false;
        if (!appointmentDateTime) return false;

        const [datePart, timePart] = appointmentDateTime.split(' ');
        if (!datePart || !timePart) return false;

        let year, month, day;

        if (datePart.includes('-')) {
          [year, month, day] = datePart.split('-').map(Number);
        } else if (datePart.includes('/')) {
          [day, month, year] = datePart.split('/').map(Number);
        } else {
          console.log(`Fila ${rowNumber} descartada: formato de fecha no válido -> ${appointmentDateTime}`);
          return false;
        }

        const [hour, minute, second] = timePart.split(':').map(Number);

        const appointmentDate = new Date(
          year,
          month - 1,
          day,
          hour,
          minute,
          second || 0
        );

        if (isNaN(appointmentDate.getTime())) {
          console.log(`Fila ${rowNumber} descartada: fecha inválida -> ${appointmentDateTime}`);
          return false;
        }

        const diffMs = appointmentDate.getTime() - now.getTime();
        const diffMinutes = diffMs / (1000 * 60);

        console.log(`Fila ${rowNumber}: ${appointmentDateTime} | faltan ${diffMinutes.toFixed(2)} min`);

        return diffMinutes >= 55 && diffMinutes <= 65;
      })
      .map(({ row, rowNumber }) => ({
        rowNumber,
        date: row[0] || '',
        displayDate: row[1] || '',
        time: row[2] || '',
        name: row[3] || '',
        phone: row[4] || '',
        barber: row[5] || '',
      }));

    return appointments;

  } catch (error) {
    console.error('Error obteniendo citas para recordatorio:', error);
    return [];
  }
};

export const markReminderAsSent = async (rowNumber) => {
  try {
    const authClient = await getAuthClient();

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'barber'!J${rowNumber}`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Sí']],
      },
      auth: authClient,
    });

    return response.data;
  } catch (error) {
    console.error('Error marcando recordatorio como enviado:', error);
    return null;
  }
};

export const getAppointmentsByBarberAndDate = async (barber, date) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    if (!rows || rows.length < 2) return [];

    const appointments = rows
      .slice(1)
      .filter(row => {
        const savedDate = (row[0] || '').trim();
        const savedTime = (row[2] || '').trim();
        const savedName = (row[3] || '').trim();
        const savedPhone = (row[4] || '').trim();
        const savedBarber = (row[5] || '').toLowerCase().trim();
        const savedStatus = (row[6] || '').toLowerCase().trim();

        return (
          savedDate === date &&
          savedBarber === barber.toLowerCase().trim() &&
          savedStatus === 'confirmado' &&
          savedName &&
          savedTime
        );
      })
      .map(row => ({
        date: row[0] || '',
        displayDate: row[1] || '',
        time: row[2] || '',
        name: row[3] || '',
        phone: row[4] || '',
        barber: row[5] || '',
        status: row[6] || '',
      }))
      .sort((a, b) => slotToMinutes(a.time) - slotToMinutes(b.time));

    return appointments;
  } catch (error) {
    console.error('Error obteniendo citas por barbero y fecha:', error);
    return [];
  }
};

export default appendToSheet;