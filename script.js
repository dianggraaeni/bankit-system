// ===== KODE LENGKAP script.js (VERSI DENGAN FITUR SHOPIT DETAIL - DIPERBAIKI) =====

document.addEventListener('DOMContentLoaded', () => {
    // --- Konfigurasi & Variabel Global ---
    const broker = {
        hostname: "147.182.226.225",
        port: 9001
    };
    let mqttClient = null;
    let userCredentials = {};
    let productCatalog = [];

    // --- Fungsi Navigasi & Utilitas ---

    function showPage(targetId) {
        // Sembunyikan semua halaman
        document.querySelectorAll('.page-content').forEach(page => {
            page.classList.add('hidden');
        });

        // Tampilkan halaman yang dituju
        const pageToShow = document.getElementById(targetId);
        if (pageToShow) {
            pageToShow.classList.remove('hidden');
            logSystem(`Menampilkan halaman: ${targetId}`, "NAV");

            // Jika halaman yang ditampilkan adalah 'history', minta data riwayat terbaru
            if (targetId === 'page-history' && mqttClient && mqttClient.isConnected()) {
                requestHistory();
            }
            // Jika halaman yang ditampilkan adalah 'shop', minta katalog produk
            if (targetId === 'page-shop' && mqttClient && mqttClient.isConnected()) {
                requestProductCatalog();
            }
        } else {
            // Fallback jika halaman tidak ditemukan
            console.error(`FATAL: Elemen dengan id '${targetId}' tidak dapat ditemukan. Periksa HTML Anda.`);
            document.getElementById('page-home')?.classList.remove('hidden'); // Tampilkan home sebagai fallback
        }
    }

    const showNotification = (message, isError = false) => {
        // Cari kontainer notifikasi di halaman yang sedang aktif
        const activePage = document.querySelector('main.page-content:not(.hidden)');
        const notifContainer = activePage ? activePage.querySelector('.notification-container') : null;

        if (!notifContainer) {
            console.warn("Tidak ada .notification-container di halaman aktif untuk menampilkan notifikasi.");
            return;
        }

        notifContainer.textContent = message;
        notifContainer.className = `notification-container my-4 p-4 rounded-md text-center font-bold text-white ${isError ? 'bg-red-500/80' : 'bg-green-500/80'}`;
        notifContainer.classList.remove('hidden');
        setTimeout(() => {
            notifContainer.classList.add('hidden');
        }, 5000);
    };

    const logSystem = (message, type = 'INFO') => {
        const timestamp = new Date().toLocaleTimeString('id-ID', {
            hour12: false
        });
        const formattedMessage = `[${timestamp}] [${type}] ${message}`;
        console.log(formattedMessage);

        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');
        logs.push(formattedMessage);
        if (logs.length > 100) logs.shift(); // Batasi jumlah log
        localStorage.setItem('systemLogs', JSON.stringify(logs));

        // Selalu render ulang log setiap ada log baru
        renderSystemLogs();
    };

    const formatCurrency = (value) => new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(value);

    // --- Logika MQTT ---

    function connectToMqtt() {
        if (!userCredentials.username) return;
        const clientId = `insys_client_${userCredentials.kelompok}_${userCredentials.kelas}_` + Date.now();
        logSystem(`Mencoba koneksi ke mqtt://${broker.hostname}:${broker.port}`, "INFO");

        mqttClient = new Paho.MQTT.Client(broker.hostname, broker.port, clientId);
        mqttClient.onConnectionLost = onConnectionLost;
        mqttClient.onMessageArrived = onMessageArrived;

        mqttClient.connect({
            userName: userCredentials.username,
            password: userCredentials.password,
            onSuccess: onConnect,
            onFailure: (err) => {
                logSystem(`Koneksi Gagal: ${err.errorMessage}`, 'ERROR');
                updateConnectionUI(false);
                showNotification(`Koneksi Gagal: ${err.errorMessage}.`, true);
            },
            useSSL: false,
            cleanSession: true,
            timeout: 10
        });
    }

    function onConnect() {
        logSystem(`Terhubung sebagai ${userCredentials.username}`, 'SUCCESS');
        const baseTopic = `${userCredentials.topicBase}/#`;
        mqttClient.subscribe(baseTopic);
        logSystem(`Subscribe ke topic: ${baseTopic}`);
        updateConnectionUI(true);
        requestWalletInfo(); // Setelah terhubung, langsung minta data wallet
    }

    function onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            logSystem(`Koneksi terputus: ${responseObject.errorMessage}`, 'ERROR');
            updateConnectionUI(false);
        }
    }

    function disconnectFromMqtt() {
        if (mqttClient && mqttClient.isConnected()) {
            mqttClient.disconnect();
        }
        logSystem('Koneksi diputus oleh pengguna.');
        localStorage.removeItem('userCredentials');
        localStorage.removeItem('userInfo');
        localStorage.removeItem('transactionHistory');
        userCredentials = {};
        window.location.reload();
    }

    function onMessageArrived(message) {
        const topic = message.destinationName;
        const payloadString = message.payloadString;
        try {
            const data = JSON.parse(payloadString);
            logSystem(`Pesan diterima dari: ${topic}`, 'MSG-IN');

            if (topic.endsWith('/account-identity/response')) {
                handleWalletResponse(data);
            } else if (topic.includes('/transfer/send/response')) {
                handleTransferResponse(data);
            } else if (topic.includes('/live-history') || topic.includes('/transfer/receive')) {
                handleLiveUpdateNotification(data);
            } else if (topic.endsWith('/wallet-history/response')) {
                handleHistoryResponse(data);
            } else if (topic.endsWith('/shopit/product-detail/response')) {
                handleProductDetailResponse(data);
            } else if (topic.endsWith('/shopit/product-catalog/response')) {
                handleCatalogResponse(data);
            } else if (topic.endsWith('/shopit/buy/response')) {
                handleBuyResponse(data);
            }
        } catch (e) {
            logSystem(`Gagal mem-parsing JSON dari topic ${topic}: ${e}`, 'ERROR');
        }
    }

    function publishMessage(topic, payload) {
        if (!mqttClient || !mqttClient.isConnected()) {
            showNotification("Tidak terhubung ke broker.", true);
            return;
        }
        const message = new Paho.MQTT.Message(JSON.stringify(payload));
        message.destinationName = topic;
        mqttClient.send(message);
        logSystem(`Pesan dikirim ke: ${topic}`, 'MSG-OUT');
    }

    // --- Fungsi Permintaan Data ---

 // ===== PASTIKAN FUNGSI INI SUDAH SEPERTI INI =====
