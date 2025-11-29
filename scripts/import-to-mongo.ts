
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

// Load env vars
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('MONGODB_URI=')) {
            let val = trimmed.substring(12).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            process.env.MONGODB_URI = val;
        }
    }
} else {
    dotenv.config();
}

if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI environment variable is missing!');
    process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = 'company_explorer';
const COLLECTION_NAME = 'companies';
const DATA_DIR = path.join(process.cwd(), 'public', 'data');

async function importData() {
    console.log('Connecting to MongoDB...');
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    try {
        console.log('Creating indexes...');
        await collection.createIndex({ name: 'text', cin: 'text' });
        await collection.createIndex({ cin: 1 });

        if (!fs.existsSync(DATA_DIR)) {
            console.log('No data directory found.');
            return;
        }

        const files = fs.readdirSync(DATA_DIR).filter(f => !f.endsWith('.bak') && !f.endsWith('.gz') && !f.startsWith('search-index'));
        console.log(`Found ${files.length} files to import.`);

        for (const file of files) {
            console.log(`Importing ${file}...`);
            const filePath = path.join(DATA_DIR, file);

            const rowsToInsert: any[] = [];
            const BATCH_SIZE = 1000;

            if (file.endsWith('.csv')) {
                const fileStream = fs.createReadStream(filePath);
                const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                let isHeader = true;
                let header: string[] = [];
                let nameIdx = -1, cinIdx = -1, stateIdx = -1, statusIdx = -1;

                for await (const line of rl) {
                    const values: string[] = [];
                    let inQuote = false;
                    let currentVal = '';
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        if (char === '"') inQuote = !inQuote;
                        else if (char === ',' && !inQuote) {
                            values.push(currentVal.trim());
                            currentVal = '';
                        } else currentVal += char;
                    }
                    values.push(currentVal.trim());
                    const cleanValues = values.map(v => v.replace(/^"|"$/g, '').trim());

                    if (isHeader) {
                        header = cleanValues;
                        nameIdx = cleanValues.findIndex(h => h.match(/Company.*Name|Name/i));
                        cinIdx = cleanValues.findIndex(h => h.match(/CIN/i));
                        stateIdx = cleanValues.findIndex(h => h.match(/State|CompanyStateCode/i));
                        statusIdx = cleanValues.findIndex(h => h.match(/Status|CompanyStatus/i));
                        isHeader = false;
                        continue;
                    }

                    const name = (nameIdx >= 0 ? cleanValues[nameIdx] : '') || 'Unknown';
                    const cin = (cinIdx >= 0 ? cleanValues[cinIdx] : '') || null;
                    const state = (stateIdx >= 0 ? cleanValues[stateIdx] : '') || null;
                    const status = (statusIdx >= 0 ? cleanValues[statusIdx] : '') || null;

                    if (name !== 'Unknown') {
                        const rawData: any = {};
                        header.forEach((h, i) => rawData[h] = cleanValues[i]);

                        rowsToInsert.push({
                            name,
                            cin,
                            state,
                            status,
                            raw_data: rawData,
                            source_file: file
                        });
                    }

                    if (rowsToInsert.length >= BATCH_SIZE) {
                        await collection.insertMany(rowsToInsert);
                        process.stdout.write('.');
                        rowsToInsert.length = 0;
                    }
                }
            } else {
                // Excel/JSON
                const fileBuffer = fs.readFileSync(filePath);
                const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json<any>(sheet);

                for (const row of data) {
                    const name = row['CompanyName'] || row['Company Name'] || row['Name'] || 'Unknown';
                    const cin = row['CIN'] || null;
                    const state = row['CompanyStateCode'] || row['State'] || null;
                    const status = row['CompanyStatus'] || row['Status'] || null;

                    if (name !== 'Unknown') {
                        rowsToInsert.push({
                            name,
                            cin,
                            state,
                            status,
                            raw_data: row,
                            source_file: file
                        });
                    }

                    if (rowsToInsert.length >= BATCH_SIZE) {
                        await collection.insertMany(rowsToInsert);
                        process.stdout.write('.');
                        rowsToInsert.length = 0;
                    }
                }
            }

            if (rowsToInsert.length > 0) {
                await collection.insertMany(rowsToInsert);
                process.stdout.write('.');
            }
            console.log(' Done.');
        }

        console.log('Import completed successfully!');

    } catch (e) {
        console.error('Import failed:', e);
    } finally {
        await client.close();
    }
}

importData();
