'use server';

import { Company } from './lib/types';
import { Pool } from 'pg';
import zlib from 'zlib';
import { promisify } from 'util';
const gunzip = promisify(zlib.gunzip);
import { cookies, headers } from 'next/headers';
import { checkRateLimit, isUserLoggedIn, verifyUser } from './lib/auth';
import { redirect } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { SearchIndex } from './lib/types';

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

export async function loginAction(formData: FormData) {
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (await verifyUser(username, password)) {
        const cookieStore = await cookies();
        cookieStore.set('premium_session', 'true', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7 // 1 week
        });
        return { success: true };
    }

    return { success: false, error: 'Invalid credentials' };
}

export async function logoutAction() {
    const cookieStore = await cookies();
    cookieStore.delete('premium_session');
    redirect('/');
}

const INDEX_FILE = path.join(process.cwd(), 'public', 'data', 'search-index.json.gz');
const DATA_DIR = path.join(process.cwd(), 'public', 'data');

async function searchInFileIndex(query: string): Promise<Company[]> {
    console.log('Falling back to file-based search...');
    if (!fs.existsSync(INDEX_FILE)) return [];

    try {
        const buffer = fs.readFileSync(INDEX_FILE);
        const jsonString = (await gunzip(buffer)).toString('utf-8');
        const index: SearchIndex[] = JSON.parse(jsonString);

        const q = query.toLowerCase();
        const matches = index.filter(item => item.n.includes(q) || (item.c && item.c.toLowerCase().includes(q))).slice(0, 50);

        const results: Company[] = [];

        for (const match of matches) {
            try {
                const filePath = path.join(DATA_DIR, match.f);
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(match.l);
                fs.readSync(fd, buffer, 0, match.l, match.b);
                fs.closeSync(fd);

                const line = buffer.toString('utf-8');
                // Simple CSV parse
                const values: string[] = [];
                let inQuote = false;
                let currentVal = '';
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"') inQuote = !inQuote;
                    else if (char === ',' && !inQuote) {
                        values.push(currentVal.trim());
                    }
