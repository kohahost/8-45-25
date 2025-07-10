const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
require("dotenv").config();

let proxies = [];
let currentProxyIndex = 0;
let agent = null;

// === Load Proxy ===
function loadProxies() {
    try {
        const data = fs.readFileSync('proxies.txt', 'utf-8');
        proxies = data.split('\n').map(p => p.trim()).filter(Boolean);
        if (proxies.length === 0) throw new Error("proxies.txt kosong!");
        console.log(`✅ Loaded ${proxies.length} proxies`);
    } catch (e) {
        console.error("❌ Gagal membaca proxies.txt:", e.message);
        process.exit(1);
    }
}

// === Ganti Proxy ===
function getNextProxy() {
    currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
    const proxy = proxies[currentProxyIndex];
    agent = new HttpsProxyAgent(proxy);
    console.log(`🌐 Ganti proxy ke [${currentProxyIndex + 1}/${proxies.length}]: ${proxy}`);
}

// === Generate Wallet dari Mnemonic ===
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Mnemonic tidak valid!");
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
    return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

// === Fungsi Utama: Kirim Semua Saldo ===
async function sendAllBalanceLoop() {
    const mnemonic = process.env.MNEMONIC;
    const receiver = process.env.RECEIVER_ADDRESS;
    const wallet = await getPiWalletAddressFromSeed(mnemonic);
    const senderKeypair = StellarSdk.Keypair.fromSecret(wallet.secretKey);
    const senderPublic = wallet.publicKey;

    const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
    const apiUrl = `https://api.mainnet.minepi.com/accounts/${senderPublic}`;

    try {
        const res = await axios.get(apiUrl, { httpsAgent: agent });
        const balanceObj = res.data.balances.find(b => b.asset_type === 'native');
        const balance = parseFloat(balanceObj.balance);

        const account = await server.loadAccount(senderPublic);
        const fee = await server.fetchBaseFee();
        const estimatedFee = fee * 1;
        const sendableAmount = balance - (estimatedFee / 10000000);

        if (sendableAmount <= 0) {
            process.stdout.write("⚠️ Tidak cukup saldo... \r");
            return setImmediate(sendAllBalanceLoop);
        }

        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: estimatedFee.toString(),
            networkPassphrase: 'Pi Network',
        })
            .addOperation(StellarSdk.Operation.payment({
                destination: receiver,
                asset: StellarSdk.Asset.native(),
                amount: sendableAmount.toFixed(7),
            }))
            .setTimeout(30)
            .build();

        tx.sign(senderKeypair);
        const result = await server.submitTransaction(tx);
        console.log(`\n✅ Transfer berhasil! TxHash: ${result.hash}`);

        // === Ambil Detail Operasi ===
        if (result._links?.operations?.href) {
            try {
                const opUrl = result._links.operations.href;
                const opRes = await axios.get(opUrl, { httpsAgent: agent });
                const op = opRes.data._embedded.records[0];

                console.log(`📄 Detail Transfer:`);
                console.log(`🔑 From   : ${op.from}`);
                console.log(`🏁 To     : ${op.to}`);
                console.log(`💰 Amount : ${op.amount} Pi`);
                console.log(`🕓 Time   : ${op.created_at}`);
                console.log(`🔗 Tx Hash: ${op.transaction_hash}`);
                console.log("--------------------------------------------------");

            } catch (err) {
                console.error("⚠️ Gagal ambil detail operasi:", err.message);
            }
        } else {
            console.warn("⚠️ Tidak ada data operasi di hasil submitTransaction");
        }

    } catch (e) {
        const status = e.response?.status;
        const msg = e.response?.data?.extras?.result_codes || e.message;
        console.error("\n❌ Gagal transfer:", msg);
        if (status === 429) getNextProxy();
    } finally {
        setImmediate(sendAllBalanceLoop); // Ulang terus tanpa jeda
    }
}

// === MULAI ===
loadProxies();
getNextProxy();
sendAllBalanceLoop();
