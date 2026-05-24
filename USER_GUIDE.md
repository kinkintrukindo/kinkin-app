# Panduan Pengguna — Aplikasi Kin Kin Trukindo

Panduan ini ditujukan untuk admin atau pemilik yang mengelola aplikasi ini sehari-hari. Tidak perlu latar belakang teknis.

---

## Pertama Kali Menggunakan

**Buka di browser:** [kinkintrukindo.com](https://kinkintrukindo.com)

Aplikasi ini bisa dibuka dari perangkat apapun — laptop, HP, atau tablet — karena semua data tersimpan di cloud. Tidak perlu install apapun.

**Login:** Masukkan kode otorisasi, lalu klik **Authorize**.

---

## Tampilan Utama

Di bagian atas ada **7 tab** (menu). Klik tab untuk berpindah halaman:

| Tab | Fungsi |
|---|---|
| 📊 Dashboard | Ringkasan bisnis secara keseluruhan |
| 🚛 Trips | Daftar perjalanan / trip truk |
| 💸 Expenses | Pencatatan pengeluaran |
| 🏦 Cash | Kas masuk dan keluar |
| 👛 Petty Cash | Uang operasional harian (Martha) |
| 💰 Capital & Fleet | Aset truk, cicilan, dan modal |
| 📄 Reports | Laporan keuangan |

---

## Tab 1 — Dashboard

Halaman ini langsung terlihat saat pertama buka. Isinya:

**Kartu KPI (angka-angka besar di atas):**
- **Total Revenue** — total nilai invoice yang dikirim ke klien
- **Trip Gross Profit** — keuntungan kotor dari trip (revenue dikurangi biaya pengemudi)
- **Truck Ops Expenses** — pengeluaran operasional truk (BBM, tol, sparepart, dll)
- **Overhead Expenses** — pengeluaran kantor (administrasi, izin, dll)
- **Net Profit** — keuntungan bersih setelah semua pengeluaran
- **Cash Balance** — saldo kas yang tersisa

Klik kartu mana saja untuk melihat rinciannya.

**Grafik:** Menampilkan tren revenue dan profit per bulan.

**Import Excel:** Tombol kuning **📥 Import Excel Sheet** di pojok kanan atas. Digunakan setiap bulan untuk memasukkan laporan dari Martha.

**Import History:** Daftar semua file yang pernah diimpor. Tombol 🗑 Undo untuk membatalkan impor jika ada kesalahan.

---

## Tab 2 — Trips

Daftar semua perjalanan truk. Setiap baris berisi:
- Tanggal, nomor invoice, tujuan, plat truk, nomor container
- **Sangu** = uang saku pengemudi
- **Lain-lain** = biaya tambahan lain
- **Total** = total biaya pengemudi (sangu + lain-lain)
- **Invoiced (Jual)** = nilai invoice ke klien (pendapatan)
- **Profit** = invoiced dikurangi total biaya pengemudi

### Cara Menambah Trip Manual

Klik tombol **+ Add Trip** di kanan atas, isi formulir, klik **Add Trip**.

### Cara Edit Trip

Klik ✏️ di baris trip yang ingin diubah. Edit langsung di tabel, klik ✓ untuk menyimpan atau ✕ untuk batal.

### Cara Hapus Trip

Klik 🗑 di baris yang ingin dihapus. Akan ada konfirmasi sebelum dihapus.

---

## Tab 3 — Expenses (Pengeluaran)

Halaman ini untuk mencatat semua pengeluaran, dibagi tiga jenis:

### Jenis Pengeluaran

**Truck / Operational** — pengeluaran yang berkaitan langsung dengan truk:
- BBM (Fuel), Tol (Toll), Servis (Repair), Sparepart, Garasi, dll

**Overhead** — pengeluaran kantor/bisnis:
- Gaji, Sewa, Listrik, Administrasi, Asuransi, Marketing, dll

**Petty Cash** — pengisian uang operasional ke Martha (lihat Tab Petty Cash)

### Cara Menambah Pengeluaran

1. Pilih jenis: **Truck**, **Overhead**, atau **Petty Cash**
2. Isi tanggal, kategori, keterangan, jumlah
3. Untuk **Truck**: pilih plat truk mana
4. Untuk **Overhead**: isi nama vendor (opsional)
5. Klik **+ Add Expense**

### Filter Periode

Di bagian atas ada tombol **All Time / This Month / Last Month / Year to Date** untuk memfilter tampilan. Bisa juga pilih rentang tanggal custom.

---

## Tab 4 — Cash (Kas)

Buku kas sederhana — mencatat semua uang yang masuk dan keluar dari rekening/kas perusahaan.

**Saldo Kas** = semua pemasukan dikurangi semua pengeluaran.

### Cara Menambah Entri Kas

1. Pilih **Cash In** atau **Cash Out**
2. Isi tanggal, keterangan, jumlah
3. Klik **+ Add Entry**

> **Catatan:** Pengisian petty cash ke Martha otomatis tercatat di sini saat ditambahkan dari tab Petty Cash atau Expenses. Pembayaran cicilan truk juga perlu dicatat di sini secara manual jika belum ada.

---

## Tab 5 — Petty Cash

Halaman ini untuk memantau **uang operasional harian** yang dipegang oleh Martha.

**Cara kerjanya:**
- Perusahaan memberikan uang ke Martha (top-up)
- Martha menggunakannya untuk pengeluaran harian
- Setiap bulan Martha melaporkan pengeluaran lewat file CSV/Excel
- Saldo Martha = total uang diberikan − total pengeluaran

### Cara Melihat Rincian Martha

Klik kartu **Martha** untuk melihat semua top-up dan pengeluaran yang tercatat atas namanya.

### Cara Mencatat Top-Up ke Martha

Di bagian **Record Top-Up**, pilih Martha, isi tanggal dan jumlah, klik **+ Record Top-Up**.

> Ini otomatis juga tercatat sebagai **Cash Out** di tab Cash.

### Pengeluaran Tidak Tertugaskan (Unassigned)

Jika ada pengeluaran dari impor yang belum ditugaskan ke Martha, akan muncul kartu **Unassigned Expenses**. Klik tombol **Assign to [Nama]** untuk menugaskannya.

---

## Tab 6 — Capital & Fleet

Halaman ini dibagi dua sub-tab:

### Sub-tab: Fleet & Loans (Aset & Cicilan)

Menampilkan kedua truk beserta jadwal cicilan:
- **B9674UEJ** — cicilan Rp 10.877.000/bulan × 36 bulan (mulai Maret 2026)
- **E9129YB** — cicilan Rp 12.028.000/bulan × 36 bulan (mulai April 2026)

**Cara mencatat pembayaran cicilan:**
1. Di kartu truk yang bersangkutan, klik **+ Record Payment**
2. Isi tanggal dan jumlah
3. Klik **Add Payment**

> Sisa hutang akan otomatis berkurang.

**Cara menambah truk baru:** Klik **+ Add Truck** di kanan atas.

### Sub-tab: Capital Injections (Modal)

Mencatat uang yang masuk ke bisnis dari pemilik atau pinjaman eksternal (bukan cicilan truk).

**Cara menambah:**
1. Pilih jenis: **Owner Capital** (modal sendiri) atau **Loan / Other Financing** (pinjaman)
2. Isi formulir dan klik **+ Record Capital / Loan**

---

## Tab 7 — Reports

Laporan keuangan lengkap dengan filter tanggal.

### Cara Menggunakan

1. Pilih periode: **All Time / This Month / Last Month / Year to Date** atau custom
2. Laporan otomatis ter-update

### Cara Export ke Excel

Klik tombol **📥 Download Excel Report** untuk mengunduh laporan dalam format `.xlsx`.

---

## Cara Import Laporan Bulanan Martha (Paling Penting!)

Setiap bulan Martha mengirim file Excel atau CSV berisi daftar trip dan pengeluaran. Cara impor:

1. Buka tab **Dashboard**
2. Klik tombol **📥 Import Excel Sheet**
3. Pilih file dari komputer
4. Sebuah jendela akan muncul — **pilih bulan yang sesuai** dengan laporan tersebut
5. Klik **📋 Parse & Preview →**
6. Cek daftar trip dan pengeluaran yang terdeteksi — semua bisa diedit jika ada yang salah
7. Klik **✓ Confirm Import** jika sudah benar

**Sistem otomatis:**
- Data duplikat (trip yang sudah ada) dilewati
- Pengeluaran langsung ditugaskan ke Martha jika dia satu-satunya pemegang petty cash
- Import tersimpan di **Import History** dan bisa dibatalkan jika salah

---

## Cara Membatalkan Import yang Salah

1. Buka tab **Dashboard**
2. Gulir ke bawah ke **📜 Import History**
3. Temukan impor yang salah
4. Klik **🗑 Undo**
5. Konfirmasi — semua trip dan pengeluaran dari impor tersebut akan dihapus

---

## Cara Reset Semua Data

> ⚠️ **Peringatan: Ini menghapus SEMUA data secara permanen.**

Di pojok kanan atas header, ada tombol kecil **🗑 Reset**. Klik hanya jika benar-benar perlu memulai dari awal.

---

## Pertanyaan Umum

**Apakah data aman jika browser ditutup?**
Ya. Semua data langsung tersimpan ke cloud (Supabase) setiap kali ada perubahan.

**Bisakah dua orang menggunakan aplikasi ini bersamaan?**
Bisa, tapi hindari mengedit data yang sama secara bersamaan karena bisa terjadi konflik.

**Bagaimana cara membuka di HP?**
Buka browser (Chrome atau Safari), ketik `kinkintrukindo.com`, masukkan kode otorisasi.

**Kenapa saldo kas kelihatan berbeda dari yang diharapkan?**
Pastikan semua pembayaran cicilan truk sudah dicatat di tab **Cash** sebagai Cash Out. Pengeluaran operasional juga harus dicatat agar saldo akurat.

**Bagaimana kalau ada pengeluaran Martha yang belum tercatat?**
Tambahkan manual di tab **Expenses** → pilih **Petty Cash** → pilih Martha.

---

## Kontak Teknis

Untuk perubahan fitur, perbaikan bug, atau bantuan teknis, hubungi developer dan berikan akses ke:
- Codebase di folder `kinkin-app`
- Supabase project: `ivybpomjhgfkrmfuxfsm`
- Vercel project: `kinkin-app` di tim `info-95777617s-projects`
