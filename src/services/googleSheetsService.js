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
        console.error('Error en addRowSheet:', error);
    }
}

const appendToSheet = async (data) => {
    try {
        console.log('GOOGLE_CREDENTIALS_JSON existe:', !!process.env.GOOGLE_CREDENTIALS_JSON);

        const auth = new google.auth.GoogleAuth({
            credentials: process.env.GOOGLE_CREDENTIALS_JSON
                ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
                : undefined,
            keyFile: process.env.GOOGLE_CREDENTIALS_JSON
                ? undefined
                : path.join(process.cwd(), 'src/credentials', 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        const spreadsheetId = '1vejgS9KOgo2FDm7sIG8v6SVMM1BFSPABMmwk43RbaVQ';

        console.log('Intentando guardar:', data);
        const result = await addRowSheet(authClient, spreadsheetId, data);
        console.log('Resultado:', result);

        return 'Datos agregados correctamente';
    } catch (error) {
        console.error('Error en appendToSheet:', error);
    }
}

export default appendToSheet;