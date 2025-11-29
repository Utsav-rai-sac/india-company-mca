'use server';

import { Company } from './lib/types';
import { MongoClient } from 'mongodb';
import { cookies, headers } from 'next/headers';
import { checkRateLimit, isUserLoggedIn, verifyUser } from './lib/auth';
import { redirect } from 'next/navigation';

let client: MongoClient | null = null;

async function getClient() {
    if (!client) {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is missing');
        }
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
    }
    return client;
}

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

export async function searchCompanies(query: string): Promise<{ results: Company[], error?: string, remaining?: number, isPremium?: boolean }> {
    if (!query || query.length < 2) return { results: [] };

    const isLoggedIn = await isUserLoggedIn();
    let remaining = -1;

    if (!isLoggedIn) {
        const headersList = await headers();
        const ip = headersList.get('x-forwarded-for') || '127.0.0.1';

        const limit = await checkRateLimit(ip);
        if (!limit.allowed) {
            return {
                results: [],
                error: 'Free search limit exceeded (10/day). Please login for unlimited access.',
                remaining: 0,
                isPremium: false
            };
        }
        remaining = limit.remaining;
    }

    try {
        const client = await getClient();
        const db = client.db('company_explorer');
        const collection = db.collection('companies');

        // Search using regex for partial match on name or cin
        const results = await collection.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { cin: { $regex: query, $options: 'i' } }
            ]
        })
            .limit(50)
            .toArray();

        const mappedResults: Company[] = results.map(row => ({
            id: row._id.toString(),
            name: row.name,
            state: row.state || '',
            cin: row.cin,
            status: row.status,
            ...row.raw_data
        }));

        return {
            results: mappedResults,
            remaining,
            isPremium: isLoggedIn
        };
    } catch (error) {
        console.error('Database search failed:', error);
        return { results: [] };
    }
}
