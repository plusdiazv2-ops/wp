import path from 'path';
import { google } from 'googleapis';

const sheets = google.sheets('v4');

async function addRowSheet(auth, spreadsheetId, values) {
    const request = {
        spreadsheetId,
        range: "'barber'!A:E",
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
        console.error(error);
    }
}

const appendToSheet = async (data) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(process.cwd(), 'src/credentials', 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        const spreadsheetId = '1vejgS9KOgo2FDm7sIG8v6SVMM1BFSPABMmwk43RbaVQ';

        console.log('Intentando guardar:', data); // ← agrega esto
        const result = await addRowSheet(authClient, spreadsheetId, data);
        console.log('Resultado:', result); // ← y esto
        return 'Datos agregados correctamente';
    } catch (error) {
        console.error('Error en appendToSheet:', error); // ← más detalle
    }
}

export default appendToSheet;