function requestWalletInfo() {
    // Jangan lakukan apa-apa jika belum login atau belum connect
    if (!userCredentials.username || !mqttClient || !mqttClient.isConnected()) return;

    // Topic request untuk get identity
    const topic = `${userCredentials.topicBase}/bankit/account-identity/request`;

    // Payload yang dibutuhkan server
    const payload = {
        "e-wallet": userCredentials.ewallet, // Nama tampilan, misal: "DoPay"
        "email": userCredentials.email
    };
    
    publishMessage(topic, payload);
}

    function requestHistory() {
        if (!userCredentials.username || !mqttClient || !mqttClient.isConnected()) return;
        const topic = `${userCredentials.topicBase}/bankit/wallet-history/request`;
        const payload = {
            "e-wallet": userCredentials.ewallet,
            "email": userCredentials.email,
            "payment_method": userCredentials.ewallet_val
        };
        publishMessage(topic, payload);
    }

    // --- Penanganan Response ---

  // VERSI BARU (FINAL)
function handleWalletResponse(data) {
    if (data.code === 200 && data.status === true && data.data) {
        updateUserInfoUI({
            username: userCredentials.username,
            ewallet: userCredentials.ewallet,
            balance: data.data.balance !== undefined ? data.data.balance : 0
        });
        // Notifikasi dihapus agar tidak menimpa notifikasi dari aksi sebelumnya (transfer/pembelian)
    } else {
        // Kita tetap menampilkan notifikasi jika terjadi error
        showNotification(data.message || 'Gagal mendapatkan data wallet.', true);
    }
}

  // ===== CARI FUNGSI INI DAN GANTI SELURUHNYA =====
