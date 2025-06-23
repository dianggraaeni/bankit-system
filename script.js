document.addEventListener('DOMContentLoaded', () => {
    // --- Konfigurasi & Variabel Global ---
    const broker = {
        hostname: "147.182.226.225",
        port: 9001,
        clientId: "insys_client_" + parseInt(Math.random() * 10000)
    };

    const TOPICS = {
        GET_WALLET_IDENTITY: '/me/get-wallet-identity',
        TRANSFER: '/balance-transfer/transfer',
        ASK_BALANCE: '/balance-transfer/ask-balance',
        GET_HISTORY: '/history/get-wallet-balance',
        NOTIFICATION: '/notification',
        GET_CATALOGUE: '/shop-it/catalogue',
        GET_PRODUCT_DETAIL: '/shop-it/detail',
        PURCHASE_PRODUCT: '/shop-it/transaction'
    };

    let mqttClient = null;
    let userCredentials = JSON.parse(localStorage.getItem('userCredentials')) || {};

    const pageId = document.querySelector('main')?.id;

    // --- Fungsi Utilitas ---
    const showNotification = (message, isError = false, elementId = 'notification') => {
        const notifEl = document.getElementById(elementId);
        if (!notifEl) return;
        notifEl.textContent = message;
        notifEl.className = `mt-4 p-4 rounded-md text-center font-bold text-white ${isError ? 'bg-red-500/80' : 'bg-green-500/80'}`;
        setTimeout(() => {
            notifEl.className += ' hidden';
        }, 5000);
    };

    const logSystem = (message, type = 'INFO') => {
        const timestamp = new Date().toLocaleTimeString();
        const formattedMessage = `[${timestamp}] [${type}] ${message}`;
        console.log(formattedMessage);
        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');
        logs.push(formattedMessage);
        localStorage.setItem('systemLogs', JSON.stringify(logs));
        if (document.getElementById('systemLogs')) {
            renderSystemLogs();
        }
    };

    const formatCurrency = (value) => new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(value);

    // --- Logika MQTT ---
    function connectToMqtt() {
        if (mqttClient && mqttClient.isConnected()) {
            logSystem('Sudah terhubung, tidak perlu koneksi ulang.');
            onConnect(); // Jalankan onConnect untuk memicu pengambilan data
            return;
        }

        logSystem(`Mencoba koneksi ke mqtt://${broker.hostname}:${broker.port}`);
        mqttClient = new Paho.MQTT.Client(broker.hostname, broker.port, broker.clientId);
        mqttClient.onConnectionLost = onConnectionLost;
        mqttClient.onMessageArrived = onMessageArrived;

        mqttClient.connect({
            userName: userCredentials.username,
            password: userCredentials.password,
            onSuccess: onConnect,
            onFailure: (err) => {
                logSystem(`Koneksi Gagal: ${err.errorMessage}`, 'ERROR');
                showNotification(`Koneksi Gagal: ${err.errorMessage}`, true);
                localStorage.removeItem('userCredentials');
            },
            useSSL: false,
            cleanSession: true // Pastikan session bersih setiap konek
        });
    }

    function onConnect() {
        logSystem(`Terhubung sebagai ${userCredentials.username}`, 'SUCCESS');
        const topicToSubscribe = `${userCredentials.topicBase}/#`;
        mqttClient.subscribe(topicToSubscribe);
        logSystem(`Subscribe ke topic: ${topicToSubscribe}`);

        // *** FIX KUNCI: Minta data HANYA setelah koneksi berhasil ***
        // Logika ini akan berjalan di setiap halaman yang membutuhkannya
        if (pageId === 'transfer-page') {
            updateConnectionUI(true);
            // Minta info wallet/saldo
            publishMessage(`${userCredentials.topicBase}${TOPICS.GET_WALLET_IDENTITY}/request`, {
                "e-wallet": userCredentials.ewallet
            });
        }
        if (pageId === 'history-page') {
            publishMessage(`${userCredentials.topicBase}${TOPICS.GET_HISTORY}/request`, {
                "e-wallet": userCredentials.ewallet
            });
        }
        if (pageId === 'shop-page') {
            document.getElementById('shop-connection-warning').classList.add('hidden');
            publishMessage(`${userCredentials.topicBase}${TOPICS.GET_CATALOGUE}/request`, {});
        }
    }

    function onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) logSystem(`Koneksi terputus: ${responseObject.errorMessage}`, 'ERROR');
        if (pageId === 'transfer-page') updateConnectionUI(false);
    }

    function disconnectFromMqtt() {
        if (mqttClient && mqttClient.isConnected()) mqttClient.disconnect();
        logSystem('Koneksi diputus oleh pengguna.');
        localStorage.clear();
        window.location.reload();
    }

    function onMessageArrived(message) {
        const topic = message.destinationName;
        const payloadString = message.payloadString;
        logSystem(`Pesan diterima dari: ${topic}`, 'MSG-IN');
        logSystem(`Payload: ${payloadString}`, 'PAYLOAD');

        try {
            const data = JSON.parse(payloadString);

            // Gunakan endsWith untuk mencocokkan response
            if (topic.endsWith(`${TOPICS.GET_WALLET_IDENTITY}/response`)) handleWalletIdentityResponse(data);
            // *** FIX: Tambahkan handler spesifik untuk response ask-balance ***
            else if (topic.endsWith(`${TOPICS.ASK_BALANCE}/response`)) handleWalletIdentityResponse(data);
            else if (topic.endsWith(`${TOPICS.TRANSFER}/response`)) handleTransferResponse(data);
            else if (topic.endsWith(`${TOPICS.GET_HISTORY}/response`)) handleHistoryResponse(data);
            else if (topic.endsWith(TOPICS.NOTIFICATION)) handleNotification(data);
            else if (topic.endsWith(`${TOPICS.GET_CATALOGUE}/response`)) handleCatalogueResponse(data);
            else if (topic.endsWith(`${TOPICS.GET_PRODUCT_DETAIL}/response`)) handleProductDetailResponse(data);
            else if (topic.endsWith(`${TOPICS.PURCHASE_PRODUCT}/response`)) handlePurchaseResponse(data);

        } catch (e) {
            logSystem(`Gagal mem-parsing JSON: ${e}`, 'ERROR');
        }
    }

    function publishMessage(topic, payload) {
        if (!mqttClient || !mqttClient.isConnected()) {
            showNotification("Tidak terhubung ke broker. Silakan coba konek ulang.", true);
            return;
        }
        const message = new Paho.MQTT.Message(JSON.stringify(payload));
        message.destinationName = topic;
        mqttClient.send(message);
        logSystem(`Pesan dikirim ke: ${topic}`, 'MSG-OUT');
        logSystem(`Payload: ${JSON.stringify(payload)}`, 'PAYLOAD');
    }

    // --- Penanganan Response & Logika Fitur ---
    function handleWalletIdentityResponse(data) {
        if (data.status_code === 200) {
            const userInfo = {
                balance: data.data.balance,
                username: userCredentials.username,
                ewallet: userCredentials.ewallet
            };
            localStorage.setItem('userInfo', JSON.stringify(userInfo));
            if (pageId === 'transfer-page') {
                updateUserInfoUI(userInfo);
                showNotification("Data akun berhasil dimuat!", false);
            }
        } else {
            showNotification(`Gagal mendapatkan data: ${data.message}`, true, pageId === 'shop-page' ? 'shop-notification' : 'notification');
        }
    }

    function handleTransferResponse(data) {
        const isSuccess = data.status_code === 200;
        showNotification(data.message, !isSuccess);
        publishMessage(`${userCredentials.topicBase}${TOPICS.ASK_BALANCE}/request`, {
            "e-wallet": userCredentials.ewallet
        });
        addTransactionToHistory({
            timestamp: new Date().toISOString(),
            type: 'Transfer Keluar',
            description: `Ke: ${document.getElementById('recipient').value} - ${document.getElementById('notes').value || 'Tanpa catatan'}`,
            amount: document.getElementById('amount').value,
            status: isSuccess ? 'Berhasil' : 'Gagal'
        });
        if (isSuccess) document.getElementById('transferForm').reset();
    }

    function handleHistoryResponse(data) {
        if (data.status_code === 200) {
            localStorage.setItem('transactionHistory', JSON.stringify(data.data.history || []));
            if (pageId === 'history-page') renderHistoryTable();
            showNotification("Riwayat transaksi berhasil diperbarui.", false);
        } else {
            showNotification(`Gagal mengambil riwayat: ${data.message}`, true);
        }
    }

    function handleNotification(data) {
        showNotification(`Notifikasi: ${data.message}`, false);
        publishMessage(`${userCredentials.topicBase}${TOPICS.ASK_BALANCE}/request`, {
            "e-wallet": userCredentials.ewallet
        });
        publishMessage(`${userCredentials.topicBase}${TOPICS.GET_HISTORY}/request`, {
            "e-wallet": userCredentials.ewallet
        });
    }

    function handleCatalogueResponse(data) {
        if (data.status_code === 200) {
            renderProductCatalogue(data.data.products);
        } else {
            document.getElementById('product-catalogue').innerHTML = `<p class="text-red-400 col-span-full">Gagal memuat katalog: ${data.message}</p>`;
        }
    }

    function handleProductDetailResponse(data) {
        if (data.status_code === 200) {
            renderProductDetail(data.data);
        } else {
            showNotification(`Gagal mengambil detail: ${data.message}`, true, 'shop-notification');
        }
    }

    function handlePurchaseResponse(data) {
        const isSuccess = data.status_code === 200;
        showNotification(data.message, !isSuccess, 'shop-notification');
        publishMessage(`${userCredentials.topicBase}${TOPICS.ASK_BALANCE}/request`, {
            "e-wallet": userCredentials.ewallet
        });
        if (isSuccess) {
            addTransactionToHistory({
                timestamp: new Date().toISOString(),
                type: 'Pembelian ShopIT',
                description: `Produk: ${data.data.product_name}`,
                amount: data.data.total_price,
                status: 'Berhasil'
            });
            document.getElementById('product-detail-content').innerHTML = '<p>Pembelian berhasil! Pilih produk lain untuk dibeli.</p>';
            document.getElementById('purchase-form-container').classList.add('hidden');
        }
    }

    // --- Fungsi UI & Rendering ---
    function updateConnectionUI(connected) {
        const btnConnect = document.getElementById('btnConnect');
        const btnDisconnect = document.getElementById('btnDisconnect');
        const statusText = document.getElementById('statusText');
        const transferContainer = document.getElementById('transfer-form-container');
        const inputs = [document.getElementById('inputKelas'), document.getElementById('inputKelompok'), document.getElementById('inputNrpSum'), document.getElementById('selectEwallet')];
        const refreshBalanceBtn = document.getElementById('btnRefreshBalance');

        if (connected) {
            btnConnect.classList.add('hidden');
            btnDisconnect.classList.remove('hidden');
            statusText.textContent = 'Connected';
            statusText.className = 'text-green-500 font-bold';
            transferContainer.classList.remove('opacity-50', 'pointer-events-none');
            document.getElementById('transfer-instruction').classList.add('hidden');
            inputs.forEach(input => input.disabled = true);
            refreshBalanceBtn.classList.remove('hidden');
        } else {
            btnConnect.classList.remove('hidden');
            btnDisconnect.classList.add('hidden');
            statusText.textContent = 'Disconnected';
            statusText.className = 'text-red-500 font-bold';
            transferContainer.classList.add('opacity-50', 'pointer-events-none');
            document.getElementById('transfer-instruction').classList.remove('hidden');
            inputs.forEach(input => input.disabled = false);
            refreshBalanceBtn.classList.add('hidden');
        }
    }

    function updateUserInfoUI(info) {
        if (pageId !== 'transfer-page') return;
        document.getElementById('ewalletText').textContent = info.ewallet || '-';
        document.getElementById('usernameText').textContent = info.username || '-';
        document.getElementById('balanceText').textContent = info.balance !== '-' ? formatCurrency(info.balance) : '-';
    }

    function addTransactionToHistory(tx) {
        let history = JSON.parse(localStorage.getItem('transactionHistory') || '[]');
        history.unshift(tx);
        localStorage.setItem('transactionHistory', JSON.stringify(history));
        if (pageId === 'history-page') renderHistoryTable();
    }

    function renderHistoryTable() {
        const history = JSON.parse(localStorage.getItem('transactionHistory') || '[]');
        const tableBody = document.getElementById('historyTableBody');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        if (history.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Tidak ada riwayat. Klik tombol refresh atau lakukan transaksi.</td></tr>';
            return;
        }
        history.forEach(tx => {
            const typeClass = tx.type.includes('Keluar') || tx.type.includes('Pembelian') ? 'text-red-400' : 'text-green-400';
            const sign = tx.type.includes('Keluar') || tx.type.includes('Pembelian') ? '-' : '+';
            const row = `
                <tr class="bg-gray-800/50 border-b border-gray-700 hover:bg-gray-700/50">
                    <td class="px-6 py-4">${new Date(tx.timestamp || Date.now()).toLocaleString('id-ID')}</td>
                    <td class="px-6 py-4">${tx.type}</td>
                    <td class="px-6 py-4">${tx.description}</td>
                    <td class="px-6 py-4 font-semibold ${typeClass}">${sign} ${formatCurrency(tx.amount)}</td>
                    <td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-xs font-bold ${tx.status === 'Berhasil' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}">${tx.status}</span></td>
                </tr>`;
            tableBody.innerHTML += row;
        });
    }

    function renderSystemLogs() {
        const logsContainer = document.getElementById('systemLogs');
        if (!logsContainer) return;
        const logs = JSON.parse(localStorage.getItem('systemLogs') || '[]');
        logsContainer.innerHTML = logs.length > 0 ? logs.join('\n') : '<p class="text-gray-500">Menunggu aktivitas sistem...</p>';
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    function renderProductCatalogue(products) {
        const catalogueContainer = document.getElementById('product-catalogue');
        catalogueContainer.innerHTML = '';
        products.forEach(product => {
            const card = document.createElement('div');
            card.className = "bg-gray-800/70 p-4 rounded-lg border border-gray-700 hover:border-cyan-500 hover:bg-gray-800 cursor-pointer transition techno-glow";
            card.dataset.productId = product.id;
            card.innerHTML = `
                <img src="${product.image_url || 'https://via.placeholder.com/300'}" alt="${product.name}" class="w-full h-40 object-cover rounded mb-4">
                <h3 class="text-lg font-bold text-white">${product.name}</h3>
                <p class="text-cyan-400 font-semibold">${formatCurrency(product.price)}</p>
            `;
            card.addEventListener('click', () => {
                publishMessage(`${userCredentials.topicBase}${TOPICS.GET_PRODUCT_DETAIL}/request`, {
                    "product_id": product.id
                });
                document.getElementById('product-detail-content').innerHTML = '<p>Memuat detail produk...</p>';
            });
            catalogueContainer.appendChild(card);
        });
    }

    function renderProductDetail(product) {
        document.getElementById('product-detail-content').innerHTML = `
            <img src="${product.image_url || 'https://via.placeholder.com/300'}" alt="${product.name}" class="w-full h-48 object-cover rounded mb-4">
            <h3 class="text-xl font-bold text-white">${product.name}</h3>
            <p class="text-cyan-400 text-lg font-semibold">${formatCurrency(product.price)}</p>
            <p class="text-gray-400 text-sm my-2">${product.description}</p>
            <p class="text-sm">Stok: <span class="font-bold">${product.inventory}</span></p>
        `;
        document.getElementById('purchaseProductId').value = product.id;
        document.getElementById('purchase-form-container').classList.remove('hidden');
    }

    // --- Inisialisasi Halaman ---
    function initTransferPage() {
        const savedCreds = localStorage.getItem('userCredentials');
        if (savedCreds) {
            const creds = JSON.parse(savedCreds);
            userCredentials = creds; // Muat kredensial
            const {
                username,
                password,
                ewallet
            } = creds;
            const userParts = username.split('_');
            const passParts = password.split('#');
            document.getElementById('inputKelas').value = userParts[3];
            document.getElementById('inputKelompok').value = userParts[1];
            document.getElementById('inputNrpSum').value = passParts[2];
            document.getElementById('selectEwallet').value = ewallet;
            connectToMqtt(); // Otomatis konek jika ada kredensial tersimpan
        }

        const savedUserInfo = localStorage.getItem('userInfo');
        if (savedUserInfo) {
            updateUserInfoUI(JSON.parse(savedUserInfo));
        }

        document.getElementById('btnConnect').addEventListener('click', () => {
            const kelas = document.getElementById('inputKelas').value.trim().toUpperCase();
            const kelompok = document.getElementById('inputKelompok').value.trim().toUpperCase();
            const nrpSum = document.getElementById('inputNrpSum').value.trim();
            if (!kelas || !kelompok || !nrpSum) {
                showNotification("Semua field kredensial harus diisi!", true);
                return;
            }
            userCredentials = {
                email: `insys-${kelas}-${kelompok}@bankit.com`,
                username: `Kelompok_${kelompok}_Kelas_${kelas}`,
                password: `Insys#${kelas}${kelompok}#${nrpSum}`,
                ewallet: document.getElementById('selectEwallet').value,
                topicBase: `${kelas}/${kelompok}`
            };
            localStorage.setItem('userCredentials', JSON.stringify(userCredentials));
            connectToMqtt();
        });
        document.getElementById('btnDisconnect').addEventListener('click', disconnectFromMqtt);
        document.getElementById('transferForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const payload = {
                "e-wallet": userCredentials.ewallet,
                "receiver_username": document.getElementById('recipient').value,
                "amount": parseInt(document.getElementById('amount').value),
                "notes": document.getElementById('notes').value
            };
            publishMessage(`${userCredentials.topicBase}${TOPICS.TRANSFER}/request`, payload);
        });
        document.getElementById('btnRefreshBalance').addEventListener('click', () => {
            publishMessage(`${userCredentials.topicBase}${TOPICS.ASK_BALANCE}/request`, {
                "e-wallet": userCredentials.ewallet
            });
            showNotification("Meminta data saldo terbaru...", false);
        });
    }

    function initOtherPages() {
        // *** FIX KUNCI: Logika terpusat untuk halaman selain Transfer ***
        if (Object.keys(userCredentials).length > 0) {
            connectToMqtt();
        } else {
            if (pageId === 'shop-page') {
                document.getElementById('shop-connection-warning').classList.remove('hidden');
            }
            if (pageId === 'history-page') {
                document.getElementById('historyTableBody').innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Silakan hubungkan akun di halaman Transfer untuk melihat riwayat.</td></tr>';
            }
        }

        if (pageId === 'history-page') {
            renderHistoryTable();
            renderSystemLogs();
            document.getElementById('btnRefreshHistory').addEventListener('click', () => {
                if (!mqttClient || !mqttClient.isConnected()) {
                    showNotification("Hubungkan akun di halaman Transfer terlebih dahulu.", true);
                    return;
                }
                publishMessage(`${userCredentials.topicBase}${TOPICS.GET_HISTORY}/request`, {
                    "e-wallet": userCredentials.ewallet
                });
            });
            document.getElementById('clearLogsBtn').addEventListener('click', () => {
                localStorage.removeItem('systemLogs');
                renderSystemLogs();
            });
        }

        if (pageId === 'shop-page') {
            document.getElementById('purchaseForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const payload = {
                    "product_id": document.getElementById('purchaseProductId').value,
                    "quantity": parseInt(document.getElementById('purchaseQuantity').value),
                    "e-wallet": userCredentials.ewallet
                };
                publishMessage(`${userCredentials.topicBase}${TOPICS.PURCHASE_PRODUCT}/request`, payload);
            });
        }
    }

    // Router sederhana
    if (pageId === 'transfer-page') initTransferPage();
    else if (pageId === 'history-page' || pageId === 'shop-page') initOtherPages();
});