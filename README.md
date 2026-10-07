# Buku Piket Digital – SMPN 2 Pasawahan

Aplikasi web berbasis **Google Apps Script + Google Spreadsheet**, dengan kode di GitHub dan
sinkronisasi memakai **clasp**. Dokumen ini mencakup **Tahap 1: fondasi dan login**.

## Yang sudah ada di Tahap 1

- Login, ganti password wajib saat login pertama, keluar
- Password disimpan sebagai hash PBKDF2-SHA256 + salt di sheet tersembunyi `Kredensial`
- Sesi 6 jam, pengunci 15 menit setelah 5 kali salah password, pencabutan sesi saat reset/ganti password
- Peran diturunkan otomatis dari data (Admin, Kepala Sekolah, Guru Piket, Guru Mapel, Wali Kelas) + pemilih peran
- Admin: tambah/ubah/nonaktifkan pengguna, reset password (password sementara tampil sekali)
- Log aktivitas (`LogAktivitas`), tema biru tua + aksen hijau, mode gelap, responsif (HP sampai desktop)
- Menu tahap berikutnya sudah tampil dengan label **Segera hadir**

Rencana tahap: 2 Data master · 3 Absensi · 4 Kejadian & dashboard · 5 Laporan & notifikasi.

## Struktur

```
src/
  appsscript.json   manifes (zona waktu Asia/Jakarta, web app)
  Config.js         konstanta & skema sheet
  Util.js           AppError, pembantu, pembungkus cache
  Crypto.js         SHA-256 & PBKDF2 murni JS (diuji terhadap node:crypto)
  Db.js             akses spreadsheet berbasis nama header
  Audit.js          log aktivitas + pengaturan
  Users.js          akun & manajemen pengguna
  Roles.js          penurunan peran dari jadwal
  Auth.js           login, sesi, ganti password
  Api.js            pintu masuk tunggal + otorisasi per rute
  Main.js           doGet, api
  Setup.js          setupApp, resetAdminPassword, refreshCache
  Index.html  Styles.html  Client.html
tests/              uji otomatis (Node, tanpa dependensi)
```

## Pemasangan

### 1. Siapkan spreadsheet dan skrip

1. Buat Google Spreadsheet baru (misalnya "Buku Piket SMPN 2 Pasawahan").
2. **Ekstensi → Apps Script**. Skrip yang dibuat dari sini otomatis terikat ke spreadsheet.
3. Catat **Script ID**: *Project Settings → IDs*.

### 2. Hubungkan dengan GitHub dan clasp

```bash
npm install -g @google/clasp      # sekali saja
clasp login
cp .clasp.json.example .clasp.json   # lalu isi scriptId
clasp push                           # kirim isi src/ ke Apps Script
```

Di **Apps Script → Project Settings**, aktifkan **"Show appsscript.json manifest file"** bila ingin
memeriksanya; `clasp push` akan menimpa isinya dengan `src/appsscript.json`.

Alur kerja harian: ubah kode di repo → `npm test` → `git commit && git push` → `clasp push`.
`.clasp.json` sudah masuk `.gitignore`; jangan di-commit.

### 3. Jalankan setup (sekali)

Di editor Apps Script pilih fungsi **`setupApp`** → **Run** → setujui izin.
Lihat **Execution log**: akan tertera username `admin` dan **password sementara**. Catat; tidak ditampilkan lagi.
`setupApp` membuat semua sheet dan aman dijalankan ulang.

### 4. Deploy web app

**Deploy → New deployment → Web app**
- *Execute as*: **Me**
- *Who has access*: **Anyone** (login ditangani aplikasi sendiri)

Buka URL-nya, masuk sebagai `admin`, lalu ganti password.

> **Penting:** jangan bagikan spreadsheet ke guru. Siapa pun dengan akses edit dapat membuka sheet
> tersembunyi `Kredensial`. Guru cukup memakai URL web app. Setelah mengubah kode, buat
> **versi deployment baru** agar perubahan berlaku.

## Mencoba peran guru sebelum Tahap 2

Peran guru diturunkan dari **NIP** akun yang cocok dengan data jadwal. Sebelum ada formulirnya (Tahap 2), isi sheet langsung:

| Sheet | Kolom | Contoh | Hasil |
|---|---|---|---|
| `JadwalPelajaran` | hari, jam_ke, kelas, mapel, nip | Senin, 1, 7A, IPA, 1980… | peran **Guru Mapel** |
| `Kelas` | kelas, wali_nip | 8B, 1980… | peran **Wali Kelas** |
| `JadwalPiket` | hari, nip, tanggal_khusus, jenis | Rabu, 1980…, (kosong), tetap | **Guru Piket** pada hari Rabu |

`jenis` di `JadwalPiket`: `tetap` (tiap pekan, isi `hari`), `tambahan` (hanya pada `tanggal_khusus`, format `2026-10-07`),
`batal` (meniadakan piket pada `tanggal_khusus`). Setelah mengubah sheet langsung, jalankan **`refreshCache`**
dari editor (atau tunggu maksimal 5 menit).

## Pemeliharaan

| Fungsi | Kegunaan |
|---|---|
| `setupApp` | membuat sheet & admin pertama (aman diulang) |
| `resetAdminPassword` | password sementara baru untuk `admin` bila lupa |
| `refreshCache` | menyegarkan cache setelah sheet diubah manual |

Semua dijaga `assertOwner_()`: hanya pemilik skrip yang bisa menjalankannya. Ini disengaja, karena
fungsi publik Apps Script dapat dipanggil pengunjung web app lewat `google.script.run`.

## Uji

```bash
npm test          # kripto, urutan pemuatan file, dan seluruh alur backend (tanpa dependensi)
npm run test:e2e  # opsional: UI di Chromium, perlu Playwright
```

## Catatan keamanan

- PBKDF2 60.000 iterasi (`CONFIG.PASSWORD.PBKDF2_ITERATIONS`), di bawah rekomendasi OWASP untuk server khusus,
  karena batas waktu Apps Script. Dikompensasi pengunci percobaan, sheet kredensial tersembunyi, dan password
  sementara acak. Angka bisa dinaikkan; hash lama diperbarui otomatis saat login berikutnya.
- Cache tidak dijamin permanen: bila cache dikosongkan Google, pengguna cukup masuk ulang.
- Token sesi disimpan di `localStorage` perangkat; gunakan **Keluar** di perangkat bersama.
- Tidak ada backup otomatis. Gunakan *File → Riwayat versi* dan buat salinan manual berkala.