// ===== CARI FUNGSI INI DAN GANTI SELURUHNYA =====
function handleTransferResponse(data) {
    const isSuccess = data.code === 200 && data.status === true;
    showNotification(data.message, !isSuccess);

    if (isSuccess) {
        logSystem("Transfer berhasil dikirim. Memicu pembaruan saldo...", "INFO");
        
        // [PERBAIKAN KUNCI] Panggil fungsi untuk meminta data saldo terbaru
        // Ini akan memicu update tampilan saldo di UI
        requestWalletInfo(); 
        
        // Kosongkan form setelah berhasil
        document.getElementById('transferForm')?.reset();
    }
}
 // ===== CARI FUNGSI INI DAN GANTI SELURUHNYA =====
// ===== GANTI FUNGSI LAMA DENGAN VERSI BARU INI =====

// ===== GANTI FUNGSI LAMA DENGAN VERSI BARU INI =====
function handleLiveUpdateNotification(data) {
    // Cek apakah notifikasinya valid dan sukses
    if (data.status === true && data.code === 200) {
        
        // 1. Tampilkan notifikasi seperti biasa untuk memberitahu pengguna
        showNotification(data.message, false);
        logSystem(`Menerima notifikasi live: ${data.message}`, "INFO");

        // 2. [PERBAIKAN KUNCI] Panggil fungsi untuk meminta data saldo terbaru
        // Ini akan memicu alur untuk memperbarui tampilan saldo di "Informasi Akun"
        requestWalletInfo();
    }
}

    function handleHistoryResponse(data) {
        if (data.code === 200 && data.status === true && data.data) {
            localStorage.setItem('transactionHistory', JSON.stringify(data.data.transactions || []));
            renderHistoryTable();
            showNotification("Riwayat transaksi berhasil dimuat.", false);
        } else {
            showNotification(data.message || 'Gagal memuat riwayat.', true);
        }
    }

    // --- Fungsi Permintaan Data Shop ---

    function requestProductCatalog() {
        if (!userCredentials.username || !mqttClient || !mqttClient.isConnected()) {
            showNotification("Hubungkan akun di halaman Transfer untuk melihat produk.", true);
            return;
        }
        const topic = `${userCredentials.topicBase}/shopit/product-catalog/request`;
        const payload = {};
        publishMessage(topic, payload);
        logSystem("Meminta katalog produk dari ShopIT.", "MSG-OUT");
    }

    // --- Penanganan Response Shop ---

    function handleCatalogResponse(data) {
        if (typeof data !== 'object' || data === null) {
            logSystem('Gagal memproses respons katalog: Data bukan objek JSON yang valid.', 'ERROR');
            showNotification('Respons dari server tidak valid.', true);
            return;
        }

        if (data.code === 200 && data.status === true && data.data && Array.isArray(data.data)) {
            productCatalog = data.data;
            renderProductCatalog();
            logSystem(`Berhasil memuat ${productCatalog.length} produk dari katalog.`);
            if (productCatalog.length > 0) {
                showNotification("Katalog produk berhasil diperbarui.", false);
            }
        } else {
            const errorMessage = data.message || 'Gagal memuat katalog produk.';
            logSystem(`Error dari server saat memuat katalog: ${errorMessage}`, 'ERROR');
            logSystem('Data mentah yang diterima:', 'DEBUG');
            console.log(data);
            showNotification(errorMessage, true);
            productCatalog = [];
            renderProductCatalog();
        }
    }

