document.addEventListener('DOMContentLoaded', () => {
    // --- Konfigurasi & Variabel Global ---
    // Konfigurasi untuk koneksi ke broker MQTT.
    const broker = {
        hostname: "147.182.226.225",
        port: 9001
    };
    let mqttClient = null; // Objek klien MQTT, null jika tidak terhubung.
    let userCredentials = {}; // Menyimpan data login dan identitas pengguna setelah konek.
    let productCatalog = []; // Cache untuk katalog produk dari server.
    let clientBalances = {}; // Cache saldo untuk setiap e-wallet yang digunakan pengguna, disimpan di localStorage.
    let lastActionTimestamp = 0; // Timestamp aksi terakhir (transfer/topup) untuk menghindari notifikasi duplikat.
    const ACTION_IGNORE_WINDOW = 3000; // Jendela waktu (ms) untuk mengabaikan notifikasi live setelah aksi manual.
    let lastPurchaseAttempt = null; // Menyimpan detail percobaan pembelian terakhir untuk validasi respons.

    // --- Fungsi Navigasi & Utilitas ---
    /**
     * Mengatur visibilitas halaman (Single Page Application-like behavior).
     * @param {string} targetId - ID elemen halaman yang akan ditampilkan.
     */
    function showPage(targetId) {
        document.querySelectorAll('.page-content').forEach(page => page.classList.add('hidden'));
        const pageToShow = document.getElementById(targetId);
        if (pageToShow) {
            pageToShow.classList.remove('hidden');
            logSystem(`Menampilkan halaman: ${targetId}`, "NAV");
            // Memuat data relevan saat halaman ditampilkan.
            if (targetId === 'page-history' && mqttClient && mqttClient.isConnected()) requestHistory();
            if (targetId === 'page-shop' && mqttClient && mqttClient.isConnected()) requestProductCatalog();
        } else {
            // Fallback ke halaman home jika target tidak ditemukan.
            document.getElementById('page-home')?.classList.remove('hidden');
        }
    }

    /**
     * Menampilkan notifikasi sementara di halaman aktif.
     * @param {string} message - Pesan yang akan ditampilkan.
     * @param {boolean} isError - True jika notifikasi adalah pesan error (warna merah).
     */
    const showNotification = (message, isError = false) => {
        const activePage = document.querySelector('main.page-content:not(.hidden)');
        const notifContainer = activePage ? activePage.querySelector('.notification-container') : null;
        if (!notifContainer) return;
        notifContainer.textContent = message;
        notifContainer.className = `notification-container my-4 p-4 rounded-md text-center font-bold text-white ${isError ? 'bg-red-500/80' : 'bg-green-500/80'}`;
        notifContainer.classList.remove('hidden');
        setTimeout(() => notifContainer.classList.add('hidden'), 5000);
    };

    /**
     * Mencatat pesan ke console dan localStorage untuk debugging dan riwayat aktivitas.
     * @param {string} message - Pesan log.
     * @param {string} type - Tipe log (e.g., 'INFO', 'ERROR', 'MSG-IN').
     */
    const logSystem = (message, type = 'INFO') => {
        const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false });
        const formattedMessage = `[${timestamp}] [${type}] ${message}`;
        console.log(formattedMessage);
        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');
        logs.push(formattedMessage);
        if (logs.length > 100) logs.shift(); // Batasi jumlah log
        localStorage.setItem('systemLogs', JSON.stringify(logs));
        renderSystemLogs(); // Update tampilan log di UI
    };

    /**
     * Memformat angka menjadi format mata uang Rupiah (IDR).
     * @param {number} value - Nilai angka yang akan diformat.
     * @returns {string} - String mata uang yang telah diformat.
     */
    const formatCurrency = (value) => new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(value);

    // --- Manajemen State Saldo ---
    /** Memuat cache saldo dari localStorage saat aplikasi dimulai. */
    function loadBalancesFromCache() {
        clientBalances = JSON.parse(localStorage.getItem('clientBalances') || '{}');
        logSystem("Cache saldo per e-wallet dimuat.", "CACHE");
    }

    /** Menyimpan state saldo terbaru ke localStorage. */
    function saveBalancesToCache() {
        localStorage.setItem('clientBalances', JSON.stringify(clientBalances));
        logSystem("Cache saldo per e-wallet disimpan.", "CACHE");
    }

    /** Mendapatkan saldo e-wallet yang sedang aktif dari cache. */
    function getCurrentEwalletBalance() {
        if (!userCredentials.ewallet_val) return 0;
        return clientBalances[userCredentials.ewallet_val] || 0;
    }

    /** Memperbarui saldo e-wallet aktif, memperbarui UI, dan menyimpan ke cache. */
    function updateCurrentEwalletBalance(newBalance) {
        if (!userCredentials.ewallet_val) return;
        clientBalances[userCredentials.ewallet_val] = newBalance;
        updateClientBalanceUI();
        saveBalancesToCache();
    }

    /** Memperbarui teks saldo di UI. */
    function updateClientBalanceUI() {
        document.getElementById('balanceText').textContent = formatCurrency(getCurrentEwalletBalance());
    }

    // --- Logika MQTT & Penanganan Pesan ---
    /** Menginisialisasi dan menghubungkan klien MQTT ke broker. */
    function connectToMqtt() {
        if (!userCredentials.username) return;
        const clientId = `insys_client_${userCredentials.kelompok}_${userCredentials.kelas}_${Date.now()}`;
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
            },
            useSSL: false,
            cleanSession: true,
            timeout: 10
        });
    }

    /** Callback yang dijalankan saat berhasil terhubung ke MQTT. */
    function onConnect() {
        logSystem(`Terhubung sebagai ${userCredentials.username}`, 'SUCCESS');
        mqttClient.subscribe(`${userCredentials.topicBase}/#`); // Subscribe ke semua sub-topic
        updateConnectionUI(true);
        // Jika saldo belum ada di cache, minta ke server.
        if (clientBalances[userCredentials.ewallet_val] === undefined) {
            requestWalletInfo();
        } else {
            updateClientBalanceUI();
        }
        requestHistory(); // Selalu minta riwayat transaksi terbaru saat konek.
    }

    /** Callback yang dijalankan saat koneksi MQTT terputus. */
    function onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            logSystem(`Koneksi terputus: ${responseObject.errorMessage}`, 'ERROR');
            updateConnectionUI(false);
        }
    }

    /** Memutuskan koneksi MQTT dan membersihkan data sesi pengguna. */
    function disconnectFromMqtt() {
        if (mqttClient && mqttClient.isConnected()) mqttClient.disconnect();
        localStorage.removeItem('userCredentials');
        userCredentials = {};
        window.location.reload(); // Muat ulang halaman untuk reset state
    }

    /** Router utama untuk pesan MQTT yang masuk. Memanggil handler yang sesuai berdasarkan topic pesan. */
    function onMessageArrived(message) {
        const topic = message.destinationName;
        const payloadString = message.payloadString;
        try {
            const data = JSON.parse(payloadString);
            logSystem(`Pesan diterima dari: ${topic}`, 'MSG-IN');
            if (topic.endsWith('/account-identity/response')) handleWalletResponse(data);
            else if (topic.includes('/transfer/send/response')) handleTransferResponse(data);
            else if (topic.includes('/live-history') || topic.includes('/transfer/receive')) handleLiveUpdateNotification(data);
            else if (topic.endsWith('/wallet-history/response')) handleHistoryResponse(data);
            else if (topic.endsWith('/shopit/product-catalog/response')) handleCatalogResponse(data);
            else if (topic.endsWith('/shopit/product-detail/response')) handleProductDetailResponse(data);
            else if (topic.endsWith('/shopit/buy/response')) handleBuyResponse(data);
            else if (topic.includes('/give-balance/response')) handleTopUpResponse(data);
        } catch (e) {
            logSystem(`Gagal mem-parsing JSON dari topic ${topic}: ${e}`, 'ERROR');
        }
    }

    /**
     * Mengirim pesan (publish) ke topic MQTT tertentu.
     * @param {string} topic - Topic tujuan.
     * @param {object} payload - Data JSON yang akan dikirim.
     */
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

    // --- Fungsi Permintaan Data (Wrappers untuk publishMessage) ---
    /** Meminta informasi detail akun/wallet dari server. */
    function requestWalletInfo() {
        publishMessage(`${userCredentials.topicBase}/bankit/account-identity/request`, { "e-wallet": userCredentials.ewallet, "email": userCredentials.email });
    }
    /** Meminta riwayat transaksi dari server. */
    function requestHistory() {
        publishMessage(`${userCredentials.topicBase}/bankit/wallet-history/request`, { "e-wallet": userCredentials.ewallet, "email": userCredentials.email, "payment_method": userCredentials.ewallet_val });
    }
    /** Meminta daftar produk yang tersedia di toko. */
    function requestProductCatalog() {
        publishMessage(`${userCredentials.topicBase}/shopit/product-catalog/request`, {});
    }
    /** Meminta detail spesifik dari satu produk. */
    function requestProductDetail(productId) {
        publishMessage(`${userCredentials.topicBase}/shopit/product-detail/request`, { "product_id": productId });
    }
    /** Meminta penambahan saldo (top-up) ke server. */
    function requestTopUp(amount) {
        publishMessage(`${userCredentials.topicBase}/bankit/${userCredentials.ewallet_val}/give-balance/request`, { "email": userCredentials.email, "amount": amount });
    }

    // --- [REVISI V4] Fungsi Aksi Pembelian dengan Validasi Saldo ---
    /** Menangani konfirmasi pembelian setelah pengguna menekan tombol "Beli Sekarang". */
    const handlePurchaseConfirmation = () => {
        const confirmButton = document.getElementById('confirmPurchaseBtn');
        if (!confirmButton) return;

        // Ambil data dari form modal
        const productId = confirmButton.getAttribute('data-product-id');
        const quantityInput = document.getElementById('buyQuantity');
        const quantity = parseInt(quantityInput.value, 10);
        const maxStock = parseInt(quantityInput.max, 10);

        // Validasi input kuantitas
        if (!productId || !quantity || quantity <= 0) {
            showNotification("Jumlah pembelian tidak valid.", true); return;
        }
        if (quantity > maxStock) {
            showNotification(`Pembelian melebihi stok yang tersedia (${maxStock}).`, true); return;
        }

        // Cari produk di cache katalog untuk mendapatkan harga
        const product = productCatalog.find(p => p.id == productId);
        if (!product) {
            showNotification("Error: Detail produk tidak ditemukan.", true); return;
        }

        const totalCost = product.price * quantity;
        const currentBalance = getCurrentEwalletBalance();

        // [PENTING] Validasi saldo di sisi klien sebelum mengirim request pembelian.
        if (totalCost > currentBalance) {
            showNotification(`Saldo Anda tidak cukup untuk melakukan pembelian ini. (${formatCurrency(currentBalance)} / ${formatCurrency(totalCost)})`, true);
            logSystem(`Pembelian dibatalkan: Saldo tidak cukup.`, "WARN");
            return; // Hentikan proses jika saldo tidak cukup
        }

        // Simpan percobaan pembelian untuk dicocokkan dengan respons server nanti
        lastPurchaseAttempt = { cost: totalCost, timestamp: Date.now() };

        // Kirim request pembelian ke server
        const topic = `${userCredentials.topicBase}/shopit/buy/request`;
        const payload = {
            "product_id": productId,
            "quantity": quantity,
            "buyer_email": userCredentials.email,
            "payment_method": userCredentials.ewallet_val
        };
        logSystem(`Mencoba membeli produk seharga ${formatCurrency(totalCost)}`, "INFO");
        publishMessage(topic, payload);
    };

    // --- Penanganan Response dari Server ---
    /** Menangani respons info wallet, digunakan untuk sinkronisasi saldo awal. */
    function handleWalletResponse(data) {
        const ewallet = userCredentials.ewallet_val;
        // Hanya update jika saldo belum ada di cache dan respons sukses
        if (clientBalances[ewallet] === undefined && data.code === 200 && data.status === true && data.data) {
            const serverBalance = data.data.balance !== undefined ? data.data.balance : 0;
            updateCurrentEwalletBalance(serverBalance);
        }
    }

    /** [REVISI V4] Menangani respons transfer dengan logika cerdas. */
    function handleTransferResponse(data) {
        const isSuccess = data.code === 200 && data.status === true;
        showNotification(data.message, !isSuccess);

        if (isSuccess) {
            lastActionTimestamp = Date.now(); // Tandai aksi manual untuk ignore notifikasi live

            const amount = parseInt(document.getElementById('amount').value, 10);
            const recipientUsername = document.getElementById('recipient').value.trim();
            const recipientEwallet = document.getElementById('recipient_ewallet').value;

            // WORKAROUND: Langsung kurangi saldo pengirim di UI untuk respons instan.
            if (amount > 0) {
                const currentBalance = getCurrentEwalletBalance();
                updateCurrentEwalletBalance(currentBalance - amount);
                logSystem(`WORKAROUND: Saldo ${userCredentials.ewallet_val} dikurangi manual ${formatCurrency(amount)}`, "WARN");
            }

            // [LOGIKA CERDAS] Deteksi jika transfer ke akun sendiri (e-wallet berbeda).
            if (recipientUsername === userCredentials.username) {
                logSystem("Deteksi transfer ke diri sendiri, e-wallet lain.", "INFO");
                const recipientCurrentBalance = clientBalances[recipientEwallet] || 0;
                // WORKAROUND: Tambahkan saldo di e-wallet tujuan secara lokal.
                clientBalances[recipientEwallet] = recipientCurrentBalance + amount;
                saveBalancesToCache(); // Simpan perubahan ke cache.
                logSystem(`WORKAROUND: Saldo ${recipientEwallet} ditambah manual ${formatCurrency(amount)}`, "WARN");
            }

            requestHistory(); // Minta riwayat baru
            document.getElementById('transferForm')?.reset();
        }
    }

    /** Menangani notifikasi live (misal: menerima transfer) */
    function handleLiveUpdateNotification(data) {
        // Abaikan jika notifikasi ini hasil dari aksi kita sendiri beberapa saat lalu.
        if (Date.now() - lastActionTimestamp < ACTION_IGNORE_WINDOW) {
            logSystem(`Notifikasi live diabaikan (jendela aksi manual).`, "WARN");
            showNotification(data.message, false);
            requestHistory();
            return;
        }
        // Jika notifikasi valid, update saldo dan minta riwayat baru.
        if (data.status === true && data.code === 200 && data.data) {
            showNotification(data.message, false);
            const amount = data.data.amount || 0;
            const newBalance = getCurrentEwalletBalance() + amount;
            updateCurrentEwalletBalance(newBalance);
            requestHistory();
        } else {
            showNotification(data.message, true);
        }
    }

    /** Menangani respons dari request top-up. */
    function handleTopUpResponse(data) {
        const isSuccess = data.code === 200 && data.status === true;
        showNotification(data.message, !isSuccess);
        if (isSuccess) {
            lastActionTimestamp = Date.now(); // Tandai aksi manual
            const amount = parseInt(document.getElementById('topupAmount').value, 10);
            // WORKAROUND: Update saldo lokal secara instan.
            const newBalance = getCurrentEwalletBalance() + amount;
            updateCurrentEwalletBalance(newBalance);
            requestHistory();
            document.getElementById('topupForm')?.reset();
        }
    }

    /** Menangani respons dari request pembelian produk. */
    function handleBuyResponse(data) {
        const isSuccess = data.code === 200 && data.status === true;
        showNotification(data.message, !isSuccess);

        // Hanya proses jika pembelian berhasil dan ada percobaan pembelian yang tercatat.
        if (isSuccess && lastPurchaseAttempt) {
            // Pastikan respons ini untuk percobaan pembelian yang baru saja dilakukan.
            if (Date.now() - lastPurchaseAttempt.timestamp < 5000) {
                lastActionTimestamp = Date.now(); // Tandai aksi manual
                const totalCost = lastPurchaseAttempt.cost;

                // WORKAROUND: Kurangi saldo lokal setelah pembelian berhasil.
                if (totalCost > 0) {
                    const newBalance = getCurrentEwalletBalance() - totalCost;
                    updateCurrentEwalletBalance(newBalance);
                    logSystem(`WORKAROUND: Saldo dikurangi manual sebesar ${formatCurrency(totalCost)} setelah pembelian.`, "WARN");
                }

                lastPurchaseAttempt = null; // Reset percobaan pembelian
                document.getElementById('productDetailModal').classList.add('hidden'); // Tutup modal
                requestProductCatalog(); // Refresh katalog (untuk stok)
                requestHistory(); // Refresh riwayat
            } else {
                logSystem("Menerima respons pembelian sukses, tapi sudah terlalu lama. Diabaikan.", "WARN");
                lastPurchaseAttempt = null;
            }
        }
    }

    /** Menangani respons riwayat transaksi dan menyimpannya ke localStorage. */
    function handleHistoryResponse(data) {
        if (data.code === 200 && data.status === true && data.data) {
            localStorage.setItem('transactionHistory', JSON.stringify(data.data.transactions || []));
            renderHistoryTable(); // Tampilkan data baru
        }
    }

    /** Menangani respons katalog produk dan menyimpannya ke variabel global. */
    function handleCatalogResponse(data) {
        productCatalog = (data.code === 200 && data.status === true && Array.isArray(data.data)) ? data.data : [];
        renderProductCatalog(); // Tampilkan katalog baru
    }

    /** Menangani respons detail produk dan menampilkannya di modal. */
    function handleProductDetailResponse(data) {
        if (data.code === 200 && data.status === true && data.data) {
            renderProductDetailModal(data.data);
        } else {
            // Sembunyikan modal jika produk tidak ditemukan atau error
            document.getElementById('productDetailModal').classList.add('hidden');
        }
    }

    // --- Fungsi Render UI (Lengkap) ---
    /** Memperbarui elemen UI berdasarkan status koneksi MQTT (terhubung/terputus). */
    function updateConnectionUI(connected) {
        // Pengelompokan elemen UI untuk kemudahan manajemen.
        const elements = {
            btnConnect: document.getElementById('btnConnect'), btnDisconnect: document.getElementById('btnDisconnect'),
            statusText: document.getElementById('statusText'), transferContainer: document.getElementById('transfer-form-container'),
            topupContainer: document.getElementById('topup-form-container'),
            inputs: [document.getElementById('inputKelas'), document.getElementById('inputKelompok'), document.getElementById('inputNrpSum'), document.getElementById('selectEwallet')],
            refreshBalanceBtn: document.getElementById('btnRefreshBalance'), transferInstruction: document.getElementById('transfer-instruction'),
            topupInstruction: document.getElementById('topup-instruction')
        };
        if (connected) {
            elements.btnConnect.classList.add('hidden'); elements.btnDisconnect.classList.remove('hidden');
            elements.statusText.textContent = 'Connected'; elements.statusText.className = 'text-green-500 font-bold';
            // Aktifkan form jika terhubung
            elements.transferContainer.classList.remove('opacity-50', 'pointer-events-none');
            elements.topupContainer.classList.remove('opacity-50', 'pointer-events-none');
            elements.transferInstruction.classList.add('hidden'); elements.topupInstruction.classList.add('hidden');
            elements.inputs.forEach(input => { if (input) input.disabled = true; }); // Nonaktifkan input login
            elements.refreshBalanceBtn.classList.remove('hidden');
        } else {
            elements.btnConnect.classList.remove('hidden'); elements.btnDisconnect.classList.add('hidden');
            elements.statusText.textContent = 'Disconnected'; elements.statusText.className = 'text-red-500 font-bold';
            // Nonaktifkan form jika terputus
            elements.transferContainer.classList.add('opacity-50', 'pointer-events-none');
            elements.topupContainer.classList.add('opacity-50', 'pointer-events-none');
            elements.transferInstruction.classList.remove('hidden'); elements.topupInstruction.classList.remove('hidden');
            elements.inputs.forEach(input => { if (input) input.disabled = false; }); // Aktifkan input login
            elements.refreshBalanceBtn.classList.add('hidden');
            if (!localStorage.getItem('userCredentials')) {
                 document.getElementById('ewalletText').textContent = '-'; document.getElementById('usernameText').textContent = '-';
                 document.getElementById('balanceText').textContent = 'Rp 0';
            }
        }
    }

    /** Mengambil data log dari localStorage dan menampilkannya di UI. */
    function renderSystemLogs() {
        const logsContainer = document.getElementById('systemLogs');
        if (!logsContainer) return;
        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');
        logsContainer.innerHTML = '';
        if (logs.length > 0) {
            logs.slice().reverse().forEach(log => {
                const p = document.createElement('p');
                // Beri warna berbeda untuk setiap tipe log
                if (log.includes('[ERROR]')) p.className = 'text-red-400';
                else if (log.includes('[SUCCESS]')) p.className = 'text-green-400';
                else if (log.includes('[WARN]')) p.className = 'text-yellow-400';
                else if (log.includes('[CACHE]')) p.className = 'text-blue-400';
                else if (log.includes('[MSG-IN]')) p.className = 'text-cyan-400';
                else if (log.includes('[MSG-OUT]')) p.className = 'text-purple-400';
                else p.className = 'text-gray-300';
                p.textContent = log;
                logsContainer.appendChild(p);
            });
        } else { logsContainer.textContent = 'Menunggu aktivitas sistem...'; }
    }

    /** Mengambil data riwayat transaksi dari localStorage dan menampilkannya dalam format tabel. */
    function renderHistoryTable() {
        const history = JSON.parse(localStorage.getItem('transactionHistory') || '[]');
        const tableBody = document.getElementById('historyTableBody');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        if (history.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Tidak ada riwayat transaksi.</td></tr>';
            return;
        }
        history.forEach(tx => {
            const isDebit = tx.balance_change < 0; // Tentukan apakah transaksi adalah pengeluaran (debit)
            const row = document.createElement('tr');
            row.className = 'bg-gray-800/50 border-b border-gray-700 hover:bg-gray-700/50';
            row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap">${new Date(tx.created_at).toLocaleString('id-ID')}</td><td class="px-6 py-4">${tx.transaction_type}</td><td class="px-6 py-4">${tx.description || '-'}</td><td class="px-6 py-4 font-semibold ${isDebit ? 'text-red-400' : 'text-green-400'}">${isDebit ? '' : '+'} ${formatCurrency(Math.abs(tx.balance_change))}</td><td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300">Berhasil</span></td>`;
            tableBody.appendChild(row);
        });
    }

    /** Menampilkan katalog produk di UI dalam bentuk grid kartu. */
    function renderProductCatalog() {
        const gridContainer = document.getElementById('product-catalog-grid');
        if (!gridContainer) return;
        gridContainer.innerHTML = '';
        if (productCatalog.length === 0) {
            gridContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">Tidak ada produk.</p>';
            return;
        }
        productCatalog.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card bg-gray-800/60 p-4 rounded-lg border border-gray-700 flex flex-col justify-between hover:border-cyan-500 transition cursor-pointer';
            card.setAttribute('data-product-id', product.id);
            card.innerHTML = `<div class="pointer-events-none"><img src="${product.image_url}" alt="${product.name}" class="w-full h-40 object-cover rounded-md mb-4 bg-gray-700"><h3 class="text-lg font-bold text-white">${product.name}</h3><p class="text-sm text-gray-400 mb-2">Stok: ${product.quantity}</p><p class="text-xl font-semibold text-cyan-400">${formatCurrency(product.price)}</p></div><button class="mt-4 w-full bg-cyan-700 text-white font-bold py-2 px-4 rounded hover:bg-cyan-600 transition pointer-events-none">Lihat Detail</button>`;
            // Tambahkan event listener untuk membuka modal detail saat kartu diklik.
            card.addEventListener('click', (e) => {
                const productId = e.currentTarget.getAttribute('data-product-id');
                document.getElementById('productDetailModal').classList.remove('hidden');
                document.getElementById('modalContent').innerHTML = '<p class="text-gray-400 col-span-full text-center">Memuat...</p>';
                requestProductDetail(productId);
            });
            gridContainer.appendChild(card);
        });
    }

    /** Menampilkan detail produk yang dipilih dalam sebuah modal. */
    function renderProductDetailModal(product) {
        const modalContent = document.getElementById('modalContent');
        if (!modalContent) return;
        modalContent.innerHTML = `<div><img src="${product.image_url}" alt="${product.name}" class="w-full h-auto object-cover rounded-lg bg-gray-700"></div><div class="flex flex-col justify-between"><div><h2 class="text-3xl font-bold text-white mb-2">${product.name}</h2><p class="text-2xl font-semibold text-cyan-400 mb-4">${formatCurrency(product.price)}</p><p class="text-sm text-gray-400 mb-1">Stok: <span class="font-bold text-white">${product.quantity}</span></p>${product.description ? `<p class="text-sm text-gray-300 mt-4">${product.description}</p>` : ''}</div><div class="mt-6"><div class="flex items-center gap-4"><label for="buyQuantity" class="text-sm font-medium text-gray-300">Jumlah:</label><input type="number" id="buyQuantity" name="quantity" min="1" max="${product.quantity}" value="1" class="w-24 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"></div><button id="confirmPurchaseBtn" data-product-id="${product.id}" class="w-full mt-4 bg-cyan-600 text-white font-bold py-3 px-4 rounded hover:bg-cyan-500 transition text-lg">Beli Sekarang</button></div></div>`;
        // Tambahkan event listener ke tombol beli di dalam modal.
        document.getElementById('confirmPurchaseBtn').addEventListener('click', handlePurchaseConfirmation);
    }

    // --- Inisialisasi Aplikasi ---
    /** Menginisialisasi semua event listener untuk elemen interaktif (tombol, form, navigasi). */
    function setupEventListeners() {
        // Event listener untuk tombol Connect.
        document.getElementById('btnConnect').addEventListener('click', () => {
            const ALLOWED_CLASS = "B"; const ALLOWED_GROUP = "N"; const ALLOWED_NRP_SUM = "118";
            const inputKelas = document.getElementById('inputKelas').value.trim().toUpperCase();
            const inputKelompok = document.getElementById('inputKelompok').value.trim().toUpperCase();
            const inputNrpSum = document.getElementById('inputNrpSum').value.trim();
            const ewalletSelect = document.getElementById('selectEwallet');
            
            // Validasi input
            if (!inputKelas || !inputKelompok || !inputNrpSum) { showNotification("Semua field harus diisi.", true); return; }
            if (inputKelas !== ALLOWED_CLASS || inputKelompok !== ALLOWED_GROUP || inputNrpSum !== ALLOWED_NRP_SUM) { showNotification("Akses Ditolak.", true); return; }

            // Buat kredensial berdasarkan input
            userCredentials = {
                username: `Kelompok_${inputKelompok}_Kelas_${inputKelas}`, password: `Insys#${inputKelas}${inputKelompok}#${inputNrpSum}`,
                email: `insys-${inputKelas}-${inputKelompok}@bankit.com`, ewallet: ewalletSelect.options[ewalletSelect.selectedIndex].text,
                ewallet_val: ewalletSelect.value, topicBase: `${inputKelas}/${inputKelompok}`,
                kelas: inputKelas, kelompok: inputKelompok, nrpSum: inputNrpSum
            };
            localStorage.setItem('userCredentials', JSON.stringify(userCredentials));
            
            // Update UI dan mulai koneksi
            document.getElementById('ewalletText').textContent = userCredentials.ewallet;
            document.getElementById('usernameText').textContent = userCredentials.username;
            updateClientBalanceUI();
            if (mqttClient && mqttClient.isConnected()) mqttClient.disconnect();
            connectToMqtt();
        });

        // Event listener untuk tombol Disconnect.
        document.getElementById('btnDisconnect').addEventListener('click', disconnectFromMqtt);
        
        // Event listener untuk form Top-Up.
        document.getElementById('topupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = parseInt(document.getElementById('topupAmount').value, 10);
            if (!amount || amount < 10000) { showNotification("Minimal top-up Rp 10.000.", true); return; }
            requestTopUp(amount);
        });
        
        // Event listener untuk form Transfer.
        document.getElementById('transferForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const recipientUsername = document.getElementById('recipient').value.trim();
            const recipientEwallet = document.getElementById('recipient_ewallet').value;
            const amount = parseInt(document.getElementById('amount').value, 10);
            
            // Validasi format username penerima
            const recipientRegex = /^Kelompok_([A-Z])_Kelas_([A-Z])$/i;
            const match = recipientUsername.match(recipientRegex);
            if (!match) { showNotification("Format Username Penerima salah!", true); return; }
            
            // Buat email penerima berdasarkan format yang ditentukan
            const receiverEmail = `insys-${match[2].toUpperCase()}-${match[1].toUpperCase()}@bankit.com`;
            publishMessage(`${userCredentials.topicBase}/bankit/${userCredentials.ewallet_val}/transfer/send/request`, { "sender_email": userCredentials.email, "receiver_payment_method": recipientEwallet, "receiver_email": receiverEmail, "amount": amount, "notes": document.getElementById('notes').value.trim() || "" });
        });
        
        // Event listener untuk tombol-tombol refresh.
        document.getElementById('btnRefreshBalance').addEventListener('click', requestWalletInfo);
        document.getElementById('btnRefreshHistory').addEventListener('click', requestHistory);
        document.getElementById('btnRefreshCatalog').addEventListener('click', requestProductCatalog);
        
        // Event listener untuk utility UI
        document.getElementById('clearLogsBtn').addEventListener('click', () => { localStorage.removeItem('systemLogs'); renderSystemLogs(); });
        document.getElementById('closeModalBtn').addEventListener('click', () => { document.getElementById('productDetailModal').classList.add('hidden'); });
        
        // Event listener untuk link navigasi.
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPageId = e.currentTarget.getAttribute('data-page');
                showPage(targetPageId);
                // Update style navigasi aktif
                document.querySelectorAll('.nav-link').forEach(l => l.classList.replace('bg-gray-800', 'hover:bg-gray-700'));
                e.currentTarget.classList.replace('hover:bg-gray-700', 'bg-gray-800');
            });
        });
    }

    /** Fungsi inisialisasi utama aplikasi. */
    function initApp() {
        logSystem("Aplikasi dimulai.", "SYSTEM");
        loadBalancesFromCache(); // Muat cache saldo
        
        // Cek jika ada kredensial yang tersimpan di localStorage
        const savedCreds = JSON.parse(localStorage.getItem('userCredentials'));
        if (savedCreds && savedCreds.kelas) {
            userCredentials = savedCreds;
            // Isi kembali form login dan info pengguna
            document.getElementById('inputKelas').value = userCredentials.kelas;
            document.getElementById('inputKelompok').value = userCredentials.kelompok;
            document.getElementById('inputNrpSum').value = userCredentials.nrpSum;
            document.getElementById('selectEwallet').value = userCredentials.ewallet_val;
            document.getElementById('ewalletText').textContent = userCredentials.ewallet;
            document.getElementById('usernameText').textContent = userCredentials.username;
            updateClientBalanceUI(); // Update saldo dari cache
            connectToMqtt(); // Coba hubungkan otomatis
        } else {
             updateConnectionUI(false); // Pastikan UI dalam state terputus
        }

        // Render data awal dari cache/default
        renderHistoryTable();
        renderSystemLogs();
        setupEventListeners();
        
        // Tampilkan halaman awal dan set navigasi aktif
        showPage('page-home');
        document.querySelector('.nav-link[data-page="page-home"]').classList.replace('hover:bg-gray-700', 'bg-gray-800');
    }

    // Jalankan aplikasi.
    initApp();
});
