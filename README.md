# Final Project Integrasi Sistem: Website Integrasi BankIT & ShopIT

![MQTT](https://img.shields.io/badge/MQTT-660066?style=for-the-badge&logo=mqtt&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white)

Proyek ini adalah sebuah website sederhana yang dibangun untuk memenuhi tugas akhir mata kuliah Integrasi Sistem. Website ini berinteraksi secara *real-time* dengan layanan `BankIT` (sistem transfer) dan `ShopIT` (e-commerce) menggunakan protokol **MQTT** untuk semua pertukaran datanya.

##  Latar Belakang
-   **BankIT**: Sebuah bank sentral IT yang menyediakan layanan transfer antar E-Wallet (DoPay, OWO, RiNG Aja) tanpa biaya admin.
-   **ShopIT**: Toko online resmi di bawah naungan BankIT yang memungkinkan pengguna berbelanja dan membayar menggunakan E-Wallet mitra BankIT.

Tujuan utama proyek ini adalah mengintegrasikan sebuah frontend website dengan kedua layanan tersebut, menunjukkan kemampuan sistem untuk berkomunikasi secara asinkron dan *real-time*.

## 📸 Tampilan Website

Berikut adalah pratinjau dari antarmuka dan fungsionalitas utama Website Integrasi BankIT.

### Halaman Utama
<img width="1919" height="886" alt="image" src="https://github.com/user-attachments/assets/d710682f-67eb-47b0-b91f-255669f41e10" />

### Halaman Transfer
<img width="1912" height="876" alt="image" src="https://github.com/user-attachments/assets/26d94e22-861d-4efd-8e19-3940ceeae7a1" />

### Halaman Riwayat
<img width="1919" height="881" alt="image" src="https://github.com/user-attachments/assets/961e11b5-e128-4570-9fe2-7567aa26da9f" />

### Halaman ShopIT
<img width="1898" height="903" alt="Screenshot 2025-06-25 092210" src="https://github.com/user-attachments/assets/4df5ee60-c6c7-484f-8998-afc072fd565b" />

## ✨ Fitur Aplikasi
<table>
<thead>
<tr>
<th width="30%">Fitur</th>
<th>Deskripsi</th>
</tr>
</thead>
<tbody>
<tr>
<th colspan="2">
<div align="center">User Profile</div>
</th>
</tr>
<tr>
<td>My Profile</td>
<td>Tampilkan profil pengguna sesuai dengan kelas dan kelompok kalian.</td>
</tr>
<tr>
<td>My Wallet</td>
<td>Tampilkan profil E-Wallet yang dipilih.</td>
</tr>
<tr>
<th colspan="2">
<div align="center">Wallet</div>
</th>
</tr>
<tr>
<td>Balance Transfer</td>
<td>Lakukan transfer saldo ke E-Wallet lain dari kelompok kalian. Juga dapat dilakukan ke kelompok lain!</td>
</tr>
<tr>
<td>Live Update Transfer</td>
<td>Subscribe ke topic yang sesuai untuk menampilkan transfer yang baru saja diterima secara live.</td>
</tr>
<tr>
<th colspan="2">
<div align="center">History</div>
</th>
</tr>
<tr>
<td>Get Wallet History</td>
<td>Tampilkan history saldo yang masuk dan keluar dari E-Wallet mulai dari awal hingga akhir.</td>
</tr>
<tr>
<td>Live Update Wallet</td>
<td>Subscribe ke topic yang sesuai untuk menampilkan perubahan saldo E-Wallet secara live.</td>
</tr>
<tr>
<th colspan="2">
<div align="center">ShopIT</div>
</th>
</tr>
<tr>
<td>View Product Catalogue</td>
<td>Tampilkan katalog produk yang dijual pada ShopIT.</td>
</tr>
<tr>
<td>View Product Detail</td>
<td>Menampilkan detail produk berdasarkan id produk.</td>
</tr>
<tr>
<td>Product Transaction</td>
<td>Lakukan pembelian produk pada ShopIT. (Apabila stok produk menyentuh angka 0, maka server akan melakukan restock produk secara otomatis. Namun transaksi tetap tidak dapat menyebabkan stok produk bernilai negatif. Misal produk tersisa 5, maka user hanya dapat membeli maksimal 5 buah produk).</td>
</tr>
</tbody>
</table>

## 🛠️ Teknologi dan Arsitektur

-   **Protokol Komunikasi**: **MQTT** sebagai protokol utama untuk semua interaksi dengan backend.
-   **Broker MQTT**:
    -   URL: `mqtt://147.182.226.225:1883`
    -   WebSocket URL: `ws://147.182.226.225:9001`
-   **Frontend**: HTML, CSS, JavaScript (Natif).
-   **Library**:
    -   **Paho MQTT (JavaScript Client)**: Untuk koneksi ke broker MQTT dari browser.
    -   **Bootstrap**: Untuk tata letak dan komponen antarmuka yang responsif.

## 🚀 Panduan Menjalankan Proyek

Untuk menjalankan dan menguji website ini di lingkungan lokal, ikuti langkah-langkah berikut.

### 1. Clone Repositori
```
git clone [URL_REPOSITORI]
cd [NAMA_FOLDER_REPOSITORI]
```

### 2. Konfigurasi Kredensial

Kunci dari proyek ini adalah konfigurasi kredensial yang tepat.

1. Buka file config.js (atau buat jika belum ada).

2. Isi kredensial sesuai dengan kelas dan kelompok menggunakan format yang benar.
```
// Ganti semua nilai di bawah ini dengan kredensial kelompok!
const CONFIG = {
    // -- Kredensial MQTT --
    // Email: insys-[KELAS]-[KELOMPOK]@bankit.com

    // Username: Kelompok_[KELOMPOK]_Kelas_[KELAS]

    // Password: Insys#[KELAS][KELOMPOK]#[3 Digit Terakhir Penjumlahan NRP Anggota]

    // -- Konfigurasi Broker --
    broker_ws: "ws://147.182.226.225:9001",

    // -- Konfigurasi Topik --
    // Format: [KELAS]/[KELOMPOK]
};
```

### 3. Jalankan Website

Karena ini adalah proyek frontend murni, maka dapat membukanya langsung di browser.

Cara Termudah: Buka file index.html langsung di browser (Google Chrome, Firefox, dll). Jika menggunakan Visual Studio Code, instal ekstensi Live Server, lalu klik kanan pada file index.html dan pilih Open with Live Server. 

## 👥 Tim Pengembang
|           Nama                  |     NRP    |
|            --                   |     --     |
| Dian Anggraeni Putri            | 5027231016 |
| ⁠Fadlillah Cantika Sari Hermawan | 5027231042 |
| ⁠Callista Meyra Azizah           | 5027231060 |

## 📚 Dokumentasi Topik MQTT

Seluruh interaksi dengan backend (mengirim permintaan dan menerima respon) dilakukan dengan mem-publish dan men-subscribe ke topik-topik MQTT tertentu.

Dokumentasi lengkap mengenai struktur topic, format payload (JSON), dan contoh interaksi dapat diakses melalui link Postman resmi berikut: https://www.postman.com/test-team-6586/workspace/fp-insys-2025/collection/683fae100426eb854a30e9e5?action=share&creator=32567284&active-environment=32567284-97cf3e4b-a4a0-4454-9387-be210337ce8f