// GANTI FUNGSI LAMA DENGAN VERSI BARU INI
// GANTI FUNGSI LAMA DENGAN VERSI BARU INI
// GANTI FUNGSI LAMA DENGAN VERSI BARU INI
function handleBuyResponse(data) {
    const isSuccess = data.code === 200 && data.status === true;

    // Tampilkan notifikasi dari server (sukses atau gagal)
    showNotification(data.message || (isSuccess ? 'Pembelian berhasil!' : 'Pembelian gagal.'), !isSuccess);

    if (isSuccess) {
        logSystem('Pembelian sukses. Menutup modal dan memperbarui data.', 'INFO');
        // Tutup jendela detail produk
        document.getElementById('productDetailModal').classList.add('hidden');
        
        // [PERBAIKAN KUNCI 1] Minta data saldo terbaru untuk mengupdate UI
        requestWalletInfo(); 
        
        // [PERBAIKAN KUNCI 2] Minta katalog produk terbaru untuk mengupdate stok
        requestProductCatalog();
    }
}

    // --- Fungsi Detail Produk & Pembelian ---

    function requestProductDetail(productId) {
        if (!userCredentials.username || !mqttClient || !mqttClient.isConnected()) {
            showNotification("Hubungkan akun untuk melihat detail produk.", true);
            return;
        }
        const topic = `${userCredentials.topicBase}/shopit/product-detail/request`;
        const payload = {
            "product_id": productId
        };
        publishMessage(topic, payload);
        logSystem(`Meminta detail untuk produk ID: ${productId}`, "MSG-OUT");
    }

    function handleProductDetailResponse(data) {
        if (data.code === 200 && data.status === true && data.data) {
            renderProductDetailModal(data.data);
        } else {
            showNotification(data.message || 'Gagal memuat detail produk.', true);
            document.getElementById('productDetailModal').classList.add('hidden');
        }
    }

    function renderProductDetailModal(product) {
        const modalContent = document.getElementById('modalContent');
        if (!modalContent) return;

        modalContent.innerHTML = `
            <div>
                <img src="${product.image_url}" alt="${product.name}" class="w-full h-auto object-cover rounded-lg bg-gray-700">
            </div>
            <div class="flex flex-col justify-between">
                <div>
                    <h2 class="text-3xl font-bold text-white mb-2">${product.name}</h2>
                    <p class="text-2xl font-semibold text-cyan-400 mb-4">${formatCurrency(product.price)}</p>
                    <p class="text-sm text-gray-400 mb-1">Stok Tersedia: <span class="font-bold text-white">${product.quantity}</span></p>
                
${product.description 
    ? `<p class="text-sm text-gray-300 mt-4">${product.description}</p>` 
    : ''
}
                </div>
                <div class="mt-6">
                    <div class="flex items-center gap-4">
                        <label for="buyQuantity" class="text-sm font-medium text-gray-300">Jumlah:</label>
                        <input type="number" id="buyQuantity" name="quantity" min="1" max="${product.quantity}" value="1" class="w-24 bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white">
                    </div>
                    <button id="confirmPurchaseBtn" data-product-id="${product.id}" class="w-full mt-4 bg-cyan-600 text-white font-bold py-3 px-4 rounded hover:bg-cyan-500 transition text-lg">
                        Beli Sekarang
                    </button>
                </div>
            </div>
        `;

        document.getElementById('confirmPurchaseBtn').addEventListener('click', handlePurchaseConfirmation);
    }

    // [DIPINDAHKAN KE SINI] - Fungsi helper untuk menangani pembelian dari modal
