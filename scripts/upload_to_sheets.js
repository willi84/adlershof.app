const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '../google-credentials.json');
const SPREADSHEET_ID = '1yQknQICmDnF2GntrfqEyVlGUlJPsMnoxwsAObhUP9ho';
const SHEET_NAME = 'final';

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.trim().split(/\r?\n/);
  const rows = lines.map(line => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"')));
  return rows;
}

async function getSheetId(sheets, sheetName) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = data.sheets.find(s => s.properties.title === sheetName);
  return sheet?.properties.sheetId;
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const sheetId = await getSheetId(sheets, SHEET_NAME);
  if (!sheetId) {
    throw new Error(`❌ Sheet '${SHEET_NAME}' nicht gefunden.`);
  }

  const values = parseCSV(path.join('tmp', 'adlershof-pois.csv'));
  const [header, ...rows] = values;

  const { data: existingData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:Z1000`,
  });

  const existingRows = existingData.values || [];
  const existingHeader = existingRows[0] || [];
  const output = [existingHeader];
  const colIndex = key => existingHeader.indexOf(key);

  const existingKeys = new Set(existingRows.slice(1).map(r => `${r[colIndex('Name')]}|${r[colIndex('Latitude')]}|${r[colIndex('Longitude')]}`));

  for (const row of rows) {
    const key = `${row[0]}|${row[4]}|${row[5]}`; // Name|Lat|Lon
    const matchIndex = existingRows.findIndex(r => `${r[colIndex('Name')]}|${r[colIndex('Latitude')]}|${r[colIndex('Longitude')]}` === key);

    if (matchIndex !== -1) {
      // Update existing row
      for (let i = 0; i < header.length; i++) {
        if (existingHeader[i] && header[i] && header[i] !== '' && row[i] !== '') {
          existingRows[matchIndex][i] = row[i];
        }
      }
    } else {
      // Append new row
      output.push(row);
    }
  }

  const final = [existingHeader, ...existingRows.slice(1), ...output.slice(1)];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: final },
  });

  // Formatierung mit dynamisch ermittelter sheetId
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
              }
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: header.length
            }
          }
        }
      ]
    }
  });

  console.log('✅ Google Sheet wurde aktualisiert und formatiert.');
}

main().catch(err => {
  console.error('❌ Fehler beim Upload:', err);
  process.exit(1);
});