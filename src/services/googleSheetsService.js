import { google } from 'googleapis';
import path from 'path';

const sheets = google.sheets('v4');

const getAuthClient = async () => {
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
    console.error('Error cargando credenciales de Google:', error);
    throw error;
  }
};

const SPREADSHEET_ID = '1vejgS9KOgo2FDm7sIG8v6SVMM1BFSPABMmwk43RbaVQ';

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

    console.log('Guardado correctamente:', result);

    return result;
  } catch (error) {
    console.error('Error en appendToSheet:', error);
    return null;
  }
};

// OBTENER TODAS LAS FILAS
async function getSheetData(auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'barber'!A:J",
      auth,
    });

    return response.data.values || [];
  } catch (error) {
    console.error('Error leyendo sheet:', error);
    return [];
  }
}

// VALIDAR DISPONIBILIDAD
export const isSlotAvailable = async (barber, date, time) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

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

    let allSlots = [];

    if (barber.toLowerCase().trim() === 'bolon') {
      allSlots = [
        "9am", "9:35am", "10:10am", "10:45am", "11:20am", "11:55am",
        "1:30pm", "2:05pm", "2:40pm", "3:15pm", "3:50pm", "4:25pm"
      ];
    } else if (barber.toLowerCase().trim() === 'julian') {
      allSlots = [
        "10am", "10:40am", "11:20am", "12pm", "12:40pm",
        "2:20pm", "3pm", "3:40pm", "4:20pm", "5pm"
      ];
    }

    const occupied = rows
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

    let available = allSlots.filter(slot => !occupied.includes(slot));

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;

    if (date === today) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const slotToMinutes = (slot) => {
        const match = slot.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
        if (!match) return -1;

        let hour = parseInt(match[1], 10);
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        const period = match[3];

        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;

        return hour * 60 + minutes;
      };

      available = available.filter(slot => slotToMinutes(slot) > currentMinutes);
    }

    return available;
  } catch (error) {
    console.error('Error obteniendo horarios disponibles:', error);
    return [];
  }
};

// DOBLE VALIDACIÓN DE DISPONIBILIDAD
export const checkAvailability = async (barber, date, time) => {
  try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

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

const slotToMinutes = (slot) => {
  const match = (slot || '').toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (!match) return -1;

  let hour = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3];

  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;

  return hour * 60 + minutes;
};

export const getUpcomingAppointmentsByPhone = async (phone) => {
    try {
    const authClient = await getAuthClient();
    const rows = await getSheetData(authClient);

    if (!rows || rows.length < 2) return null;

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
    const rows = await getSheetData(authClient);

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

export default appendToSheet;