// GANTI FUNGSI LAMA DENGAN VERSI BARU INI
// GANTI FUNGSI LAMA DENGAN VERSI FINAL INI
// ===== GANTI FUNGSI LAMA DENGAN VERSI FINAL INI =====
const handlePurchaseConfirmation = () => {
    const confirmButton = document.getElementById('confirmPurchaseBtn');
    if (!confirmButton) return;

    const productId = confirmButton.getAttribute('data-product-id');
    const quantityInput = document.getElementById('buyQuantity');
    const quantity = parseInt(quantityInput.value, 10);
    const maxStock = parseInt(quantityInput.max, 10);

    if (!productId || !quantity || quantity <= 0) {
        showNotification("Jumlah pembelian tidak valid.", true);
        return;
    }

    if (quantity > maxStock) {
        showNotification(`Pembelian melebihi stok yang tersedia (${maxStock}).`, true);
        return;
    }

    const topic = `${userCredentials.topicBase}/shopit/buy/request`;
    
    // [PERBAIKAN KUNCI] Menambahkan field "payment_method" yang diminta oleh server.
    // Tanpa ini, server tidak tahu harus memotong saldo dari e-wallet mana.
    const payload = {
        "product_id": productId,
        "quantity": quantity,
        "buyer_email": userCredentials.email,
        "payment_method": userCredentials.ewallet_val // Mengambil metode pembayaran dari kredensial
    };

    publishMessage(topic, payload);
};

    // --- Fungsi Render UI Shop ---

    function renderProductCatalog() {
        const gridContainer = document.getElementById('product-catalog-grid');
        if (!gridContainer) return;

        gridContainer.innerHTML = '';

        if (productCatalog.length === 0) {
            gridContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">Tidak ada produk yang tersedia saat ini. Coba refresh.</p>';
            return;
        }

        productCatalog.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card bg-gray-800/60 p-4 rounded-lg border border-gray-700 flex flex-col justify-between hover:border-cyan-500 transition cursor-pointer';
            card.setAttribute('data-product-id', product.id);

            card.innerHTML = `
                <div class="pointer-events-none">
                    <img src="${product.image_url}" alt="${product.name}" class="w-full h-40 object-cover rounded-md mb-4 bg-gray-700">
                    <h3 class="text-lg font-bold text-white">${product.name}</h3>
                    <p class="text-sm text-gray-400 mb-2">Stok: ${product.quantity}</p>
                    <p class="text-xl font-semibold text-cyan-400">${formatCurrency(product.price)}</p>
                </div>
                <button class="mt-4 w-full bg-cyan-700 text-white font-bold py-2 px-4 rounded hover:bg-cyan-600 transition pointer-events-none">
                    Lihat Detail
                </button>
            `;
            gridContainer.appendChild(card);
        });

        document.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const productId = e.currentTarget.getAttribute('data-product-id');
                document.getElementById('productDetailModal').classList.remove('hidden');
                document.getElementById('modalContent').innerHTML = '<p class="text-gray-400 col-span-full text-center">Memuat detail produk...</p>';
                requestProductDetail(productId);
            });
        });
    }

    // --- Fungsi Render UI ---

    function renderSystemLogs() {
        const logsContainer = document.getElementById('systemLogs');
        if (!logsContainer) return;

        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');

        if (logs.length > 0) {
            logsContainer.innerHTML = '';
            logs.slice().reverse().forEach(log => {
                const p = document.createElement('p');
                if (log.includes('[ERROR]')) p.className = 'text-red-400';
                else if (log.includes('[SUCCESS]')) p.className = 'text-green-400';
                else if (log.includes('[WARN]')) p.className = 'text-yellow-400';
                else if (log.includes('[MSG-IN]')) p.className = 'text-cyan-400';
                else if (log.includes('[MSG-OUT]')) p.className = 'text-purple-400';
                else if (log.includes('[NAV]')) p.className = 'text-gray-400';
                else p.className = 'text-gray-300';
                p.textContent = log;
                logsContainer.appendChild(p);
            });
        } else {
            logsContainer.textContent = 'Menunggu aktivitas sistem...';
        }
    }

    function renderHistoryTable() {
        const history = JSON.parse(localStorage.getItem('transactionHistory') || '[]');
        const tableBody = document.getElementById('historyTableBody');
        if (!tableBody) return;

        tableBody.innerHTML = '';

        if (history.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Tidak ada riwayat transaksi. Coba refresh.</td></tr>';
            return;
        }

        history.forEach(tx => {
            const amount = tx.balance_change;
            const isDebit = amount < 0;
            const typeClass = isDebit ? 'text-red-400' : 'text-green-400';
            const sign = isDebit ? '' : '+';
            const row = document.createElement('tr');
            row.className = 'bg-gray-800/50 border-b border-gray-700 hover:bg-gray-700/50';
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap">${new Date(tx.created_at).toLocaleString('id-ID')}</td>
                <td class="px-6 py-4">${tx.transaction_type}</td>
                <td class="px-6 py-4">${tx.description || '-'}</td>
                <td class="px-6 py-4 font-semibold ${typeClass}">${sign} ${formatCurrency(Math.abs(amount))}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300">Berhasil</span></td>
            `;
            tableBody.appendChild(row);
        });
    }

    function updateConnectionUI(connected) {
        const elements = {
            btnConnect: document.getElementById('btnConnect'),
            btnDisconnect: document.getElementById('btnDisconnect'),
            statusText: document.getElementById('statusText'),
            transferContainer: document.getElementById('transfer-form-container'),
            inputs: [
                document.getElementById('inputKelas'),
                document.getElementById('inputKelompok'),
                document.getElementById('inputNrpSum'),
                document.getElementById('selectEwallet')
            ],
            refreshBalanceBtn: document.getElementById('btnRefreshBalance'),
            transferInstruction: document.getElementById('transfer-instruction')
        };

        if (!elements.btnConnect) return;

        if (connected) {
            elements.btnConnect.classList.add('hidden');
            elements.btnDisconnect.classList.remove('hidden');
            elements.statusText.textContent = 'Connected';
            elements.statusText.className = 'text-green-500 font-bold';
            elements.transferContainer.classList.remove('opacity-50', 'pointer-events-none');
            elements.transferInstruction.classList.add('hidden');
            elements.inputs.forEach(input => {
                if (input) input.disabled = true;
            });
            elements.refreshBalanceBtn.classList.remove('hidden');
        } else {
            elements.btnConnect.classList.remove('hidden');
            elements.btnDisconnect.classList.add('hidden');
            elements.statusText.textContent = 'Disconnected';
            elements.statusText.className = 'text-red-500 font-bold';
            elements.transferContainer.classList.add('opacity-50', 'pointer-events-none');
            elements.transferInstruction.classList.remove('hidden');
            elements.inputs.forEach(input => {
                if (input) input.disabled = false;
            });
            elements.refreshBalanceBtn.classList.add('hidden');
            updateUserInfoUI({
                balance: 0
            });
        }
    }

    function updateUserInfoUI(userInfo = null) {
        let infoToDisplay = userInfo || JSON.parse(localStorage.getItem('userInfo')) || {};
        if (userInfo) {
            localStorage.setItem('userInfo', JSON.stringify(infoToDisplay));
        }

        const ewalletText = document.getElementById('ewalletText');
        const usernameText = document.getElementById('usernameText');
        const balanceText = document.getElementById('balanceText');

        if (ewalletText) ewalletText.textContent = infoToDisplay.ewallet || '-';
        if (usernameText) usernameText.textContent = infoToDisplay.username || '-';
        if (balanceText) {
            const balanceValue = infoToDisplay.balance;
            balanceText.textContent = (typeof balanceValue === 'number') ? formatCurrency(balanceValue) : 'Rp 0';
        }
    }

    // --- Inisialisasi Aplikasi ---

    function initApp() {
        logSystem("Aplikasi dimulai.", "SYSTEM");

        const navLinks = document.querySelectorAll('.nav-link');
        const activeClass = 'bg-gray-800 text-white';
        const inactiveClass = 'text-gray-300 hover:bg-gray-700 hover:text-white';

        function setActiveNav(targetPageId) {
            navLinks.forEach(link => {
                const linkTarget = link.getAttribute('data-page');
                link.classList.remove(...activeClass.split(' '));
                link.classList.add(...inactiveClass.split(' '));
                if (linkTarget === targetPageId) {
                    link.classList.remove(...inactiveClass.split(' '));
                    link.classList.add(...activeClass.split(' '));
                }
            });
        }

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPageId = e.currentTarget.getAttribute('data-page');
                if (targetPageId) {
                    showPage(targetPageId);
                    setActiveNav(targetPageId);
                }
            });
        });

 // ===== CARI BLOK addEventListener untuk btnConnect DAN GANTI SELURUHNYA =====

document.getElementById('btnConnect').addEventListener('click', () => {
    // --- ATURAN KEAMANAN: HANYA KREDENSIAL INI YANG DIIZINKAN ---
    const ALLOWED_CLASS = "B";
    const ALLOWED_GROUP = "N";
    const ALLOWED_NRP_SUM = "118"; // Sesuai perhitungan Kelompok N

    // --- Ambil input dari pengguna ---
    const inputKelas = document.getElementById('inputKelas').value.trim().toUpperCase();
    const inputKelompok = document.getElementById('inputKelompok').value.trim().toUpperCase();
    const inputNrpSum = document.getElementById('inputNrpSum').value.trim();
    const ewalletSelect = document.getElementById('selectEwallet');
    const ewalletValue = ewalletSelect.value;
    const ewalletText = ewalletSelect.options[ewalletSelect.selectedIndex].text;

    // --- Validasi Input Kosong ---
    if (!inputKelas || !inputKelompok || !inputNrpSum) {
        showNotification("Semua field kredensial harus diisi.", true);
        return;
    }

    // --- PENJAGA KEAMANAN (INI BAGIAN KUNCI) ---
    // Cek apakah input dari pengguna sesuai dengan kredensial yang diizinkan untuk aplikasi ini.
    if (
        inputKelas !== ALLOWED_CLASS ||
        inputKelompok !== ALLOWED_GROUP ||
        inputNrpSum !== ALLOWED_NRP_SUM
    ) {
        // JIKA TIDAK SESUAI, TOLAK MENTAH-MENTAH!
        showNotification("Akses Ditolak: Kredensial tidak sesuai untuk kelompok ini.", true);
        logSystem(`AKSES DITOLAK (Client-Side): Upaya login dengan kredensial ${inputKelas}/${inputKelompok}`, "SECURITY");
        
        // Hentikan proses, jangan biarkan koneksi terjadi.
        return;
    }

    // --- Jika kredensial BENAR, lanjutkan seperti biasa ---
    logSystem("Kredensial valid. Melanjutkan koneksi...", "INFO");

    userCredentials = {
        username: `Kelompok_${inputKelompok}_Kelas_${inputKelas}`,
        password: `Insys#${inputKelas}${inputKelompok}#${inputNrpSum}`,
        email: `insys-${inputKelas}-${inputKelompok}@bankit.com`,
        ewallet: ewalletText,
        ewallet_val: ewalletValue,
        topicBase: `${inputKelas}/${inputKelompok}`,
        kelas: inputKelas,
        kelompok: inputKelompok,
        nrpSum: inputNrpSum
    };
    localStorage.setItem('userCredentials', JSON.stringify(userCredentials));
    
    updateUserInfoUI({
        username: userCredentials.username,
        ewallet: userCredentials.ewallet,
        balance: 0
    });

    if (mqttClient && mqttClient.isConnected()) mqttClient.disconnect();
    connectToMqtt();
});

        document.getElementById('btnDisconnect').addEventListener('click', disconnectFromMqtt);
        document.getElementById('btnRefreshBalance').addEventListener('click', requestWalletInfo);
        document.getElementById('btnRefreshHistory').addEventListener('click', requestHistory);
        document.getElementById('clearLogsBtn').addEventListener('click', () => {
            if (confirm("Apakah Anda yakin ingin menghapus semua log sistem?")) {
                localStorage.removeItem('systemLogs');
                logSystem("Log sistem telah dihapus oleh pengguna.", "SYSTEM");
            }
        });

        // --- Event Listener untuk ShopIT ---

        document.getElementById('btnRefreshCatalog').addEventListener('click', requestProductCatalog);

        document.getElementById('closeModalBtn').addEventListener('click', () => {
            document.getElementById('productDetailModal').classList.add('hidden');
        });

        // [DIHAPUS] Definisi handlePurchaseConfirmation sudah dipindahkan ke scope global.

