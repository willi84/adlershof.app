const https = require('https');
const fs = require('fs');

const HERE_API_KEY = process.env.HERE_API_KEY;

const bbox = {
  north: 52.4445,
  south: 52.425,
  west: 13.509,
  east: 13.566
};

function fetchOSMData() {
  const query = `
    [out:json][timeout:25];
    (
      node["shop"](52.425,13.509,52.4445,13.566);
      node["amenity"](52.425,13.509,52.4445,13.566);
    );
    out center;
  `;

  return new Promise((resolve, reject) => {
    const req = https.request('https://overpass-api.de/api/interpreter', { method: 'POST' }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = json.elements
            .filter(e => e.tags?.name)
            .map(e => ({
              name: e.tags.name,
              type: e.tags.shop || e.tags.amenity || '',
              lat: e.lat,
              lon: e.lon,
              source: 'OSM'
            }));
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(`data=${encodeURIComponent(query)}`);
    req.end();
  });
}

function fetchHereData() {
  return new Promise((resolve, reject) => {
    const url = `https://discover.search.hereapi.com/v1/discover?in=bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}&limit=100&apiKey=${HERE_API_KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = json.items || [];
          const results = items.map(item => ({
            name: item.title,
            type: item.categories?.[0]?.name || '',
            lat: item.position.lat,
            lon: item.position.lng,
            source: 'HERE'
          }));
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function reverseGeocode(lat, lon) {
  const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lon}&lang=de-DE&apiKey=${HERE_API_KEY}`;

  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const item = json.items?.[0];
          if (item) {
            const address = item.address;
            resolve({
              address: address.label || '',
              stadtteil: address.district || ''
            });
          } else {
            resolve({ address: '', stadtteil: '' });
          }
        } catch (e) {
          resolve({ address: '', stadtteil: '' });
        }
      });
    }).on('error', () => resolve({ address: '', stadtteil: '' }));
  });
}

async function mergeSources(osm, here) {
  const combined = [];

  for (const poi of [...osm, ...here]) {
    const duplicate = combined.find(existing =>
      poi.name === existing.name &&
      Math.abs(poi.lat - existing.lat) < 0.001 &&
      Math.abs(poi.lon - existing.lon) < 0.001
    );

    if (!duplicate) {
      combined.push({
        name: poi.name,
        type: poi.type,
        lat: poi.lat,
        lon: poi.lon,
        source: poi.source,
        address: '',
        stadtteil: ''
      });
    } else {
      duplicate.source = 'Beide';
    }
  }

  for (let i = 0; i < combined.length; i++) {
    const entry = combined[i];
    const { address, stadtteil } = await reverseGeocode(entry.lat, entry.lon);
    entry.address = address;
    entry.stadtteil = stadtteil;
    console.log(`📍 ${i + 1}/${combined.length}: ${entry.name} → ${stadtteil}`);
    await new Promise(r => setTimeout(r, 300));
  }

  return combined;
}

function writeCSV(data, path = 'adlershof.csv') {
  const header = 'Name,Typ,Adresse,Stadtteil,lat,lon,Quelle\n';
  const rows = data.map(d =>
    `"${d.name.replace(/"/g, '""')}","${d.type.replace(/"/g, '""')}","${d.address.replace(/"/g, '""')}","${d.stadtteil.replace(/"/g, '""')}",${d.lat},${d.lon},${d.source}`
  );
// create folder tmp if not exists
    if (!fs.existsSync('tmp')) {
      fs.mkdirSync('tmp', { recursive: true });
    }

  fs.writeFileSync(path, header + rows.join('\n'), 'utf8');
  console.log(`✅ CSV gespeichert unter ${path}`);
}

async function main() {
  if (!HERE_API_KEY) {
    console.error("❌ Bitte setze die Umgebungsvariable HERE_API_KEY");
    process.exit(1);
  }

  console.log('⬇️ Lade OSM-Daten …');
  const osm = await fetchOSMData();
  console.log(`📦 OSM: ${osm.length} Einträge`);

  console.log('⬇️ Lade HERE-Daten …');
  const here = await fetchHereData();
  console.log(`📦 HERE: ${here.length} Einträge`);

  console.log('🔀 Führe zusammen und ergänze Adressen …');
  const merged = await mergeSources(osm, here);
  console.log(`✅ Gesamt nach Merge: ${merged.length} Einträge`);

  writeCSV(merged);
}

main().catch(err => console.error('❌ Fehler:', err));