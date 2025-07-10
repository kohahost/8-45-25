const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Baca semua proxy dari file
const proxies = fs.readFileSync('proxies.txt', 'utf-8')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p);

// URL Pi API
const TEST_URL = 'https://api.mainnet.minepi.com';

// Fungsi untuk cek satu proxy
async function testProxy(proxy) {
    const agent = new HttpsProxyAgent(proxy);

    try {
        const res = await axios.get(TEST_URL, {
            httpsAgent: agent,
            timeout: 7000,
        });

        if (res.status === 200 || res.status === 403) {
            console.log(`✅ ${proxy} [OK]`);
            fs.appendFileSync('working.txt', proxy + '\n');
        } else {
            console.log(`⚠️ ${proxy} [HTTP ${res.status}]`);
        }
    } catch (e) {
        console.log(`❌ ${proxy} [${e.code || e.message}]`);
    }
}

// Main loop semua proxy
async function runAll() {
    console.log(`🔍 Mengecek ${proxies.length} proxy...`);
    for (let i = 0; i < proxies.length; i++) {
        await testProxy(proxies[i]);
    }
    console.log('✅ Selesai! Hasil disimpan ke working.txt');
}

runAll();