// ===== INI ADALAH VERSI YANG BENAR =====

document.getElementById('transferForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const recipientUsername = document.getElementById('recipient').value.trim();
    const recipientEwallet = document.getElementById('recipient_ewallet').value;
    const amount = parseInt(document.getElementById('amount').value, 10);
    const notes = document.getElementById('notes').value.trim();

    // --- BAGIAN INI SANGAT PENTING, JANGAN DIHAPUS ---
    if (!recipientUsername || !recipientEwallet || !amount || amount <= 0) {
        showNotification("Harap isi semua field transfer dengan benar.", true);
        return; // Hentikan jika input kosong atau jumlah tidak valid
    }

    const recipientRegex = /^Kelompok_([A-Z])_Kelas_([A-Z])$/i;
    const match = recipientUsername.match(recipientRegex);
    if (!match) {
        showNotification("Format Username Penerima salah! Contoh: Kelompok_L_Kelas_B", true);
        return; // Hentikan jika format username salah
    }
    // --- AKHIR DARI BAGIAN YANG PENTING ---


    // >> TIDAK ADA LAGI KODE VALIDASI LINTAS KELOMPOK DI SINI <<


    // Lanjutkan langsung ke pembuatan payload dan pengiriman pesan
    // match[1] adalah KELOMPOK, match[2] adalah KELAS
    const receiverEmail = `insys-${match[2].toUpperCase()}-${match[1].toUpperCase()}@bankit.com`;
    const senderEwallet = userCredentials.ewallet_val;
    const topic = `${userCredentials.topicBase}/bankit/${senderEwallet}/transfer/send/request`;
    
    const payload = {
        "sender_email": userCredentials.email,
        "receiver_payment_method": recipientEwallet,
        "receiver_email": receiverEmail,
        "amount": amount,
        "notes": notes || ""
    };
    
    logSystem(`Mencoba transfer ke ${recipientUsername}...`, "INFO");
    publishMessage(topic, payload);
});

        // --- Proses Startup Aplikasi ---
        const savedCreds = JSON.parse(localStorage.getItem('userCredentials'));
        if (savedCreds && savedCreds.kelas) {
            userCredentials = savedCreds;
            logSystem("Kredensial ditemukan, mencoba koneksi otomatis...", "INFO");

            const inputKelasEl = document.getElementById('inputKelas');
            if (inputKelasEl) {
                inputKelasEl.value = savedCreds.kelas;
                document.getElementById('inputKelompok').value = savedCreds.kelompok;
                document.getElementById('inputNrpSum').value = savedCreds.nrpSum;
                document.getElementById('selectEwallet').value = savedCreds.ewallet_val;
            }
            connectToMqtt();
        }

        updateUserInfoUI();
        renderHistoryTable();
        renderSystemLogs();

        const initialPage = 'page-home';
        showPage(initialPage);
        setActiveNav(initialPage);
    }

    // --- Mulai Aplikasi ---
    initApp();
});
