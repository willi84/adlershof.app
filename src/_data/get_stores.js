const fetch = require("node-fetch");
// import fetch from 'node-fetch';

// https://docs.google.com/spreadsheets/d/1yQknQICmDnF2GntrfqEyVlGUlJPsMnoxwsAObhUP9ho/edit?gid=863575810#gid=863575810

const SHEET_ID = '1yQknQICmDnF2GntrfqEyVlGUlJPsMnoxwsAObhUP9ho';
const GID_TAB_2 = '803355479'; // id of the second tab #gid1234 in sheet url
// const GID_TAB_2 = '1778827723'; // id of the second tab #gid1234 in sheet url

const getData = async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    const jsonText = text.match(/\{.*\}/s)[0];
    return JSON.parse(jsonText);
}

module.exports = async function () {
    const id = GID_TAB_2;
    const base_url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
    const base_data_url = `${base_url}/gviz/tq?tqx=out:json`;
    const data_id = '1389058166';
    const base_edit_url = `${base_url}/edit?gid=${data_id}#gid=${data_id}`;
    const api_names = {}
    const api_url = `${base_data_url}&gid=${id}`;
    const data = await getData(base_data_url);
    const data_api = await getData(api_url);
    console.log(api_url)
    // console.log(data_api.table.rows.length);
    // console.log(data_api.table.rows);
    // console.log(data_api.table.cols.length);
    const originalProperties = [];
    for (let i = 0; i < data_api.table.cols.length; i++) {
        const key = data_api.table.cols[i].label;
        // console.log(`key: ${key}`);
        // if(key.toLowerCase() !== 'table_name'){
            originalProperties.push(key)
        // }
    }
    console.log('labels');
    console.log(originalProperties);
    console.log(data_api.table.rows);
    const labels = [];
    // for (let i = 0; i < originalProperties.length; i++) {
    for (let i = 0; i < data_api.table.rows.length; i++) {
        const item = data_api.table.rows[i].c;
        const origKey = item[0].v;
        const apiKeyItem = item[1];
        const key = apiKeyItem && apiKeyItem.v !== '' ? apiKeyItem.v : origKey;
        const label = item[2].v;
        const showValue = item[3].v;
        const isShown = typeof showValue == 'boolean' ? showValue == false ? false : true : true; // default is true, null is always true
        labels.push({
            origKey: origKey.toLowerCase().trim(),
            key: key.toLowerCase().trim(),
            label: label,
            show: isShown,
            
        });

    }

    for (let i = 0; i < data_api.table.rows.length; i++) {
        const key = data_api.table.rows[i].c[0].v;
        // console.log(`key: ${key}`);
        if(key.toLowerCase() !== 'table_name'){
            const id = key.toLowerCase();

            const newKeyItem = data_api.table.rows[i].c[1];
            const apiKey = newKeyItem && newKeyItem !== '' ? newKeyItem.v : id;
            api_names[id] =apiKey;
            // api_names[id] = data_api.table.rows[i].c[1].v;
        }
    }
    // console.log('api_names');
    // console.log(api_names);
    // console.log('labels');
    // console.log(labels);

    const keysData = [];
    for (let i = 0; i < data.table.rows[0].c.length; i++) {
        const key = data.table.cols[i].label;
        keysData.push(key.toLowerCase());
    }
    // Daten umwandeln
    const items = data.table.rows.map(row => {
        const item = {};
        for (let i = 0; i < row.c.length; i++) {
            const cell = row.c[i];
            const k = keysData[i];
            // if(!cell){
            //     console.log(cell);
            // }
            const value = cell ? cell.v  ? cell.v : '' : '';
            const old_key = keysData[i].toLowerCase();
            const v = typeof value === 'string' ? value.trim() : `${value}`;
            if(old_key?.toLowerCase() !==  v.toLowerCase()){

                // translate keys to tab 2
                const key = api_names[old_key] ? api_names[old_key] : old_key;
                item[key] = value;
            }
        }
        return item;
        // console.log(item); // debug
    }).filter(item => item.name !== undefined); // filter out empty rows
    return {
        source: { data: base_edit_url},
        items,
        labels
    }
};
