
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.xlsx');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const users = [
    ['Username', 'Password'],
    ['admin', 'admin123'],
    ['user', 'user123']
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(users);
XLSX.utils.book_append_sheet(wb, ws, 'Users');

XLSX.writeFile(wb, USERS_FILE);

console.log(`Created users file at ${USERS_FILE}`);
console.log('Default users:');
console.log('- admin / admin123');
console.log('- user / user123');
