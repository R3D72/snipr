import http from 'http';
import http2 from 'http2';
import https from 'https';
import tls from 'tls';
import WebSocket from 'ws';

// قراءة بيانات الاعتماد بأمان من بيئة الاستضافة (Environment Variables)
const TOKEN = process.env.DISCORD_TOKEN;
const PASSWORD = process.env.DISCORD_PASSWORD;

// قائمة السيرفرات اللي تبي الحساب يراقبها
const TARGET_SERVERS = [
    '1362759838622417228'
    // 'أيدي_سيرفر_ثاني_هنا',
];

const TARGET_CODE = '467';
const MY_SERVER = '1362759838622417228'; // سيرفرك اللي بينسحب له الرابط
const API_HOST = 'canary.discord.com';
const API_IP = '162.159.135.232';
const REQ = 4;
const REFRESH_INTERVAL = 240_000;
const RETRY_INTERVAL = 5_000;

let h2;
let h2Session;
let mfaToken = '';

// إنشاء سيرفر وهمي (بورت وهمي) لضمان استقرار الاستضافة ومنع إغلاق السكريبت
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Lightning Sniper is active and running!\n');
}).listen(PORT, () => {
    console.log(`\x1b[36m[PORT ACTIVE]\x1b[0m السيرفر الوهمي يعمل بنجاح على البورت: \x1b[33m${PORT}\x1b[0m`);
});

const MFA_HEADERS = {
    'User-Agent': 'Chrome/124',
    'X-Super-Properties': 'eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0fQ==',
    'X-Discord-Timezone': 'Europe/Istanbul',
    'X-Discord-Locale': 'en-US',
    'X-Debug-Options': 'bugReporterEnabled',
    'Content-Type': 'application/json',
};

const httpRequest = (method, path, body) => new Promise((resolve, reject) => {
    const req = https.request({
        hostname: API_HOST,
        path,
        method,
        headers: {
            ...MFA_HEADERS,
            'Authorization': TOKEN,
            'Content-Length': Buffer.byteLength(body).toString(),
        },
        rejectUnauthorized: false,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
    }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
});

const refreshMfa = async () => {
    try {
        const ticketRes = await httpRequest('PATCH', '/api/v7/guilds/0/vanity-url', JSON.stringify({ code: 'xherz' }));
        if (ticketRes.status !== 401) return false;
        const ticket = JSON.parse(ticketRes.body)?.mfa?.ticket;
        if (!ticket) return false;
        const mfaRes = await httpRequest('POST', '/api/v7/mfa/finish', JSON.stringify({ ticket, mfa_type: 'password', data: PASSWORD }));
        if (mfaRes.status === 200) {
            const token = JSON.parse(mfaRes.body)?.token;
            if (token) {
                mfaToken = token;
                return true;
            }
        }
        return false;
    } catch (err) {
        return false;
    }
};

const startMfaLoop = async () => {
    while (true) {
        const ok = await refreshMfa();
        await new Promise(r => setTimeout(r, ok ? REFRESH_INTERVAL : RETRY_INTERVAL));
    }
};

const BASE_HEADERS = {
    ':method': 'PATCH',
    ':authority': API_HOST,
    ':scheme': 'https',
    ':path': `/api/v9/guilds/${MY_SERVER}/vanity-url`,
    'authorization': TOKEN,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'x-super-properties': 'eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0fQ=='
};

const patch = code => {
    const startTime = process.hrtime.bigint();
    const body = Buffer.from(`{"code":"${code}"}`);
    const headers = { ...BASE_HEADERS, 'content-length': String(body.length) };
    if (mfaToken) headers['x-discord-mfa-authorization'] = mfaToken;

    for (let i = 0; i < REQ; i++) {
        const req = h2.request(headers);
        req.on('data', chunk => {
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1_000_000;
            const resStr = chunk.toString();
            
            if (resStr.includes('uses') || resStr.includes(`"code":"${TARGET_CODE}"`)) {
                console.log(`\x1b[32m[🔥 LIGHTNING SUCCESS]\x1b[0m تم سحب الرابط بنجاح! السرعة الفعلية: \x1b[33m${durationMs.toFixed(2)} ms\x1b[0m`);
            }
        });
        req.end(body);
    }
};

const connectHttp2 = () => {
    const sock = tls.connect({
        host: API_IP,
        port: 443,
        servername: API_HOST,
        ALPNProtocols: ['h2'],
        session: h2Session
    });
    sock.once('session', s => h2Session = s);
    h2 = http2.connect(`https://${API_HOST}`, {
        createConnection: () => sock
    });
    const retry = () => {
        h2.destroy();
        setTimeout(connectHttp2, 800);
    };
    h2.on('error', retry);
    h2.on('close', retry);
};

const connectGateway = () => {
    const ws = new WebSocket('wss://gateway.discord.gg');

    ws.on('message', data => {
        const msg = JSON.parse(data);

        if (msg.op === 10) {
            setInterval(() => ws.send('{"op":1,"d":null}'), msg.d.heartbeat_interval);
            ws.send('{"op":2,"d":{"token":"' + TOKEN + '","intents":1,"properties":{"os":"linux","browser":"firefox","device":"kaka"}}}');
        }

        if (msg.t === 'READY') {
            console.log(`\x1b[32m[LIGHTNING READY]\x1b[0m الأداة جاهزة لخطف الرابط: \x1b[33m${TARGET_CODE}\x1b[0m بأقصى سرعة ممكنة.`);
        }

        if (msg.t === 'GUILD_UPDATE') {
            const guildId = msg.d?.id;
            const guildCode = msg.d?.vanity_url_code;

            if (TARGET_SERVERS.includes(guildId)) {
                if (guildCode !== TARGET_CODE) {
                    patch(TARGET_CODE);
                }
            }
        }
    });

    ws.on('error', () => setTimeout(connectGateway, 800));
    ws.on('close', () => setTimeout(connectGateway, 800));
};

startMfaLoop();
connectHttp2();
connectGateway();
